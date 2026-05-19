import { useState, useMemo } from "react";
import { ExternalLink, RefreshCw, Flame, TrendingUp, Clock, Search } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { DealScoreBadge } from "@/components/shared/DealScoreBadge";
import { CountdownTimer } from "@/components/shared/CountdownTimer";
import { PriceBar } from "@/components/shared/PriceBar";
import { CardDetailDrawer } from "@/components/shared/CardDetailDrawer";
import { useAllListings, useRefreshAllListings } from "@/hooks/useListings";
import { useCards } from "@/hooks/useCards";
import { formatCurrency } from "@/lib/utils";
import { DEAL_TIER_CONFIG } from "@/types";
import type { DealTier, WatchedCard } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

type SortKey = "dealScore" | "totalCost" | "endTime";

/** One merged listing row including card metadata */
type DealRow = {
  id: string;
  cardName: string;
  setName: string;
  condition: string;
  targetPrice: number;
  title: string;
  imageUrl: string | null;
  ebayUrl: string;
  listingPrice: number;
  shippingCost: number | null;
  totalCost: number;
  marketPrice: number;
  dealScore: number;
  dealTier: DealTier;
  listingType: "AUCTION" | "FIXED_PRICE";
  seller: string | null;
  sellerFeedback: number | null;
  bids: number | null;
  endTime: string | null;
};

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4 flex items-center gap-4">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: accent ? `${accent}22` : undefined }}
      >
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      </div>
    </div>
  );
}

