import { TrendingDown, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { LotRevaluation } from "@/types";

/**
 * Live "Lot price vs market" headline for the analyzer modal. Mirrors
 * the price-vs-market bar the deal feed shows per-listing, but rolled
 * up to the whole lot:
 *
 *   $250.00 paid    Worth $180 – $420 (mid $300)    +20% deal
 *   [▓▓▓▓▓▓▓▓░░░░░░] bar fills proportional to mid/lot ratio
 *
 * Hides itself until the valuation lands (no skeleton — keeps the
 * panel from flashing on a brief fetch). Color flips on >0 vs <0 deal.
 */
export function LotValuationPanel({
  lotTotalCost,
  valuation,
}: {
  lotTotalCost: number;
  valuation: LotRevaluation | null | undefined;
}) {
  if (!valuation) return null;
  const low = valuation.withAnnotationLowEstimate;
  const high = valuation.withAnnotationHighEstimate;
  const mid = (low + high) / 2;
  // If we have no market value at all, hide — the panel would be misleading.
  if (mid <= 0) return null;

  // Deal percentage: how much below market the listing price is, against the
  // midpoint. Positive = good (paying less than market). Negative = overpaying.
  const deltaPct = ((mid - lotTotalCost) / mid) * 100;
  const goodDeal = deltaPct >= 0;

  // Bar fills proportionally to lotTotalCost / mid, capped at 100% so a
  // wildly-overpriced lot doesn't paint outside the box. The amber colour
  // is the listing price; the dark track behind it is "headroom to market".
  const fillPct = Math.max(0, Math.min(100, (lotTotalCost / mid) * 100));

  return (
    <div
      className="border-b border-slate-800 p-4 space-y-2"
      data-testid="lot-valuation-panel"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">
          Lot price vs market
        </p>
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            goodDeal
              ? "bg-emerald-900/40 text-emerald-300 border border-emerald-700/40"
              : "bg-red-900/40 text-red-300 border border-red-700/40"
          }`}
          title={
            goodDeal
              ? "Listing is below the midpoint market value of the cards you've identified"
              : "Listing is above the midpoint market value of the cards you've identified"
          }
        >
          {goodDeal ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {goodDeal ? "+" : ""}
          {deltaPct.toFixed(0)}%
        </span>
      </div>

      <div className="flex items-baseline gap-3 tabular-nums">
        <span className="text-lg font-bold text-[#F5C518]">
          {formatCurrency(lotTotalCost)}
        </span>
        <span className="text-xs text-slate-500">paid</span>
        <span className="text-xs text-slate-600 ml-auto">
          Worth{" "}
          <span className="text-emerald-400 font-medium">
            {formatCurrency(low)}
            {high > low && <> – {formatCurrency(high)}</>}
          </span>
        </span>
      </div>

      {/* Progress bar — listing price relative to midpoint */}
      <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full ${goodDeal ? "bg-emerald-500" : "bg-red-500"} transition-[width]`}
          style={{ width: `${fillPct}%` }}
          aria-label={`Lot price is ${fillPct.toFixed(0)}% of midpoint market value`}
        />
      </div>
      <p className="text-[10px] text-slate-600">
        Midpoint {formatCurrency((low + high) / 2)} ·{" "}
        {valuation.addedCardSummaries.length} card
        {valuation.addedCardSummaries.length === 1 ? "" : "s"} identified
      </p>
    </div>
  );
}
