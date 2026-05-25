import { useState } from "react";
import { X, ExternalLink, RefreshCw, TrendingUp, Calculator, ShoppingBag, Receipt } from "lucide-react";
import { useSoldComps } from "@/hooks/useSoldComps";
import { formatDistanceToNow } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { DealScoreBadge } from "./DealScoreBadge";
import { CountdownTimer } from "./CountdownTimer";
import { PriceBar } from "./PriceBar";
import { TargetPriceInput } from "./TargetPriceInput";
import { useCardListings, useRefreshListings } from "@/hooks/useListings";
import { usePrices, usePriceHistory } from "@/hooks/usePrices";
import { formatCurrency } from "@/lib/utils";
import { getMarketForVariant, variantLabel } from "@/types";
import type { WatchedCard } from "@/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Human label + tailwind classes for the price-source chip. We surface this
 * on every listing so the user can tell at a glance whether they're seeing
 * a TCGPlayer-grade comparison (the gold standard for US Pokémon prices), a
 * scraped fallback (less trustworthy, still USD), a cardmarket EUR proxy,
 * or no comparison at all.
 */
function priceSourceChip(
  source: string | null | undefined,
  currency: string | null | undefined
): { label: string; cls: string } | null {
  switch (source) {
    case "tcgplayer":
      return { label: "TCGPlayer", cls: "bg-blue-900/30 text-blue-300 border-blue-700/40" };
    case "tcgplayer_scrape":
      return { label: "TCGPlayer (scraped)", cls: "bg-indigo-900/30 text-indigo-300 border-indigo-700/40" };
    case "cardmarket":
      return { label: `Cardmarket ${currency ?? "EUR"}`, cls: "bg-cyan-900/30 text-cyan-300 border-cyan-700/40" };
    case "none":
      return { label: "No market ref", cls: "bg-slate-800/60 text-slate-400 border-slate-700/40" };
    default:
      return null;
  }
}

/**
 * Tailwind classes for the condition-grade chip, mirroring the same visual
 * language as DealTier (HOT/red, GOOD/green, etc.). Two-tone bg/border/text
 * keeps it readable on the slate-900 backdrop.
 */
function conditionBadgeClasses(grade: string | null | undefined): string {
  switch (grade) {
    case "NM":
      return "bg-emerald-900/40 text-emerald-400 border-emerald-700/40";
    case "LP":
      return "bg-teal-900/40 text-teal-400 border-teal-700/40";
    case "MP":
      return "bg-amber-900/40 text-amber-400 border-amber-700/40";
    case "HP":
      return "bg-orange-900/40 text-orange-400 border-orange-700/40";
    case "DMG":
      return "bg-red-900/40 text-red-400 border-red-700/40";
    case "GRADED":
      return "bg-purple-900/40 text-purple-300 border-purple-700/40";
    default:
      return "bg-slate-800/60 text-slate-400 border-slate-700/40";
  }
}

/**
 * Format a chart-ready sparkline from real PriceSnapshot history. Returns
 * one point per snapshot day (whatever the API gave us), with the date
 * already formatted for the X-axis label.
 *
 * If the API returns an empty history (brand-new card before the first
 * snapshot lands), and we have a `fallbackBase` from the current market
 * price, return a single-point series so the chart renders a flat dot
 * rather than blank space — honest "today only" signal.
 */