// ─── Skeleton rows ─────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-800">
      {[...Array(7)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full bg-slate-800" />
        </td>
      ))}
    </tr>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ hasCards }: { hasCards: boolean }) {
  return (
    <tr>
      <td colSpan={7} className="py-16 text-center">
        <div className="mx-auto max-w-sm space-y-2">
          <p className="text-3xl">🎴</p>
          <p className="font-medium text-slate-300">
            {hasCards ? "No active deals right now" : "Your watchlist is empty"}
          </p>
          <p className="text-sm text-slate-500">
            {hasCards
              ? "Listings refresh every 30 minutes. Hit Refresh Now to check immediately."
              : "Add cards to your watchlist to start sniping deals."}
          </p>
          {!hasCards && (
            <a
              href="/watchlist"
              className="mt-2 inline-block text-sm text-[#F5C518] underline underline-offset-2"
            >
              Go to Watchlist →
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: listings, isLoading } = useAllListings();
  const { data: cards } = useCards();
  const refreshAll = useRefreshAllListings();

  const [drawerCard, setDrawerCard] = useState<WatchedCard | null>(null);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<DealTier | "ALL">("ALL");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "AUCTION" | "FIXED_PRICE">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("dealScore");

  // Map the flat listing objects (which include card details) into DealRows
  const rows = useMemo<DealRow[]>(() => {
    if (!listings) return [];
    return listings.map((l) => ({
      id: l.id,
      cardName: l.card.cardName,
      setName: l.card.setName,
      condition: l.card.condition,
      targetPrice: l.card.targetPrice,
      title: l.title,
      imageUrl: l.imageUrl,
      ebayUrl: l.ebayUrl,
      listingPrice: Number(l.listingPrice),
      shippingCost: l.shippingCost != null ? Number(l.shippingCost) : null,
      totalCost: Number(l.totalCost),
      marketPrice: Number(l.marketPrice),
      dealScore: Number(l.dealScore),
      dealTier: l.dealTier,
      listingType: l.listingType,
      seller: l.seller,
      sellerFeedback: l.sellerFeedback != null ? Number(l.sellerFeedback) : null,
      bids: l.bids != null ? Number(l.bids) : null,
      endTime: l.endTime,
    }));
  }, [listings]);

  // Stats
  const hotCount = rows.filter((r) => r.dealTier === "HOT").length;
  const auctionsEndingSoon = rows.filter(
    (r) =>
      r.listingType === "AUCTION" &&
      r.endTime &&
      new Date(r.endTime).getTime() - Date.now() < 24 * 60 * 60 * 1000
  ).length;

  // Filter + sort
  const filtered = useMemo(() => {
    let out = rows;
    if (search) {
      const q = search.toLowerCase();
      out = out.filter(
        (r) =>
          r.cardName.toLowerCase().includes(q) ||
          r.setName.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q)
      );
    }
    if (tierFilter !== "ALL") out = out.filter((r) => r.dealTier === tierFilter);
    if (typeFilter !== "ALL") out = out.filter((r) => r.listingType === typeFilter);

    out = [...out].sort((a, b) => {
      if (sortKey === "dealScore") return b.dealScore - a.dealScore;
      if (sortKey === "totalCost") return a.totalCost - b.totalCost;
      if (sortKey === "endTime") {
        if (!a.endTime) return 1;
        if (!b.endTime) return -1;
        return new Date(a.endTime).getTime() - new Date(b.endTime).getTime();
      }
      return 0;
    });
    return out;
  }, [rows, search, tierFilter, typeFilter, sortKey]);

  function handleRefreshAll() {
    if (!cards) return;
    refreshAll.mutate(cards.map((c) => c.id));
  }

  // Suppress unused import warning for formatCurrency (used in PriceBar via prop)
  void formatCurrency;

  return (
    <PageShell>
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Deal Feed</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Live eBay listings scored against market price — best deals first
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
          onClick={handleRefreshAll}
          disabled={refreshAll.isPending}
        >
          <RefreshCw
            className={`h-4 w-4 mr-1.5 ${refreshAll.isPending ? "animate-spin" : ""}`}
          />
          Refresh Now
        </Button>
      </div>

      {/* Stats bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<span className="text-xl">🎴</span>}
          label="Cards Watched"
          value={cards?.length ?? "—"}
          accent="#F5C518"
        />
        <StatCard
          icon={<Flame className="h-5 w-5 text-red-400" />}
          label="Active Listings"
          value={rows.length}
          accent="#E63946"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-emerald-400" />}
          label="Hot Deals"
          value={hotCount}
          accent="#34d399"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-yellow-400" />}
          label="Ending in 24h"
          value={auctionsEndingSoon}
          accent="#F5C518"
        />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Search cards or titles…"
            className="pl-8 bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as DealTier | "ALL")}>
          <SelectTrigger className="w-40 bg-slate-900 border-slate-700 text-slate-300">
            <SelectValue placeholder="All tiers" />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-700">
            <SelectItem value="ALL">All tiers</SelectItem>
            {(Object.keys(DEAL_TIER_CONFIG) as DealTier[]).map((t) => (
              <SelectItem key={t} value={t}>
                {DEAL_TIER_CONFIG[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
          <SelectTrigger className="w-36 bg-slate-900 border-slate-700 text-slate-300">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-700">
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="AUCTION">Auction</SelectItem>
            <SelectItem value="FIXED_PRICE">Buy It Now</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="w-36 bg-slate-900 border-slate-700 text-slate-300">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-700">
            <SelectItem value="dealScore">Best Deal</SelectItem>
            <SelectItem value="totalCost">Lowest Price</SelectItem>
            <SelectItem value="endTime">Ending Soon</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Deals table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/60">
              <th className="px-4 py-2.5 text-left font-medium text-slate-400 w-12" />
              <th className="px-4 py-2.5 text-left font-medium text-slate-400">Card</th>
              <th className="px-4 py-2.5 text-left font-medium text-slate-400">Deal</th>
              <th className="px-4 py-2.5 text-left font-medium text-slate-400 min-w-[180px]">
                Price vs Market
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-slate-400">Type</th>
              <th className="px-4 py-2.5 text-left font-medium text-slate-400">Countdown</th>
              <th className="px-4 py-2.5 text-left font-medium text-slate-400">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
            ) : filtered.length === 0 ? (
              <EmptyState hasCards={!!cards?.length} />
            ) : (
              filtered.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors"
                >
                  {/* Thumbnail */}
                  <td className="px-3 py-3">
                    {row.imageUrl ? (
                      <img
                        src={row.imageUrl}
                        alt={row.title}
                        className="h-10 w-8 object-contain rounded"
                      />
                    ) : (
                      <div className="h-10 w-8 rounded bg-slate-800 flex items-center justify-center text-lg">
                        🃏
                      </div>
                    )}
                  </td>

                  {/* Card name */}
                  <td className="px-4 py-3">
                    <button
                      className="font-medium text-slate-100 hover:text-[#F5C518] transition-colors leading-tight line-clamp-1 text-left"
                      onClick={() => {
                        const fullCard = cards?.find((c) => c.cardName === row.cardName && c.setName === row.setName);
                        if (fullCard) setDrawerCard(fullCard);
                      }}
                    >
                      {row.cardName}
                    </button>
                    <p className="text-xs text-slate-500 mt-0.5">{row.setName}</p>
                    {row.seller && (
                      <p className="text-xs text-slate-600 mt-0.5">
                        @{row.seller}
                        {row.sellerFeedback != null && (
                          <span className="ml-1">({row.sellerFeedback.toFixed(1)}%)</span>
                        )}
                      </p>
                    )}
                  </td>

                  {/* Deal badge */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <DealScoreBadge tier={row.dealTier} score={row.dealScore} />
                    {row.totalCost <= row.targetPrice && (
                      <Badge className="ml-1.5 text-[10px] bg-emerald-900/40 text-emerald-400 border border-emerald-700/40">
                        at target
                      </Badge>
                    )}
                  </td>

                  {/* Price bar */}
                  <td className="px-4 py-3 min-w-[200px]">
                    <PriceBar
                      listingPrice={row.listingPrice}
                      shippingCost={row.shippingCost}
                      marketPrice={row.marketPrice}
                    />
                  </td>

                  {/* Listing type */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.listingType === "AUCTION" ? (
                      <div className="space-y-0.5">
                        <Badge className="text-[10px] bg-orange-900/40 text-orange-400 border border-orange-700/40">
                          Auction
                        </Badge>
                        {row.bids != null && (
                          <p className="text-[10px] text-slate-500">
                            {row.bids} bid{row.bids !== 1 ? "s" : ""}
                          </p>
                        )}
                      </div>
                    ) : (
                      <Badge className="text-[10px] bg-blue-900/40 text-blue-400 border border-blue-700/40">
                        Buy Now
                      </Badge>
                    )}
                  </td>

                  {/* Countdown */}
                  <td className="px-4 py-3">
                    {row.endTime ? (
                      <CountdownTimer endTime={row.endTime} />
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>

                  {/* Buy button */}
                  <td className="px-4 py-3">
                    <a
                      href={row.ebayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button
                        size="sm"
                        className="bg-[#F5C518] text-slate-900 hover:bg-[#f0ba00] font-semibold"
                      >
                        Buy
                        <ExternalLink className="h-3 w-3 ml-1.5" />
                      </Button>
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <p className="mt-2 text-xs text-slate-600 text-right">
          {filtered.length} listing{filtered.length !== 1 ? "s" : ""} shown
        </p>
      )}

      <CardDetailDrawer
        card={drawerCard}
        onClose={() => setDrawerCard(null)}
      />
    </PageShell>
  );
}
