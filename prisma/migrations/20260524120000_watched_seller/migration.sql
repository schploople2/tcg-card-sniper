-- D2: WatchedSeller — per-user eBay seller alerts.
-- New AlertKind value SELLER_LISTING is added in a separate ALTER TYPE
-- statement at the top so it's available to subsequent inserts immediately.
-- See docs/features/d5x-watched-seller.md.
ALTER TYPE "AlertKind" ADD VALUE 'SELLER_LISTING';

CREATE TABLE "WatchedSeller" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchedSeller_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WatchedSeller_userId_idx" ON "WatchedSeller"("userId");
CREATE INDEX "WatchedSeller_sellerName_idx" ON "WatchedSeller"("sellerName");
CREATE UNIQUE INDEX "WatchedSeller_userId_sellerName_key"
  ON "WatchedSeller"("userId", "sellerName");

ALTER TABLE "WatchedSeller"
  ADD CONSTRAINT "WatchedSeller_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
