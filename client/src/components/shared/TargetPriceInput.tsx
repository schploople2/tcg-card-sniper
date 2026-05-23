import { useEffect, useState } from "react";
import { Target as TargetIcon, X } from "lucide-react";
import { useUpdateCard } from "@/hooks/useCards";
import { formatCurrency } from "@/lib/utils";

interface TargetPriceInputProps {
  cardId: string;
  /** Current target on the card, USD. Null/undefined = no target set. */
  value: number | string | null | undefined;
  /** Optional callback fired after a successful save. Used to refresh
   *  listing/alert queries that depend on the target. */
  onSaved?: () => void;
  className?: string;
}

/**
 * Inline editor for WatchedCard.targetPrice. Two display modes:
 *   - "no target" → an icon button that, on click, opens an inline input
 *   - "has target" → shows the formatted value with edit + clear actions
 *
 * Submit on Enter or blur. Esc cancels back to the current value. Clears
 * via the × button (sends targetPrice: null).
 *
 * Why an inline editor rather than a modal? Watchlist users edit targets
 * frequently as prices move — modal friction would slow them down.
 */
export function TargetPriceInput({
  cardId,
  value,
  onSaved,
  className = "",
}: TargetPriceInputProps) {
  const updateCard = useUpdateCard();
  const current = value == null ? null : Number(value);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(current?.toString() ?? "");

  // Reset draft whenever the upstream value changes (e.g. after save).
  useEffect(() => {
    setDraft(current?.toString() ?? "");
  }, [current]);

  const save = async (raw: string) => {
    const trimmed = raw.trim();
    // Empty input or 0 → clear. Otherwise must parse to a positive number.
    let payload: number | null;
    if (trimmed === "" || trimmed === "0") {
      payload = null;
    } else {
      const n = parseFloat(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        // Quietly revert — toast is overkill for a transient typo.
        setDraft(current?.toString() ?? "");
        setEditing(false);
        return;
      }
      payload = n;
    }
    // No-op if unchanged (and not entering edit-mode-then-cancel).
    if (payload === current) {
      setEditing(false);
      return;
    }
    await updateCard.mutateAsync({ id: cardId, targetPrice: payload });
    setEditing(false);
    onSaved?.();
  };

  if (!editing && current === null) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition ${className}`}
        title="Set a target price — we'll alert you when a listing drops to or below it"
      >
        <TargetIcon className="h-3 w-3" />
        Set target
      </button>
    );
  }

  if (!editing && current !== null) {
    return (
      <div className={`inline-flex items-center gap-1 ${className}`}>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-full bg-emerald-900/30 px-2 py-0.5 text-[11px] text-emerald-300 border border-emerald-700/40 hover:bg-emerald-900/50 transition tabular-nums"
          title="Click to edit target"
        >
          <TargetIcon className="h-3 w-3" />
          {formatCurrency(current)}
        </button>
        <button
          type="button"
          onClick={() => save("")}
          className="text-slate-600 hover:text-red-400 transition"
          title="Clear target"
          disabled={updateCard.isPending}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[11px] ${className}`}
    >
      <TargetIcon className="h-3 w-3 text-slate-500" />
      <span className="text-slate-500">$</span>
      <input
        autoFocus
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save(draft);
          if (e.key === "Escape") {
            setDraft(current?.toString() ?? "");
            setEditing(false);
          }
        }}
        className="w-16 bg-transparent text-slate-200 outline-none tabular-nums"
        placeholder="0.00"
        disabled={updateCard.isPending}
      />
    </span>
  );
}
