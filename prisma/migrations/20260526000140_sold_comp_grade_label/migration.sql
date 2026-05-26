-- AlterTable
ALTER TABLE "SoldComp" ADD COLUMN     "gradeLabel" TEXT;

-- CreateIndex
CREATE INDEX "SoldComp_cardId_gradeLabel_idx" ON "SoldComp"("cardId", "gradeLabel");

-- C2 backfill: extract gradeLabel from existing GRADED rows using Postgres regex.
-- Matches grader + score with optional space (e.g. "PSA10", "PSA 10", "BGS 9.5").
-- Uppercased for canonical form so all "PSA 10" labels are byte-identical.
UPDATE "SoldComp"
SET "gradeLabel" =
  UPPER(SUBSTRING("title" FROM '(?i)\b(PSA|BGS|CGC|SGC|ACE|GMA)\b'))
  || ' '
  || SUBSTRING("title" FROM '(?i)\b(?:PSA|BGS|CGC|SGC|ACE|GMA)\s*(10|9\.5|9|8\.5|8|7\.5|7|6|5|4|3|2|1)\b')
WHERE "conditionGrade" = 'GRADED'
  AND "title" ~* '\m(PSA|BGS|CGC|SGC|ACE|GMA)\s*(10|9\.5|9|8\.5|8|7\.5|7|6|5|4|3|2|1)\M';
