import { useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip, ReferenceLine, CartesianGrid,
} from "recharts";

/**
 * CardDetailDrawer
 * ────────────────
 * Slide-in drawer that opens when a card is clicked in the Dashboard or Watchlist.
 * Shows:
 *  - Card header (name, set, condition, market price)
 *  - Price history sparkline (Recharts AreaChart, 30-day)
 *  - Deal score breakdown panel (formula with shipping)
 *  - Full eBay listings table (all listings, sortable, shipping shown)
 *  - Direct "Buy Now" / "Watch Bid" eBay affiliate links
 */

// ── Mock price history (30 days, from PriceCharting) ────────────────────────
const PRICE_HISTORY = [
  { date: "Apr 20", price: 128 }, { date: "Apr 22", price: 124 },
  { date: "Apr 24", price: 119 }, { date: "Apr 26", price: 122 },
  { date: "Apr 28", price: 118 }, { date: "Apr 30", price: 115 },
  { date: "May 2",  price: 117 }, { date: "May 4",  price: 113 },
  { date: "May 6",  price: 110 }, { date: "May 8",  price: 114 },
  { date: "May 10", price: 111 }, { date: "May 12", price: 108 },
  { date: "May 14", price: 112 }, { date: "May 16", price: 109 },
  { date: "May 18", price: 112 }, // today
];

// ── Mock eBay listings for this card ─────────────────────────────────────────
const LISTINGS = [
  {
    id: 1, type: "AUCTION",
    title: "Charizard ex 215/197 Obsidian Flames NM PSA Ready",
    listingPrice: 68.00, shippingCost: 4.99,
    seller: "poke_vault_tx", feedback: 99.8,
    condition: "NM", bids: 14,
    endTime: Date.now() + 1000 * 60 * 47,
    url: "#",
  },
  {
    id: 2, type: "FIXED_PRICE",
    title: "Charizard ex 215/197 Obsidian Flames Near Mint",
    listingPrice: 89.99, shippingCost: null,
    seller: "midwest_packs", feedback: 97.5,
    condition: "NM", bids: null,
    endTime: null, url: "#",
  },
  {
    id: 3, type: "AUCTION",
    title: "Charizard ex Alt Art 215/197 OBF - MINT condition",
    listingPrice: 74.00, shippingCost: 5.49,
    seller: "card_kings_co", feedback: 98.9,
    condition: "NM", bids: 8,
    endTime: Date.now() + 1000 * 60 * 60 * 6.5,
    url: "#",
  },
  {
    id: 4, type: "FIXED_PRICE",
    title: "Pokémon Charizard ex 215/197 LIGHTLY PLAYED",
    listingPrice: 72.00, shippingCost: null,
    seller: "holo_hustle", feedback: 96.2,
    condition: "LP", bids: null,
    endTime: null, url: "#",
  },
  {
    id: 5, type: "FIXED_PRICE",
    title: "CHARIZARD EX 215/197 Obsidian Flames English NM/M",
    listingPrice: 99.00, shippingCost: null,
    seller: "graded_gold", feedback: 100,
    condition: "NM", bids: null,
    endTime: null, url: "#",
  },
];

const MARKET_PRICE = 112.00;

/** Compute deal score from total cost vs market price */
function getDealScore(listing, market) {
  const total = listing.listingPrice + (listing.shippingCost ?? 0);
  const score = Math.round(((market - total) / market) * 100);
  if (score >= 25) return { tier: "HOT",  score, label: "🔥 Hot Deal",   color: "#f87171" };
  if (score >= 10) return { tier: "GOOD", score, label: "✅ Good Deal",  color: "#34d399" };
  if (score >= 0)  return { tier: "FAIR", score, label: "⚠️ Fair",       color: "#facc15" };
  return              { tier: "OVER", score, label: "❌ Overpriced",   color: "#64748b" };
}

function formatCurrency(v) { return `$${Number(v).toFixed(2)}`; }

