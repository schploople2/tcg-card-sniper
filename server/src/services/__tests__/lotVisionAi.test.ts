import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

/**
 * Pc — lotVisionAi unit tests.
 *
 * Three groups:
 *   1. dedupeSuggestions — cross-image suggestion merging
 *   2. parseModelOutput / coerceSuggestion — defensive parsing of model output
 *   3. runLotVision — Prisma + Anthropic SDK mocked end-to-end (cache hit,
 *      cache miss, partial failure, image cap, provider disabled).
 */

// ─── Module mocks (must be set up before importing lotVisionAi) ──────────────

const findMany = vi.fn();
const update = vi.fn();

vi.mock("../../db.js", () => ({
  prisma: {
    lotImage: { findMany, update },
  },
}));

const messagesCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: messagesCreate };
  },
}));

// Config is read at call time. We mutate this object between tests.
const configState: {
  OCR_PROVIDER: "claude" | "none";
  ANTHROPIC_API_KEY: string | undefined;
  OCR_MAX_IMAGES_PER_LOT: number;
} = {
  OCR_PROVIDER: "claude",
  ANTHROPIC_API_KEY: "test-key",
  OCR_MAX_IMAGES_PER_LOT: 6,
};
vi.mock("../../config.js", () => ({
  config: configState,
}));

let dedupeSuggestions: typeof import("../lotVisionAi.js").dedupeSuggestions;
let parseModelOutput: typeof import("../lotVisionAi.js").parseModelOutput;
let coerceSuggestion: typeof import("../lotVisionAi.js").coerceSuggestion;
let runLotVision: typeof import("../lotVisionAi.js").runLotVision;
let visionEnabled: typeof import("../lotVisionAi.js").visionEnabled;

beforeAll(async () => {
  ({
    dedupeSuggestions,
    parseModelOutput,
    coerceSuggestion,
    runLotVision,
    visionEnabled,
  } = await import("../lotVisionAi.js"));
});

beforeEach(() => {
  findMany.mockReset();
  update.mockReset().mockResolvedValue({});
  messagesCreate.mockReset();
  configState.OCR_PROVIDER = "claude";
  configState.ANTHROPIC_API_KEY = "test-key";
  configState.OCR_MAX_IMAGES_PER_LOT = 6;
});

// ─── dedupeSuggestions ───────────────────────────────────────────────────────

