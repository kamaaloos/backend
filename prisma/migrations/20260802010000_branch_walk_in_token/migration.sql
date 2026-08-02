-- Opaque public walk-in token (replaces exposing branch UUID on guest routes)
ALTER TABLE "Branch" ADD COLUMN "walkInToken" TEXT;

UPDATE "Branch"
SET "walkInToken" = gen_random_uuid()::text
WHERE "walkInToken" IS NULL;

ALTER TABLE "Branch" ALTER COLUMN "walkInToken" SET NOT NULL;

CREATE UNIQUE INDEX "Branch_walkInToken_key" ON "Branch"("walkInToken");
