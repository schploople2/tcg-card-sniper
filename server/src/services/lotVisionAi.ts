import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { recordOcrCall } from "./ocrUsage.js";

/**
 * Pc — Vision-AI card detection for lot listings.
 *
 * Given a set of `LotImage` rows, ask Claude Vision to identify every
 * Pokémon card visible in each image. Results are cached on the row's
 * `ocrText` column (existing reserved column — no migration) so a second
 * call for the same lot is a free DB read with no API spend.
 *
 * Output is a flat list of {name, quantity, confidence, ...} suggestions
 * suitable for piping into the existing `cardNameExtractor` →
 * `lotValuation` pipeline via the `namesToExtracted()` adapter.
 *
 * The service is lazy-on-demand: the route handler decides when to call
 * us. We don't background-process LotImages — spend is gated behind a
 * user clicking "Suggest cards from photos" in the analyzer modal.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** One card the model says it sees in an image. */
export interface VisionSuggestion {
  /** Canonical lowercased card name — matches what the local trie stores. */
  name: string;
  /** Inferred quantity, default 1. */
  quantity: number;
  /** 0..1 confidence reported by the model. */
  confidence: number;
  /** Optional set hint surfaced to the user; doesn't affect candidate resolution today. */
  setHint?: string | null;
  /** Optional card number hint (e.g. "4/102"). */
  cardNumber?: string | null;
  /** 0-indexed LotImage.position that produced this hit. */
  sourceImagePosition: number;
}

/**
 * A3 — Bulk-rarity counts for cards visible in the photos but NOT
 * specifically identified by name. These come from the model alongside
 * the per-card `suggestions[]` and let us value binder pages where most
 * cards are commons/uncommons that aren't worth individually pricing.
 */
export interface BulkCounts {
  commons: number;
  uncommons: number;
  rares: number;
  holos: number;
}

export interface VisionRunResult {
  suggestions: VisionSuggestion[];
  /**
   * Aggregated count of *unidentified* cards across every processed
   * image, broken out by rarity bucket. Zeroed out when no cache-hit /
   * processed image reported any bulk.
   */
  bulk: BulkCounts;
  /**
   * "cached"  — every image already had ocrText, no API call made.
   * "partial" — some images cached, some processed live.
   * "fresh"   — first run for this lot.
   */
  cacheStatus: "cached" | "partial" | "fresh";
  /** How many images were sent to the Anthropic API on this call (0 = cache hit). */
  imagesProcessed: number;
  /** How many image API calls threw (credit out, rate limit, transient 5xx). */
  imagesFailed: number;
  /**
   * "ok"            — every attempted call returned (results may still be empty).
   * "partial-failed"— at least one call succeeded and at least one failed.
   * "all-failed"    — every attempted call threw; suggestions are empty for
   *                   provider reasons, not because the photos lack cards.
   *                   Routes should surface this as 503 so the UI can show
   *                   "AI temporarily unavailable" instead of "no cards found".
   */
  providerStatus: "ok" | "partial-failed" | "all-failed";
}

const EMPTY_BULK: BulkCounts = {
  commons: 0,
  uncommons: 0,
  rares: 0,
  holos: 0,
};

/**
 * Defensively coerce a raw `bulk` object from cached or fresh model output
 * into a clean `BulkCounts`. Clamps each count to 0..99 (sanity bound —
 * no listing photo realistically shows 100+ of one rarity), defaults
 * missing/garbage fields to 0. Exported for tests.
 */
export function coerceBulk(raw: unknown): BulkCounts {
  if (!raw || typeof raw !== "object") return { ...EMPTY_BULK };
  const r = raw as Record<string, unknown>;
  const clamp = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(0, Math.min(99, Math.floor(v)))
      : 0;
  return {
    commons: clamp(r.commons),
    uncommons: clamp(r.uncommons),
    rares: clamp(r.rares),
    holos: clamp(r.holos),
  };
}

/** Sum two BulkCounts elementwise. */
export function addBulk(a: BulkCounts, b: BulkCounts): BulkCounts {
  return {
    commons: a.commons + b.commons,
    uncommons: a.uncommons + b.uncommons,
    rares: a.rares + b.rares,
    holos: a.holos + b.holos,
  };
}

// ─── Anthropic client (lazy) ─────────────────────────────────────────────────

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!config.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    _client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return _client;
}

