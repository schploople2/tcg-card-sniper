import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Minus, Trash2, Search, Image as ImageIcon, Sparkles, Check } from "lucide-react";
import {
  useLotAnnotation,
  useLotImages,
  useLotSuggestions,
  useSaveAnnotation,
} from "@/hooks/useLots";
import { useCatalogSearch } from "@/hooks/useCatalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";
import type { AddedLotCard, CatalogCard, Lot, LotSuggestion } from "@/types";

interface LotAnalyzerModalProps {
  lot: Lot | null;
  onClose: () => void;
}

/**
 * Modal where a user manually identifies the cards in a lot.
 *
 * Layout (lg screen):
 *   ┌─────────────────────────────────────────────────┐
 *   │ Lot title + close                                │
 *   ├──────────────────────┬──────────────────────────┤
 *   │  Image gallery       │  Auto-parsed cards (RO)  │
 *   │  (eBay listing imgs) │  Your added cards (edit) │
 *   │                      │  Notes                   │
 *   │                      │  Catalog search + add    │
 *   └──────────────────────┴──────────────────────────┘
 *
 * Portal-mounted on document.body to escape any ancestor stacking
 * contexts (we hit this gotcha on P4's notification drawer).
 */
export function LotAnalyzerModal({ lot, onClose }: LotAnalyzerModalProps) {
  // Hooks run with possibly-null ebayItemId; the hooks themselves bail out.
  const ebayItemId = lot?.ebayItemId ?? null;
  const { data: annotation, isLoading: annotationLoading } =
    useLotAnnotation(ebayItemId);
  const { data: imagesData, isLoading: imagesLoading } = useLotImages(ebayItemId);
  const saveAnnotation = useSaveAnnotation();
  const suggestionsMutation = useLotSuggestions();
  const [suggestions, setSuggestions] = useState<LotSuggestion[] | null>(null);
  const [acceptedSuggestionKeys, setAcceptedSuggestionKeys] = useState<Set<string>>(
    new Set()
  );

  // Local editable state — seeded once from server, edited freely, saved on submit.
  const [addedCards, setAddedCards] = useState<AddedLotCard[]>([]);
  const [notes, setNotes] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const catalog = useCatalogSearch(catalogQuery, !!lot);

  // Seed local state when the server data lands. We use the annotation's
  // updatedAt as the dependency so a re-open after save reflects the new value.
  useEffect(() => {
    if (annotation) {
      setAddedCards(
        (annotation.addedCards ?? []).map((c) => ({
          cardId: c.cardId,
          quantity: c.quantity,
          note: c.note ?? null,
        }))
      );
      setNotes(annotation.notes ?? "");
    }
  }, [annotation?.updatedAt, annotation]);

  // Reset catalog query and local state when the modal closes/reopens for a
  // different lot — otherwise old additions leak into a new analysis.
  useEffect(() => {
    if (!lot) {
      setCatalogQuery("");
    }
    // Reset AI suggestions whenever the active lot changes — they're
    // per-listing and would mislead if leaked across analyses.
    setSuggestions(null);
    setAcceptedSuggestionKeys(new Set());
  }, [lot?.ebayItemId, lot]);

  // Local index of card metadata for the in-modal cards-list rendering.
  // Catalog query results land here keyed by id so subsequent renders can
  // look up "what is cardId xyz" without a per-row fetch.
  const catalogIndex = useMemo(() => {
    const m = new Map<string, CatalogCard>();
    for (const c of catalog.data ?? []) m.set(c.id, c);
    return m;
  }, [catalog.data]);

  if (!lot) return null;

  const images = imagesData?.images ?? [];

  function handleAdd(card: CatalogCard) {
    setAddedCards((prev) => {
      // If the same cardId is already in the list, bump its quantity
      // instead of duplicating the row.
      const existing = prev.find((c) => c.cardId === card.id);
      if (existing) {
        return prev.map((c) =>
          c.cardId === card.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { cardId: card.id, quantity: 1, note: null }];
    });
  }

  function handleRequestSuggestions() {
    if (!lot) return;
    suggestionsMutation.mutate(lot.ebayItemId, {
      onSuccess: (data) => setSuggestions(data.suggestions),
    });
  }

  /**
   * Accept one vision suggestion: pick the first candidate printing (the
   * cheapest by default — `lotValuation` doesn't sort, so the catalog's
   * natural order wins; the user can refine via the catalog search). We
   * mark the suggestion accepted by name so the chip flips to "added".
   */
  function handleAcceptSuggestion(s: LotSuggestion) {
    if (s.candidates.length === 0) return;
    const cardId = s.candidates[0].cardId;
    setAddedCards((prev) => {
      const existing = prev.find((c) => c.cardId === cardId);
      if (existing) {
        return prev.map((c) =>
          c.cardId === cardId ? { ...c, quantity: c.quantity + s.quantity } : c
        );
      }
      return [
        ...prev,
        { cardId, quantity: s.quantity, note: null },
      ];
    });
    setAcceptedSuggestionKeys((prev) => new Set(prev).add(s.name));
  }

  function handleAcceptAllHighConfidence() {
    if (!suggestions) return;
    for (const s of suggestions) {
      if (s.confidence >= 0.8 && !acceptedSuggestionKeys.has(s.name)) {
        handleAcceptSuggestion(s);
      }
    }
  }

  function setQuantity(cardId: string, delta: number) {
    setAddedCards((prev) =>
      prev
        .map((c) =>
          c.cardId === cardId
            ? { ...c, quantity: Math.max(1, c.quantity + delta) }
            : c
        )
        .filter((c) => c.quantity > 0)
    );
  }

  function remove(cardId: string) {
    setAddedCards((prev) => prev.filter((c) => c.cardId !== cardId));
  }

  function handleSave() {
    if (!lot) return;
    saveAnnotation.mutate(
      {
        ebayItemId: lot.ebayItemId,
        addedCards,
        notes: notes.trim() || null,
      },
      { onSuccess: () => onClose() }
    );
  }

  const modal = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel — desktop: side-by-side; mobile: stacked, scrollable */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-800 bg-[#0a0f1e] shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white">Analyze this lot</h2>
              <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{lot.title}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 hover:bg-slate-800 shrink-0"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Body — two columns on lg, stacked below */}
          <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
            {/* Left: images */}
            <div className="flex-1 lg:w-1/2 lg:border-r border-slate-800 p-4 overflow-y-auto">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
                eBay listing photos
              </p>
              {imagesLoading ? (
                <div className="grid grid-cols-2 gap-2">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="aspect-square bg-slate-800 rounded-lg" />
                  ))}
                </div>
              ) : images.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
                  <ImageIcon className="h-10 w-10 mb-2" />
                  <p className="text-sm">No images available</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Listing may have ended or images failed to load.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {images.map((img) => (
                    <a
                      key={img.position}
                      href={img.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-lg overflow-hidden border border-slate-800 hover:border-slate-600 transition"
                    >
                      <img
                        src={img.imageUrl}
                        alt={`Listing image ${img.position + 1}`}
                        className="w-full aspect-square object-cover bg-slate-900"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Right: parsed + analysis */}
            <div className="flex-1 lg:w-1/2 flex flex-col min-h-0">
              {/* Auto-parsed (read-only summary) */}
              <div className="border-b border-slate-800 p-4">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">
                  Auto-parsed from title
                </p>
                {lot.parsedCards.length === 0 ? (
                  <p className="text-xs text-slate-600 italic">
                    No specific cards in the title — likely a generic mystery lot.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {lot.parsedCards.map((pc, i) => (
                      <Badge
                        key={i}
                        className="text-[10px] bg-slate-800 text-slate-300 border-slate-700"
                      >
                        {pc.quantity > 1 ? `${pc.quantity}× ` : ""}
                        {pc.name}
                        {pc.candidates.length > 1 && (
                          <span className="ml-1 text-slate-500">
                            ({pc.candidates.length})
                          </span>
                        )}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* AI suggestions (Pc) — lazy, click to load */}
              <div className="border-b border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" /> AI suggestions
                  </p>
                  {suggestions && suggestions.some((s) => s.confidence >= 0.8) && (
                    <button
                      type="button"
                      onClick={handleAcceptAllHighConfidence}
                      className="text-[10px] text-[#F5C518] hover:underline"
                    >
                      Add all high-confidence
                    </button>
                  )}
                </div>
                {suggestions === null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={suggestionsMutation.isPending || images.length === 0}
                    onClick={handleRequestSuggestions}
                    className="text-xs text-slate-300 hover:text-white hover:bg-slate-800 gap-1.5 h-auto py-1.5 px-2.5"
                    title="Ask Claude Vision to identify cards in the listing photos"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {suggestionsMutation.isPending
                      ? "Analyzing photos…"
                      : "Suggest cards from photos"}
                  </Button>
                ) : suggestions.length === 0 ? (
                  <p className="text-xs text-slate-600 italic">
                    No cards identified in the photos.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <SuggestionChip
                        key={`${s.name}-${s.sourceImagePosition ?? "?"}`}
                        suggestion={s}
                        accepted={acceptedSuggestionKeys.has(s.name)}
                        onAccept={() => handleAcceptSuggestion(s)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Your added cards */}
              <div className="border-b border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                    Your additions
                  </p>
                  <p className="text-[10px] text-slate-600">
                    {addedCards.length} card
                    {addedCards.length === 1 ? "" : "s"}
                  </p>
                </div>
                {annotationLoading ? (
                  <Skeleton className="h-12 w-full bg-slate-800 rounded" />
                ) : addedCards.length === 0 ? (
                  <p className="text-xs text-slate-600 italic">
                    Use the search below to identify cards from the photos and
                    add them here.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {addedCards.map((entry) => (
                      <AddedRow
                        key={entry.cardId}
                        entry={entry}
                        catalogIndex={catalogIndex}
                        onInc={() => setQuantity(entry.cardId, 1)}
                        onDec={() => setQuantity(entry.cardId, -1)}
                        onRemove={() => remove(entry.cardId)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="border-b border-slate-800 p-4">
                <label className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5 block">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Anything not captured by the card list — condition, set context, etc."
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#F5C518]"
                />
              </div>

              {/* Catalog search */}
              <div className="flex-1 flex flex-col min-h-0 p-4">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">
                  Add a card from the catalog
                </p>
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    autoFocus
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    placeholder='Try "Charizard", "Mew ex", or a set name'
                    className="pl-8 bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500"
                  />
                </div>
                <div className="flex-1 overflow-y-auto -mx-1 px-1">
                  {catalog.isFetching ? (
                    <div className="space-y-1.5">
                      {[...Array(3)].map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full bg-slate-800 rounded" />
                      ))}
                    </div>
                  ) : catalog.data && catalog.data.length === 0 ? (
                    <p className="text-xs text-slate-600 px-2 py-3">No matches.</p>
                  ) : (
                    <div className="space-y-1">
                      {(catalog.data ?? []).map((c) => (
                        <CatalogRow key={c.id} card={c} onAdd={() => handleAdd(c)} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t border-slate-800 px-5 py-3">
            <div className="text-xs text-slate-500">
              Saved analyses persist — they re-appear next time this listing surfaces.
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={onClose}
                className="text-slate-400 hover:text-slate-200"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saveAnnotation.isPending}
                className="bg-[#F5C518] text-slate-900 hover:bg-[#f0ba00] font-semibold"
              >
                {saveAnnotation.isPending ? "Saving…" : "Save analysis"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modal, document.body);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface AddedRowProps {
  entry: AddedLotCard;
  catalogIndex: Map<string, CatalogCard>;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
}

/**
 * One row in the "Your additions" list. Pulls the card's display
 * metadata from the in-modal catalog cache (populated by recent searches)
 * — if the entry's card isn't in the cache yet (e.g. an annotation from a
 * previous session), we render a sparse "cardId only" row. Acceptable
 * since the user already explicitly added it; the cardId is the source of
 * truth and the server has full metadata.
 */
function AddedRow({ entry, catalogIndex, onInc, onDec, onRemove }: AddedRowProps) {
  const card = catalogIndex.get(entry.cardId);
  return (
    <div className="flex items-center gap-2 rounded-md bg-slate-800/50 px-2 py-1.5">
      {card?.imageSmall ? (
        <img
          src={card.imageSmall}
          alt={card.name}
          className="h-8 w-6 object-contain rounded shrink-0"
        />
      ) : (
        <div className="h-8 w-6 rounded bg-slate-700 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-200 truncate">
          {card?.name ?? entry.cardId}
        </p>
        <p className="text-[10px] text-slate-500 truncate">
          {card ? `${card.setName} · #${card.number}` : "(open the catalog to load details)"}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onDec}
          className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
          title="Decrease quantity"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="w-5 text-center text-xs tabular-nums text-slate-200">
          {entry.quantity}
        </span>
        <button
          type="button"
          onClick={onInc}
          className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
          title="Increase quantity"
        >
          <Plus className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-slate-500 hover:bg-red-900/40 hover:text-red-400 ml-1"
          title="Remove"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

interface SuggestionChipProps {
  suggestion: LotSuggestion;
  accepted: boolean;
  onAccept: () => void;
}

/**
 * One AI-suggested card. Shows name + quantity + a confidence indicator
 * (• low / •• medium / ••• high). Clicking the + button pushes the first
 * candidate printing into Your additions; chip flips to a check on success.
 *
 * Suggestions with zero catalog candidates (model hallucinated a name we
 * don't recognise) are rendered greyed-out and non-actionable.
 */
function SuggestionChip({ suggestion, accepted, onAccept }: SuggestionChipProps) {
  const noMatch = suggestion.candidates.length === 0;
  const dots =
    suggestion.confidence >= 0.8 ? "•••" : suggestion.confidence >= 0.5 ? "••" : "•";
  const tooltipLines = [
    `${suggestion.quantity}× ${suggestion.name}`,
    suggestion.setHint ? `Set hint: ${suggestion.setHint}` : null,
    suggestion.cardNumber ? `Number: ${suggestion.cardNumber}` : null,
    `Confidence: ${(suggestion.confidence * 100).toFixed(0)}%`,
    suggestion.candidates.length > 0
      ? `${suggestion.candidates.length} catalog match${suggestion.candidates.length === 1 ? "" : "es"}`
      : "No catalog match — can't add",
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={onAccept}
      disabled={noMatch || accepted}
      title={tooltipLines.join("\n")}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition ${
        accepted
          ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-300"
          : noMatch
          ? "border-slate-800 bg-slate-900/50 text-slate-600 cursor-not-allowed"
          : "border-purple-700/40 bg-purple-900/20 text-purple-200 hover:bg-purple-900/40"
      }`}
    >
      {accepted ? (
        <Check className="h-3 w-3" />
      ) : (
        <Plus className="h-3 w-3" />
      )}
      <span className="font-medium capitalize">
        {suggestion.quantity > 1 && (
          <span className="text-slate-400 mr-0.5">{suggestion.quantity}×</span>
        )}
        {suggestion.name}
      </span>
      <span className="text-[9px] opacity-70 ml-0.5">{dots}</span>
    </button>
  );
}

interface CatalogRowProps {
  card: CatalogCard;
  onAdd: () => void;
}

function CatalogRow({ card, onAdd }: CatalogRowProps) {
  // Pick a single representative price for the listing hint. Catalog rows
  // can carry a `previewMarket` from the server-side normalisation.
  const preview = card.previewMarket;
  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex items-center gap-2 w-full rounded-md bg-slate-900 hover:bg-slate-800 px-2 py-1.5 text-left transition"
    >
      {card.imageSmall ? (
        <img
          src={card.imageSmall}
          alt={card.name}
          className="h-8 w-6 object-contain rounded shrink-0"
        />
      ) : (
        <div className="h-8 w-6 rounded bg-slate-700 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-200 truncate">{card.name}</p>
        <p className="text-[10px] text-slate-500 truncate">
          {card.setName} · #{card.number}
        </p>
      </div>
      {preview != null && (
        <span className="shrink-0 text-[10px] text-[#F5C518] font-medium tabular-nums">
          {formatCurrency(preview)}
        </span>
      )}
      <Plus className="h-3 w-3 text-slate-500 shrink-0" />
    </button>
  );
}