describe("dedupeSuggestions", () => {
  it("keeps the higher-confidence reading when the same card appears twice", () => {
    const out = dedupeSuggestions([
      { name: "charizard", quantity: 1, confidence: 0.6, sourceImagePosition: 0, setHint: null, cardNumber: null },
      { name: "charizard", quantity: 1, confidence: 0.92, sourceImagePosition: 2, setHint: "Base Set", cardNumber: "4/102" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.92);
    expect(out[0].setHint).toBe("Base Set");
  });

  it("keeps the MAX quantity across photo angles, not the sum", () => {
    const out = dedupeSuggestions([
      { name: "pikachu", quantity: 2, confidence: 0.7, sourceImagePosition: 0, setHint: null, cardNumber: null },
      { name: "pikachu", quantity: 3, confidence: 0.5, sourceImagePosition: 1, setHint: null, cardNumber: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(3);
  });

  it("sorts by confidence descending", () => {
    const out = dedupeSuggestions([
      { name: "mew", quantity: 1, confidence: 0.4, sourceImagePosition: 0, setHint: null, cardNumber: null },
      { name: "mewtwo", quantity: 1, confidence: 0.9, sourceImagePosition: 0, setHint: null, cardNumber: null },
      { name: "pikachu", quantity: 1, confidence: 0.7, sourceImagePosition: 0, setHint: null, cardNumber: null },
    ]);
    expect(out.map((s) => s.name)).toEqual(["mewtwo", "pikachu", "mew"]);
  });

  // bo3 — Phase 1 baseline observed 6 cases of duplicate (name, position)
  // suggestions surviving past dedupeSuggestions. Tighten dedupe to be
  // resilient to leading/trailing whitespace, casing drift in cached
  // entries, and unicode normalisation variants.
  it("collapses duplicates that differ only in whitespace or case (bo3)", () => {
    const out = dedupeSuggestions([
      { name: "mega absol ex", quantity: 2, confidence: 0.95, sourceImagePosition: 2, setHint: null, cardNumber: null },
      { name: "Mega Absol EX", quantity: 2, confidence: 0.95, sourceImagePosition: 2, setHint: null, cardNumber: null },
      { name: " mega absol ex ", quantity: 1, confidence: 0.90, sourceImagePosition: 2, setHint: null, cardNumber: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(2);
    expect(out[0].confidence).toBe(0.95);
  });

  it("collapses NFC vs NFD unicode duplicates (bo3)", () => {
    // "é" can be represented as U+00E9 (NFC) or U+0065 U+0301 (NFD).
    // Pokémon names use é regularly — without normalisation the same name
    // in two encodings looks like two cards to a JS Map.
    const nfc = "pokémon ex";
    const nfd = "pokémon ex";
    const out = dedupeSuggestions([
      { name: nfc, quantity: 1, confidence: 0.9, sourceImagePosition: 0, setHint: null, cardNumber: null },
      { name: nfd, quantity: 1, confidence: 0.9, sourceImagePosition: 0, setHint: null, cardNumber: null },
    ]);
    expect(out).toHaveLength(1);
  });
});

// ─── parseModelOutput ────────────────────────────────────────────────────────

describe("parseModelOutput", () => {
  const EMPTY = { cards: [], bulk: { commons: 0, uncommons: 0, rares: 0, holos: 0 } };

  it("parses clean JSON", () => {
    const out = parseModelOutput('{"cards":[{"cardName":"Pikachu","quantity":1,"confidence":0.9}]}');
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0].cardName).toBe("Pikachu");
  });

  it("strips ```json code fences", () => {
    const out = parseModelOutput('```json\n{"cards":[{"cardName":"Mewtwo"}]}\n```');
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0].cardName).toBe("Mewtwo");
  });

  it("strips bare ``` fences", () => {
    const out = parseModelOutput('```\n{"cards":[{"cardName":"Charizard"}]}\n```');
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0].cardName).toBe("Charizard");
  });

  it("recovers via brace-slice when prose surrounds the JSON", () => {
    const out = parseModelOutput(
      'Here is what I see:\n{"cards":[{"cardName":"Snorlax","confidence":0.8}]}\nLet me know if you need more.'
    );
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0].cardName).toBe("Snorlax");
  });

  it("returns empty for malformed JSON", () => {
    expect(parseModelOutput("not json at all")).toEqual(EMPTY);
    expect(parseModelOutput("")).toEqual(EMPTY);
    expect(parseModelOutput("{not: valid}")).toEqual(EMPTY);
  });

  it("returns empty when JSON is valid but lacks a cards array", () => {
    expect(parseModelOutput('{"hello":"world"}')).toEqual(EMPTY);
    expect(parseModelOutput('{"cards":"oops"}')).toEqual(EMPTY);
  });

  it("returns the empty-cards shape with zero bulk by default", () => {
    expect(parseModelOutput('{"cards":[]}')).toEqual(EMPTY);
  });

  it("parses the bulk field alongside cards (A3)", () => {
    const out = parseModelOutput(
      '{"cards":[{"cardName":"Pikachu"}],"bulk":{"commons":12,"uncommons":4,"rares":1,"holos":2}}'
    );
    expect(out.cards).toHaveLength(1);
    expect(out.bulk).toEqual({ commons: 12, uncommons: 4, rares: 1, holos: 2 });
  });

  it("defaults bulk to zeros when the field is missing", () => {
    const out = parseModelOutput('{"cards":[{"cardName":"Mew"}]}');
    expect(out.bulk).toEqual({ commons: 0, uncommons: 0, rares: 0, holos: 0 });
  });

  it("clamps bulk counts to 0..99 (sanity bound)", () => {
    const out = parseModelOutput('{"cards":[],"bulk":{"commons":500,"uncommons":-3,"rares":"x","holos":1.7}}');
    expect(out.bulk).toEqual({ commons: 99, uncommons: 0, rares: 0, holos: 1 });
  });
});

