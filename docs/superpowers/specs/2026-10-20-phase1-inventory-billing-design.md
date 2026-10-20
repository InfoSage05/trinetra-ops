# Trinetra Candles — Phase 1: Inventory + Billing Core — Design Spec (v2, consolidated)

> v2 supersedes the original version of this document. It folds in findings from three initial
> review agents (business/domain fit, technical architecture, future-extensibility) and a
> subsequent external audit (Codex) that corrected several factual errors in the original design
> and in the first round of review resolutions. The full history is preserved in the paired
> document `2026-10-20-trinetra-candles-full-context-and-phase1-plan.md`; this file is the
> single current source of truth for implementation.

## 1. Context & Problem

Trinetra Candles is a candle manufacturing business run by the user's father, currently using
HDPOS Smart V2 for billing and inventory. The core pain point: inventory (tracked in Excel) and
billing (done in HDPOS) are disconnected. Before building a bill, the father has to manually check
an Excel sheet for stock availability, then manually edit that Excel sheet afterward to reflect
what was just sold. This is fully manual, error-prone, and becomes especially chaotic during
seasonal demand spikes (Puja, Diwali).

This is not a plan to replace HDPOS wholesale. It's a new, purpose-built system designed around
the business's actual workflow, starting with the single highest-value fix: making stock
visibility and stock deduction automatic and inseparable from the billing process itself — while
also being honest about what a real, legally-compliant, production-usable billing system needs on
day one (correct GST handling, a way to process returns, a trustworthy opening stock number, and
backups), rather than treating those as someday-maybe polish.

This spec covers **Phase 1 only**: Inventory (finished goods) + Billing. Later phases (not
designed here) will add:
- **Phase 2:** LLM-assisted data entry — typed natural-language stock updates, Excel upload
  parsing/reconciliation.
- **Phase 3:** Voice-to-order capture, pending-orders/reminders dashboard.
- **Phase 4:** Reporting/analytics, broader order-to-cash/procurement/manufacturing phases (see
  Section 15), festive-season load review.

Phase 1 deliberately excludes raw-material inventory and bill-of-materials (BOM)/manufacturing
tracking — it tracks only finished, sellable candle SKUs.

**Confirmed business fact (resolves an open question from review):** in this business, billing
and physical handover of goods happen **at the same time**, almost always. This means Phase 1
does not need a three-way separation of ordered/invoiced/dispatched quantities — one bill line
item's quantity represents all three at once. If this ever stops being true in practice (e.g. a
future bulk order shipped over several days), that would need a dedicated order/fulfillment model
— deliberately not built now, since it would be speculative.

## 2. Goals & Success Criteria

- When building a bill, the person entering it sees live, accurate stock availability for each
  product as they add it — no separate Excel lookup.
- Finalizing a bill automatically and atomically deducts stock — no manual Excel edit afterward.
- Logging production (new stock made) is a first-class action that increases stock the same way
  selling decreases it.
- Every stock change is traceable: what changed, by how much, why, who did it, and when — and
  corrections never overwrite history, they append to it.
- Bills are legally valid GST tax invoices (including e-invoicing where applicable), support
  partial/credit payment tracking, and can be both printed and shared digitally (PDF).
- A return or billing mistake can be processed through a proper credit note, not a silent edit.
- Opening stock is seeded through an explicit, auditable process, not assumed correct.
- The system can actually be trusted to run the business day-to-day: backups exist, a restore has
  been rehearsed at least once, and there's a one-page runbook for "what do I do if X breaks."
- The father (owner) and workers have separate logins; workers cannot see pricing/financials or
  make bills, only log production and view stock levels.
- The system is usable from both phone and laptop, from different locations, since the business
  is cloud-hosted rather than tied to one PC.
- The architecture must not block future phases: LLM-driven agents (voice orders, Excel parsing)
  must be able to reuse the same core logic as the UI, not reimplement it.

## 3. Scope Decisions (consolidated, final)

