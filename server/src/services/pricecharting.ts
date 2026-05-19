import axios from "axios";
import { config } from "../config.js";

const BASE_URL = "https://www.pricecharting.com/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceChartingProduct {
  id: number;
  "product-name": string;
  "console-name": string;
  /** Prices in cents */
  "loose-price": number;
  "cib-price": number;
  "new-price": number;
  "graded-price": number;
}

interface PriceChartingSearchResponse {
  products: PriceChartingProduct[];
}

export interface CardPrices {
  /** Loose/raw price in dollars */
  loosePrice: number | null;
  /** CIB (complete in box) price in dollars */
  cibPrice: number | null;
  /** New/sealed price in dollars */
  newPrice: number | null;
  /** Graded (PSA/BGS) price in dollars */
  gradedPrice: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** PriceCharting returns prices in cents — convert to dollars */
function centsToUsd(cents: number | undefined): number | null {
  if (!cents || cents === 0) return null;
  return Math.round(cents) / 100;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up market prices for a Pokémon card by name.
 * Returns the best match from PriceCharting's product search.
 *
 * Prices are cached at the DB layer (PriceCache model, 6-hour TTL) —
 * this function is only called on a cache miss.
 */
export async function fetchCardPrices(cardName: string): Promise<CardPrices | null> {
  const response = await axios.get<PriceChartingSearchResponse>(
    `${BASE_URL}/products`,
    {
      params: {
        q: cardName,
        status: "prices",
        apikey: config.PRICECHARTING_API_KEY,
      },
    }
  );

  const products = response.data.products;
  if (!products?.length) return null;

  // Prefer exact name match, fall back to first result
  const match =
    products.find(
      (p) => p["product-name"].toLowerCase() === cardName.toLowerCase()
    ) ?? products[0];

  return {
    loosePrice: centsToUsd(match["loose-price"]),
    cibPrice: centsToUsd(match["cib-price"]),
    newPrice: centsToUsd(match["new-price"]),
    gradedPrice: centsToUsd(match["graded-price"]),
  };
}

/**
 * Fetch prices by PriceCharting product ID (faster, more precise).
 * Use this when you've already identified the exact product.
 */
export async function fetchCardPricesById(productId: number): Promise<CardPrices | null> {
  const response = await axios.get<PriceChartingProduct>(
    `${BASE_URL}/product`,
    {
      params: {
        id: productId,
        apikey: config.PRICECHARTING_API_KEY,
      },
    }
  );

  const p = response.data;
  return {
    loosePrice: centsToUsd(p["loose-price"]),
    cibPrice: centsToUsd(p["cib-price"]),
    newPrice: centsToUsd(p["new-price"]),
    gradedPrice: centsToUsd(p["graded-price"]),
  };
}
