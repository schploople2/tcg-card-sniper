-- CreateTable
CREATE TABLE "WatchlistGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchlistGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WatchlistGroup_userId_idx" ON "WatchlistGroup"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistGroup_userId_name_key" ON "WatchlistGroup"("userId", "name");

-- AddForeignKey
ALTER TABLE "WatchlistGroup" ADD CONSTRAINT "WatchlistGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "WatchedCard" ADD COLUMN "groupId" TEXT;

-- CreateIndex
CREATE INDEX "WatchedCard_userId_groupId_idx" ON "WatchedCard"("userId", "groupId");

-- AddForeignKey
ALTER TABLE "WatchedCard" ADD CONSTRAINT "WatchedCard_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WatchlistGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
