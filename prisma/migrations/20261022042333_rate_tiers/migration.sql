-- CreateEnum
CREATE TYPE "RateTier" AS ENUM ('A', 'B', 'C');

-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "rateTier" "RateTier" NOT NULL DEFAULT 'B';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "rateTier" "RateTier" NOT NULL DEFAULT 'B';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "rateA" DECIMAL(12,2),
ADD COLUMN     "rateC" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "product_rate_changes" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tier" "RateTier" NOT NULL,
    "oldRate" DECIMAL(12,2),
    "newRate" DECIMAL(12,2),
    "reason" TEXT,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_rate_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_rate_changes_productId_changedAt_idx" ON "product_rate_changes"("productId", "changedAt");

-- AddForeignKey
ALTER TABLE "product_rate_changes" ADD CONSTRAINT "product_rate_changes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
