// ─── Enums (mirror Prisma schema) ─────────────────────────────────────────────

export type DealTier = "HOT" | "GOOD" | "FAIR" | "OVER";
export type ListingType = "AUCTION" | "FIXED_PRICE";

// ─── API response shapes ───────────────────────────────────────────────────────

export interface PriceCache {
  id: string;
  cardId: string;
  loosePrice: number | null;
  cibPrice: number | null;
  newPrice: number | null;
  gradedPrice: number | null;
  fetchedAt: string;
  expiresAt: string;
}

export interface Listing {
  id: string;
  cardId: string;
  ebayItemId: string;
  title: string;
  imageUrl: string | null;
  ebayUrl: string;
  /** Base listing price before shipping */
  listingPrice: number;
  /** null = free shipping */
  shippingCost: number | null;
  /** listingPrice + (shippingCost ?? 0) */
  totalCost: number;
  marketPrice: number;
  dealScore: number;
  dealTier: DealTier;
  listingType: ListingType;
  condition: string | null;
  seller: string | null;
  sellerFeedback: number | null;
  bids: number | null;
  endTime: string | null; // ISO date string
  fetchedAt: string;
  expiresAt: string;
}

export interface WatchedCard {
  id: string;
  userId: string;
  cardName: string;
  setName: string;
  cardNumber: string | null;
  condition: string;
  /** Maximum total cost (listing + shipping) the user will pay */
  targetPrice: number;
  createdAt: string;
  updatedAt: string;
  /** Best current listing included on GET /api/cards */
  listings?: Listing[];
  priceCache?: PriceCache | null;
}

// ─── Form / mutation payloads ─────────────────────────────────────────────────

export interface CreateCardPayload {
  cardName: string;
  setName: string;
  cardNumber?: string;
  condition: string;
  targetPrice: number;
}

export interface UpdateCardPayload extends Partial<CreateCardPayload> {}

// ─── API response wrappers ────────────────────────────────────────────────────

export interface ListingsResponse {
  listings: Listing[];
  fromCache: boolean;
}

export interface PricesResponse {
  prices: PriceCache;
  fromCache: boolean;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

export interface DealTierConfig {
  label: string;
  color: string;
  bg: string;
  border: string;
}

export const DEAL_TIER_CONFIG: Record<DealTier, DealTierConfig> = {
  HOT:  { label: "🔥 Hot Deal",   color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.35)" },
  GOOD: { label: "✅ Good Deal",  color: "#34d399", bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.35)"  },
  FAIR: { label: "⚠️ Fair",       color: "#facc15", bg: "rgba(250,204,21,0.12)",  border: "rgba(250,204,21,0.35)"  },
  OVER: { label: "❌ Overpriced", color: "#64748b", bg: "rgba(100,116,139,0.12)", border: "#334155"                },
};
