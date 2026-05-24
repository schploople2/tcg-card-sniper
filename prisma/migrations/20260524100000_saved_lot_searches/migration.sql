-- B4: SavedLotSearch — per-user persisted lot search queries.
-- See model in schema.prisma and docs/features/a2l-saved-lot-searches.md.
CREATE TABLE "SavedLotSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "minLowEstimate" DECIMAL(10,2),
    "maxAskingPrice" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" TIMESTAMP(3),

    CONSTRAINT "SavedLotSearch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedLotSearch_userId_idx" ON "SavedLotSearch"("userId");
CREATE UNIQUE INDEX "SavedLotSearch_userId_query_key" ON "SavedLotSearch"("userId", "query");

ALTER TABLE "SavedLotSearch"
  ADD CONSTRAINT "SavedLotSearch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
