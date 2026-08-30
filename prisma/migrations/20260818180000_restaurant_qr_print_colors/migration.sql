-- Table QR print card colors (Scan Me frame vs QR modules).
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "qrFrameColor" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "qrModuleColor" TEXT;
