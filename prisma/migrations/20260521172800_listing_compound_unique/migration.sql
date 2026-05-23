-- DropIndex
DROP INDEX "Listing_ebayItemId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Listing_cardId_ebayItemId_key" ON "Listing"("cardId", "ebayItemId");