function formatHistoryForChart(
  points: { date: string; market: number }[],
  fallbackBase: number | null
): { date: string; price: number }[] {
  if (points.length === 0 && fallbackBase != null && fallbackBase > 0) {
    const d = new Date();
    return [
      {
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        price: Math.round(fallbackBase * 100) / 100,
      },
    ];
  }

  return points.map((p) => ({
    date: new Date(p.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    price: Math.round(p.market * 100) / 100,
  }));
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CardDetailDrawerProps {
  card: WatchedCard | null;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Slide-over drawer showing detailed listing data, price history sparkline,
 * and a deal-score breakdown for a single watched card.
 */
export function CardDetailDrawer({ card, onClose }: CardDetailDrawerProps) {
  const [tab, setTab] = useState("listings");
  const { data: listingsData, isLoading: listingsLoading } = useCardListings(card?.id ?? null);
  const { data: pricesData, isLoading: pricesLoading } = usePrices(card?.id ?? null);
  // 30-day daily price snapshots (real, persisted) drive the chart. Empty
  // until the daily snapshot cron has logged its first row for the card.
  const { data: historyData } = usePriceHistory(card?.id ?? null, 30);
  const refresh = useRefreshListings(card?.id ?? "");

  if (!card) return null;

  const listings = listingsData?.listings ?? [];
  const prices = pricesData?.prices;

  // The variant-derived target = TCGPlayer market price for the watched
  // variant. (Historically the codebase has been calling this `targetPrice`
  // since the market was used as an implicit threshold — kept for now to
  // avoid sprawling rename; the user's explicit target is `userTarget`.)
  const targetPrice =
    getMarketForVariant(prices ?? null, card.variant) ??
    getMarketForVariant(card.priceCache ?? null, card.variant);

  // The actual user-set target price (P3). Null = no target. When set, the
  // refresh job fires a TARGET_HIT alert as listings drop to/below it.
  const userTarget =
    card.targetPrice != null ? Number(card.targetPrice) : null;

  const marketPrice =
    targetPrice ??
    (listings[0] ? Number(listings[0].marketPrice) : null);

  // Build the chart from real snapshot history. When the API has nothing yet
  // (new card, snapshot cron hasn't run), we synthesise a single point from
  // the current market price so the chart renders a flat dot instead of
  // empty space — but unlike the old buildSparkline jitter, this is honest:
  // one real point, no fake history.
  const sparkline = formatHistoryForChart(historyData?.points ?? [], marketPrice);

  const bestListing = listings[0];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-[#0a0f1e] border-l border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{card.cardName}</h2>
            <p className="text-sm text-slate-400 mt-0.5 truncate">
              {card.setName}
              {card.cardNumber && ` · #${card.cardNumber}`}
            </p>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <Badge className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                {variantLabel(card.variant)}
              </Badge>
              <span className="text-xs text-slate-500">
                TCGPlayer market:{" "}
                <span className="text-[#F5C518] font-medium">
                  {targetPrice != null ? formatCurrency(targetPrice) : "—"}
                </span>
              </span>
              {/* User-set target threshold (P3). When a listing's totalCost
                  drops to/below this, a TARGET_HIT alert fires on refresh. */}
              <TargetPriceInput cardId={card.id} value={userTarget} />
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="mx-5 mt-3 grid w-auto grid-cols-4 bg-slate-800/60 border border-slate-700">
            <TabsTrigger
              value="listings"
              className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-white"
            >
              <ShoppingBag className="h-3.5 w-3.5 mr-1.5" />
              eBay Listings
            </TabsTrigger>
            <TabsTrigger
              value="sold"
              className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-white"
            >
              <Receipt className="h-3.5 w-3.5 mr-1.5" />
              Sold Comps
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-white"
            >
              <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
              Price History
            </TabsTrigger>
            <TabsTrigger
              value="breakdown"
              className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-white"
            >
              <Calculator className="h-3.5 w-3.5 mr-1.5" />
              Score Breakdown
            </TabsTrigger>
          </TabsList>

          {/* ── Listings tab ── */}
          <TabsContent value="listings" className="flex-1 overflow-y-auto px-5 py-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-500">
                {listings.length} listing{listings.length !== 1 ? "s" : ""} found
                {listingsData?.fromCache && (
                  <span className="ml-2 text-slate-600">(cached)</span>
                )}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-slate-400 hover:text-slate-200"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refresh.isPending ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {listingsLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full bg-slate-800 rounded-xl" />
                ))}
              </div>
            ) : listings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-2xl mb-2">🔍</p>
                <p className="text-sm font-medium text-slate-400">No listings cached</p>
                <p className="text-xs text-slate-600 mt-1">Hit Refresh to fetch from eBay</p>
              </div>
            ) : (
              <div className="space-y-2">
                {listings.map((listing) => {
                  const lp = Number(listing.listingPrice);
                  const sc = listing.shippingCost != null ? Number(listing.shippingCost) : null;
                  const tc = Number(listing.totalCost);
                  const nmMarket = Number(listing.marketPrice);
                  // Use condition-adjusted market for the deal bar comparison;
                  // a $39 MP card vs $90 (adjusted) is meaningful, vs $140 (NM)
                  // is misleading. Falls back to NM market on legacy rows.
                  const mp =
                    listing.adjustedMarketPrice != null
                      ? Number(listing.adjustedMarketPrice)
                      : nmMarket;
                  const ds = Number(listing.dealScore);
                  const grade = listing.conditionGrade;
                  // Only surface the badge when we extracted a real grade —
                  // UNKNOWN means "could be anything", showing it is just noise.
                  const showGradeBadge = grade && grade !== "UNKNOWN";
                  // UNSCORED tier means no market reference — skip the PriceBar
                  // (would render with mp=0) and skip the dealScore badge text.
                  const isUnscored = listing.dealTier === "UNSCORED" || mp <= 0;
                  const sourceChip = priceSourceChip(
                    listing.priceSource,
                    listing.priceCurrency
                  );

                  return (
                    <div
                      key={listing.id}
                      className="rounded-xl border border-slate-800 bg-[#0f172a] p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex gap-2.5 min-w-0">
                          {listing.imageUrl && (
                            <img
                              src={listing.imageUrl}
                              alt={listing.title}
                              className="h-12 w-10 object-contain rounded shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-200 line-clamp-2 leading-snug">
                              {listing.title}
                            </p>
                            {listing.seller && (
                              <p className="text-[10px] text-slate-600 mt-0.5">
                                @{listing.seller}
                                {listing.sellerFeedback != null && (
                                  <span className="ml-1">
                                    ({Number(listing.sellerFeedback).toFixed(1)}%)
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                        </div>
                        <DealScoreBadge tier={listing.dealTier} score={ds} />
                      </div>

                      {isUnscored ? (
                        // No market reference — show price + shipping plainly,
                        // skip the proportion bar (the "vs" comparison is the
                        // whole point and it would be meaningless here).
                        <div className="flex items-baseline justify-between text-xs tabular-nums">
                          <span className="text-slate-200 font-medium">
                            {formatCurrency(lp)}
                            {sc !== null && sc > 0 && (
                              <span className="text-[#E63946] ml-1">
                                +{formatCurrency(sc)} ship
                              </span>
                            )}
                            {sc === null && (
                              <span className="text-emerald-500 ml-1">free ship</span>
                            )}
                          </span>
                          <span className="text-slate-500">no market reference</span>
                        </div>
                      ) : (
                        <PriceBar
                          listingPrice={lp}
                          shippingCost={sc}
                          marketPrice={mp}
                        />
                      )}

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {sourceChip && (
                            <Badge
                              className={`text-[10px] border ${sourceChip.cls}`}
                              title={`Market price source: ${sourceChip.label}`}
                            >
                              {sourceChip.label}
                            </Badge>
                          )}
                          {listing.listingType === "AUCTION" ? (
                            <Badge className="text-[10px] bg-orange-900/40 text-orange-400 border border-orange-700/40">
                              Auction{listing.bids != null ? ` · ${listing.bids} bids` : ""}
                            </Badge>
                          ) : (
                            <Badge className="text-[10px] bg-blue-900/40 text-blue-400 border border-blue-700/40">
                              Buy Now
                            </Badge>
                          )}
                          {showGradeBadge && (
                            <Badge
                              className={`text-[10px] border ${conditionBadgeClasses(grade)}`}
                              title={
                                grade === "GRADED"
                                  ? `Graded slab — scored against ${formatCurrency(mp)} (NM market ${formatCurrency(nmMarket)} × 1.5)`
                                  : `Condition ${grade} — scored against ${formatCurrency(mp)} (NM market ${formatCurrency(nmMarket)})`
                              }
                            >
                              {grade}
                            </Badge>
                          )}
                          {/* "at target" only fires when the user has *set*
                              a target AND this listing's total is at or below
                              it. Previously this used market price as the
                              threshold, which made every below-market listing
                              show the badge — useful as a heuristic, but
                              confusing now that targets are first-class. */}
                          {userTarget != null && tc <= userTarget && (
                            <Badge className="text-[10px] bg-emerald-900/40 text-emerald-400 border border-emerald-700/40">
                              at target
                            </Badge>
                          )}
                          <CountdownTimer endTime={listing.endTime} />
                        </div>
                        <a
                          href={listing.ebayUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-[#F5C518] text-slate-900 hover:bg-[#f0ba00] font-semibold"
                          >
                            Buy <ExternalLink className="h-3 w-3 ml-1" />
                          </Button>
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── Sold comps tab (C1) ── */}
          <TabsContent value="sold" className="flex-1 overflow-y-auto px-5 py-3">
            <SoldCompsPanel cardId={card.id} enabled={tab === "sold"} />
          </TabsContent>

          {/* ── Price history tab ── */}
          <TabsContent value="history" className="flex-1 overflow-y-auto px-5 py-3">
            <p className="text-xs text-slate-500 mb-4">
              30-day market price trend from PriceCharting
            </p>

            {pricesLoading ? (
              <Skeleton className="h-56 w-full bg-slate-800 rounded-xl" />
            ) : !marketPrice ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-2xl mb-2">📊</p>
                <p className="text-sm font-medium text-slate-400">No price data yet</p>
                <p className="text-xs text-slate-600 mt-1">
                  Fetch listings to load market prices
                </p>
              </div>
            ) : (
              <>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sparkline}>
                      <defs>
                        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#F5C518" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#F5C518" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: "#64748b", fontSize: 10 }}
                        tickLine={false}
                        interval={6}
                      />
                      <YAxis
                        tick={{ fill: "#64748b", fontSize: 10 }}
                        tickLine={false}
                        tickFormatter={(v) => `$${v}`}
                        width={50}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          borderColor: "#334155",
                          color: "#f1f5f9",
                          fontSize: 12,
                        }}
                        formatter={(v: number) => [formatCurrency(v), "Price"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="#F5C518"
                        strokeWidth={2}
                        fill="url(#priceGrad)"
                        // Show a dot for very short series (e.g. 1-point
                        // first-day state) so it's actually visible.
                        dot={sparkline.length <= 2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Honest empty-state hint when we only have a synthetic
                    "today only" point — the chart looks like a sparkline,
                    but it's really 1 point. Tell the user so they don't
                    mistake the flat dot for "price is stable." */}
                {(historyData?.points.length ?? 0) === 0 && (
                  <p className="mt-2 text-[10px] text-slate-600">
                    Price history starts tomorrow — daily snapshots build over time.
                  </p>
                )}
                {(historyData?.points.length ?? 0) > 0 && (
                  <p className="mt-2 text-[10px] text-slate-600">
                    {historyData!.points.length}-day history · source: {historyData!.points[historyData!.points.length - 1]?.source ?? "—"}
                  </p>
                )}

                {prices?.variants && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {Object.entries(prices.variants)
                      .filter(([, v]) => v.market != null)
                      .map(([key, v]) => {
                        const isActive = key === card.variant;
                        return (
                          <div
                            key={key}
                            className={[
                              "rounded-lg px-3 py-2 flex justify-between text-xs border",
                              isActive
                                ? "bg-[#F5C518]/10 border-[#F5C518]/40"
                                : "bg-slate-800/60 border-transparent",
                            ].join(" ")}
                          >
                            <span className="text-slate-500">{variantLabel(key)}</span>
                            <span
                              className={
                                isActive
                                  ? "text-[#F5C518] font-medium"
                                  : "text-slate-200 font-medium"
                              }
                            >
                              {formatCurrency(Number(v.market))}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Score breakdown tab ── */}
          <TabsContent value="breakdown" className="flex-1 overflow-y-auto px-5 py-3">
            {!bestListing ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-2xl mb-2">🧮</p>
                <p className="text-sm font-medium text-slate-400">No listing data</p>
                <p className="text-xs text-slate-600 mt-1">
                  Fetch listings to see the deal score breakdown
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-slate-500">
                  Score breakdown for the best current listing
                </p>

                {/* Formula display */}
                <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4 font-mono text-sm space-y-3">
                  <div className="flex justify-between text-slate-300">
                    <span className="text-slate-500">Market Price</span>
                    <span>{formatCurrency(Number(bestListing.marketPrice))}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span className="text-slate-500">Listing Price</span>
                    <span>{formatCurrency(Number(bestListing.listingPrice))}</span>
                  </div>
                  {bestListing.shippingCost != null && (
                    <div className="flex justify-between text-[#E63946]">
                      <span>+ Shipping</span>
                      <span>
                        {Number(bestListing.shippingCost) === 0
                          ? "FREE"
                          : formatCurrency(Number(bestListing.shippingCost))}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-slate-800 pt-2 flex justify-between font-semibold text-slate-200">
                    <span>Total Cost</span>
                    <span>{formatCurrency(Number(bestListing.totalCost))}</span>
                  </div>
                </div>

                {/* Formula */}
                <div className="rounded-xl bg-slate-800/40 border border-slate-800 p-4 text-xs text-slate-400 space-y-2">
                  <p className="font-semibold text-slate-300">Formula</p>
                  <p className="font-mono text-slate-500">
                    score = (marketPrice − totalCost) / marketPrice × 100
                  </p>
                  <p className="font-mono text-[#F5C518]">
                    = ({formatCurrency(Number(bestListing.marketPrice))} −{" "}
                    {formatCurrency(Number(bestListing.totalCost))}) /{" "}
                    {formatCurrency(Number(bestListing.marketPrice))} × 100
                  </p>
                  <p className="font-mono text-white font-semibold">
                    = {Number(bestListing.dealScore) > 0 ? "+" : ""}{Number(bestListing.dealScore)}%
                  </p>
                </div>

                {/* Tier legend */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400">Tier thresholds</p>
                  {[
                    { label: "🔥 Hot Deal", range: "> 25% below market", color: "#f87171" },
                    { label: "✅ Good Deal", range: "10–25% below market", color: "#34d399" },
                    { label: "⚠️ Fair", range: "0–10% below market", color: "#facc15" },
                    { label: "❌ Overpriced", range: "Above market price", color: "#64748b" },
                  ].map((t) => (
                    <div
                      key={t.label}
                      className={[
                        "flex justify-between rounded-lg px-3 py-2 text-xs border",
                        bestListing.dealTier === t.label.split(" ")[1]
                          ? "bg-slate-800"
                          : "bg-transparent",
                      ].join(" ")}
                      style={{ borderColor: `${t.color}33` }}
                    >
                      <span style={{ color: t.color }}>{t.label}</span>
                      <span className="text-slate-500">{t.range}</span>
                    </div>
                  ))}
                </div>

                {/* Current badge */}
                <div className="flex items-center justify-between rounded-xl bg-slate-800/40 border border-slate-700 px-4 py-3">
                  <span className="text-xs text-slate-400">Current tier:</span>
                  <DealScoreBadge
                    tier={bestListing.dealTier}
                    score={Number(bestListing.dealScore)}
                  />
                </div>

                {/* Target check */}
                {targetPrice == null ? (
                  <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3 text-xs text-slate-500">
                    No TCGPlayer market price for the{" "}
                    <span className="text-slate-300">{variantLabel(card.variant)}</span>{" "}
                    variant yet — refresh to populate it.
                  </div>
                ) : (
                  <div
                    className={[
                      "rounded-xl border px-4 py-3 text-xs",
                      Number(bestListing.totalCost) <= targetPrice
                        ? "border-emerald-700/50 bg-emerald-900/20 text-emerald-400"
                        : "border-slate-700 bg-slate-800/40 text-slate-500",
                    ].join(" ")}
                  >
                    {Number(bestListing.totalCost) <= targetPrice ? (
                      <span>
                        ✓ Total cost ({formatCurrency(Number(bestListing.totalCost))}) is at or
                        below the {variantLabel(card.variant)} market price
                        ({formatCurrency(targetPrice)})
                      </span>
                    ) : (
                      <span>
                        Total cost ({formatCurrency(Number(bestListing.totalCost))}) exceeds the
                        {" "}{variantLabel(card.variant)} market price
                        ({formatCurrency(targetPrice)}) by{" "}
                        {formatCurrency(Number(bestListing.totalCost) - targetPrice)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function SoldCompsPanel({ cardId, enabled }: { cardId: string; enabled: boolean }) {
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
          <p className="text-[11px] text-slate-600 font-mono truncate" title={query}>
            {query}
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={isFetching}
            onClick={() => refetch()}
            className="h-7 text-xs text-slate-400 hover:text-slate-200"
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
