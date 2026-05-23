-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('TARGET_HIT', 'HOT_DEAL');

-- AlterTable
ALTER TABLE "WatchedCard" ADD COLUMN "targetPrice" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "readAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Alert_cardId_listingId_kind_key" ON "Alert"("cardId", "listingId", "kind");

-- CreateIndex
CREATE INDEX "Alert_userId_readAt_idx" ON "Alert"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "WatchedCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
