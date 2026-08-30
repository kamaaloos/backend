-- Per-restaurant customer brand pack (colors + existing logoUrl).
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "brandAccent" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "brandButton" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "brandPaper" TEXT;
