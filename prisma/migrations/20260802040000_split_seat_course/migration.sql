-- CreateEnum
CREATE TYPE "Course" AS ENUM ('APPETIZER', 'DRINK', 'MAIN', 'DESSERT', 'OTHER');

-- AlterTable OrderItem
ALTER TABLE "OrderItem" ADD COLUMN "seatNumber" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "course" "Course" NOT NULL DEFAULT 'MAIN';
ALTER TABLE "OrderItem" ADD COLUMN "firedAt" TIMESTAMP(3);

-- Fire existing kitchen-visible lines so current tickets keep cooking.
UPDATE "OrderItem" SET "firedAt" = "createdAt"
WHERE "status" IN ('NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED');

-- AlterTable Payment: allow multiple payments per order
DROP INDEX IF EXISTS "Payment_orderId_key";
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateTable PaymentLine
CREATE TABLE "PaymentLine" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentLine_paymentId_orderItemId_key" ON "PaymentLine"("paymentId", "orderItemId");
CREATE INDEX "PaymentLine_orderItemId_idx" ON "PaymentLine"("orderItemId");

ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
