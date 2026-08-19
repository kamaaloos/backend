-- Walk-in capability tokens expire; backfill legacy table QR tokens with no TTL.
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "walkInTokenExpiresAt" TIMESTAMP(3);

UPDATE "Branch"
SET "walkInTokenExpiresAt" = NOW() + INTERVAL '90 days'
WHERE "walkInTokenExpiresAt" IS NULL;

UPDATE "Table"
SET "qrTokenExpiresAt" = NOW() + INTERVAL '90 days'
WHERE "qrTokenExpiresAt" IS NULL
  AND ("qrToken" IS NOT NULL OR "qrCode" IS NOT NULL);