| Decision | Choice |
|---|---|
| Platform | Cloud-hosted responsive web app (PWA), accessible from phones and laptops, from multiple locations |
| Connectivity assumption | Reliable WiFi/broadband — no offline-first design needed in Phase 1 |
| Scale | Small: dozens of SKUs, under 50 bills/day even at peak |
| User roles | Separate logins, role-based: **owner** (father — full access, billing, financials) and **worker** (production entry, stock viewing only; no pricing/financials, no billing) |
| Order vs. dispatch | One event — billing happens at the time of physical handover. No separate order/invoice/dispatch quantity tracking in Phase 1 (confirmed business fact, see Section 1) |
| Invoice type | Full GST tax invoice: GSTIN, HSN codes, CGST/SGST/IGST breakup (persisted per line, not just computed at display time), sequential-within-financial-year numbering |
| E-invoicing (IRN/QR) | Applicability and integration **in scope** — turnover is reported above the notified threshold, but exact applicability (document types, any exemptions) must be confirmed with the business's CA before go-live; B2C invoices are outside the IRN flow regardless |
| Invoice numbering scheme | A per-financial-year **serialized counter table** (not a raw Postgres `SEQUENCE` — see Section 6) producing a serial within Rule 46's 16-character limit; void/cancelled numbers are retained, never reused |
| Payment tracking | Yes — paid / partial / credit per bill, via an append-only payment log (not a single mutable field), with outstanding dues trackable per customer; refunds/overpayments handled as entries in the same log |
| Returns / credit notes | **In scope for Phase 1** — a return or invoicing mistake is processed through a proper credit note, with a compensating stock-ledger entry, not a silent edit to the original bill |
| Opening stock | **In scope for Phase 1** — seeded through an explicit, dated, auditable import process, not assumed |
| Physical stock count reconciliation | **In scope for Phase 1** — a lightweight workflow that records counted quantity vs. expected quantity and requires an approval, rather than letting someone silently overwrite a number |
| Backups / security / recovery basics | **In scope for Phase 1 as launch requirements**, not deferred hardening — see Section 10 |
| Inventory scope | Finished goods only (no raw materials / BOM in Phase 1) |
| Bill output | Both printed (thermal/A4) and digital (PDF, shareable) |
| Rollout | Parallel run alongside HDPOS first, before full cutover — see Section 9 for the cutover protocol |
| Overselling behavior | Warn, but allow override — not hard-blocked; a minimal "units still owed" shortfall note is captured on the line item |
| Peak-season billing | Owner-only in Phase 1 (no worker-drafted bills); revisit only if real usage shows a bottleneck |
| Outage fallback | Documented manual paper-based fallback procedure (no code) for connectivity loss during Diwali/Puja — see Section 8 |

## 4. Architecture

**Approach:** Single Next.js (TypeScript) application serving both the UI and the backend API
(via server actions/API routes), backed by a single PostgreSQL database. Deployed as one unit
(e.g. Vercel + a managed Postgres such as Supabase/Neon, chosen partly because it includes
automated backups — see Section 10). Responsive layout with a PWA manifest so it installs
cleanly on phones alongside normal laptop browser use.

**Why this shape** (vs. a separate frontend/backend split, or building on an existing open-source
ERP like ERPNext/Odoo): matches the actual scale (1–3 concurrent users, small catalog); one
codebase/language/deployment is sustainable for a single developer; future LLM integration is
just a server-side API call to Claude from within the same app; building on ERPNext/Odoo was
rejected because their generic data model and customization learning curve work against a UI
shaped exactly around this business. (This also means the concurrency-safe numbering, tax
handling, and auditable ledgers these mature ERPs already solved are being built from scratch
here — a reason to budget real design/test effort for them, not a reason to reverse the
decision. ERPNext's stock ledger and Odoo's stock-move history and count-vs-adjustment workflow
are used as direct inspiration for Sections 6 and 9 below.)

**Architectural principles locked in for Phase 1 (meant to persist through later phases):**

1. **Immutable stock ledger.** Every stock change (production, sale, return, opening balance,
   correction) is an append-only entry in `stock_ledger`. Posted entries are never edited or
   deleted — in code *and* in database permissions — only compensated with a new entry. "Current
   stock" is always computed as a sum over ledger entries.
