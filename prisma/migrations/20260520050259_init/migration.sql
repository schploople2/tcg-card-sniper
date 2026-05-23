-- CreateEnum
CREATE TYPE "DealTier" AS ENUM ('HOT', 'GOOD', 'FAIR', 'OVER');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('AUCTION', 'FIXED_PRICE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchedCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardName" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "cardNumber" TEXT,
    "condition" TEXT NOT NULL DEFAULT 'Raw NM',
    "targetPrice" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchedCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "ebayItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "ebayUrl" TEXT NOT NULL,
    "listingPrice" DECIMAL(10,2) NOT NULL,
    "shippingCost" DECIMAL(10,2),
    "totalCost" DECIMAL(10,2) NOT NULL,
    "marketPrice" DECIMAL(10,2) NOT NULL,
    "dealScore" INTEGER NOT NULL,
    "dealTier" "DealTier" NOT NULL,
    "listingType" "ListingType" NOT NULL,
    "condition" TEXT,
    "seller" TEXT,
    "sellerFeedback" DOUBLE PRECISION,
    "bids" INTEGER,
    "endTime" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceCache" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "loosePrice" DECIMAL(10,2),
    "cibPrice" DECIMAL(10,2),
    "newPrice" DECIMAL(10,2),
    "gradedPrice" DECIMAL(10,2),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "WatchedCard_userId_idx" ON "WatchedCard"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_ebayItemId_key" ON "Listing"("ebayItemId");

-- CreateIndex
CREATE INDEX "Listing_cardId_idx" ON "Listing"("cardId");

-- CreateIndex
CREATE INDEX "Listing_dealTier_dealScore_idx" ON "Listing"("dealTier", "dealScore");

-- CreateIndex
CREATE INDEX "Listing_expiresAt_idx" ON "Listing"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCache_cardId_key" ON "PriceCache"("cardId");

-- AddForeignKey
ALTER TABLE "WatchedCard" ADD CONSTRAINT "WatchedCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "WatchedCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceCache" ADD CONSTRAINT "PriceCache_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "WatchedCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
