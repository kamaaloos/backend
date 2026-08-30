-- Ordered gallery for cinematic menu backgrounds.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "brandBackgroundUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill single brandBackgroundUrl into the gallery when empty.
UPDATE "Restaurant"
SET "brandBackgroundUrls" = ARRAY["brandBackgroundUrl"]
WHERE "brandBackgroundUrl" IS NOT NULL
  AND "brandBackgroundUrl" <> ''
  AND (cardinality("brandBackgroundUrls") IS NULL OR cardinality("brandBackgroundUrls") = 0);
