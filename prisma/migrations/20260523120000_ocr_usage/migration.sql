-- CreateTable
CREATE TABLE "OcrUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "imagesProcessed" INTEGER NOT NULL DEFAULT 0,
    "callsMade" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OcrUsage_userId_day_key" ON "OcrUsage"("userId", "day");

-- CreateIndex
CREATE INDEX "OcrUsage_day_idx" ON "OcrUsage"("day");

-- AddForeignKey
ALTER TABLE "OcrUsage" ADD CONSTRAINT "OcrUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
