-- CreateIndex
CREATE INDEX "bill_line_items_productId_idx" ON "bill_line_items"("productId");

-- CreateIndex
CREATE INDEX "credit_note_lines_creditNoteId_idx" ON "credit_note_lines"("creditNoteId");

-- CreateIndex
CREATE INDEX "credit_notes_noteDate_idx" ON "credit_notes"("noteDate");

-- CreateIndex
CREATE INDEX "stock_ledger_createdAt_idx" ON "stock_ledger"("createdAt");

