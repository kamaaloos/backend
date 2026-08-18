-- Per-restaurant dish photo library (https blob URLs).
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "menuImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
