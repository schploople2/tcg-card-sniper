import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SuggestionChip } from "./LotAnalyzerModal";
import type { LotSuggestion } from "@/types";

/**
 * The AI-suggestions section of the lot analyzer modal. Renders one of:
 *   - amber "AI vision is temporarily unavailable" + Retry button (nl6 all-failed)
 *   - "Suggest cards from photos" trigger button (initial state, suggestions===null)
 *   - "No cards identified in the photos" empty state (suggestions===[])
 *   - chip grid (with optional amber partial-failed warning above)
 *
 * Extracted from LotAnalyzerModal so tests can mount the AI-down branch
 * without standing up the entire modal + react-query + image fetch.
 */
export interface SuggestionsPanelProps {
  aiTemporarilyDown: boolean;
  suggestions: LotSuggestion[] | null;
  suggestionsWarning: string | null;
  isPending: boolean;
  imagesCount: number;

  // ytf: per-chip state keyed by suggestionKeyFn(s), not s.name — so
  // duplicate-name suggestions across photos don't share state.
  acceptedSuggestionKeys: Set<string>;
  pickedCardIdByKey: Record<string, string>;
  openPickerKey: string | null;
  /** Caller computes per-chip key from (suggestion, index). Index must be
   *  the render-list index so duplicate (name, position) pairs still get
   *  unique keys. */
  suggestionKeyFn: (s: LotSuggestion, index: number) => string;

  /** True when the lot has cached suggestions but no bulk data (legacy
   *  cache from before A3 shipped). Surfaces a small "Refresh AI"
   *  affordance so the user can opt in to a fresh OCR. */
  needsBulkRefresh?: boolean;
  /** Fires a force-refresh of the OCR cache for this lot. Called when
   *  user clicks the refresh link offered alongside needsBulkRefresh. */
  onRefreshSuggestions?: () => void;

  onRequestSuggestions: () => void;
  onAcceptAllHighConfidence: () => void;
  onAcceptSuggestion: (s: LotSuggestion, key: string) => void;
  onPickerOpenChange: (key: string, open: boolean) => void;
  onPickPrinting: (s: LotSuggestion, cardId: string, key: string) => void;
  onSearchFromSuggestion: (name: string) => void;
}

export function SuggestionsPanel({
  aiTemporarilyDown,
  suggestions,
  suggestionsWarning,
  isPending,
  imagesCount,
  needsBulkRefresh = false,
  onRefreshSuggestions,
  acceptedSuggestionKeys,
  pickedCardIdByKey,
  openPickerKey,
  suggestionKeyFn,
  onRequestSuggestions,
  onAcceptAllHighConfidence,
  onAcceptSuggestion,
  onPickerOpenChange,
  onPickPrinting,
  onSearchFromSuggestion,
}: SuggestionsPanelProps) {
  return (
    <div className="border-b border-slate-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> AI suggestions
        </p>
        {suggestions && suggestions.some((s) => s.confidence >= 0.8) && (
          <button
            type="button"
            onClick={onAcceptAllHighConfidence}
            className="text-[10px] text-[#F5C518] hover:underline"
          >
            Add all high-confidence
          </button>
        )}
      </div>

      {aiTemporarilyDown ? (
        <div className="space-y-2" data-testid="ai-down-banner">
          <p className="text-xs text-amber-400">
            AI vision is temporarily unavailable. Please try again later.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending || imagesCount === 0}
            onClick={onRequestSuggestions}
            className="text-xs text-slate-300 hover:text-white hover:bg-slate-800 gap-1.5 h-auto py-1.5 px-2.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isPending ? "Retrying…" : "Retry"}
          </Button>
        </div>
      ) : suggestions === null ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending || imagesCount === 0}
          onClick={onRequestSuggestions}
          className="text-xs text-slate-300 hover:text-white hover:bg-slate-800 gap-1.5 h-auto py-1.5 px-2.5"
          title="Ask Claude Vision to identify cards in the listing photos"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {isPending ? "Analyzing photos…" : "Suggest cards from photos"}
        </Button>
      ) : suggestions.length === 0 ? (
        <p className="text-xs text-slate-600 italic">
          No cards identified in the photos.
        </p>
      ) : (
        <div className="space-y-2">
          {suggestionsWarning && (
            <p
              className="text-[11px] text-amber-400"
              data-testid="partial-failed-warning"
            >
              {suggestionsWarning}
            </p>
          )}
          {/* qi3: cap the chip grid so binder-page lots with 40+ suggestions
              don't push BulkValuationPanel + additions + Save off-screen.
              max-h scrolls internally; everything below the panel stays
              reachable. */}
          <div
            className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto pr-1"
            data-testid="suggestion-chips"
          >
            {needsBulkRefresh && onRefreshSuggestions && (
              <p
                className="text-[11px] text-slate-500"
                data-testid="needs-bulk-refresh"
              >
                Bulk estimate not available for this analysis.{" "}
                <button
                  type="button"
                  onClick={onRefreshSuggestions}
                  disabled={isPending}
                  className="text-[#F5C518] hover:underline disabled:opacity-50"
                >
                  Refresh AI {isPending ? "(running…)" : "to update"}
                </button>
              </p>
            )}
            {suggestions.map((s, i) => {
              const k = suggestionKeyFn(s, i);
              return (
                <SuggestionChip
                  key={k}
                  suggestion={s}
                  accepted={acceptedSuggestionKeys.has(k)}
                  currentCardId={pickedCardIdByKey[k]}
                  pickerOpen={openPickerKey === k}
                  onAccept={() => onAcceptSuggestion(s, k)}
                  onPickerOpenChange={(open) => onPickerOpenChange(k, open)}
                  onPick={(cardId) => onPickPrinting(s, cardId, k)}
                  onSearch={onSearchFromSuggestion}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
