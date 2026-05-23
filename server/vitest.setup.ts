/**
 * Vitest setup — populates the env vars `config.ts` validates at import time.
 *
 * `config.ts` calls `process.exit(1)` if any required env var is missing.
 * In tests we never make real network calls or hit Postgres, but the modules
 * we import *do* import config transitively — so without these stubs the
 * test runner itself bails on the first import.
 *
 * Values are obviously-fake — no real keys, no real database. If a test
 * accidentally tries to make a real outbound call with these credentials
 * the request will fail loud (401/connection refused), which is the desired
 * behavior — tests should mock IO, not hit the network.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test_db";
process.env.JWT_SECRET ??= "test-jwt-secret-must-be-at-least-32-characters-long";
process.env.EBAY_CLIENT_ID ??= "test-client-id";
process.env.EBAY_CLIENT_SECRET ??= "test-client-secret";
process.env.EBAY_ENVIRONMENT ??= "sandbox";
process.env.EBAY_DELETION_VERIFICATION_TOKEN ??=
  "test_verification_token_for_unit_tests_xxxxxxxxxxxx";
process.env.EBAY_DELETION_ENDPOINT_URL ??=
  "https://test.example.com/ebay/account-deletion";
process.env.NODE_ENV ??= "test";
process.env.PORT ??= "3099";
process.env.ENABLE_TCGPLAYER_SCRAPE ??= "false";
