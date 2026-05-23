import { ExternalLink, Layers, Wand2 } from "lucide-react";
import { DealScoreBadge } from "./DealScoreBadge";
import { CountdownTimer } from "./CountdownTimer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { Lot, ParsedLotCard } from "@/types";

interface LotCardProps {
  lot: Lot;
  /** Open the analyzer modal for this lot. Wired by Dashboard. */
  onAnalyze?: () => void;
}

/**
 * Renders one parsed lot listing.
 *
 * Layout (mobile-first):
 *   - Image + title row
 *   - Tier badge, listing price, value range (low–high)
 *   - Horizontal scroll of parsed-card chips. Ambiguous chips (multiple
 *     candidate printings) get a yellow border + show the candidate count.
 *   - Footer: end time / bid count for auctions, "Buy" link.
 *
 * For v1 we DON'T render the per-card printing picker modal yet —
 * candidates are visible via tooltip on each chip. The full "Refine"
 * modal is a follow-up.
 */
export function LotCard({ lot, onAnalyze }: LotCardProps) {
  const hasAuction = lot.kind === "AUCTION_ONLY" || lot.kind === "BIN_PLUS_AUCTION";
  const sanityFlag = lot.highEstimate > 5 * lot.totalCost && lot.lowEstimate > 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4 space-y-3">
      {/* Title row */}
      <div className="flex items-start gap-3">
        {lot.imageUrl ? (
          <img
            src={lot.imageUrl}
            alt={lot.title}
            className="h-16 w-12 object-contain rounded shrink-0"
          />
        ) : (
          <div className="h-16 w-12 rounded bg-slate-800 flex items-center justify-center shrink-0">
            <Layers className="h-5 w-5 text-slate-600" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-200 line-clamp-2 leading-snug">{lot.title}</p>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <DealScoreBadge tier={lot.lotTier} score={lot.lotScore} />
            <Badge className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
              {lot.parsedCards.length} cards parsed
            </Badge>
            {hasAuction && lot.endTime && (
              <CountdownTimer endTime={lot.endTime} />
            )}
            {sanityFlag && (
              <Badge
                className="text-[10px] bg-amber-900/40 text-amber-300 border border-amber-700/40"
                title="The parsed value is wildly higher than the listing price — could be a parser error, verify before bidding."
              >
                ⚠ verify
              </Badge>
            )}
          </div>
        </div>
        <div className="shrink-0 flex flex-col gap-1.5">
          <a
            href={lot.ebayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-[#F5C518] px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-[#f0ba00] transition"
          >
            Buy
            <ExternalLink className="h-3 w-3" />
          </a>
          {onAnalyze && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onAnalyze}
              className="text-[11px] text-slate-300 hover:text-white hover:bg-slate-800 gap-1 px-2 py-1 h-auto"
              title="Open the lot analyzer to add cards visually"
            >
              <Wand2 className="h-3 w-3" />
              Analyze
            </Button>
          )}
        </div>
      </div>

      {/* Price + estimate range */}
      <div className="flex items-baseline justify-between text-xs tabular-nums">
        <span className="text-slate-400">
          <span className="text-[#F5C518] font-semibold text-base">
            {formatCurrency(lot.totalCost)}
          </span>
          {lot.shippingCost !== null && lot.shippingCost > 0 && (
            <span className="text-[#E63946] ml-1">
              (incl. {formatCurrency(lot.shippingCost)} ship)
            </span>
          )}
          {lot.shippingCost === null && (
            <span className="text-emerald-500 ml-1">(free ship)</span>
          )}
        </span>
        <span className="text-slate-500">
          {lot.lowEstimate > 0 ? (
            <>
              Worth{" "}
              <span className="text-emerald-400 font-medium">
                {formatCurrency(lot.lowEstimate)}
                {lot.highEstimate > lot.lowEstimate && (
                  <> – {formatCurrency(lot.highEstimate)}</>
                )}
              </span>
            </>
          ) : (
            <span className="text-slate-600">No priced cards</span>
          )}
        </span>
      </div>

      {/* Parsed cards — horizontal scroll */}
      {lot.parsedCards.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {lot.parsedCards.map((pc, i) => (
            <ParsedCardChip key={`${pc.name}-${i}`} pc={pc} />
          ))}
        </div>
      )}
    </div>
  );
}

function ParsedCardChip({ pc }: { pc: ParsedLotCard }) {
  const ambiguous = pc.candidates.length > 1;
  const priced = pc.candidates.filter((c) => c.market != null);
  const summary =
    priced.length > 0
      ? priced.length === pc.candidates.length
        ? `${priced.length} printing${priced.length > 1 ? "s" : ""}`
        : `${priced.length}/${pc.candidates.length} priced`
      : "no prices";

  const tooltip = pc.candidates
    .slice(0, 8)
    .map((c) => `${c.setName} #${c.number}${c.market ? ` — ${c.currency} ${c.market.toFixed(2)}` : " — no price"}`)
    .join("\n");

  return (
    <div
      title={`${pc.quantity > 1 ? `${pc.quantity}× ` : ""}${pc.name}\n\n${tooltip}`}
      className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] ${
        ambiguous
          ? "border-amber-700/50 bg-amber-900/10 text-amber-200"
          : "border-slate-700 bg-slate-800/60 text-slate-300"
      }`}
    >
      <div className="font-medium capitalize">
        {pc.quantity > 1 && <span className="text-slate-500 mr-1">{pc.quantity}×</span>}
        {pc.name}
      </div>
      <div className="text-[10px] text-slate-500">{summary}</div>
    </div>
  );
}