function useCountdown(endTime) {
  const [remaining, setRemaining] = useState(() =>
    endTime ? Math.max(0, endTime - Date.now()) : null
  );
  // In real component, add useEffect timer here
  if (remaining === null) return null;
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2,"0")}s`;
}

// ── Custom Recharts tooltip ───────────────────────────────────────────────────
function SparkTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1e293b", border: "1px solid #334155", borderRadius: 6,
      padding: "6px 10px", fontSize: 12,
    }}>
      <p style={{ margin: 0, color: "#94a3b8" }}>{payload[0].payload.date}</p>
      <p style={{ margin: "2px 0 0", fontWeight: 500, color: "#F5C518" }}>
        ${payload[0].value}
      </p>
    </div>
  );
}

// ── Listing Row ───────────────────────────────────────────────────────────────
function ListingRow({ listing, market }) {
  const total = listing.listingPrice + (listing.shippingCost ?? 0);
  const deal = getDealScore(listing, market);
  const countdown = useCountdown(listing.endTime);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 90px 130px 110px 120px",
      alignItems: "center", padding: "10px 0",
      borderBottom: "1px solid #1e293b", gap: 8,
    }}>
      {/* Title + seller */}
      <div>
        <p style={{ margin: 0, fontSize: 12, color: "#e2e8f0", fontWeight: 500, lineHeight: 1.3 }}>
          {listing.title.length > 52 ? listing.title.slice(0, 52) + "…" : listing.title}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <span style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 4,
            background: "#1e293b", border: "1px solid #334155", color: "#94a3b8",
          }}>{listing.condition}</span>
          <span style={{ fontSize: 10, color: "#475569" }}>⭐ {listing.feedback}% · {listing.seller}</span>
        </div>
      </div>

      {/* Type */}
      <div>
        {listing.type === "AUCTION" ? (
          <span style={{
            fontSize: 10, padding: "2px 6px", borderRadius: 5, fontWeight: 500,
            background: "rgba(245,197,24,0.12)", border: "1px solid rgba(245,197,24,0.35)", color: "#fbbf24",
          }}>AUCTION</span>
        ) : (
          <span style={{
            fontSize: 10, padding: "2px 6px", borderRadius: 5, fontWeight: 500,
            background: "#1e293b", border: "1px solid #334155", color: "#94a3b8",
          }}>BUY IT NOW</span>
        )}
      </div>

      {/* Total cost (listing + shipping) */}
      <div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "white" }}>
          {formatCurrency(total)}
        </p>
        {listing.shippingCost ? (
          <p style={{ margin: "2px 0 0", fontSize: 10, color: "#475569" }}>
            {formatCurrency(listing.listingPrice)} + {formatCurrency(listing.shippingCost)} ship
          </p>
        ) : (
          <p style={{ margin: "2px 0 0", fontSize: 10, color: "#34d399" }}>Free shipping</p>
        )}
      </div>

      {/* Ends / bids */}
      <div>
        {listing.type === "AUCTION" && countdown ? (
          <>
            <span style={{
              fontFamily: "monospace", fontSize: 11, fontWeight: 500,
              color: listing.endTime - Date.now() < 3600000 ? "#f87171" : "#F5C518",
            }}>{countdown}</span>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "#475569" }}>{listing.bids} bids</p>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "#475569" }}>—</span>
        )}
      </div>

      {/* Deal badge + CTA */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
        <span style={{
          fontSize: 9, padding: "2px 6px", borderRadius: 20, fontWeight: 500,
          background: `${deal.color}18`, border: `1px solid ${deal.color}50`, color: deal.color,
        }}>
          {deal.label} {deal.score > 0 ? `+${deal.score}%` : `${deal.score}%`}
        </span>
        <a href={listing.url} style={{
          fontSize: 10, padding: "4px 10px", borderRadius: 6, fontWeight: 500,
          textDecoration: "none", display: "inline-block",
          background: listing.type === "AUCTION" ? "#F5C518" : "#E63946",
          color: listing.type === "AUCTION" ? "#0a0f1e" : "white",
        }}>
          {listing.type === "AUCTION" ? "Watch →" : "Buy →"}
        </a>
      </div>
    </div>
  );
}

// ── Deal Score Breakdown ──────────────────────────────────────────────────────
function ScoreBreakdown({ listing, market }) {
  if (!listing) return null;
  const total = listing.listingPrice + (listing.shippingCost ?? 0);
  const score = Math.round(((market - total) / market) * 100);
  const deal = getDealScore(listing, market);

  return (
    <div style={{
      background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 10, padding: 16,
    }}>
      <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 500, color: "white" }}>
        Deal Score Breakdown
      </p>

      {/* Formula */}
      <div style={{
        background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8,
        padding: "10px 14px", marginBottom: 14, fontFamily: "monospace", fontSize: 12,
      }}>
        <p style={{ margin: 0, color: "#64748b" }}>score = (market − totalCost) / market × 100</p>
        <p style={{ margin: "6px 0 0", color: "#e2e8f0" }}>
          = ({formatCurrency(market)} − {formatCurrency(total)}) / {formatCurrency(market)} × 100
        </p>
        <p style={{ margin: "4px 0 0", color: deal.color, fontWeight: 500, fontSize: 14 }}>
          = {score > 0 ? "+" : ""}{score}%
        </p>
      </div>

      {/* Line items */}
      {[
        { label: "Market price (PriceCharting)", value: formatCurrency(market), color: "#94a3b8" },
        { label: "Listing price", value: formatCurrency(listing.listingPrice), color: "#e2e8f0" },
        { label: "Shipping cost", value: listing.shippingCost ? formatCurrency(listing.shippingCost) : "FREE", color: listing.shippingCost ? "#e2e8f0" : "#34d399" },
        { label: "Total cost", value: formatCurrency(total), color: "#F5C518", bold: true },
        { label: "You save", value: `${formatCurrency(market - total)} (${score > 0 ? "+" : ""}${score}%)`, color: deal.color, bold: true },
      ].map(row => (
        <div key={row.label} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "5px 0", borderBottom: "1px solid #1e293b",
        }}>
          <span style={{ fontSize: 12, color: "#64748b" }}>{row.label}</span>
          <span style={{
            fontSize: 12, fontWeight: row.bold ? 500 : 400, color: row.color,
          }}>{row.value}</span>
        </div>
      ))}

      {/* Tier badge */}
      <div style={{
        marginTop: 12, padding: "8px 12px", borderRadius: 8, textAlign: "center",
        background: `${deal.color}12`, border: `1px solid ${deal.color}40`,
      }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: deal.color }}>
          {deal.label} — {score > 0 ? "+" : ""}{score}% below market
        </span>
      </div>
    </div>
  );
}

// ── Main Drawer ───────────────────────────────────────────────────────────────
export default function CardDetailDrawer({ onClose }) {
  const [activeTab, setActiveTab] = useState("listings");
  const [selectedListing, setSelectedListing] = useState(LISTINGS[0]);

  const lowestTotal = Math.min(...LISTINGS.map(l => l.listingPrice + (l.shippingCost ?? 0)));
  const priceChange = PRICE_HISTORY[PRICE_HISTORY.length - 1].price - PRICE_HISTORY[0].price;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,0.65)", display: "flex", justifyContent: "flex-end",
    }} onClick={onClose}>
      <div style={{
        width: "min(740px, 96vw)", height: "100vh", overflowY: "auto",
        background: "#0f172a", borderLeft: "1px solid #1e293b",
        display: "flex", flexDirection: "column",
      }} onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 14, padding: "18px 20px 16px",
          borderBottom: "1px solid #1e293b", background: "#0a0f1e",
        }}>
          <div style={{
            width: 52, height: 72, borderRadius: 6, background: "#1e293b",
            border: "1px solid #334155", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 28, flexShrink: 0,
          }}>🃏</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "white" }}>
              Charizard ex
            </h2>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "#64748b" }}>
              Obsidian Flames · #215/197 · Raw NM
            </p>
            <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
              {[
                { label: "Market price", value: formatCurrency(MARKET_PRICE), color: "#e2e8f0" },
                { label: "Lowest total", value: formatCurrency(lowestTotal), color: "#34d399" },
                { label: "30-day trend", value: `${priceChange < 0 ? "▼" : "▲"} $${Math.abs(priceChange)}`, color: priceChange < 0 ? "#34d399" : "#f87171" },
                { label: "Active listings", value: LISTINGS.length, color: "#F5C518" },
              ].map(s => (
                <div key={s.label}>
                  <p style={{ margin: 0, fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 15, fontWeight: 500, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
            color: "#64748b", width: 32, height: 32, cursor: "pointer", fontSize: 16,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>✕</button>
        </div>

        {/* ── Tabs ── */}
        <div style={{
          display: "flex", gap: 0, borderBottom: "1px solid #1e293b", background: "#0a0f1e",
          padding: "0 20px",
        }}>
          {[
            { id: "listings", label: "eBay Listings" },
            { id: "history",  label: "Price History" },
            { id: "score",    label: "Score Breakdown" },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              fontSize: 13, padding: "10px 16px", border: "none", cursor: "pointer",
              background: "transparent",
              color: activeTab === tab.id ? "#F5C518" : "#64748b",
              borderBottom: activeTab === tab.id ? "2px solid #F5C518" : "2px solid transparent",
              fontWeight: activeTab === tab.id ? 500 : 400,
              marginBottom: -1,
            }}>{tab.label}</button>
          ))}
        </div>

        {/* ── Tab: Listings ── */}
        <div style={{ padding: "16px 20px", flex: 1 }}>
          {activeTab === "listings" && (
            <div>
              {/* Column headers */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 90px 130px 110px 120px",
                padding: "0 0 6px", borderBottom: "1px solid #334155", gap: 8,
              }}>
                {["Listing", "Type", "Total cost", "Ends", "Deal"].map(h => (
                  <p key={h} style={{
                    margin: 0, fontSize: 10, color: "#475569",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                    textAlign: h === "Deal" ? "right" : "left",
                  }}>{h}</p>
                ))}
              </div>
              {LISTINGS.map(l => (
                <div key={l.id} onClick={() => setSelectedListing(l)}
                  style={{ cursor: "pointer", borderRadius: 6, padding: "0 6px", margin: "0 -6px",
                    background: selectedListing?.id === l.id ? "rgba(245,197,24,0.04)" : "transparent",
                    border: selectedListing?.id === l.id ? "1px solid rgba(245,197,24,0.15)" : "1px solid transparent",
                  }}>
                  <ListingRow listing={l} market={MARKET_PRICE} />
                </div>
              ))}
              <p style={{ marginTop: 10, fontSize: 10, color: "#334155", textAlign: "center" }}>
                All prices are total cost (listing + shipping) · Affiliate links via eBay Partner Network
              </p>
            </div>
          )}

          {/* ── Tab: Price History ── */}
          {activeTab === "history" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "white" }}>30-day market price</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>Source: PriceCharting · Raw NM</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: 0, fontSize: 11, color: "#475569" }}>Current</p>
                  <p style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "#e2e8f0" }}>$112.00</p>
                </div>
              </div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={PRICE_HISTORY} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F5C518" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#F5C518" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval={2} />
                    <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<SparkTooltip />} />
                    <ReferenceLine y={112} stroke="#F5C518" strokeDasharray="4 4" strokeOpacity={0.4} />
                    <Area type="monotone" dataKey="price" stroke="#F5C518" strokeWidth={2} fill="url(#priceGrad)" dot={false} activeDot={{ r: 4, fill: "#F5C518" }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, gap: 10 }}>
                {[
                  { label: "30d high", value: `$${Math.max(...PRICE_HISTORY.map(p => p.price))}` },
                  { label: "30d low",  value: `$${Math.min(...PRICE_HISTORY.map(p => p.price))}` },
                  { label: "30d change", value: `${priceChange < 0 ? "▼" : "▲"} $${Math.abs(priceChange)}`, color: priceChange < 0 ? "#34d399" : "#f87171" },
                  { label: "Avg (30d)", value: `$${Math.round(PRICE_HISTORY.reduce((a,p) => a + p.price, 0) / PRICE_HISTORY.length)}` },
                ].map(s => (
                  <div key={s.label} style={{
                    flex: 1, background: "#0a0f1e", border: "1px solid #1e293b",
                    borderRadius: 8, padding: "8px 12px", textAlign: "center",
                  }}>
                    <p style={{ margin: 0, fontSize: 10, color: "#475569", textTransform: "uppercase" }}>{s.label}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 500, color: s.color ?? "#e2e8f0" }}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Tab: Score Breakdown ── */}
          {activeTab === "score" && (
            <div>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>
                Click a listing above to see its breakdown, or viewing the best deal below.
              </p>
              <ScoreBreakdown listing={selectedListing ?? LISTINGS[0]} market={MARKET_PRICE} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
