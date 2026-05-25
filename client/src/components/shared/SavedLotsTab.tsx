import { Bookmark, ExternalLink, Layers, Wand2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { useSavedLots, useDeleteSavedLot, type SavedLot } from "@/hooks/useSavedLots";
import type { Lot } from "@/types";

/**
 * u8y — "Saved" tab on the Dashboard. Renders the user's pinned lots
 * using the snapshotted fields on each SavedLot row, so saved entries
 * keep rendering even after the underlying Lot cache row expires.
 *
 * Clicking Analyze opens the same LotAnalyzerModal used in the live
 * search tab. We construct a minimal "shadow Lot" from the snapshot
 * fields — the modal will hydrate the rest (images, annotations,
 * suggestions) from its own queries.
 */
export interface SavedLotsTabProps {
  onAnalyze: (lot: Lot) => void;
}

export function SavedLotsTab({ onAnalyze }: SavedLotsTabProps) {
  const { data, isLoading, error } = useSavedLots();
  const deleteSaved = useDeleteSavedLot();

  if (isLoading) {
    return <div className="text-sm text-slate-500 p-6">Loading saved lots…</div>;
  }
  if (error) {
    return (
      <div className="text-sm text-amber-400 p-6">
        Couldn't load saved lots. Try again in a moment.
      </div>
    );
  }
  const rows = data?.savedLots ?? [];
  if (rows.length === 0) {
    return (
      <div className="text-sm text-slate-500 p-6 space-y-2">
        <p className="flex items-center gap-2">
          <Bookmark className="h-4 w-4" />
          No saved lots yet.
        </p>
        <p className="text-xs text-slate-600">
          Tap the bookmark icon on any lot in the Lots tab to save it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <SavedLotRow
          key={row.id}
          row={row}
          onRemove={() => deleteSaved.mutate(row.id)}
          onAnalyze={() => onAnalyze(savedLotToShadowLot(row))}
        />
      ))}
    </div>
  );
}

/**
 * Construct a minimal Lot from a SavedLot snapshot so LotAnalyzerModal
 * (which expects a Lot) can render header + buttons. parsedCards is
 * left empty — the modal hydrates real data via its own hooks
 * (useLotImages, useLotAnnotation, useLotSuggestions). Estimates default
 * to 0 / UNSCORED until the user re-OCRs / re-searches.
 */
function savedLotToShadowLot(s: SavedLot): Lot {
  const price = Number(s.listingPrice);
  return {
    id: s.id, // SavedLot.id is fine as the React key inside the modal
    ebayItemId: s.ebayItemId,
    title: s.title,
    imageUrl: s.imageUrl,
    ebayUrl: s.ebayUrl,
    listingPrice: price,
    shippingCost: null,
    totalCost: price,
    lowEstimate: 0,
    highEstimate: 0,
    lotScore: 0,
    lotTier: "UNSCORED",
    kind: "BIN",
    bids: null,
    endTime: null,
    parsedCards: [],
  };
}

function SavedLotRow({
  row,
  onRemove,
  onAnalyze,
}: {
  row: SavedLot;
  onRemove: () => void;
  onAnalyze: () => void;
}) {
  const savedAt = new Date(row.createdAt);
  return (
    <div
      className="rounded-xl border border-slate-800 bg-[#0f172a] p-4 space-y-2"
      data-testid="saved-lot-row"
    >
      <div className="flex items-start gap-3">
        {row.imageUrl ? (
          <img
            src={row.imageUrl}
            alt=""
            className="h-16 w-12 object-contain rounded shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="h-16 w-12 rounded bg-slate-800 flex items-center justify-center shrink-0">
            <Layers className="h-5 w-5 text-slate-600" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onAnalyze}
            className="block text-left text-sm text-slate-200 line-clamp-2 leading-snug hover:text-white hover:underline decoration-slate-600 underline-offset-2 focus:outline-none focus:underline"
            title="Open the lot analyzer"
          >
            {row.title}
          </button>
          <p className="text-[11px] text-slate-500 mt-1">
            Saved {savedAt.toLocaleDateString()} ·{" "}
            <span className="text-[#F5C518] font-medium">
              {formatCurrency(Number(row.listingPrice))}
            </span>
          </p>
        </div>
        <div className="shrink-0 flex flex-col gap-1.5 items-end">
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove from Saved"
            className="p-1 text-slate-500 hover:text-red-400 transition"
            title="Remove from Saved"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <a
            href={row.ebayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-[#F5C518] px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-[#f0ba00] transition"
          >
            Buy
            <ExternalLink className="h-3 w-3" />
          </a>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onAnalyze}
            className="text-[11px] text-slate-300 hover:text-white hover:bg-slate-800 gap-1 px-2 py-1 h-auto"
            title="Open the lot analyzer"
          >
            <Wand2 className="h-3 w-3" />
            Analyze
          </Button>
        </div>
      </div>
    </div>
  );
}
