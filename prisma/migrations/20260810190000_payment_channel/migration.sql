-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('CASH', 'TERMINAL', 'ONLINE', 'COUNTER');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "channel" "PaymentChannel" NOT NULL DEFAULT 'CASH';

-- Backfill from existing method/provider
UPDATE "Payment"
SET "channel" = CASE
  WHEN "method" = 'ONLINE' THEN 'ONLINE'::"PaymentChannel"
  WHEN "method" = 'CARD' AND "provider" = 'stripe' THEN 'TERMINAL'::"PaymentChannel"
  WHEN "method" = 'CARD' THEN 'COUNTER'::"PaymentChannel"
  ELSE 'CASH'::"PaymentChannel"
END;

-- CreateIndex
CREATE INDEX "Payment_channel_idx" ON "Payment"("channel");
