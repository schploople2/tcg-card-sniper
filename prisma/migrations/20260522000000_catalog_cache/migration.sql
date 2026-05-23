-- Enable pg_trgm extension for fast fuzzy / substring search on card names.
-- The extension is a built-in PostgreSQL contrib module; Railway's managed
-- Postgres allows CREATE EXTENSION on the application database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "rarity" TEXT,
    "setId" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "setSeries" TEXT NOT NULL,
    "setReleaseDate" TEXT,
    "setTotal" INTEGER,
    "imageSmall" TEXT,
    "imageLarge" TEXT,
    "variants" TEXT[],
    "hasCardmarket" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- B-tree indexes (Prisma-style)
CREATE INDEX "Card_setId_idx" ON "Card"("setId");
CREATE INDEX "Card_number_idx" ON "Card"("number");

-- Trigram GIN indexes — these power the catalog search.
-- gin_trgm_ops supports both LIKE '%foo%' and similarity() ranking.
CREATE INDEX "Card_name_trgm_idx" ON "Card" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Card_setName_trgm_idx" ON "Card" USING GIN ("setName" gin_trgm_ops);