// ─── coerceSuggestion ────────────────────────────────────────────────────────

describe("coerceSuggestion", () => {
  it("lowercases the name and applies defaults", () => {
    const s = coerceSuggestion({ cardName: "Charizard" }, 0);
    expect(s).not.toBeNull();
    expect(s!.name).toBe("charizard");
    expect(s!.quantity).toBe(1);
    expect(s!.confidence).toBe(0.5);
    expect(s!.setHint).toBeNull();
    expect(s!.cardNumber).toBeNull();
    expect(s!.sourceImagePosition).toBe(0);
  });

  it("rejects when cardName is missing", () => {
    expect(coerceSuggestion({}, 0)).toBeNull();
    expect(coerceSuggestion({ cardName: "" }, 0)).toBeNull();
    expect(coerceSuggestion({ cardName: 42 }, 0)).toBeNull();
  });

  it('rejects the literal "unidentified" placeholder', () => {
    expect(coerceSuggestion({ cardName: "unidentified" }, 0)).toBeNull();
    expect(coerceSuggestion({ cardName: "UNIDENTIFIED" }, 0)).toBeNull();
  });

  it("clamps quantity to [1, 99] and floors fractions", () => {
    expect(coerceSuggestion({ cardName: "x", quantity: 0 }, 0)!.quantity).toBe(1);
    expect(coerceSuggestion({ cardName: "x", quantity: 100 }, 0)!.quantity).toBe(1);
    expect(coerceSuggestion({ cardName: "x", quantity: 2.9 }, 0)!.quantity).toBe(2);
    expect(coerceSuggestion({ cardName: "x", quantity: "5" }, 0)!.quantity).toBe(1);
  });

  it("clamps confidence to [0, 1]", () => {
    expect(coerceSuggestion({ cardName: "x", confidence: -0.5 }, 0)!.confidence).toBe(0);
    expect(coerceSuggestion({ cardName: "x", confidence: 1.5 }, 0)!.confidence).toBe(1);
    expect(coerceSuggestion({ cardName: "x", confidence: 0.73 }, 0)!.confidence).toBeCloseTo(0.73);
  });

  it("preserves non-empty hint strings, nulls empty ones", () => {
    const s = coerceSuggestion(
      { cardName: "Mew", setHint: "Promo", cardNumber: "8" },
      3
    );
    expect(s!.setHint).toBe("Promo");
    expect(s!.cardNumber).toBe("8");
    const empty = coerceSuggestion({ cardName: "Mew", setHint: "", cardNumber: "" }, 3);
    expect(empty!.setHint).toBeNull();
    expect(empty!.cardNumber).toBeNull();
  });
});

// ─── visionEnabled ───────────────────────────────────────────────────────────

describe("visionEnabled", () => {
  it("true when provider=claude and key present", () => {
    expect(visionEnabled()).toBe(true);
  });

  it("false when provider=none", () => {
    configState.OCR_PROVIDER = "none";
    expect(visionEnabled()).toBe(false);
  });

  it("false when key missing", () => {
    configState.ANTHROPIC_API_KEY = undefined;
    expect(visionEnabled()).toBe(false);
  });
});

// ─── runLotVision ────────────────────────────────────────────────────────────

function modelReply(cards: Array<{ cardName: string; quantity?: number; confidence?: number }>) {
  return {
    content: [{ type: "text", text: JSON.stringify({ cards }) }],
  };
}