2. **Shared core logic, many callers.** Business operations (`createBill()`, `recordProduction()`,
   `adjustStock()`, `recordReturn()`, `importOpeningStock()`) are implemented once as backend
   functions. The UI is one caller; Phase 2/3 agentic workflows become additional callers of the
   same functions, never a reimplementation.
3. **Server-side role enforcement.** Role checks gate every mutating action on the server, not
   just in UI visibility.
4. **Idempotent, attributable writes.** Every ledger-style write carries a uniquely-indexed
   `idempotency_key` scoped to the operation and caller (so a retried call from any source —
   including a future agent — safely returns the original result instead of double-applying),
   and an `actor_type` (`human` | `agent`) + `source_metadata` so an agent-authored entry stays
   distinguishable from a human one.
5. **Core functions support a typed preview, not a raw dry-run.** `createBill()` etc. can return
   a typed proposal describing the effect (ledger entries, tax, totals) without committing.
   Crucially, commit-time always **revalidates** stock, price, and permissions against current
   state rather than trusting the preview — a preview is a proposal, not a lock. This is what
   makes "a future agent proposes a change, a human approves it, then it commits" buildable later
   without reimplementing validation logic, while staying safe against stale previews. None of
   these functions open their own database transaction — callers control the transaction
   boundary, so a future batch operation (e.g. reconciling an uploaded Excel sheet) can wrap many
   calls in one all-or-nothing transaction.

## 5. Data Model

- **`users`** — id, name, email, password_hash, role (`owner` | `worker`), created_at.
- **`business_profile`** — single-row settings: legal name, GSTIN, home state code, address.
  Used both to determine CGST+SGST vs. IGST and to snapshot supplier details onto issued
  invoices.
- **`customers`** — id, name, phone, billing address, state (controlled GST state code, not free
  text), gstin (nullable, for B2B). Delivery/ship-to address is captured per bill (see below),
  since tax treatment depends on place of supply, not just the customer's stored billing state.
- **`products`** — id, name, sku, unit, hsn_code, unit_price, gst_rate.
- **`invoice_number_counters`** — one row per financial year: `financial_year`, `next_serial`,
  `prefix`. Allocating a number is a single `UPDATE ... RETURNING` inside the bill's transaction
  (not a Postgres `SEQUENCE`, which is concurrency-safe but does not roll back on an aborted
  transaction and can therefore leave gaps — unacceptable if a gapless series is required under
  Rule 46; this table guarantees gaplessness since the increment lives inside the same
  transaction as the bill row). Void/cancelled serials are retained here, never reused.
- **`stock_ledger`** — id, product_id, quantity_delta (+/-), type (`opening` | `produced` |
  `billed` | `return` | `adjustment`), source_reference (nullable FK-style reference to the
  originating bill line / credit note line / stock count, used for duplicate-post protection and
  traceability), reason (required for `adjustment`), created_by, idempotency_key (unique, scoped
  to operation+caller), actor_type (`human` | `agent`, default `human`), source_metadata (jsonb,
  nullable), created_at. *Current stock for a product = `SUM(quantity_delta)`.*
- **`bills`** — id, invoice_number (from `invoice_number_counters`, unique), customer_id,
  bill_date, subtotal, cgst_total, sgst_total, igst_total, discount_total (nullable), round_off
  (nullable), tax_total, grand_total, place_of_supply (state code), reverse_charge_applicable
  (boolean, default false), delivery_address (snapshot), supplier snapshot fields (legal name,
  GSTIN, address — copied from `business_profile` at bill time so a later profile edit can't
  change a historical invoice), payment_status (`paid` | `partial` | `credit`, computed from
  `payment_log`), amount_due (computed), created_by, idempotency_key (unique), actor_type,
  source_metadata (jsonb, nullable), created_at.
- **`bill_line_items`** — id, bill_id, product_id, product name/SKU/HSN/unit snapshot (frozen at
  bill time, independent of later product-catalog edits), quantity, unit_price, tax_rate,
  cgst_amount, sgst_amount, igst_amount, line_total, shortfall_quantity (nullable — units still
  owed if this line was billed while oversold), shortfall_note (nullable).
- **`payment_log`** — id, bill_id, amount (negative for a refund), method (cash/UPI/bank
  transfer/cheque/etc.), paid_at, recorded_by, note (nullable). `bills.amount_paid`/`amount_due`/
  `payment_status` are computed from this log.
