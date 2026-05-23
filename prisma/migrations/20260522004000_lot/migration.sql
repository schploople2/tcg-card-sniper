-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "ebayItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "ebayUrl" TEXT NOT NULL,
    "listingPrice" DECIMAL(10,2) NOT NULL,
    "shippingCost" DECIMAL(10,2),
    "totalCost" DECIMAL(10,2) NOT NULL,
    "lowEstimate" DECIMAL(12,2) NOT NULL,
    "highEstimate" DECIMAL(12,2) NOT NULL,
    "lotScore" INTEGER NOT NULL,
    "lotTier" "DealTier" NOT NULL,
    "kind" "ListingKind",
    "bids" INTEGER,
    "endTime" TIMESTAMP(3),
    "parsedCards" JSONB NOT NULL,
    "parsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lot_ebayItemId_key" ON "Lot"("ebayItemId");

-- CreateIndex
CREATE INDEX "Lot_lotTier_lotScore_idx" ON "Lot"("lotTier", "lotScore");

-- CreateIndex
CREATE INDEX "Lot_expiresAt_idx" ON "Lot"("expiresAt");
