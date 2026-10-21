-- AlterTable
ALTER TABLE "bill_line_items" ADD COLUMN     "qtyPerCarton" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "qtyPerCarton" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "bill_charges" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "chargeNo" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "taxableValue" DECIMAL(12,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "cgstAmount" DECIMAL(12,2) NOT NULL,
    "sgstAmount" DECIMAL(12,2) NOT NULL,
    "igstAmount" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "bill_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bill_charges_billId_chargeNo_key" ON "bill_charges"("billId", "chargeNo");

-- AddForeignKey
ALTER TABLE "bill_charges" ADD CONSTRAINT "bill_charges_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Posted invoice charges are append-only, like the invoice itself.
CREATE TRIGGER bill_charges_immutable BEFORE UPDATE OR DELETE ON "bill_charges"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
