-- The rate history is a record: rows are never edited or deleted.
CREATE TRIGGER product_rate_changes_immutable BEFORE UPDATE OR DELETE ON "product_rate_changes" FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
