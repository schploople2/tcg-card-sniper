import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { prisma } from "../db.js";

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

export interface VisionRunResult {
  suggestions: VisionSuggestion[];
  /**
   * "cached"  — every image already had ocrText, no API call made.
   * "partial" — some images cached, some processed live.
   * "fresh"   — first run for this lot.
   */
  cacheStatus: "cached" | "partial" | "fresh";
  /** How many images were sent to the Anthropic API on this call (0 = cache hit). */
  imagesProcessed: number;
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

Rules:
- Only count cards you can actually see. Do not invent cards.
- A "card" is a standalone Pokémon TCG card. Ignore booster packs, tins, sleeves, and merchandise.
- If lighting/angle makes a card unreadable, omit it rather than guessing.
- If 5+ cards are present and indistinct (e.g. a stack), surface the ones whose names you can read and one summary entry with cardName="unidentified" if useful.

Return ONLY valid JSON in this exact shape — no prose, no markdown fences:
{"cards":[{"cardName":"...","setHint":"...","cardNumber":"...","quantity":1,"confidence":0.9}]}

If you see no Pokémon cards, return {"cards":[]}.`;

// ─── Image processing ────────────────────────────────────────────────────────

export interface RawCard {
  cardName?: unknown;
  setHint?: unknown;
  cardNumber?: unknown;
  quantity?: unknown;
  confidence?: unknown;
}

/** Parse a model response, defensive against malformed JSON / extra prose. Exported for tests. */
export function parseModelOutput(text: string): RawCard[] {
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
        return parsed.cards as RawCard[];
      }
    } catch {
      // continue
    }
  }
  return [];
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
): Promise<{ suggestions: VisionSuggestion[]; cacheJson: string }> {
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

  const raw = parseModelOutput(text);
  const suggestions = raw
    .map((r) => coerceSuggestion(r, position))
    .filter((s): s is VisionSuggestion => s !== null);

  return {
    suggestions,
    cacheJson: JSON.stringify({ cards: suggestions }),
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
export async function runLotVision(ebayItemId: string): Promise<VisionRunResult> {
  if (!visionEnabled()) {
    return { suggestions: [], cacheStatus: "cached", imagesProcessed: 0 };
  }

  const images = await prisma.lotImage.findMany({
    where: { ebayItemId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, imageUrl: true, ocrText: true },
  });
  if (images.length === 0) {
    return { suggestions: [], cacheStatus: "cached", imagesProcessed: 0 };
  }

  const capped = images.slice(0, config.OCR_MAX_IMAGES_PER_LOT);

  const suggestions: VisionSuggestion[] = [];
  let processedCount = 0;
  let cachedCount = 0;

  for (const img of capped) {
    if (img.ocrText) {
      // Cache hit — replay stored suggestions.
      const raw = parseModelOutput(img.ocrText);
      for (const r of raw) {
        const s = coerceSuggestion(r, img.position);
        if (s) suggestions.push(s);
      }
      cachedCount += 1;
      continue;
    }

    try {
      const { suggestions: imgSuggestions, cacheJson } = await visionOneImage(
        img.imageUrl,
        img.position
      );
      await prisma.lotImage.update({
        where: { id: img.id },
        data: { ocrText: cacheJson },
      });
      suggestions.push(...imgSuggestions);
      processedCount += 1;
    } catch (err) {
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

  console.log(
    `[lotVisionAi] ebayItemId=${ebayItemId} ${capped.length} images → ${suggestions.length} suggestions (${processedCount} fresh / ${cachedCount} cached)`
  );

  return { suggestions, cacheStatus, imagesProcessed: processedCount };
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
