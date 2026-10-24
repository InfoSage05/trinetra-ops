/*
  Warnings:

  - You are about to alter the column `unitPrice` on the `bill_line_items` table. The data in that column could be lost. The data in that column will be cast from `Decimal(12,2)` to `Decimal(12,4)`.

*/
-- AlterTable
ALTER TABLE "bill_line_items" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(12,4);