/** Is the vision pipeline currently enabled? Routes use this to 503. */
export function visionEnabled(): boolean {
  return config.OCR_PROVIDER === "claude" && !!config.ANTHROPIC_API_KEY;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You identify Pokémon trading cards in eBay listing photos.

Look at the image and identify EVERY distinct Pokémon card you can see. For
each card return:
- cardName: the Pokémon's name as it appears on the card (e.g. "Charizard", "Mewtwo ex", "Pikachu V")
- setHint: the set name if visible (e.g. "Base Set", "Paldean Fates"), else null
- cardNumber: the card number if legible (e.g. "4/102", "232/091", "RC32"), else null
- quantity: how many copies of THIS exact card you can see in the image, default 1
- confidence: 0.0-1.0 — how confident you are this card is actually in the image and your reading is correct

ALSO count cards you can SEE but cannot specifically identify by name —
these are bulk cards (typical of binder pages or stacked lots). Bucket
each by rarity using the card's visible rarity symbol or art treatment:
- commons: small black circle (●) rarity symbol, no holo finish
- uncommons: small black diamond (◆) rarity symbol, no holo finish
- rares: small black star (★) symbol, no holo finish
- holos: any card with a holographic/foil finish on the artwork or whole
  card — includes Holo Rare, Reverse Holo, V, ex, EX, GX, VMAX, etc.

Do NOT double-count: any card you listed in cards[] above must be
excluded from the bulk counts. Bulk is for the "everything else" pile.
Return zeros if every visible card is in cards[].

Rules:
- Only count cards you can actually see. Do not invent cards.
- A "card" is a standalone Pokémon TCG card. Ignore booster packs, tins, sleeves, and merchandise.
- If lighting/angle makes a card unreadable, omit it from cards[] but you
  may still bucket it in bulk if its rarity is visible.

Return ONLY valid JSON in this exact shape — no prose, no markdown fences:
{"cards":[{"cardName":"...","setHint":"...","cardNumber":"...","quantity":1,"confidence":0.9}],"bulk":{"commons":0,"uncommons":0,"rares":0,"holos":0}}

If you see no Pokémon cards at all, return {"cards":[],"bulk":{"commons":0,"uncommons":0,"rares":0,"holos":0}}.`;

// ─── Image processing ────────────────────────────────────────────────────────

export interface RawCard {
  cardName?: unknown;
  setHint?: unknown;
  cardNumber?: unknown;
  quantity?: unknown;
  confidence?: unknown;
}

export interface ParsedModelOutput {
  cards: RawCard[];
  bulk: BulkCounts;
}

/** Parse a model response, defensive against malformed JSON / extra prose. Exported for tests. */
export function parseModelOutput(text: string): ParsedModelOutput {
  // First try clean JSON. If that fails, try to strip surrounding prose
  // and code fences and try again. Last resort: empty.
  const attempts = [
    text,
    text.replace(/```json\s*/gi, "").replace(/```/g, "").trim(),
    text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
  ];
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && Array.isArray(parsed.cards)) {
        return {
          cards: parsed.cards as RawCard[],
          bulk: coerceBulk(parsed.bulk),
        };
      }
    } catch {
      // continue
    }
  }
  return { cards: [], bulk: { ...EMPTY_BULK } };
}

/**
 * Replay a cached `LotImage.ocrText` blob into VisionSuggestion[]. The
 * cache stores the already-coerced shape (see `cacheJson` in
 * `visionOneImage`), so this is mostly a guarded JSON.parse + minimal
 * shape check — not the raw-model-output coercion pipeline.
 *
 * The `position` override exists because older cache entries may have
 * been written before sourceImagePosition was added; we re-stamp it
 * from the loop context to be safe.
 *
 * Exported for tests.
 */
export function parseCachedSuggestions(
  text: string,
  position: number
): { suggestions: VisionSuggestion[]; bulk: BulkCounts } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { suggestions: [], bulk: { ...EMPTY_BULK } };
  }
  const cards =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { cards?: unknown }).cards)
      ? ((parsed as { cards: unknown[] }).cards)
      : [];
  const bulk = coerceBulk(
    parsed && typeof parsed === "object"
      ? (parsed as { bulk?: unknown }).bulk
      : undefined
  );
  const out: VisionSuggestion[] = [];
  for (const c of cards) {
    if (!c || typeof c !== "object") continue;
    const rec = c as Record<string, unknown>;
    // Defensive: accept either the canonical `name` (current writer) or
    // `cardName` (would only appear if someone reverts to raw-model output
    // in cache). Drops anything without a string name.
    const rawName =
      typeof rec.name === "string"
        ? rec.name
        : typeof rec.cardName === "string"
        ? rec.cardName
        : "";
    const name = rawName.trim().toLowerCase();
    if (!name || name === "unidentified") continue;
    const quantity =
      typeof rec.quantity === "number" && rec.quantity >= 1 && rec.quantity <= 99
        ? Math.floor(rec.quantity)
        : 1;
    const confidence =
      typeof rec.confidence === "number"
        ? Math.max(0, Math.min(1, rec.confidence))
        : 0.5;
    out.push({
      name,
      quantity,
      confidence,
      setHint:
        typeof rec.setHint === "string" && rec.setHint.length > 0 ? rec.setHint : null,
      cardNumber:
        typeof rec.cardNumber === "string" && rec.cardNumber.length > 0
          ? rec.cardNumber
          : null,
      sourceImagePosition: position,
    });
  }
  return { suggestions: out, bulk };
}

/** Normalise one raw card object from the model into a VisionSuggestion. Exported for tests. */
export function coerceSuggestion(
  raw: RawCard,
  position: number
): VisionSuggestion | null {
  const name = typeof raw.cardName === "string" ? raw.cardName.trim().toLowerCase() : "";
  if (!name || name === "unidentified") return null;
  const quantity =
    typeof raw.quantity === "number" && raw.quantity >= 1 && raw.quantity <= 99
      ? Math.floor(raw.quantity)
      : 1;
  const confidence =
    typeof raw.confidence === "number"
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.5;
  return {
    name,
    quantity,
    confidence,
    setHint: typeof raw.setHint === "string" && raw.setHint.length > 0 ? raw.setHint : null,
    cardNumber: typeof raw.cardNumber === "string" && raw.cardNumber.length > 0 ? raw.cardNumber : null,
    sourceImagePosition: position,
  };
}

/**
 * Run vision over one image. Returns suggestions + the canonical JSON
 * string we cache on `LotImage.ocrText` so a future call can rehydrate
 * without hitting the API.
 */
async function visionOneImage(
  imageUrl: string,
  position: number
): Promise<{ suggestions: VisionSuggestion[]; bulk: BulkCounts; cacheJson: string }> {
  const resp = await client().messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "url", url: imageUrl },
          },
          {
            type: "text",
            text: "Identify every Pokémon card visible. JSON only.",
          },
        ],
      },
    ],
  });

  // Concatenate any text blocks the model returned.
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = parseModelOutput(text);
  const suggestions = parsed.cards
    .map((r) => coerceSuggestion(r, position))
    .filter((s): s is VisionSuggestion => s !== null);

  return {
    suggestions,
    bulk: parsed.bulk,
    cacheJson: JSON.stringify({ cards: suggestions, bulk: parsed.bulk }),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Process every image attached to a lot. Idempotent — images with cached
 * `ocrText` are read from DB; new images are sent to Claude and the
 * result persisted.
 *
 * Honours `OCR_MAX_IMAGES_PER_LOT` to cap spend. Images beyond the cap
 * are silently skipped (they remain processable on a later request if
 * the cap is raised). Returns early with an empty result when the
 * provider is disabled.
 */
/**
 * Cached-only read of OCR results for a lot. Never calls the Anthropic
 * API — if no images have cached ocrText, returns empty. Used by the
 * modal's "rehydrate on open" path so re-opening a previously-analyzed
 * lot shows its AI suggestions + bulk panel without re-prompting the
 * user to click "Suggest cards from photos".
 *
 * Returns null when nothing is cached so the route can 204.
 */
export async function readCachedLotVision(
  ebayItemId: string
): Promise<{ suggestions: VisionSuggestion[]; bulk: BulkCounts } | null> {
  const images = await prisma.lotImage.findMany({
    where: { ebayItemId, ocrText: { not: null } },
    orderBy: { position: "asc" },
    select: { position: true, ocrText: true },
  });
  if (images.length === 0) return null;

  const suggestions: VisionSuggestion[] = [];
  let bulk: BulkCounts = { ...EMPTY_BULK };
  for (const img of images) {
    if (!img.ocrText) continue;
    const cached = parseCachedSuggestions(img.ocrText, img.position);
    suggestions.push(...cached.suggestions);
    bulk = addBulk(bulk, cached.bulk);
  }
  return { suggestions, bulk };
}

export async function runLotVision(
  ebayItemId: string,
  opts: { userId?: string } = {}
): Promise<VisionRunResult> {
  if (!visionEnabled()) {
    return {
      suggestions: [],
      bulk: { ...EMPTY_BULK },
      cacheStatus: "cached",
      imagesProcessed: 0,
      imagesFailed: 0,
      providerStatus: "ok",
    };
  }

  const images = await prisma.lotImage.findMany({
    where: { ebayItemId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, imageUrl: true, ocrText: true },
  });
  if (images.length === 0) {
    return {
      suggestions: [],
      bulk: { ...EMPTY_BULK },
      cacheStatus: "cached",
      imagesProcessed: 0,
      imagesFailed: 0,
      providerStatus: "ok",
    };
  }

  const capped = images.slice(0, config.OCR_MAX_IMAGES_PER_LOT);

  const suggestions: VisionSuggestion[] = [];
  let bulk: BulkCounts = { ...EMPTY_BULK };
  let processedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;

  for (const img of capped) {
    if (img.ocrText) {
      // Cache hit — replay stored suggestions. The cache stores the
      // *already-coerced* VisionSuggestion shape ({name, confidence, ...}),
      // NOT the raw model output ({cardName, ...}), so don't run it through
      // coerceSuggestion again — that would look for `cardName` on
      // already-renamed objects and silently drop every cached entry.
      // (rys: this was a real bug that wiped out every cached lot's
      // suggestions until the next manual re-OCR.)
      const cached = parseCachedSuggestions(img.ocrText, img.position);
      for (const s of cached.suggestions) {
        suggestions.push(s);
      }
      bulk = addBulk(bulk, cached.bulk);
      cachedCount += 1;
      continue;
    }

    try {
      const { suggestions: imgSuggestions, bulk: imgBulk, cacheJson } = await visionOneImage(
        img.imageUrl,
        img.position
      );
      await prisma.lotImage.update({
        where: { id: img.id },
        data: { ocrText: cacheJson },
      });
      suggestions.push(...imgSuggestions);
      bulk = addBulk(bulk, imgBulk);
      processedCount += 1;
    } catch (err) {
      failedCount += 1;
      console.error(
        `[lotVisionAi] image position=${img.position} failed:`,
        err instanceof Error ? err.message : err
      );
      // Continue with remaining images — partial results are better than none.
    }
  }

  let cacheStatus: VisionRunResult["cacheStatus"];
  if (processedCount === 0) cacheStatus = "cached";
  else if (cachedCount === 0) cacheStatus = "fresh";
  else cacheStatus = "partial";

  // Distinguish "every Anthropic call threw" from "calls succeeded but the
  // photos legitimately had no identifiable cards". Only count attempted
  // calls (cache hits don't count toward attempted) — if every cache-miss
  // image failed and there were no cache hits, that's all-failed.
  const attempted = processedCount + failedCount;
  let providerStatus: VisionRunResult["providerStatus"];
  if (attempted === 0 || failedCount === 0) providerStatus = "ok";
  else if (processedCount === 0 && cachedCount === 0) providerStatus = "all-failed";
  else providerStatus = "partial-failed";

  console.log(
    `[lotVisionAi] ebayItemId=${ebayItemId} ${capped.length} images → ${suggestions.length} suggestions (${processedCount} fresh / ${cachedCount} cached / ${failedCount} failed, status=${providerStatus})`
  );

  if (opts.userId) {
    try {
      await recordOcrCall(opts.userId, processedCount);
    } catch (err) {
      // Telemetry must never break the user-facing call. Log and continue.
      console.error(
        "[lotVisionAi] recordOcrCall failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return {
    suggestions,
    bulk,
    cacheStatus,
    imagesProcessed: processedCount,
    imagesFailed: failedCount,
    providerStatus,
  };
}

/**
 * Dedupe suggestions by canonical (name, sourceImagePosition) — the model
 * occasionally lists the same card twice in one image if it's confused.
 * When merging duplicates we keep the higher confidence and sum quantity.
 */
export function dedupeSuggestions(suggestions: VisionSuggestion[]): VisionSuggestion[] {
  const byKey = new Map<string, VisionSuggestion>();
  for (const s of suggestions) {
    // Cross-image dedupe: same name across different photos likely shows the
    // SAME physical card photographed from different angles. We pick the
    // single highest-confidence reading rather than summing.
    const key = s.name;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...s });
    } else if (s.confidence > existing.confidence) {
      byKey.set(key, { ...s, quantity: Math.max(existing.quantity, s.quantity) });
    } else {
      existing.quantity = Math.max(existing.quantity, s.quantity);
    }
  }
  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
}
