-- CreateTable
CREATE TABLE "LotAnnotation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ebayItemId" TEXT NOT NULL,
    "addedCards" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LotAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LotAnnotation_userId_ebayItemId_key" ON "LotAnnotation"("userId", "ebayItemId");

-- CreateIndex
CREATE INDEX "LotAnnotation_ebayItemId_idx" ON "LotAnnotation"("ebayItemId");

-- AddForeignKey
ALTER TABLE "LotAnnotation" ADD CONSTRAINT "LotAnnotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LotImage" (
    "id" TEXT NOT NULL,
    "ebayItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "ocrText" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LotImage_ebayItemId_position_key" ON "LotImage"("ebayItemId", "position");

-- CreateIndex
CREATE INDEX "LotImage_ebayItemId_idx" ON "LotImage"("ebayItemId");
