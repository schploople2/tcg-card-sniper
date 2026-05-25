-- CreateTable
CREATE TABLE "SavedLot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ebayItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "ebayUrl" TEXT NOT NULL,
    "listingPrice" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedLot_userId_createdAt_idx" ON "SavedLot"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedLot_userId_ebayItemId_key" ON "SavedLot"("userId", "ebayItemId");

-- AddForeignKey
ALTER TABLE "SavedLot" ADD CONSTRAINT "SavedLot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
