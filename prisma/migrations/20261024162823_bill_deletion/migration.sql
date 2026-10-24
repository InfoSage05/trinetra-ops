-- CreateTable
CREATE TABLE "bill_deletions" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "customerName" TEXT NOT NULL,
    "grandTotal" DECIMAL(12,2) NOT NULL,
    "hadPayments" BOOLEAN NOT NULL DEFAULT false,
    "hadReturns" BOOLEAN NOT NULL DEFAULT false,
    "deletedBy" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_deletions_deletedAt_idx" ON "bill_deletions"("deletedAt");

-- The deletion note can never be edited or removed.
CREATE TRIGGER bill_deletions_immutable BEFORE UPDATE OR DELETE ON "bill_deletions" FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- Rows are still never edited. They can be removed only inside the one transaction that discards a whole test bill
-- (the application sets "app.discarding" for that transaction and nothing else does).
CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.discarding', true) = 'on' AND TG_TABLE_NAME <> 'bill_deletions' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Rows in % are immutable; append a compensating entry instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