- **`credit_notes`** — id, original_bill_id, credit_note_number (own counter, same gapless
  pattern as `invoice_number_counters`), reason, created_by, created_at. **`credit_note_lines`**
  — id, credit_note_id, bill_line_item_id, quantity, amount, tax amounts — each credit note line
  generates a compensating `stock_ledger` entry (type `return`) linked back via
  `source_reference`.
- **`stock_counts`** — id, product_id, counted_quantity, expected_quantity (snapshot of computed
  stock at count time), delta, counted_by, counted_at, approved_by (nullable until approved),
  approved_at (nullable). Approving a count writes a `stock_ledger` adjustment entry for the
  delta — the count itself never directly overwrites stock (mirrors Odoo's counted-vs-applied
  pattern: a count is a proposal, the adjustment entry is what actually changes the ledger).
- **`irp_submissions`** — id, bill_id, status (`pending` | `submitted` | `accepted` | `rejected`
  | `failed` | `cancelled`), irn (nullable), qr_code_data (nullable), attempt_count, last_error
  (nullable), created_at, updated_at. A bill is not shown to the customer as a final, issued
  e-invoice until this reaches `accepted` (where applicable) — see Section 6.

## 6. Core Flow: Billing with Live Stock + Auto-Deduction

1. Owner starts a new bill, selects or creates the customer, confirms delivery address (used for
   place-of-supply determination, not just the customer's stored billing state).
2. Adding a line item: selecting a product shows its live available stock (computed from
   `stock_ledger`) immediately next to the quantity field.
3. If the entered quantity exceeds available stock, an inline warning appears (e.g. "Only 8
   available, you entered 10") but entry is not blocked. If the father proceeds, the shortfall
   (e.g. "2 units still owed") is captured on that line item rather than disappearing silently.
4. On **Finalize Bill**, one database transaction:
   - Allocates the next invoice number from `invoice_number_counters` for the current financial
     year (gapless by construction, since the increment and the bill insert share a transaction).
   - Computes and stores the CGST/SGST/IGST split per line, using the business's own state
     (`business_profile`) vs. the delivery/place-of-supply state — not simply the customer's
     stored billing state.
   - Freezes supplier/customer/product/tax snapshots onto the bill and its line items.
   - Records payment status/amount due (via `payment_log`).
   - Writes one negative `stock_ledger` entry per line item (type `billed`), linked to the bill
     line via `source_reference` (this link plus the idempotency key is what prevents a retried
     finalize from double-deducting stock).
   - Creates a `pending` row in `irp_submissions` if the invoice is e-invoicing-applicable.
   - If any step fails, nothing is partially saved, including the invoice number.
5. **Separately, outside that transaction:** a background job submits pending `irp_submissions`
   rows to the government IRP (this cannot be part of the database transaction — it's a network
   call to an external system). It uses retry-with-backoff and reconciles timeouts by polling
   status rather than resubmitting blindly. The invoice is not presented to the customer as a
   final e-invoice (with IRN/QR) until the submission reaches `accepted`; a `failed` or stuck
   `pending` submission surfaces in an operator queue on the dashboard rather than silently
   blocking the sale (the underlying bill and stock deduction are already committed in step 4 —
   only the government-reporting step is async).
6. Because current stock is computed live, the updated number is visible immediately to anyone
   else logged in, on any device.

**Production entry:** a simple form ("Produced 200 units of Lavender Jar Candle") writes a
positive `stock_ledger` entry (type `produced`). Available to both owner and worker roles. This
does not check raw-material availability — the UI says so explicitly.

**Manual correction:** goes through the same ledger as an `adjustment` entry and **requires** a
reason note.

**Returns:** processed only through a credit note against an original bill (Section 5), never by
editing the original bill or directly writing a positive stock-ledger entry labeled as if it were
new production.

**Negative-stock surfacing:** the dashboard shows a visible indicator for any product at or below
zero, so "warn but allow" doesn't quietly reintroduce the "nobody notices" failure mode.

**Concurrency note:** overselling is warn-not-blocked, so Phase 1 doesn't need
reservation/locking for two simultaneous bills both reading the same "last few units available" —
brief staleness there is an accepted, visible, correctable edge case. Invoice numbering is
different: a collision or gap there is a legally-sensitive failure, not a harmless stale read,
which is why it gets its own mechanism (`invoice_number_counters`) rather than relying on
database-level uniqueness alone.

## 7. GST Compliance Details

- **Tax breakup** (CGST/SGST/IGST) is persisted per line at bill time, not recomputed at display
  time, so a reprint always matches the original.
- **Place of supply** and **reverse-charge applicability** are explicit, mandatory fields, derived
  from delivery/transaction facts rather than inferred solely from the customer's stored billing
  state.
- **Discount and round-off** are explicit, separate fields.
- **E-invoicing (IRN + QR)** — in scope, but applicability is not simply "turnover above
  threshold = every invoice gets an IRN." It depends on PAN-wide aggregate turnover history,
  notified-taxpayer status/exemptions, and document type (B2C invoices are outside the IRN
  reporting flow regardless). **This must be confirmed with the business's CA, and tested
  against the IRP sandbox, before production cutover** — see Section 12 for the explicit open
  item.
- **Invoice serial format** — Rule 46 requires a consecutive serial, unique per financial year,
  at most 16 characters, using permitted characters. The counter design in Section 5 enforces
  this; the exact prefix format should still be sanity-checked with the CA.
- **IRP is an external system** and cannot participate in the billing database transaction — see
  Section 6's async submission design. IRN cancellation is time-limited (currently 24 hours per
  current IRP guidance); corrections after that window go through credit notes, not cancellation.

## 8. Outage Fallback Procedure

Full offline support stays out of scope, but Diwali/Puja is both the highest-stakes and the
likeliest-for-outage period. Fallback (no code): keep a pre-printed paper duplicate book at the
billing counter. If the system is unreachable, bill by hand on paper, preserving the actual time
of sale. Once connectivity returns, enter each paper bill into the system **dated as of the
actual sale**, not the re-entry time, noting the original paper slip number for reference and
reconciliation; any applicable e-invoice reporting for that sale follows the business's normal
legal timelines for late-reported transactions (confirm the exact process with the CA — this
determines whether late IRP submission needs special handling).

## 9. Cutover & Parallel-Run Protocol

During the parallel-run period (Section 3), a single, explicit rule applies: **one system is
authoritative for a given sale at any moment.** Concretely:
- Pick a single cutover moment for opening stock (Section 10) and for "which system is used for
  new bills from now on" — don't let both systems independently believe they hold the current
  stock truth.
- Reconcile stock and sales totals between the two systems daily during the parallel-run window,
  and investigate any mismatch same-day rather than letting it compound.
- Decide and document a rollback trigger (what would cause reverting fully to HDPOS) before
  starting the parallel run, not during an incident.

## 10. Operational Baseline (launch requirements, not deferred hardening)

- **Opening stock import:** a one-time, explicit, dated import process that writes `opening`-type
  `stock_ledger` entries per product. Treated as auditable data entry, not a database seed script
  run silently.
- **Backups:** use a managed Postgres provider with automated backups enabled; rehearse an actual
  restore at least once before go-live (not just assume backups work).
- **Account recovery:** a password reset flow for both owner and worker logins.
- **Audit retention:** the ledger tables themselves (`stock_ledger`, `payment_log`,
  `credit_notes`, `irp_submissions`) are the audit trail and are retained indefinitely — never
  truncated or purged.
- **Monitoring:** basic uptime/error monitoring (e.g. an error-logging service and a simple
  health-check), plus a one-page runbook covering the failure modes this spec already identifies
  as recoverable-but-needing-a-procedure (a failed IRP submission stuck in the operator queue, a
  stock count pending approval, restoring from backup).

## 11. Screens (Phase 1)

- **Login** — role-based session; includes password reset.
- **Dashboard** — owner: sales summary, outstanding dues, negative-stock indicator, IRP operator
  queue (failed/pending submissions), pending stock-count approvals. Worker: production-entry
  shortcut and stock overview only.
- **Billing** — customer select/create, delivery address, line items with live stock +
  overselling warning + shortfall capture, finalize → invoice generation, print view, PDF export.
- **Inventory** — product list with live computed stock, search/filter, production-entry form,
  manual adjustment form (reason required), opening-stock import.
- **Stock count** — start a count session, enter counted quantities, submit for approval; owner
  approves, which posts the compensating adjustment.
- **Customers** — list, create/edit, outstanding dues per customer.
- **Bill history** — past invoices, reprint/re-download PDF, update payment status, issue a
  credit note against a bill.
- **User management** (owner only) — create/manage worker logins.

Worker-role users never see pricing, billing, or customer financial screens.

## 12. Open Items Pending CA Confirmation

These are explicitly flagged rather than guessed at, and should be resolved during the
parallel-run period, before full cutover:
- Exact e-invoicing (IRN) applicability for this business's specific document types and taxpayer
  status.
- The precise invoice serial/prefix format (within Rule 46's constraints).
- Place-of-supply treatment for any transaction types beyond straightforward in-state/out-of-state
  sales (e.g. any export or special-category sales, if applicable).
- The legally correct process for late/outage-fallback invoice entry and reporting.

## 13. Error Handling

- Database posting is atomic: invoice payload, tax snapshots, stock movements, and the durable
  IRP submission job either all succeed or none do. IRP submission itself follows a separate,
  retryable lifecycle outside that transaction.
- Every ledger-mutating action requires a reason/reference — nothing changes stock invisibly, and
  posted entries are never edited, only compensated.
- Server-side role checks gate every mutating action regardless of what the UI exposes.

## 14. Testing Approach

Given this is a solo-maintained small-scale application, automated testing focuses narrowly on
the places a bug causes real damage:
- **Stock ledger math** — current stock always equals the correct sum of ledger entries under
  concurrent writes.
- **Billing transaction** — a finalized bill produces exactly one correct ledger entry per line,
  correct tax computation, a correctly allocated invoice number, and never partially commits.
- **Invoice numbering concurrency** — concurrent finalize calls never produce a duplicate serial;
  a rolled-back finalize does not advance the counter (i.e. does not create a gap).
- **IRP recovery** — accepted, rejected, timeout-after-acceptance, and duplicate-retry scenarios
  all resolve without a duplicate invoice or duplicate stock posting.
- **GST split and rounding** — per-line CGST/SGST/IGST amounts always sum correctly to the
  bill-level tax total.
- **Credit notes and stock counts** — a credit note always produces the correct compensating
  ledger entry; an approved stock count always produces exactly one adjustment entry matching the
  delta.

The rest of the UI is validated through manual click-through testing.

## 15. Explicitly Out of Scope for Phase 1

- Raw material / bill-of-materials (BOM) tracking.
- LLM-assisted Excel parsing and voice-to-order capture (Phase 2).
- Full pending-orders / reminders dashboard (Phase 3) — Phase 1 only captures a minimal per-line
  shortfall note as a stopgap.
- Worker-drafted bills requiring owner approval (billing stays owner-only; revisit if needed).
- Separate order/invoice/dispatch quantity tracking (confirmed unnecessary — see Section 1).
- Broader order-to-cash and procurement/manufacturing phases (raw-material procurement, BOM,
  yield/wastage, packaging, dispatch-as-a-distinct-step) — these belong to a future phase, scoped
  only after mapping one real order end-to-end once Phase 1 is live, not speculatively now.
- Reporting/analytics and festive-season infrastructure load hardening (Phase 4).
- Full offline support (mitigated instead by the documented manual fallback procedure, Section 8).
- Hard-blocking overselling (deferred; revisit if real-world use shows a need).

## 16. Review Provenance

This spec incorporates findings from three initial review agents (business/domain fit, technical
architecture/correctness, future-extensibility for agentic workflows) and a subsequent external
audit that corrected several errors in the first round of resolutions — notably around invoice
numbering mechanics, IRP's external/asynchronous nature, e-invoicing applicability nuance, and
lifecycle completeness (returns, opening stock, backups). The full discussion history, including
citations checked during the external audit, is preserved in
`2026-10-20-trinetra-candles-full-context-and-phase1-plan.md`.
