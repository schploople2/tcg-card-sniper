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

  /**
   * Enables the TCGPlayer scraping fallback. Defaults OFF because TCGPlayer's
   * product pages are fully client-rendered (React app shell) — static
   * scraping returns no price data, so the scraper is a no-op until we wire
   * up a headless browser (playwright/puppeteer) or find an authorised JSON
   * endpoint. The service is left in place so flipping this flag back on
   * after that work is a single env var change. For now, alt-art cards fall
   * through to the cardmarket fallback.
   */
  ENABLE_TCGPLAYER_SCRAPE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /**
   * Marketplace Account Deletion notification config.
   * Verification token must be 32-80 chars, alphanumeric + `_-` only (eBay's rule).
   * Endpoint URL is the exact public HTTPS URL eBay will call — used in the
   * SHA-256 challenge response, so it must match byte-for-byte what's saved
   * in the eBay developer console.
   */
  EBAY_DELETION_VERIFICATION_TOKEN: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,80}$/, "EBAY_DELETION_VERIFICATION_TOKEN must be 32-80 chars [A-Za-z0-9_-]")
    .default("dev_placeholder_verification_token_change_me_32"),
  EBAY_DELETION_ENDPOINT_URL: z
    .string()
    .url()
    .default("https://example.com/ebay/account-deletion"),

  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  /**
   * Pc — Vision-AI card detection. When `OCR_PROVIDER=claude`, the lot
   * analyzer's "Suggest cards from photos" button will call Anthropic's
   * Vision API to identify cards in eBay listing images. Set to `none` to
   * disable cleanly (the UI hides the button when the endpoint returns 503).
   *
   * `ANTHROPIC_API_KEY` is only required when `OCR_PROVIDER=claude`.
   * `OCR_MAX_IMAGES_PER_LOT` caps spend per call — at ~$0.003/image this
   * keeps a single lot under $0.02 even with the heaviest listings.
   */
  OCR_PROVIDER: z.enum(["claude", "none"]).default("none"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OCR_MAX_IMAGES_PER_LOT: z.coerce.number().int().min(1).max(20).default(6),
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
