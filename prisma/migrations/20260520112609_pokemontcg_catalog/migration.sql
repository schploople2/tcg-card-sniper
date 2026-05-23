/*
  Warnings:

  - You are about to drop the column `cibPrice` on the `PriceCache` table. All the data in the column will be lost.
  - You are about to drop the column `gradedPrice` on the `PriceCache` table. All the data in the column will be lost.
  - You are about to drop the column `loosePrice` on the `PriceCache` table. All the data in the column will be lost.
  - You are about to drop the column `newPrice` on the `PriceCache` table. All the data in the column will be lost.
  - You are about to drop the column `condition` on the `WatchedCard` table. All the data in the column will be lost.
  - Added the required column `pokemonTcgId` to the `WatchedCard` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PriceCache" DROP COLUMN "cibPrice",
DROP COLUMN "gradedPrice",
DROP COLUMN "loosePrice",
DROP COLUMN "newPrice",
ADD COLUMN     "variants" JSONB;

-- AlterTable
ALTER TABLE "WatchedCard" DROP COLUMN "condition",
ADD COLUMN     "pokemonTcgId" TEXT NOT NULL,
ADD COLUMN     "variant" TEXT NOT NULL DEFAULT 'normal';
