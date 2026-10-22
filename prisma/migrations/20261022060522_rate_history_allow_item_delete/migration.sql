-- Rate history rows can never be edited. They may go only when the item itself is deleted (an item with no bills,
-- stock, orders or counts), so deleting a mistaken item is not blocked just because its rates were once changed.
DROP TRIGGER product_rate_changes_immutable ON "product_rate_changes";
CREATE TRIGGER product_rate_changes_no_edit BEFORE UPDATE ON "product_rate_changes" FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
