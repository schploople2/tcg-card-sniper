-- CreateEnum
CREATE TYPE "ListingKind" AS ENUM ('AUCTION_ONLY', 'BIN', 'BIN_PLUS_AUCTION');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "kind" "ListingKind";
