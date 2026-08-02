-- CreateEnum
CREATE TYPE "OrderMode" AS ENUM ('DINE_IN', 'WALK_IN');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "mode" "OrderMode" NOT NULL DEFAULT 'DINE_IN';
ALTER TABLE "Order" ADD COLUMN "queueNumber" INTEGER;

-- CreateIndex
CREATE INDEX "Order_branchId_mode_status_idx" ON "Order"("branchId", "mode", "status");

-- CreateIndex
CREATE INDEX "Order_branchId_queueNumber_idx" ON "Order"("branchId", "queueNumber");
