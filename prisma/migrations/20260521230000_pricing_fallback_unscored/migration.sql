-- AlterEnum
ALTER TYPE "DealTier" ADD VALUE 'UNSCORED';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "priceSource" TEXT,
                      ADD COLUMN     "priceCurrency" TEXT;

-- AlterTable
ALTER TABLE "PriceCache" ADD COLUMN  "cardmarketPrices" JSONB;

-- CreateTable
CREATE TABLE "TcgplayerScrapeCache" (
    "id" TEXT NOT NULL,
    "pokemonTcgId" TEXT NOT NULL,
    "productUrl" TEXT,
    "prices" JSONB,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'ok',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TcgplayerScrapeCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TcgplayerScrapeCache_pokemonTcgId_key" ON "TcgplayerScrapeCache"("pokemonTcgId");

-- CreateIndex
CREATE INDEX "TcgplayerScrapeCache_expiresAt_idx" ON "TcgplayerScrapeCache"("expiresAt");
