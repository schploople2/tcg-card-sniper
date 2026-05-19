import { useState, useEffect } from "react";

// ─── Colour tokens ────────────────────────────────────────────────────────────
// slate-950  #0a0f1e   page bg
// slate-900  #0f172a   card bg
// slate-800  #1e293b   table row / input bg
// slate-700  #334155   borders
// yellow-400 #F5C518   primary accent (Pokémon electric)
// red-500    #E63946   danger / Pokéball red
// emerald-400 #34d399  good deal green
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mock deal data — shippingCost is pulled from eBay Browse API's
 * shippingOptions[0].shippingCost.value. null = free shipping.
 * dealScore is computed as: ((marketPrice - totalCost) / marketPrice) * 100
 * where totalCost = listingPrice + (shippingCost ?? 0)
 */
const MOCK_DEALS = [
  {
    id: 1,
    thumbnail: "https://placehold.co/56x78/1e293b/F5C518?text=🃏",
    cardName: "Charizard ex",
    set: "Obsidian Flames",
    cardNumber: "215/197",
    condition: "NM",
    listingType: "AUCTION",
    listingPrice: 68.0,
    shippingCost: 4.99,   // totalCost = $72.99
    marketPrice: 112.0,
    dealScore: 35,        // ((112 - 72.99) / 112) * 100 ≈ 35
    dealTier: "HOT",
    endTime: Date.now() + 1000 * 60 * 47,
    bids: 14,
    seller: "poke_vault_tx",
    sellerFeedback: 99.8,
  },
  {
    id: 2,
    thumbnail: "https://placehold.co/56x78/1e293b/F5C518?text=🃏",
    cardName: "Umbreon VMAX Alt Art",
    set: "Evolving Skies",
    cardNumber: "215/203",
    condition: "PSA 10",
    listingType: "FIXED_PRICE",
    listingPrice: 310.0,
    shippingCost: null,   // free shipping
    marketPrice: 385.0,
    dealScore: 19,        // ((385 - 310) / 385) * 100 ≈ 19
    dealTier: "GOOD",
    endTime: null,
    bids: null,
    seller: "graded_gold",
    sellerFeedback: 100,
  },
  {
    id: 3,
    thumbnail: "https://placehold.co/56x78/1e293b/F5C518?text=🃏",
    cardName: "Pikachu VMAX",
    set: "Vivid Voltage",
    cardNumber: "188/185",
    condition: "LP",
    listingType: "AUCTION",
    listingPrice: 42.5,
    shippingCost: 8.0,    // high shipping; totalCost = $50.50
    marketPrice: 58.0,
    dealScore: 13,        // ((58 - 50.50) / 58) * 100 ≈ 13 — shipping hurts this one
    dealTier: "GOOD",
    endTime: Date.now() + 1000 * 60 * 60 * 3.2,
    bids: 6,
    seller: "cards_n_coffee",
    sellerFeedback: 98.1,
  },
  {
    id: 4,
    thumbnail: "https://placehold.co/56x78/1e293b/F5C518?text=🃏",
    cardName: "Mew ex (Special Illustration)",
    set: "151",
    cardNumber: "205/165",
    condition: "NM",
    listingType: "FIXED_PRICE",
    listingPrice: 89.99,
    shippingCost: null,   // free shipping
    marketPrice: 94.0,
    dealScore: 4,
    dealTier: "FAIR",
    endTime: null,
    bids: null,
    seller: "midwest_packs",
    sellerFeedback: 97.5,
  },
  {
    id: 5,
    thumbnail: "https://placehold.co/56x78/1e293b/F5C518?text=🃏",
    cardName: "Lugia V Alt Art",
    set: "Silver Tempest",
    cardNumber: "186/195",
    condition: "NM",
    listingType: "FIXED_PRICE",
    listingPrice: 155.0,
    shippingCost: null,
    marketPrice: 138.0,
    dealScore: -12,
    dealTier: "OVER",
    endTime: null,
    bids: null,
    seller: "holo_hustle",
    sellerFeedback: 96.2,
  },
  {
    id: 6,
    thumbnail: "https://placehold.co/56x78/1e293b/F5C518?text=🃏",
    cardName: "Rayquaza VMAX Alt Art",
    set: "Evolving Skies",
    cardNumber: "218/203",
    condition: "BGS 9.5",
    listingType: "AUCTION",
    listingPrice: 201.0,
    shippingCost: 5.99,   // totalCost = $206.99
    marketPrice: 290.0,
    dealScore: 29,        // ((290 - 206.99) / 290) * 100 ≈ 29
    dealTier: "HOT",
    endTime: Date.now() + 1000 * 60 * 17,
    bids: 22,
    seller: "bgs_breaks",
    sellerFeedback: 99.3,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(val) {
  return `$${Number(val).toFixed(2)}`;
}

function useCountdown(endTime) {
  const [remaining, setRemaining] = useState(() =>
    endTime ? Math.max(0, endTime - Date.now()) : null
  );

  useEffect(() => {
    if (!endTime) return;
    const id = setInterval(() => {
      setRemaining(Math.max(0, endTime - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  if (remaining === null) return null;
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DealBadge({ tier, score }) {
  const configs = {
    HOT: {
      label: "🔥 Hot Deal",
      bg: "bg-red-500/20",
      border: "border-red-500/50",
      text: "text-red-400",
    },
    GOOD: {
      label: "✅ Good Deal",
      bg: "bg-emerald-500/20",
      border: "border-emerald-500/50",
      text: "text-emerald-400",
    },
    FAIR: {
      label: "⚠️ Fair",
      bg: "bg-yellow-500/20",
      border: "border-yellow-500/50",
      text: "text-yellow-400",
    },
    OVER: {
      label: "❌ Overpriced",
      bg: "bg-slate-700/60",
      border: "border-slate-600",
      text: "text-slate-400",
    },
  };
  const c = configs[tier] || configs.FAIR;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${c.bg} ${c.border} ${c.text}`}
    >
      {c.label}
      <span className="ml-1 opacity-70">{score > 0 ? `+${score}%` : `${score}%`}</span>
    </span>
  );
}

function ListingTypePill({ type }) {
  if (type === "AUCTION")
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-yellow-400/20 text-yellow-300 border border-yellow-400/40">
        AUCTION
      </span>
    );
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-slate-700 text-slate-300 border border-slate-600">
      BUY IT NOW
    </span>
  );
}

function CountdownCell({ endTime }) {
  const label = useCountdown(endTime);
  if (!label) return <span className="text-slate-500 text-sm">—</span>;
  const urgent = endTime - Date.now() < 1000 * 60 * 60; // < 1 hr
  return (
    <span
      className={`font-mono text-sm font-semibold tabular-nums ${
        urgent ? "text-red-400 animate-pulse" : "text-yellow-400"
      }`}
    >
      {label}
    </span>
  );
}

/**
 * PriceBar — compares totalCost (listing + shipping) against market price.
 * Shipping is shown as a stacked segment on the bar so the user can see
 * how much of the bar is "base price" vs "shipping overhead".
 */
function PriceBar({ listing, shipping, market }) {
  const total = listing + (shipping ?? 0);
  const listingPct = Math.min(100, Math.round((listing / market) * 100));
  const shippingPct = Math.min(100 - listingPct, Math.round(((shipping ?? 0) / market) * 100));
  const totalPct = listingPct + shippingPct;
  const barColor = totalPct < 75 ? "#E63946" : totalPct < 90 ? "#34d399" : totalPct < 100 ? "#F5C518" : "#64748b";

  return (
    <div className="flex flex-col gap-1 min-w-[130px]">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-slate-400">Total cost</span>
        <span className="text-slate-400">Market</span>
      </div>
      {/* Stacked bar: listing (solid) + shipping (hatched/lighter) */}
      <div className="relative h-1.5 rounded-full bg-slate-700 w-full">
        <div
          className="absolute left-0 top-0 h-1.5 rounded-l-full transition-all"
          style={{ width: `${listingPct}%`, backgroundColor: barColor }}
        />
        {shipping && shippingPct > 0 && (
          <div
            className="absolute top-0 h-1.5 transition-all"
            style={{
              left: `${listingPct}%`,
              width: `${shippingPct}%`,
              backgroundColor: barColor,
              opacity: 0.4,
              borderRadius: shippingPct + listingPct >= 100 ? "0 2px 2px 0" : 0,
            }}
          />
        )}
      </div>
      <div className="flex justify-between text-xs">
        <div>
          <span className="font-semibold text-white">{formatCurrency(total)}</span>
          {shipping ? (
            <span className="text-slate-500 ml-1 text-[10px]">
              ({formatCurrency(listing)} + {formatCurrency(shipping)} ship)
            </span>
          ) : (
            <span className="text-emerald-500 ml-1 text-[10px] font-medium">Free ship</span>
          )}
        </div>
        <span className="text-slate-400">{formatCurrency(market)}</span>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, accent }) {
  return (
    <div className="flex items-center gap-4 bg-slate-900 border border-slate-700 rounded-xl px-5 py-4 flex-1">
      <div
        className="text-3xl w-12 h-12 flex items-center justify-center rounded-lg"
        style={{ background: `${accent}18` }}
      >
        {icon}
      </div>
      <div>
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-white leading-tight" style={{ color: accent }}>
          {value}
        </p>
        {sub && <p className="text-slate-500 text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main Mockup ──────────────────────────────────────────────────────────────

export default function DashboardMockup() {
  const [filter, setFilter] = useState("ALL");
  const [sort, setSort] = useState("score");
  const [search, setSearch] = useState("");
  const [selectedCard, setSelectedCard] = useState(null);

  const filtered = MOCK_DEALS.filter((d) => {
    if (filter !== "ALL" && d.dealTier !== filter) return false;
    if (search && !d.cardName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (sort === "score") return b.dealScore - a.dealScore;
    if (sort === "price") return a.listingPrice - b.listingPrice;
    if (sort === "endTime") {
      if (!a.endTime && !b.endTime) return 0;
      if (!a.endTime) return 1;
      if (!b.endTime) return -1;
      return a.endTime - b.endTime;
    }
    return 0;
  });

  const hotDeals = MOCK_DEALS.filter((d) => d.dealTier === "HOT").length;
  const endingSoon = MOCK_DEALS.filter(
    (d) => d.endTime && d.endTime - Date.now() < 1000 * 60 * 60
  ).length;

  return (
    <div
      className="min-h-screen font-sans"
      style={{ background: "#0a0f1e", color: "#e2e8f0" }}
    >
      {/* ── Top Nav ── */}
      <nav
        className="flex items-center justify-between px-6 py-3 border-b"
        style={{ borderColor: "#1e293b", background: "#0f172a" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚡</span>
          <span className="font-bold text-lg tracking-tight" style={{ color: "#F5C518" }}>
            TCG Card Sniper
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: "#E63946", color: "white" }}
          >
            BETA
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            className="text-sm px-4 py-1.5 rounded-lg font-semibold"
            style={{ background: "#1e293b", color: "#94a3b8" }}
          >
            📋 Watchlist
          </button>
          <button
            className="text-sm px-4 py-1.5 rounded-lg font-semibold"
            style={{ background: "#F5C518", color: "#0a0f1e" }}
          >
            ⚡ Dashboard
          </button>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ background: "#E63946" }}
          >
            J
          </div>
        </div>
      </nav>

      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
        {/* ── Page title ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Deal Feed</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Live eBay listings ranked by deal score · refreshes every 30 min
            </p>
          </div>
          <button
            className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg font-semibold border"
            style={{
              background: "#1e293b",
              borderColor: "#334155",
              color: "#94a3b8",
            }}
          >
            🔄 Refresh Now
          </button>
        </div>

        {/* ── Stats Bar ── */}
        <div className="flex gap-4">
          <StatCard
            icon="👁️"
            label="Cards Watched"
            value="12"
            sub="across 6 sets"
            accent="#94a3b8"
          />
          <StatCard
            icon="🔥"
            label="Hot Deals"
            value={hotDeals}
            sub=">25% below market"
            accent="#E63946"
          />
          <StatCard
            icon="⏰"
            label="Ending Soon"
            value={endingSoon}
            sub="auctions < 1 hour"
            accent="#F5C518"
          />
          <StatCard
            icon="💰"
            label="Avg Savings"
            value="$41"
            sub="vs market this week"
            accent="#34d399"
          />
        </div>

        {/* ── Filters & Sort ── */}
        <div
          className="flex flex-wrap items-center gap-3 p-4 rounded-xl border"
          style={{ background: "#0f172a", borderColor: "#1e293b" }}
        >
          {/* Search */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
              🔍
            </span>
            <input
              className="pl-8 pr-4 py-2 rounded-lg text-sm border"
              style={{
                background: "#1e293b",
                borderColor: "#334155",
                color: "#e2e8f0",
                width: 220,
              }}
              placeholder="Search cards..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Tier filter pills */}
          <div className="flex gap-2">
            {["ALL", "HOT", "GOOD", "FAIR", "OVER"].map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className="text-xs px-3 py-1.5 rounded-full font-semibold border transition-all"
                style={
                  filter === t
                    ? { background: "#F5C518", color: "#0a0f1e", borderColor: "#F5C518" }
                    : { background: "#1e293b", color: "#94a3b8", borderColor: "#334155" }
                }
              >
                {t === "ALL" ? "All Deals" : t === "HOT" ? "🔥 Hot" : t === "GOOD" ? "✅ Good" : t === "FAIR" ? "⚠️ Fair" : "❌ Over"}
              </button>
            ))}
          </div>

          {/* Sort */}
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-400">
            Sort by:
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="text-sm rounded-lg px-3 py-1.5 border"
              style={{
                background: "#1e293b",
                borderColor: "#334155",
                color: "#e2e8f0",
              }}
            >
              <option value="score">Deal Score</option>
              <option value="price">Price</option>
              <option value="endTime">Ending Soon</option>
            </select>
          </div>
        </div>

        {/* ── Deals Table ── */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: "#1e293b" }}
        >
          {/* Table header */}
          <div
            className="grid text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3 border-b"
            style={{
              gridTemplateColumns: "56px 1fr 120px 140px 160px 140px 160px",
              background: "#0f172a",
              borderColor: "#1e293b",
            }}
          >
            <div />
            <div>Card</div>
            <div>Deal Score</div>
            <div>Type</div>
            <div>Price vs Market</div>
            <div>Ends / Bids</div>
            <div>Action</div>
          </div>

          {/* Rows */}
          {filtered.map((deal, i) => (
            <DealRow
              key={deal.id}
              deal={deal}
              even={i % 2 === 0}
              onSelect={() => setSelectedCard(deal)}
            />
          ))}

          {filtered.length === 0 && (
            <div className="py-16 text-center text-slate-500">
              <p className="text-4xl mb-3">🔍</p>
              <p className="font-semibold text-slate-400">No deals match your filters</p>
              <p className="text-sm mt-1">Try adjusting the tier filter or search term</p>
            </div>
          )}
        </div>

        {/* ── Footer note ── */}
        <p className="text-center text-slate-600 text-xs">
          Deal scores calculated from PriceCharting market data · Affiliate links via eBay Partner Network ·{" "}
          <span style={{ color: "#F5C518" }}>Last updated 2 min ago</span>
        </p>
      </div>

      {/* ── Card Detail Overlay (placeholder) ── */}
      {selectedCard && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setSelectedCard(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl p-6 border"
            style={{ background: "#0f172a", borderColor: "#334155" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-white">{selectedCard.cardName}</h2>
                <p className="text-slate-400 text-sm">
                  {selectedCard.set} · #{selectedCard.cardNumber}
                </p>
              </div>
              <button
                onClick={() => setSelectedCard(null)}
                className="text-slate-500 hover:text-white text-xl"
              >
                ✕
              </button>
            </div>
            <div className="rounded-lg p-4 text-center text-slate-500 border border-dashed"
              style={{ borderColor: "#334155" }}>
              <p className="text-2xl mb-2">📊</p>
              <p className="text-sm">Card Detail Drawer — Mockup #3</p>
              <p className="text-xs mt-1">Price sparkline + all listings will render here</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Deal Row ─────────────────────────────────────────────────────────────────

function DealRow({ deal, even, onSelect }) {
  return (
    <div
      className="grid items-center px-4 py-3 border-b cursor-pointer transition-colors hover:bg-slate-800/60"
      style={{
        gridTemplateColumns: "56px 1fr 120px 140px 160px 140px 160px",
        background: even ? "#0f172a" : "#111827",
        borderColor: "#1e293b",
      }}
      onClick={onSelect}
    >
      {/* Thumbnail */}
      <div
        className="w-10 h-14 rounded-md flex items-center justify-center text-lg border overflow-hidden"
        style={{ borderColor: "#334155", background: "#1e293b" }}
      >
        🃏
      </div>

      {/* Card info */}
      <div className="pr-4">
        <p className="font-semibold text-white text-sm leading-tight">{deal.cardName}</p>
        <p className="text-slate-400 text-xs mt-0.5">
          {deal.set} · #{deal.cardNumber}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span
            className="text-xs px-1.5 py-0.5 rounded font-medium"
            style={{ background: "#1e293b", color: "#94a3b8", border: "1px solid #334155" }}
          >
            {deal.condition}
          </span>
          <span className="text-xs text-slate-500">
            ⭐ {deal.sellerFeedback}% · {deal.seller}
          </span>
        </div>
      </div>

      {/* Deal badge */}
      <div>
        <DealBadge tier={deal.dealTier} score={deal.dealScore} />
      </div>

      {/* Listing type */}
      <div>
        <ListingTypePill type={deal.listingType} />
      </div>

      {/* Price bar — uses totalCost (listing + shipping) vs market */}
      <div>
        <PriceBar listing={deal.listingPrice} shipping={deal.shippingCost} market={deal.marketPrice} />
      </div>

      {/* Countdown / bids */}
      <div className="text-sm">
        {deal.listingType === "AUCTION" ? (
          <div>
            <CountdownCell endTime={deal.endTime} />
            <p className="text-slate-500 text-xs mt-0.5">{deal.bids} bids</p>
          </div>
        ) : (
          <span className="text-slate-500 text-sm">Fixed Price</span>
        )}
      </div>

      {/* CTA button */}
      <div onClick={(e) => e.stopPropagation()}>
        {deal.listingType === "AUCTION" ? (
          <button
            className="text-xs px-3 py-2 rounded-lg font-bold border transition-all w-full"
            style={{
              background: "#F5C518",
              color: "#0a0f1e",
              borderColor: "#F5C518",
            }}
          >
            👁 Watch Bid →
          </button>
        ) : (
          <button
            className="text-xs px-3 py-2 rounded-lg font-bold border transition-all w-full"
            style={{
              background: "#E63946",
              color: "white",
              borderColor: "#E63946",
            }}
          >
            🛒 Buy Now →
          </button>
        )}
      </div>
    </div>
  );
}
