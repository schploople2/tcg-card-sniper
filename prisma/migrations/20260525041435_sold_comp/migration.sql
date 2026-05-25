-- CreateTable
CREATE TABLE "SoldComp" (
    "id" TEXT NOT NULL,
    "cardId" TEXT,
    "query" TEXT NOT NULL,
    "ebayItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "soldPrice" DECIMAL(10,2) NOT NULL,
    "shippingCost" DECIMAL(10,2),
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "conditionGrade" TEXT,
    "acceptedOffer" BOOLEAN NOT NULL DEFAULT false,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "imageUrl" TEXT,
    "ebayUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoldComp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SoldComp_cardId_soldAt_idx" ON "SoldComp"("cardId", "soldAt");

-- CreateIndex
CREATE INDEX "SoldComp_query_fetchedAt_idx" ON "SoldComp"("query", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SoldComp_query_ebayItemId_key" ON "SoldComp"("query", "ebayItemId");

-- AddForeignKey
ALTER TABLE "SoldComp" ADD CONSTRAINT "SoldComp_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
