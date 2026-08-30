-- Track which staff member received / settled a till payment.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "receivedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "Payment_receivedByUserId_idx" ON "Payment"("receivedByUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_receivedByUserId_fkey'
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_receivedByUserId_fkey"
      FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
