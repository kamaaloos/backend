/*
  Warnings:

  - You are about to drop the column `ipAddress` on the `Device` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[token]` on the table `Device` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `token` to the `Device` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Device" DROP CONSTRAINT "Device_branchId_fkey";

-- DropIndex
DROP INDEX "Device_branchId_idx";

-- AlterTable
ALTER TABLE "Device" DROP COLUMN "ipAddress",
ADD COLUMN     "appVersion" TEXT,
ADD COLUMN     "token" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Device_token_key" ON "Device"("token");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
