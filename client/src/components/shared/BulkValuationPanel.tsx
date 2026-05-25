import { Layers } from "lucide-react";
import type { BulkCounts, BulkValuation } from "@/types";

/**
 * A3 — Bulk-rarity valuation row in the lot analyzer modal.
 *
 * Shown beneath the AI suggestions when the vision pass also reported
 * unidentified cards bucketed by rarity. Renders a one-line headline
 * "≈ N bulk cards · $X.XX – $Y.YY" with a small per-bucket breakdown
 * hover-tooltip.
 *
 * Hides itself entirely when totalCards is 0 (nothing to value).
 */
export function BulkValuationPanel({
  counts,
  valuation,
}: {
  counts: BulkCounts | null | undefined;
  valuation: BulkValuation | null | undefined;
}) {
  if (!valuation || valuation.totalCards === 0) return null;
  const parts: string[] = [];
  if (counts?.commons) parts.push(`${counts.commons} common${counts.commons === 1 ? "" : "s"}`);
  if (counts?.uncommons) parts.push(`${counts.uncommons} uncommon${counts.uncommons === 1 ? "" : "s"}`);
  if (counts?.rares) parts.push(`${counts.rares} rare${counts.rares === 1 ? "" : "s"}`);
  if (counts?.holos) parts.push(`${counts.holos} holo${counts.holos === 1 ? "" : "s"}`);

  return (
    <div
      className="border-b border-slate-800 p-4"
      data-testid="bulk-valuation-panel"
    >
      <p className="text-[11px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5 mb-2">
        <Layers className="h-3 w-3" /> Bulk estimate
      </p>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-slate-200">
          ≈ {valuation.totalCards} unidentified card
          {valuation.totalCards === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-emerald-400">
          ${valuation.low.toFixed(2)} – ${valuation.high.toFixed(2)}
        </span>
        <span className="text-[10px] text-slate-600">
          (mid ${valuation.mid.toFixed(2)})
        </span>
      </div>
      {parts.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-1">{parts.join(" · ")}</p>
      )}
    </div>
  );
}
