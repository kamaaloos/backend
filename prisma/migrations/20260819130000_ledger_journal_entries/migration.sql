-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ACCOUNTANT';

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "debit" DECIMAL(10,2) NOT NULL,
    "credit" DECIMAL(10,2) NOT NULL,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "LedgerCategory" AS ENUM ('REVENUE', 'TIPS', 'REFUND', 'TAX', 'ADJUSTMENT');

-- AlterColumn to use enum
ALTER TABLE "JournalEntry" ALTER COLUMN "category" TYPE "LedgerCategory" USING "category"::"LedgerCategory";

-- CreateIndex
CREATE INDEX "JournalEntry_restaurantId_date_idx" ON "JournalEntry"("restaurantId", "date");
CREATE INDEX "JournalEntry_branchId_date_idx" ON "JournalEntry"("branchId", "date");
CREATE INDEX "JournalEntry_paymentId_idx" ON "JournalEntry"("paymentId");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
