import { useState } from "react";

/**
 * WatchlistMockup
 * ───────────────
 * Page for managing the cards you want to track.
 * - Left panel: Add / Edit card form
 * - Right panel: Grid of watched cards showing market price,
 *   target price, and whether any current listings are at/below target
 *
 * Target price is compared against TOTAL cost (listing + shipping),
 * consistent with the deal score engine.
 */

const CONDITIONS = ["Raw NM", "Raw LP", "Raw MP", "PSA 10", "PSA 9", "BGS 10", "BGS 9.5"];
const SETS = [
  "Obsidian Flames", "Evolving Skies", "151", "Vivid Voltage",
  "Silver Tempest", "Crown Zenith", "Paldea Evolved", "Scarlet & Violet Base",
];

/** Mock watched cards — marketPrice from PriceCharting, activeDeals = listings at/below target */
const INITIAL_CARDS = [
  {
    id: 1,
    cardName: "Charizard ex",
    set: "Obsidian Flames",
    cardNumber: "215/197",
    condition: "Raw NM",
    targetPrice: 80.00,
    marketPrice: 112.00,
    lowestTotal: 72.99,   // best current listing total (listing + shipping)
    activeDeals: 2,
    lastUpdated: "2 min ago",
    trend: "down",        // price trend vs last week
  },
  {
    id: 2,
    cardName: "Umbreon VMAX Alt Art",
    set: "Evolving Skies",
    cardNumber: "215/203",
    condition: "PSA 10",
    targetPrice: 350.00,
    marketPrice: 385.00,
    lowestTotal: 310.00,
    activeDeals: 1,
    lastUpdated: "2 min ago",
    trend: "up",
  },
  {
    id: 3,
    cardName: "Mew ex (Special Illus.)",
    set: "151",
    cardNumber: "205/165",
    condition: "Raw NM",
    targetPrice: 75.00,
    marketPrice: 94.00,
    lowestTotal: 89.99,
    activeDeals: 0,
    lastUpdated: "4 min ago",
    trend: "stable",
  },
  {
    id: 4,
    cardName: "Pikachu VMAX",
    set: "Vivid Voltage",
    cardNumber: "188/185",
    condition: "Raw LP",
    targetPrice: 45.00,
    marketPrice: 58.00,
    lowestTotal: 50.50,
    activeDeals: 0,
    lastUpdated: "2 min ago",
    trend: "down",
  },
  {
    id: 5,
    cardName: "Rayquaza VMAX Alt Art",
    set: "Evolving Skies",
    cardNumber: "218/203",
    condition: "BGS 9.5",
    targetPrice: 220.00,
    marketPrice: 290.00,
    lowestTotal: 206.99,
    activeDeals: 1,
    lastUpdated: "2 min ago",
    trend: "stable",
  },
  {
    id: 6,
    cardName: "Lugia V Alt Art",
    set: "Silver Tempest",
    cardNumber: "186/195",
    condition: "Raw NM",
    targetPrice: 120.00,
    marketPrice: 138.00,
    lowestTotal: 155.00,
    activeDeals: 0,
    lastUpdated: "6 min ago",
    trend: "up",
  },
];

function formatCurrency(val) {
  return `$${Number(val).toFixed(2)}`;
}

function TrendIcon({ trend }) {
  if (trend === "up") return <span style={{ color: "#f87171", fontSize: 11 }}>▲ Higher</span>;
  if (trend === "down") return <span style={{ color: "#34d399", fontSize: 11 }}>▼ Lower</span>;
  return <span style={{ color: "#64748b", fontSize: 11 }}>● Stable</span>;
}

