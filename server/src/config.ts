import { z } from "zod";

/**
 * Validate and export all environment variables at startup.
 * The app will throw immediately if any required variable is missing,
 * rather than failing mysteriously at runtime.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL connection string"),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  EBAY_CLIENT_ID: z.string().min(1, "EBAY_CLIENT_ID is required"),
  EBAY_CLIENT_SECRET: z.string().min(1, "EBAY_CLIENT_SECRET is required"),
  EBAY_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),

  PRICECHARTING_API_KEY: z.string().min(1, "PRICECHARTING_API_KEY is required"),

  CORS_ORIGIN: z.string().default("http://localhost:5173"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌  Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

/** eBay API base URL — switches automatically based on EBAY_ENVIRONMENT */
export const EBAY_BASE_URL =
  config.EBAY_ENVIRONMENT === "production"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";

/** Pokémon TCG category ID on eBay */
export const EBAY_POKEMON_CATEGORY_ID = "183454";

/** Listing cache TTL in milliseconds (30 minutes) */
export const LISTING_CACHE_TTL_MS = 30 * 60 * 1000;

/** Price cache TTL in milliseconds (6 hours) */
export const PRICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
