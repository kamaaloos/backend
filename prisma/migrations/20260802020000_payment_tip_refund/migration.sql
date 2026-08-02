-- Tip + refund tracking on payments
ALTER TABLE "Payment" ADD COLUMN "tipAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "refundedAt" TIMESTAMP(3);
