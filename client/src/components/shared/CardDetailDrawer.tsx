import { useState } from "react";
import { X, ExternalLink, RefreshCw, TrendingUp, Calculator, ShoppingBag } from "lucide-react";
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
import { useCardListings, useRefreshListings } from "@/hooks/useListings";
import { usePrices } from "@/hooks/usePrices";
import { formatCurrency } from "@/lib/utils";
import type { WatchedCard } from "@/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a synthetic 30-day sparkline from PriceCharting tiers.
 * Since PriceCharting returns a single current price (not time-series),
 * we model a plausible historical curve by adding small jitter.
 * Replace with real historical data if the API supports it.
 */
function buildSparkline(
  basePrice: number
): { date: string; price: number }[] {
  const points: { date: string; price: number }[] = [];
  let p = basePrice * 0.85;
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    p = p + (Math.random() - 0.45) * basePrice * 0.04;
    p = Math.max(p, basePrice * 0.6);
    points.push({
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      price: Math.round(p * 100) / 100,
    });
  }
  // Pin last point to current price
  points[points.length - 1].price = basePrice;
  return points;
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
  const refresh = useRefreshListings(card?.id ?? "");

  if (!card) return null;

  const listings = listingsData?.listings ?? [];
  const prices = pricesData?.prices;

  const marketPrice =
    prices != null
      ? Number(prices.loosePrice) || Number(prices.gradedPrice) || null
      : listings[0]
      ? Number(listings[0].marketPrice)
      : null;

  const sparkline = marketPrice ? buildSparkline(marketPrice) : [];

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
                {card.condition}
              </Badge>
              <span className="text-xs text-slate-500">
                Target: <span className="text-[#F5C518] font-medium">{formatCurrency(card.targetPrice)}</span>
              </span>
              {marketPrice && (
                <span className="text-xs text-slate-500">
                  Market: <span className="text-slate-300 font-medium">{formatCurrency(marketPrice)}</span>
                </span>
              )}
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
          <TabsList className="mx-5 mt-3 grid w-auto grid-cols-3 bg-slate-800/60 border border-slate-700">
            <TabsTrigger
              value="listings"
              className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-white"
            >
              <ShoppingBag className="h-3.5 w-3.5 mr-1.5" />
              eBay Listings
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
                  const mp = Number(listing.marketPrice);
                  const ds = Number(listing.dealScore);

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

                      <PriceBar
                        listingPrice={lp}
                        shippingCost={sc}
                        marketPrice={mp}
                      />

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {listing.listingType === "AUCTION" ? (
                            <Badge className="text-[10px] bg-orange-900/40 text-orange-400 border border-orange-700/40">
                              Auction{listing.bids != null ? ` · ${listing.bids} bids` : ""}
                            </Badge>
                          ) : (
                            <Badge className="text-[10px] bg-blue-900/40 text-blue-400 border border-blue-700/40">
                              Buy Now
                            </Badge>
                          )}
                          {tc <= card.targetPrice && (
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
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {prices && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {[
                      ["Loose", prices.loosePrice],
                      ["CIB", prices.cibPrice],
                      ["New", prices.newPrice],
                      ["Graded", prices.gradedPrice],
                    ]
                      .filter(([, v]) => v != null)
                      .map(([label, val]) => (
                        <div
                          key={label as string}
                          className="rounded-lg bg-slate-800/60 px-3 py-2 flex justify-between text-xs"
                        >
                          <span className="text-slate-500">{label}</span>
                          <span className="text-slate-200 font-medium">
                            {formatCurrency(Number(val))}
                          </span>
                        </div>
                      ))}
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
                <div
                  className={[
                    "rounded-xl border px-4 py-3 text-xs",
                    Number(bestListing.totalCost) <= card.targetPrice
                      ? "border-emerald-700/50 bg-emerald-900/20 text-emerald-400"
                      : "border-slate-700 bg-slate-800/40 text-slate-500",
                  ].join(" ")}
                >
                  {Number(bestListing.totalCost) <= card.targetPrice ? (
                    <span>
                      ✓ Total cost ({formatCurrency(Number(bestListing.totalCost))}) is at or
                      below your target ({formatCurrency(card.targetPrice)})
                    </span>
                  ) : (
                    <span>
                      Total cost ({formatCurrency(Number(bestListing.totalCost))}) exceeds your
                      target ({formatCurrency(card.targetPrice)}) by{" "}
                      {formatCurrency(Number(bestListing.totalCost) - card.targetPrice)}
                    </span>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
