-- Product rates are normalized to a per-piece basis. Four decimals preserve
-- rates entered per dozen (for example ₹10 / 12 pieces = ₹0.8333 per piece).
ALTER TABLE "products"
  ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(12,4),
  ALTER COLUMN "rateA" SET DATA TYPE DECIMAL(12,4),
  ALTER COLUMN "rateC" SET DATA TYPE DECIMAL(12,4);

ALTER TABLE "product_rate_changes"
  ALTER COLUMN "oldRate" SET DATA TYPE DECIMAL(12,4),
  ALTER COLUMN "newRate" SET DATA TYPE DECIMAL(12,4);
