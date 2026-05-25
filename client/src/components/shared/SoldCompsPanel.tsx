import { RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { useSoldComps } from "@/hooks/useSoldComps";

/**
 * C1 — Sold-comps panel rendered inside the card detail drawer's "Sold Comps"
 * tab. Owns its own data fetch via `useSoldComps` so the drawer doesn't need
 * to thread the query through.
 *
 * Extracted from CardDetailDrawer so unit tests can mount it in isolation
 * with the hook mocked, rather than mounting the whole drawer.
 *
 * `enabled` flips the underlying useQuery on — drives lazy fetching when
 * the tab isn't active (no point spending a ScrapingBee credit if the user
 * is on the listings tab).
 */
export function SoldCompsPanel({
  cardId,
  enabled,
}: {
  cardId: string;
  enabled: boolean;
}) {
  const { data, isLoading, error, refetch, isFetching } = useSoldComps(
    cardId,
    enabled
  );

  if (isLoading) {
    return <div className="text-sm text-slate-500">Loading sold comps…</div>;
  }
  if (error) {
    return (
      <div className="text-sm text-amber-400">
        Couldn't load sold comps. Try again in a moment.
      </div>
    );
  }
  if (!data) return null;
  const { summary, rows, query, fromCache } = data;

  if (summary.count === 0) {
    return (
      <div className="space-y-2 text-sm text-slate-500">
        <p>No sold comps in the last 90 days for this query.</p>
        <p className="text-[11px] text-slate-600 font-mono">{query}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary headline */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Median sold (last 90d)
          </p>
          <span className="text-[10px] text-slate-600">
            {summary.count} comps · {fromCache ? "cached" : "fresh"}
          </span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold text-emerald-400">
            ${summary.median?.toFixed(2) ?? "—"}
          </span>
          <span className="text-xs text-slate-500">
            Range ${summary.low?.toFixed(2)} – ${summary.high?.toFixed(2)}
          </span>
        </div>
        {summary.mostRecentAt && (
          <p className="text-[11px] text-slate-600 mt-1">
            Most recent {formatDistanceToNow(new Date(summary.mostRecentAt))} ago
          </p>
        )}
        <div className="flex items-center justify-between mt-3">
          <p
            className="text-[11px] text-slate-600 font-mono truncate"
            title={query}
          >
            {query}
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={isFetching}
            onClick={() => refetch()}
            className="h-7 text-xs text-slate-400 hover:text-slate-200"
            aria-label="Refresh sold comps"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Individual sold rows */}
      <div className="space-y-2">
        {rows.slice(0, 30).map((r) => (
          <div
            key={r.ebayItemId}
            className="flex gap-3 rounded border border-slate-800 bg-slate-900/30 p-2"
            data-testid="sold-comp-row"
          >
            {r.imageUrl && (
              <img
                src={r.imageUrl}
                alt=""
                className="h-12 w-12 object-cover rounded border border-slate-800"
                loading="lazy"
              />
            )}
            <div className="flex-1 min-w-0">
              <a
                href={r.ebayUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-slate-300 hover:text-white line-clamp-2"
              >
                {r.title}
              </a>
              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                <span>
                  {formatDistanceToNow(new Date(r.soldAt), { addSuffix: true })}
                </span>
                {r.conditionGrade && (
                  <span className="px-1 py-0.5 rounded bg-slate-800 text-slate-400">
                    {r.conditionGrade}
                  </span>
                )}
                {r.acceptedOffer && (
                  <span
                    className="px-1 py-0.5 rounded bg-purple-900/30 text-purple-300"
                    title="Best Offer accepted"
                  >
                    BO
                  </span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-semibold text-emerald-400">
                ${r.totalPrice.toFixed(2)}
              </div>
              {r.shippingCost != null && r.shippingCost > 0 && (
                <div className="text-[10px] text-slate-600">
                  +${r.shippingCost.toFixed(2)} ship
                </div>
              )}
            </div>
          </div>
        ))}
        {rows.length > 30 && (
          <p className="text-[11px] text-slate-600 text-center pt-2">
            Showing 30 of {rows.length} comps.
          </p>
        )}
      </div>
    </div>
  );
}
