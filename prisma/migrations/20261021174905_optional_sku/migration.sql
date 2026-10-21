-- AlterTable
ALTER TABLE "bill_line_items" ALTER COLUMN "productSku" DROP NOT NULL;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "sku" DROP NOT NULL;