function WatchCard({ card, onEdit, onDelete, onView }) {
  const atTarget = card.lowestTotal <= card.targetPrice;
  const pctBelow = Math.round(((card.marketPrice - card.targetPrice) / card.marketPrice) * 100);

  return (
    <div
      style={{
        background: "#0f172a",
        border: `1px solid ${atTarget ? "rgba(52,211,153,0.35)" : "#1e293b"}`,
        borderRadius: 10,
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        position: "relative",
        cursor: "pointer",
      }}
      onClick={() => onView(card)}
    >
      {/* Active deal banner */}
      {card.activeDeals > 0 && (
        <div style={{
          position: "absolute", top: -1, right: 12,
          background: atTarget ? "#34d399" : "#F5C518",
          color: atTarget ? "#052e16" : "#0a0f1e",
          fontSize: 9, fontWeight: 500,
          padding: "2px 8px", borderRadius: "0 0 6px 6px",
        }}>
          {card.activeDeals} deal{card.activeDeals > 1 ? "s" : ""} found
        </div>
      )}

      {/* Card header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          width: 36, height: 50, borderRadius: 5, background: "#1e293b",
          border: "1px solid #334155", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 18, flexShrink: 0,
        }}>🃏</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "white", lineHeight: 1.2 }}>
            {card.cardName}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#64748b" }}>
            {card.set} · #{card.cardNumber}
          </p>
          <div style={{ display: "flex", gap: 5, marginTop: 5, alignItems: "center" }}>
            <span style={{
              fontSize: 10, padding: "1px 6px", borderRadius: 4,
              background: "#1e293b", border: "1px solid #334155", color: "#94a3b8",
            }}>{card.condition}</span>
            <TrendIcon trend={card.trend} />
          </div>
        </div>
        {/* Actions */}
        <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => onEdit(card)} style={{
            width: 28, height: 28, borderRadius: 6, border: "1px solid #334155",
            background: "#1e293b", color: "#64748b", cursor: "pointer", fontSize: 13,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✏️</button>
          <button onClick={() => onDelete(card.id)} style={{
            width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(230,57,70,0.3)",
            background: "rgba(230,57,70,0.08)", color: "#f87171", cursor: "pointer", fontSize: 13,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>🗑</button>
        </div>
      </div>

      {/* Price data */}
      <div style={{
        background: "#0a0f1e", borderRadius: 7, padding: "10px 12px",
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4,
      }}>
        <div>
          <p style={{ margin: 0, fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>Market</p>
          <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 500, color: "#e2e8f0" }}>
            {formatCurrency(card.marketPrice)}
          </p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>Your target</p>
          <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 500, color: "#F5C518" }}>
            {formatCurrency(card.targetPrice)}
          </p>
          <p style={{ margin: "1px 0 0", fontSize: 9, color: "#475569" }}>{pctBelow}% off market</p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>Lowest total</p>
          <p style={{
            margin: "2px 0 0", fontSize: 14, fontWeight: 500,
            color: atTarget ? "#34d399" : "#94a3b8",
          }}>
            {formatCurrency(card.lowestTotal)}
          </p>
          <p style={{ margin: "1px 0 0", fontSize: 9, color: "#475569" }}>incl. shipping</p>
        </div>
      </div>

      {/* Target progress bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 9, color: "#475569" }}>Lowest total vs your target</span>
          <span style={{ fontSize: 9, color: atTarget ? "#34d399" : "#64748b" }}>
            {atTarget ? "✓ At target!" : `${formatCurrency(card.lowestTotal - card.targetPrice)} away`}
          </span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: "#1e293b", position: "relative" }}>
          <div style={{
            position: "absolute", left: 0, top: 0, height: 4, borderRadius: 2,
            background: atTarget ? "#34d399" : "#F5C518",
            width: `${Math.min(100, Math.round((card.targetPrice / card.lowestTotal) * 100))}%`,
          }} />
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 9, color: "#334155" }}>Updated {card.lastUpdated}</p>
    </div>
  );
}

export default function WatchlistMockup() {
  const [cards, setCards] = useState(INITIAL_CARDS);
  const [editingCard, setEditingCard] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    cardName: "", set: "", cardNumber: "", condition: "Raw NM", targetPrice: "",
  });
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "list"

  function handleEdit(card) {
    setForm({
      cardName: card.cardName, set: card.set, cardNumber: card.cardNumber,
      condition: card.condition, targetPrice: card.targetPrice,
    });
    setEditingCard(card);
    setShowForm(true);
  }

  function handleDelete(id) {
    setCards(c => c.filter(x => x.id !== id));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (editingCard) {
      setCards(c => c.map(x => x.id === editingCard.id ? {
        ...x, ...form, targetPrice: parseFloat(form.targetPrice),
      } : x));
    } else {
      setCards(c => [...c, {
        id: Date.now(), ...form, targetPrice: parseFloat(form.targetPrice),
        marketPrice: 0, lowestTotal: null, activeDeals: 0, lastUpdated: "just now", trend: "stable",
      }]);
    }
    setForm({ cardName: "", set: "", cardNumber: "", condition: "Raw NM", targetPrice: "" });
    setEditingCard(null);
    setShowForm(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1e", color: "#e2e8f0", fontFamily: "sans-serif" }}>
      {/* Nav */}
      <nav style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px", background: "#0f172a", borderBottom: "1px solid #1e293b",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 500, color: "#F5C518" }}>
          ⚡ TCG Card Sniper
          <span style={{ background: "#E63946", color: "white", fontSize: 10, padding: "1px 7px", borderRadius: 20 }}>BETA</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={{ fontSize: 12, padding: "5px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: "#F5C518", color: "#0a0f1e", fontWeight: 500 }}>
            📋 Watchlist
          </button>
          <button style={{ fontSize: 12, padding: "5px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: "#1e293b", color: "#94a3b8" }}>
            ⚡ Dashboard
          </button>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#E63946", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500 }}>J</div>
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px", display: "grid", gridTemplateColumns: showForm ? "340px 1fr" : "1fr", gap: 20 }}>

        {/* ── Add/Edit Form Panel ── */}
        {showForm && (
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 20, alignSelf: "start", position: "sticky", top: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "white" }}>
                {editingCard ? "Edit Card" : "Add to Watchlist"}
              </h2>
              <button onClick={() => { setShowForm(false); setEditingCard(null); }} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Card Name */}
              <div>
                <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Card Name *</label>
                <input
                  required value={form.cardName}
                  onChange={e => setForm(f => ({ ...f, cardName: e.target.value }))}
                  placeholder="e.g. Charizard ex"
                  style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px", color: "#e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>

              {/* Set */}
              <div>
                <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Set</label>
                <select
                  value={form.set} onChange={e => setForm(f => ({ ...f, set: e.target.value }))}
                  style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px", color: "#e2e8f0", fontSize: 13, outline: "none" }}
                >
                  <option value="">Select a set…</option>
                  {SETS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              {/* Card Number + Condition */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Card #</label>
                  <input
                    value={form.cardNumber} onChange={e => setForm(f => ({ ...f, cardNumber: e.target.value }))}
                    placeholder="e.g. 215/197"
                    style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px", color: "#e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Condition</label>
                  <select
                    value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}
                    style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px", color: "#e2e8f0", fontSize: 13, outline: "none" }}
                  >
                    {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Target Price */}
              <div>
                <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Target Price (incl. shipping) *</label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#64748b", fontSize: 13 }}>$</span>
                  <input
                    required type="number" min="0" step="0.01"
                    value={form.targetPrice} onChange={e => setForm(f => ({ ...f, targetPrice: e.target.value }))}
                    placeholder="0.00"
                    style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px 8px 22px", color: "#e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 10, color: "#475569" }}>
                  We'll alert you when any listing's total cost (listing + shipping) hits this price.
                </p>
              </div>

              {/* Submit */}
              <button type="submit" style={{
                background: "#F5C518", color: "#0a0f1e", border: "none", borderRadius: 8,
                padding: "10px 0", fontWeight: 500, fontSize: 14, cursor: "pointer", marginTop: 2,
              }}>
                {editingCard ? "Save Changes" : "Add to Watchlist"}
              </button>
              {editingCard && (
                <button type="button" onClick={() => { setEditingCard(null); setShowForm(false); }} style={{
                  background: "transparent", color: "#64748b", border: "1px solid #334155",
                  borderRadius: 8, padding: "8px 0", fontSize: 13, cursor: "pointer",
                }}>
                  Cancel
                </button>
              )}
            </form>
          </div>
        )}

        {/* ── Right panel: header + grid ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "white" }}>My Watchlist</h1>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                {cards.length} cards · target price vs total cost (listing + shipping)
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {/* View toggle */}
              <div style={{ display: "flex", background: "#1e293b", borderRadius: 8, border: "1px solid #334155", overflow: "hidden" }}>
                <button onClick={() => setViewMode("grid")} style={{ padding: "6px 10px", border: "none", cursor: "pointer", background: viewMode === "grid" ? "#334155" : "transparent", color: viewMode === "grid" ? "white" : "#64748b", fontSize: 13 }}>⊞</button>
                <button onClick={() => setViewMode("list")} style={{ padding: "6px 10px", border: "none", cursor: "pointer", background: viewMode === "list" ? "#334155" : "transparent", color: viewMode === "list" ? "white" : "#64748b", fontSize: 13 }}>☰</button>
              </div>
              <button onClick={() => { setShowForm(!showForm); setEditingCard(null); setForm({ cardName: "", set: "", cardNumber: "", condition: "Raw NM", targetPrice: "" }); }} style={{
                background: "#F5C518", color: "#0a0f1e", border: "none", borderRadius: 8,
                padding: "7px 14px", fontWeight: 500, fontSize: 13, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 5,
              }}>
                + Add Card
              </button>
            </div>
          </div>

          {/* Summary strip */}
          <div style={{
            display: "flex", gap: 10, marginBottom: 16,
            background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "10px 14px",
          }}>
            {[
              { label: "At target", val: cards.filter(c => c.lowestTotal <= c.targetPrice).length, color: "#34d399" },
              { label: "Active deals", val: cards.reduce((a, c) => a + c.activeDeals, 0), color: "#F5C518" },
              { label: "No deals yet", val: cards.filter(c => c.activeDeals === 0).length, color: "#475569" },
            ].map(s => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 14, borderRight: "1px solid #1e293b" }}>
                <span style={{ fontSize: 20, fontWeight: 500, color: s.color }}>{s.val}</span>
                <span style={{ fontSize: 11, color: "#64748b" }}>{s.label}</span>
              </div>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#475569" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399", display: "inline-block" }} />
              Green border = at/below target
            </div>
          </div>

          {/* Card Grid */}
          {cards.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#475569" }}>
              <p style={{ fontSize: 40, margin: "0 0 10px" }}>📭</p>
              <p style={{ fontSize: 16, fontWeight: 500, color: "#64748b", margin: 0 }}>Your watchlist is empty</p>
              <p style={{ fontSize: 13, margin: "4px 0 16px" }}>Add cards to start tracking deals</p>
              <button onClick={() => setShowForm(true)} style={{ background: "#F5C518", color: "#0a0f1e", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 500, cursor: "pointer" }}>
                + Add your first card
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: viewMode === "grid" ? "repeat(auto-fill, minmax(280px, 1fr))" : "1fr", gap: 12 }}>
              {cards.map(card => (
                <WatchCard key={card.id} card={card} onEdit={handleEdit} onDelete={handleDelete} onView={() => {}} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
