-- A1 + A4: Lot-tied alerts.
-- Alert.cardId / Alert.listingId become nullable so lot-only alerts can
-- reference Alert.lotEbayItemId instead. App layer enforces "exactly one
-- of (cardId+listingId) | lotEbayItemId is set per row".
ALTER TYPE "AlertKind" ADD VALUE 'LOT_HOT';

ALTER TABLE "Alert"
  ADD COLUMN "lotEbayItemId" TEXT,
  ALTER COLUMN "cardId" DROP NOT NULL,
  ALTER COLUMN "listingId" DROP NOT NULL;

CREATE UNIQUE INDEX "Alert_userId_lotEbayItemId_kind_key"
  ON "Alert" ("userId", "lotEbayItemId", "kind");
