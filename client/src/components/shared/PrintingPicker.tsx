import * as Popover from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { Sparkles, Search } from "lucide-react";
import type { LotSuggestion } from "@/types";
import { formatCurrency } from "@/lib/utils";

interface PrintingPickerProps {
  /** The suggestion whose candidates we're choosing from. */
  suggestion: LotSuggestion;
  /** When set, marks the row whose cardId matches as the currently-picked
   *  printing (used by the chip's "Change printing" flow). */
  currentCardId?: string;
  /** Open/closed state — controlled from the parent (the chip's dropdown). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element the popover anchors to. */
  children: ReactNode;
  /** Fired when the user picks a candidate. Parent routes through useSaveAnnotation. */
  onPick: (cardId: string) => void;
  /** Fired when the user clicks the "search catalog" link in the empty state.
   *  Parent should scroll the modal's catalog search input into view and pre-fill it. */
  onSearch: (name: string) => void;
}

/**
 * Popover that lists every catalog printing for a vision-AI suggestion so the
 * user can override the auto-resolved candidate (`candidates[0]`). The first
 * candidate is marked with an "AI" badge so the user sees what they'd be
 * overriding. Picked cardId flows back to the parent's annotation save flow.
 *
 * The candidate list comes from the suggestion payload itself — `valueLot` on
 * the server populates it during vision resolution — so there is no extra
 * API call for the common case.
 */
export function PrintingPicker({
  suggestion,
  currentCardId,
  open,
  onOpenChange,
  children,
  onPick,
  onSearch,
}: PrintingPickerProps) {
  const candidates = suggestion.candidates;
  const aiPickCardId = candidates[0]?.cardId;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-80 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-2xl"
        >
          <header className="px-1.5 pt-1 pb-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Pick the right printing
            </p>
            <p className="text-xs text-slate-200 truncate capitalize">{suggestion.name}</p>
          </header>

          {candidates.length === 0 ? (
            <EmptyState name={suggestion.name} onSearch={onSearch} />
          ) : (
            <ul className="space-y-1 max-h-72 overflow-y-auto">
              {candidates.map((c) => (
                <li key={c.cardId}>
                  <CandidateRow
                    candidate={c}
                    isAiPick={c.cardId === aiPickCardId}
                    isCurrentPick={c.cardId === currentCardId}
                    onClick={() => {
                      onPick(c.cardId);
                      onOpenChange(false);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface CandidateRowProps {
  candidate: LotSuggestion["candidates"][number];
  isAiPick: boolean;
  isCurrentPick: boolean;
  onClick: () => void;
}

function CandidateRow({ candidate, isAiPick, isCurrentPick, onClick }: CandidateRowProps) {
  const year = candidate.setReleaseDate?.slice(0, 4) ?? null;
  const price = candidate.market != null ? formatCurrency(candidate.market) : "—";
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`printing-row-${candidate.cardId}`}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
        isCurrentPick
          ? "bg-emerald-900/30 hover:bg-emerald-900/40"
          : "hover:bg-slate-800"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-200 truncate">
          {candidate.setName}
          {year && <span className="text-slate-500"> · {year}</span>}
        </p>
        <p className="text-[10px] text-slate-500 truncate">#{candidate.number}</p>
      </div>
      <span className="shrink-0 text-xs text-slate-300 tabular-nums">{price}</span>
      {isAiPick && (
        <span
          title="The AI's auto-resolved guess"
          className="shrink-0 inline-flex items-center gap-0.5 rounded border border-purple-700/50 bg-purple-900/30 px-1.5 py-0.5 text-[9px] font-medium text-purple-300"
        >
          <Sparkles className="h-2.5 w-2.5" />
          AI
        </span>
      )}
    </button>
  );
}

interface EmptyStateProps {
  name: string;
  onSearch: (name: string) => void;
}

function EmptyState({ name, onSearch }: EmptyStateProps) {
  return (
    <div className="px-1.5 py-2 space-y-2">
      <p className="text-xs text-slate-400">
        No catalog printings found for{" "}
        <span className="text-slate-200">&ldquo;{name}&rdquo;</span>.
      </p>
      <button
        type="button"
        onClick={() => onSearch(name)}
        className="inline-flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200 transition"
      >
        <Search className="h-3 w-3" />
        Search the full catalog
      </button>
    </div>
  );
}