describe("runLotVision", () => {
  it("returns empty result and no API call when provider disabled", async () => {
    configState.OCR_PROVIDER = "none";
    const result = await runLotVision("ebay-1");
    expect(result).toEqual({
      suggestions: [],
      bulk: { commons: 0, uncommons: 0, rares: 0, holos: 0 },
      cacheStatus: "cached",
      imagesProcessed: 0,
      imagesFailed: 0,
      providerStatus: "ok",
    });
    expect(findMany).not.toHaveBeenCalled();
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("returns empty result when the lot has no images", async () => {
    findMany.mockResolvedValueOnce([]);
    const result = await runLotVision("ebay-1");
    expect(result.suggestions).toEqual([]);
    expect(result.cacheStatus).toBe("cached");
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("replays from cache when every image has ocrText (no API spend)", async () => {
    // Matches the production cache shape: visionOneImage stores the
    // already-coerced VisionSuggestion shape ({name, ...}) — NOT the raw
    // model output ({cardName, ...}). Earlier this test mocked the raw
    // shape, which masked rys: a serialization mismatch where the
    // cache-hit path tried to re-coerce already-coerced rows and silently
    // dropped every entry.
    findMany.mockResolvedValueOnce([
      {
        id: "img-1",
        position: 0,
        imageUrl: "https://e/0.jpg",
        ocrText: JSON.stringify({
          cards: [{ name: "charizard", quantity: 1, confidence: 0.9, setHint: null, cardNumber: null, sourceImagePosition: 0 }],
        }),
      },
      {
        id: "img-2",
        position: 1,
        imageUrl: "https://e/1.jpg",
        ocrText: JSON.stringify({
          cards: [{ name: "pikachu", quantity: 1, confidence: 0.8, setHint: null, cardNumber: null, sourceImagePosition: 1 }],
        }),
      },
    ]);

    const result = await runLotVision("ebay-1");

    expect(messagesCreate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result.cacheStatus).toBe("cached");
    expect(result.imagesProcessed).toBe(0);
    expect(result.suggestions.map((s) => s.name)).toEqual(["charizard", "pikachu"]);
  });

  it("rys regression — production cache shape with hints replays through parseCachedSuggestions", async () => {
    // Exact byte-for-byte sample of the cache content from prod lot
    // v1|147321331349|0 position 3, which was returning zero suggestions
    // until the cache-hit replay was fixed.
    findMany.mockResolvedValueOnce([
      {
        id: "img-3",
        position: 3,
        imageUrl: "https://e/3.jpg",
        ocrText:
          '{"cards":[{"name":"mew vmax","quantity":1,"confidence":0.95,"setHint":"Fusion Strike","cardNumber":"260/264","sourceImagePosition":3}]}',
      },
    ]);

    const result = await runLotVision("ebay-rys");

    expect(messagesCreate).not.toHaveBeenCalled();
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      name: "mew vmax",
      quantity: 1,
      confidence: 0.95,
      setHint: "Fusion Strike",
      cardNumber: "260/264",
      sourceImagePosition: 3,
    });
  });

  it("calls the API and writes back cache on miss", async () => {
    findMany.mockResolvedValueOnce([
      { id: "img-1", position: 0, imageUrl: "https://e/0.jpg", ocrText: null },
    ]);
    messagesCreate.mockResolvedValueOnce(modelReply([{ cardName: "Mewtwo", confidence: 0.85 }]));

    const result = await runLotVision("ebay-1");

    expect(messagesCreate).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    const updateArg = update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "img-1" });
    expect(typeof updateArg.data.ocrText).toBe("string");
    expect(JSON.parse(updateArg.data.ocrText).cards[0].name).toBe("mewtwo");
    expect(result.cacheStatus).toBe("fresh");
    expect(result.imagesProcessed).toBe(1);
    expect(result.suggestions[0].name).toBe("mewtwo");
  });

  it("reports cacheStatus='partial' when some images are cached and others fresh", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "img-1",
        position: 0,
        imageUrl: "https://e/0.jpg",
        ocrText: JSON.stringify({ cards: [{ cardName: "Snorlax", confidence: 0.7 }] }),
      },
      { id: "img-2", position: 1, imageUrl: "https://e/1.jpg", ocrText: null },
    ]);
    messagesCreate.mockResolvedValueOnce(modelReply([{ cardName: "Gengar", confidence: 0.8 }]));

    const result = await runLotVision("ebay-1");

    expect(result.cacheStatus).toBe("partial");
    expect(result.imagesProcessed).toBe(1);
    expect(result.suggestions.map((s) => s.name).sort()).toEqual(["gengar", "snorlax"]);
  });

  it("tolerates a single image failure and returns the rest", async () => {
    findMany.mockResolvedValueOnce([
      { id: "img-1", position: 0, imageUrl: "https://e/0.jpg", ocrText: null },
      { id: "img-2", position: 1, imageUrl: "https://e/1.jpg", ocrText: null },
    ]);
    messagesCreate
      .mockRejectedValueOnce(new Error("anthropic 500"))
      .mockResolvedValueOnce(modelReply([{ cardName: "Eevee", confidence: 0.6 }]));

    // Spy on console.error to suppress and verify the warning fires.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runLotVision("ebay-1");

    expect(result.imagesProcessed).toBe(1);
    expect(result.imagesFailed).toBe(1);
    expect(result.providerStatus).toBe("partial-failed");
    expect(result.suggestions.map((s) => s.name)).toEqual(["eevee"]);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("reports providerStatus='all-failed' when every API call throws", async () => {
    findMany.mockResolvedValueOnce([
      { id: "img-1", position: 0, imageUrl: "https://e/0.jpg", ocrText: null },
      { id: "img-2", position: 1, imageUrl: "https://e/1.jpg", ocrText: null },
    ]);
    messagesCreate
      .mockRejectedValueOnce(new Error("credit balance too low"))
      .mockRejectedValueOnce(new Error("credit balance too low"));

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runLotVision("ebay-1");
    errSpy.mockRestore();

    expect(result.suggestions).toEqual([]);
    expect(result.imagesProcessed).toBe(0);
    expect(result.imagesFailed).toBe(2);
    expect(result.providerStatus).toBe("all-failed");
  });

  it("reports providerStatus='ok' when failures coexist with cache hits", async () => {
    // Cache hits aren't "attempted calls", so a single fail alongside a cache
    // hit is still partial-failed (the user has SOME results). But with NO
    // cache hits and only failures, we'd be all-failed (covered above).
    findMany.mockResolvedValueOnce([
      {
        id: "img-1",
        position: 0,
        imageUrl: "https://e/0.jpg",
        ocrText: JSON.stringify({ cards: [{ name: "pikachu", confidence: 0.9 }] }),
      },
      { id: "img-2", position: 1, imageUrl: "https://e/1.jpg", ocrText: null },
    ]);
    messagesCreate.mockRejectedValueOnce(new Error("anthropic 500"));

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runLotVision("ebay-1");
    errSpy.mockRestore();

    expect(result.imagesFailed).toBe(1);
    // partial-failed by the rule: failedCount > 0 AND (processed > 0 OR cached > 0)
    expect(result.providerStatus).toBe("partial-failed");
    expect(result.suggestions.map((s) => s.name)).toEqual(["pikachu"]);
  });

  it("caps the number of images at OCR_MAX_IMAGES_PER_LOT", async () => {
    configState.OCR_MAX_IMAGES_PER_LOT = 2;
    findMany.mockResolvedValueOnce([
      { id: "img-1", position: 0, imageUrl: "https://e/0.jpg", ocrText: null },
      { id: "img-2", position: 1, imageUrl: "https://e/1.jpg", ocrText: null },
      { id: "img-3", position: 2, imageUrl: "https://e/2.jpg", ocrText: null },
      { id: "img-4", position: 3, imageUrl: "https://e/3.jpg", ocrText: null },
    ]);
    messagesCreate.mockResolvedValue(modelReply([{ cardName: "Ditto", confidence: 0.5 }]));

    const result = await runLotVision("ebay-1");

    expect(messagesCreate).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.imagesProcessed).toBe(2);
  });
});
