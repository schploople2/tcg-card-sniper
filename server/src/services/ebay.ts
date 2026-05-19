import axios from "axios";
import { config, EBAY_BASE_URL, EBAY_POKEMON_CATEGORY_ID } from "../config.js";

// ─── OAuth token cache ────────────────────────────────────────────────────────

interface EbayToken {
  accessToken: string;
  expiresAt: number; // Unix ms
}

let tokenCache: EbayToken | null = null;

/**
 * Fetch (or return a cached) eBay application token via the
 * OAuth 2.0 Client Credentials flow.
 *
 * Tokens are valid for 7200 seconds (2 hours). We refresh 5 minutes
 * early to avoid races at expiry boundaries.
 */
async function getEbayToken(): Promise<string> {
  const now = Date.now();
  const BUFFER_MS = 5 * 60 * 1000; // 5 min

  if (tokenCache && tokenCache.expiresAt - BUFFER_MS > now) {
    return tokenCache.accessToken;
  }

  const credentials = Buffer.from(
    `${config.EBAY_CLIENT_ID}:${config.EBAY_CLIENT_SECRET}`
  ).toString("base64");

  const response = await axios.post<{ access_token: string; expires_in: number }>(
    `${EBAY_BASE_URL}/identity/v1/oauth2/token`,
    "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  tokenCache = {
    accessToken: response.data.access_token,
    expiresAt: now + response.data.expires_in * 1000,
  };

  return tokenCache.accessToken;
}

// ─── Browse API types ─────────────────────────────────────────────────────────

export interface EbayListingRaw {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
  shippingOptions?: Array<{
    shippingCost?: { value: string; currency: string };
    shippingCostType?: string; // "FIXED" | "FREE" | "CALCULATED"
  }>;
  buyingOptions: string[]; // ["AUCTION"] | ["FIXED_PRICE"] | ["AUCTION", "FIXED_PRICE"]
  itemAffiliateWebUrl?: string;
  itemWebUrl: string;
  condition?: string;
  seller?: { username: string; feedbackPercentage: string };
  currentBidPrice?: { value: string };
  bidCount?: number;
  itemEndDate?: string; // ISO 8601
  thumbnailImages?: Array<{ imageUrl: string }>;
}

interface SearchResponse {
  itemSummaries?: EbayListingRaw[];
  total?: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface NormalisedListing {
  ebayItemId: string;
  title: string;
  imageUrl: string | null;
  ebayUrl: string;
  listingPrice: number;
  /** null = free shipping */
  shippingCost: number | null;
  /** listingPrice + (shippingCost ?? 0) */
  totalCost: number;
  listingType: "AUCTION" | "FIXED_PRICE";
  condition: string | null;
  seller: string | null;
  sellerFeedback: number | null;
  bids: number | null;
  endTime: Date | null;
}

/**
 * Search eBay for listings of a specific Pokémon card.
 *
 * @param cardName  - e.g. "Charizard ex"
 * @param condition - optional condition filter appended to the query
 * @param limit     - max results to return (eBay max 200)
 */
export async function searchEbayListings(
  cardName: string,
  condition?: string,
  limit = 20
): Promise<NormalisedListing[]> {
  const token = await getEbayToken();

  const query = condition ? `${cardName} ${condition}` : cardName;

  const response = await axios.get<SearchResponse>(
    `${EBAY_BASE_URL}/buy/browse/v1/item_summary/search`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "X-EBAY-C-ENDUSERCTX": "contextualLocation=country%3DUS",
      },
      params: {
        q: query,
        category_ids: EBAY_POKEMON_CATEGORY_ID,
        limit,
        fieldgroups: "EXTENDED",
        filter: [
          "conditionIds:{1000|1500|2000|2500|3000}", // NM, LP, MP, HP, Poor
          "buyingOptions:{FIXED_PRICE|AUCTION}",
        ].join(","),
      },
    }
  );

  const items = response.data.itemSummaries ?? [];
  return items.map(normaliseItem);
}

// ─── Normalisation helper ─────────────────────────────────────────────────────

/**
 * Convert a raw eBay item summary into our clean internal shape.
 * Key decisions:
 *  - shippingCost: null when eBay says "FREE" or cost is $0.00
 *  - totalCost:    listingPrice + (shippingCost ?? 0)
 *  - listingType:  AUCTION when buyingOptions includes "AUCTION"
 */
function normaliseItem(item: EbayListingRaw): NormalisedListing {
  const listingPrice = parseFloat(item.price.value);

  // Determine shipping cost — null means free
  let shippingCost: number | null = null;
  const shippingOption = item.shippingOptions?.[0];
  if (shippingOption) {
    const isFree =
      shippingOption.shippingCostType === "FREE" ||
      parseFloat(shippingOption.shippingCost?.value ?? "0") === 0;
    if (!isFree && shippingOption.shippingCost) {
      shippingCost = parseFloat(shippingOption.shippingCost.value);
    }
  }

  const totalCost = listingPrice + (shippingCost ?? 0);

  const isAuction = item.buyingOptions.includes("AUCTION");

  return {
    ebayItemId: item.itemId,
    title: item.title,
    imageUrl: item.thumbnailImages?.[0]?.imageUrl ?? null,
    ebayUrl: item.itemAffiliateWebUrl ?? item.itemWebUrl,
    listingPrice,
    shippingCost,
    totalCost,
    listingType: isAuction ? "AUCTION" : "FIXED_PRICE",
    condition: item.condition ?? null,
    seller: item.seller?.username ?? null,
    sellerFeedback: item.seller?.feedbackPercentage
      ? parseFloat(item.seller.feedbackPercentage)
      : null,
    bids: item.bidCount ?? null,
    endTime: item.itemEndDate ? new Date(item.itemEndDate) : null,
  };
}
