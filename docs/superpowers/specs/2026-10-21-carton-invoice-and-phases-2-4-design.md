# Carton-based invoice template + Phases 2–4 — Design

Status: approved by the owner's request of 2026-10-21 ("go ahead with phase 2 and other phases"). Builds on the Phase 1 spec (v2); every Phase 1 principle still binds (append-only ledgers, domain-layer role checks, idempotency, humans approve every AI proposal).

## 1. Carton model (new requirement)
- Every product has `qtyPerCarton` (pieces per carton, integer ≥ 1). Birthday candles, masjid candles and flower candles differ.
- The stock ledger stays in **pieces**; cartons are a display/entry convenience (`12 cartons + 5 pcs`).
- A bill line is entered as **cartons (+ optional loose pieces)**; total quantity = cartons × qtyPerCarton + loose. The domain also still accepts a plain `quantity` in pieces. The line snapshots `qtyPerCarton`; the invoice's "NO OF CARTOONS" column is `quantity ÷ qtyPerCarton`.

## 2. Invoice template (from `new in voice.xlsx`)
Header (TAX INVOICE, business, address, GST no, invoice no/date) · purchaser (name, mobile, address, GST no) · 12 columns: SL NO, DESCRIPTION, HSN/SAC, NO OF CARTOONS, QNTY PER CARTOON, TOTAL QNTY, UNIT, RATE, CGST, SGST, IGST, TOTAL AMOUNT · at least 15 rows · three charge rows (TOTAL CARTOON = carton packing charge, EXTRA CARRET = crate charge, FREIGHT CHARGES) · invoice value in words + GRAND TOTAL · terms & conditions · bank details · "Customer seal and Signature" / "Signature of the Supplier".
- Extra charges are stored as `bill_charges` rows (immutable), taxed at a rate the owner can set per charge (default: the highest rate on the bill, because packing/freight on a composite supply follow the principal supply). **Open item for the CA.**
- Spelling slips in the sheet (IN VOICE, TURMS, CARTOON, CARRET, UNIOUN) are corrected on the printed invoice.
- The GST number on the sheet fails the official checksum (`...H**I**ZX`); the valid form `21ASKPD3583H1ZX` is used as the default and flagged for the owner to verify.

## 3. Billing screen
Modelled on the template: purchaser block, item rows (cartons, extra pieces, rate, discount; qty/carton, total qty, unit, GST derived), the three charges, live totals and amount in words. A **stock panel** sits beside the form (sticky side panel on laptops, floating card on phones) and follows the item being edited: pieces, cartons + pieces, after-this-bill remainder, reorder warning.

## 4. Connected sections
Customer page (bills, dues, "new bill for this customer"), item page (stock, movement history, "bill this item", "add production"), cross-links from bills, stock, dashboard and orders; `/billing/new?customer=…&product=…&order=…` prefill.

## 5. Phase 2 — AI-assisted data entry
- One provider-neutral client over an **OpenAI-compatible API** (Groq / OpenRouter / Together / Hugging Face / a self-hosted server) → open-source models; separate optional speech-to-text client (Whisper). Config only via env; tests use mocks.
- Model output is always a **typed proposal** (zod-validated, products matched against the real catalogue, IDs verified). A human reviews and approves; only then are the existing domain functions called, with `actorType = AGENT` and provenance in `sourceMetadata`. The model never writes to a ledger.
- Typed/voice stock updates ("rose candle 5 carton bana", "birthday 3 ctn") → production proposals. A deterministic fallback parser works with no AI key.
- Stock-sheet upload (any layout) → LLM extracts item/quantity rows → matched to products → proposed **stock counts** (owner approves, existing count workflow).

## 6. Phase 3 — Orders, voice intake, reminders
- `orders` + `order_lines` (ordered/fulfilled quantities, due date, status PENDING / PARTIAL / COMPLETED / CANCELLED, source MANUAL / TEXT / VOICE). Bills may reference an order and automatically advance its fulfilled quantities.
- Voice or typed order → proposal (customer, items in cartons, due date) → review → saved as a pending order.
- Pending-orders view with what to produce (outstanding vs stock), overdue/due-soon reminders on the dashboard, one-tap WhatsApp reminder text (no key needed).

## 7. Phase 4 — Reports and hardening
Sales/GST/ageing/stock-movement reports with date ranges, CSV exports (sales register, HSN-wise GST summary), SQL aggregation instead of loading all bills, paginated bill list, extra indexes.

## 8. Out of scope / later
Raw-material and BOM tracking, multi-warehouse, a real e-invoice (IRP/GSP) adapter (needs CA confirmation + credentials), payment-gateway collection.
