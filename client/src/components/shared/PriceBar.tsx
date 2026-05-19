import { formatCurrency } from "@/lib/utils";

interface PriceBarProps {
  /** Base listing price */
  listingPrice: number;
  /** null = free shipping */
  shippingCost: number | null;
  /** Reference market price (100% width) */
  marketPrice: number;
  className?: string;
}

/**
 * Stacked horizontal bar showing listing + shipping vs. market price.
 * - Yellow segment: listing price
 * - Orange segment: shipping cost (if any)
 * - The bar fills proportionally against market price (capped at 100%)
 */
export function PriceBar({
  listingPrice,
  shippingCost,
  marketPrice,
  className = "",
}: PriceBarProps) {
  const total = listingPrice + (shippingCost ?? 0);
  const listingPct = Math.min((listingPrice / marketPrice) * 100, 100);
  const shippingPct =
    shippingCost != null
      ? Math.min((shippingCost / marketPrice) * 100, 100 - listingPct)
      : 0;

  return (
    <div className={`space-y-1 ${className}`}>
      {/* Stacked bar */}
      <div className="h-2 w-full rounded-full bg-slate-700 overflow-hidden flex">
        <div
          className="h-full rounded-l-full transition-all"
          style={{ width: `${listingPct}%`, backgroundColor: "#F5C518" }}
        />
        {shippingPct > 0 && (
          <div
            className="h-full transition-all"
            style={{ width: `${shippingPct}%`, backgroundColor: "#E63946" }}
          />
        )}
      </div>
      {/* Labels */}
      <div className="flex items-center justify-between text-[10px] text-slate-400 tabular-nums">
        <span>
          {formatCurrency(listingPrice)}
          {shippingCost != null && shippingCost > 0 && (
            <span className="text-[#E63946] ml-1">
              +{formatCurrency(shippingCost)} ship
            </span>
          )}
          {shippingCost === null && (
            <span className="text-emerald-500 ml-1">free ship</span>
          )}
        </span>
        <span className="text-slate-500">
          vs {formatCurrency(marketPrice)}
        </span>
      </div>
      {/* Total if shipping adds cost */}
      {shippingCost !== null && shippingCost > 0 && (
        <div className="text-[10px] text-slate-500">
          Total: <span className="text-slate-300 font-medium">{formatCurrency(total)}</span>
        </div>
      )}
    </div>
  );
}
