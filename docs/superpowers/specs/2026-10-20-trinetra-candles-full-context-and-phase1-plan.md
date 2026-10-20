# Trinetra Candles — Full Context + Phase 1 Plan (Review Copy)

> This document is self-contained. It exists so an independent reviewer can evaluate the plan
> without needing any prior conversation history. It covers: who this is for, the real-world
> problem, the full multi-phase product vision, the scope decisions made for Phase 1, and the
> detailed Phase 1 design itself.

## Part A — Business Context

Trinetra Candles is a candle manufacturing business, run by the user's father, operating at
meaningful scale (not a hobby shop) with real seasonal volatility: demand spikes sharply around
Puja and Diwali, which is also when the current process breaks down the most.

The business already has full visibility into its own pipeline: where raw materials come from,
how purchasing works, which machines produce which products, how packaging happens, and how
finished goods are shipped to customers. The user (the father's child) grew up around this
workflow and understands it firsthand — the goal is software that reflects how this specific
business actually works, not a generic template forced onto it.

**Current tooling:** HDPOS Smart V2, used mainly for inventory lookup and billing. Actual stock
levels are tracked separately in Excel sheets.

**The core problem:** Inventory and billing are disconnected systems requiring manual
reconciliation:
1. Before entering an order into a bill, the father has to leave the billing screen and manually
   check an Excel sheet to see if enough stock exists.
2. If it does, he bills the quantity — but the Excel sheet is *not* automatically updated. He has
   to go back and manually reduce the quantity in Excel afterward.
3. This manual double-entry is slow, error-prone, and during Puja/Diwali — when order volume
   peaks hardest — the process effectively breaks down into chaos: wrong stock numbers, missed
   updates, no single source of truth.

**Explicit non-goal:** This is *not* an attempt to replace HDPOS as a general-purpose tool. It's
a new, narrower system built specifically around this business's workflow, prioritizing
simplicity for non-technical users (the father, and shop-floor workers) over feature breadth.

## Part B — Full Product Vision (all phases)

The complete vision the user described, broken into phases because each phase is independently
shippable and later phases depend on the data model established in Phase 1:

- **Phase 1 — Inventory + Billing core** (this is the only phase designed in detail so far — see
  Part C below). Live stock visibility during bill creation, atomic auto-deduction on bill
  finalization, atomic increase on logging production, full GST invoicing, payment/dues
  tracking, role-based access (owner vs worker).
- **Phase 2 — LLM-assisted data entry.** The father should be able to type a natural-language
  stock update (e.g. "add 50 more rose jar candles") or upload an Excel sheet of current stock,
  and have an LLM-driven pipeline parse and reconcile that into the same stock ledger Phase 1
  establishes — without replacing the ledger model, just adding new ways to write to it.
- **Phase 3 — Voice-to-order capture + reminders.** The father should be able to speak a
  customer's order out loud, have an LLM transcribe and extract structured order data (customer,
  items, quantities), and have it registered as a pending order. The system should then actively
  remind him which orders are still pending, for which customer, and which specific items/
  quantities are owed — directly targeting the chaos of festival-season order backlogs.
- **Phase 4 — Reporting/analytics, multi-role hardening, and seasonal load review.** Once the
  above are real and in use, revisit whether reporting, deeper analytics, or infrastructure
  hardening for Puja/Diwali peak load is actually needed, based on real usage rather than
  speculation.

**Explicit long-term architectural requirement (stated directly by the user):** the backend must
stay flexible enough to keep adding new "sub-agentic workflows" over time (Phase 2/3 and beyond)
without major rework. The user has evaluated off-the-shelf tools (Vyapar, and generic
inventory/billing SaaS) and rejected them specifically because their layouts and workflows cannot
be customized to match this business's actual process — this system is being custom-built for
that reason, not as a cost-saving measure.

## Part C — Decisions Made During Scoping (apply to Phase 1)

| Topic | Decision | Rationale given |
|---|---|---|
| Platform | Cloud-hosted responsive web app, PWA-installable | Must be usable from phones and laptops, from different locations (shop, factory floor, elsewhere) — not tied to one PC like HDPOS is today |
| Connectivity | Assume reliable WiFi/broadband | Confirmed by the user; offline-first complexity explicitly deferred unless real usage proves otherwise |
| Scale | Small — dozens of SKUs, under 50 bills/day even at peak | Keeps Phase 1 lean; avoids premature performance engineering |
| User roles | Separate logins, role-based (owner = father, worker = shop-floor staff) | Owner sees full financials/pricing/billing; workers see only production entry and stock levels — deliberately limited visibility |
| Invoicing | Full GST tax invoice (GSTIN, HSN codes, CGST/SGST/IGST breakup, sequential numbering) | Matches legal/commercial requirements already met by HDPOS today; non-negotiable for a swap-in replacement |
| E-invoicing (IRN/QR) | **Applicability and integration in scope** — turnover was reported above the threshold; CA must confirm taxpayer and document applicability before launch | E-invoicing covers specified documents for notified taxpayers, with exemptions; it does not mean every retail B2C invoice receives an IRN. See GST Compliance Details. |
| Invoice numbering scheme | Financial-year-specific series, with a serialized counter if the CA confirms a gapless series is required. Each invoice serial must fit Rule 46's 16-character limit. | PostgreSQL `SEQUENCE` is concurrency-safe but does not roll back values and can leave gaps. The former sample `INV/2026-27/00001` is 17 characters. |
| Payments | Track paid / partial / credit per bill, via an append-only payment log (not a single mutable field), with per-customer outstanding dues | B2B/distributor sales commonly happen on credit, often paid off in installments; a log preserves *when* and *how much* was paid each time, matching the audit-trail principle already used for stock |
| Inventory scope | Finished goods only — no raw material or bill-of-materials (BOM) tracking yet | Raw material/BOM tracking is a materially different, more complex data model (recipes, yield, wastage) and isn't required to fix the stated problem; deferred to a future phase if ever needed |
| Bill output | Both printed (thermal/A4) and digital (PDF, shareable via WhatsApp/email) | Matches current practice (printed) while adding flexibility distributors increasingly expect (digital) |
| Rollout | Parallel run alongside HDPOS before full cutover | Reduces risk during transition; avoids switching systems during the Diwali rush itself |
| Overselling | Warn, but allow override for an order; the invoice/dispatch policy must be confirmed | Owner stays in control, while order, invoice, and shipped quantities remain distinct if goods are not handed over at billing time |
| Shortfall tracking | Track unfulfilled order quantity as an open fulfillment amount, not merely a free-text bill-line note | A note alone cannot safely represent whether the quantity was invoiced or shipped. Keep this minimal in Phase 1 only if invoices and dispatch usually happen together; otherwise add a small order/fulfillment record before launch. |
| Peak-season billing bottleneck | Billing stays owner-only in Phase 1 (no worker-drafted bills) | Confirmed during review as a conscious, revisit-if-needed decision rather than an oversight — simplicity wins unless real Diwali-season usage proves the owner is a bottleneck |
| Internet outage fallback | A documented manual (paper-based) fallback procedure, not a code feature | Confirmed during review: full offline support is still out of scope, but the single highest-stakes period (Diwali) is also the likeliest for connectivity hiccups, so an explicit non-code mitigation is required — see Part D's Outage Fallback Procedure |

**Technical approach selected:** A single Next.js (TypeScript) application serving both UI and
backend (API routes/server actions), with PostgreSQL as the single database, deployed as one
unit (e.g. Vercel + a managed Postgres like Supabase/Neon).

**Two alternatives were considered and rejected:**
- *Separate React frontend + Python/FastAPI backend* — rejected because the assumed benefit
  (Python being "better" for the future LLM work) doesn't hold: Claude's API is a plain REST call
  from any language, so splitting the stack would add deployment/maintenance overhead for no
  real gain at this project's scale (effectively one developer maintaining it).
- *Building on an existing open-source ERP (e.g. ERPNext/Odoo) via its API, with a custom
  frontend* — rejected because these systems bring their own generic data model and a steep
  customization learning curve (e.g. Frappe framework internals), working directly against the
  user's stated goal: a workflow and UI shaped exactly around this specific business, not
  retrofitted onto someone else's structure.

**Key architectural principles locked in for Phase 1 (and meant to persist through later
phases):**
1. **Immutable stock ledger, not a mutable quantity field.** Every stock change (production,
   sale, manual correction) is an append-only entry in a `stock_ledger` table. "Current stock" is
   always computed as a sum over ledger entries, never stored and overwritten directly. This
   gives a full audit trail by construction, borrowed as a lesson from how mature ERPs (ERPNext,
   Odoo) model inventory internally — without adopting their full complexity.
2. **Shared core logic, many callers.** Business operations (`createBill()`, `recordProduction()`,
   `adjustStock()`) are implemented once as backend functions. The UI is just one caller. Future
   Phase 2/3 agentic workflows (parsing an Excel upload, parsing a voice transcript into order
   data) are designed to become *additional callers* of these same functions — never a
   reimplementation of the underlying logic. This is the specific mechanism meant to satisfy the
   "backend stays flexible for more sub-agentic workflows" requirement.
3. **Server-side role enforcement.** Role checks (owner vs worker) gate every mutating action on
   the server, not just in UI visibility — a worker cannot invoke billing/financial logic even by
   directly hitting an API route or guessing a URL.
4. **Idempotent, attributable writes.** Every ledger-style write (`stock_ledger`, `bills`,
   `payment_log`) carries a nullable, uniquely-indexed `idempotency_key` and a nullable
   `actor_type` (`human` | `agent`) + `source_metadata` (jsonb). Phase 1 never populates these —
   the UI's calls simply omit them — but the columns exist from day one so a retried or
   duplicate call from a future LLM-driven caller (Excel reconciliation, voice-order parsing)
   can be deduped safely, and so an agent-authored entry is distinguishable from a human one
   when something needs debugging during festival-season chaos. Retrofitting this onto tables
   that already hold real financial history would be far more expensive than including it now.
5. **Core functions support preview-before-commit, and don't hardcode their own transaction
   boundary.** `createBill()`, `recordProduction()`, and `adjustStock()` each support a dry-run
   mode that computes and returns the effect (the ledger entries it *would* write) without
   committing. This is what actually makes "LLM proposes a change, the father reviews it, then
   it commits" possible in Phase 2/3 without duplicating validation/calculation logic in a
   separate preview path — which would otherwise break principle 2's "never a reimplementation"
   promise. Separately, none of these functions open their own database transaction internally;
   callers control the transaction boundary, so a future batch operation (e.g. reconciling an
   entire uploaded Excel sheet) can wrap many calls in one all-or-nothing transaction, the same
   way bill finalization already does for a single bill.

## Part D — Phase 1 Detailed Design

### Data Model
- **`users`** — id, name, email, password_hash, role (`owner` | `worker`), created_at
- **`business_profile`** — single-row settings: legal name, GSTIN, home state code, address.
  Needed to identify the supplier location for tax determination and to snapshot supplier
  details onto issued invoices.
- **`customers`** — id, name, phone, billing address, state (controlled GST state code), gstin
  (nullable, for B2B). Capture delivery/ship-to address and legally determined place of supply
  on each bill; do not infer tax treatment solely from billing state.
- **`products`** — id, name, sku, unit, hsn_code, unit_price, gst_rate
- **`stock_ledger`** — id, product_id, quantity_delta (+/-), type (`opening` | `produced` |
  `dispatched` | `return` | `adjustment`), source document/line reference, reason (required for
  adjustment), created_by, idempotency key and provenance, created_at. Opening balances are
  explicit dated movements. Posted entries are immutable; corrections append compensating
  movements. Link each dispatch line and enforce duplicate-post protection. *Current stock for a
  product = `SUM(quantity_delta)` for that product.*
- **`bills`** — id, invoice_number (assigned from a financial-year series, unique),
  customer_id, bill_date, subtotal, cgst_total, sgst_total, igst_total, discount_total
  (nullable), round_off (nullable), tax_total, grand_total, place_of_supply (state code),
  reverse_charge_applicable, IRP status and IRN/acknowledgement/QR payload when applicable,
  immutable supplier/recipient snapshots, created_by, idempotency key and provenance, created_at.
  Derive payment status and amount due from payment entries/reversals rather than storing
  competing mutable values.
- **`bill_line_items`** — id, bill_id, product_id plus immutable description/SKU/HSN/unit and
  tax-rate snapshots, ordered/invoiced/dispatched quantities, unit_price, taxable_value,
  persisted line tax split, line_total, and any outstanding fulfillment quantity.
- **`payment_log`** — id, bill_id, amount, method (cash/UPI/bank transfer/cheque/etc.), paid_at,
  recorded_by, note (nullable). `bills.amount_paid`/`amount_due`/`payment_status` are computed
  from this log, the same way stock is computed from `stock_ledger` — a single running total
  would otherwise lose the "when was how much paid" history that matters for a credit-heavy
  B2B business paying off dues in installments.

### Core Flow — Billing with Live Stock + Auto-Deduction
1. Owner starts a draft bill/order and selects/creates the customer. Before implementation,
   confirm whether billing and physical handover happen together in the usual workflow. If they
   do, finalizing a bill can also post dispatch; if not, keep order, invoice, and dispatch
   quantities/states separate.
2. Selecting a product on a line item immediately shows live available stock (computed from
   `stock_ledger`).
3. If entered quantity exceeds available stock, an inline warning appears (e.g. "Only 8
   available, you entered 10") — entry is not blocked.
4. If an order line exceeds available stock, warn and allow the order, while recording its
   unfulfilled quantity. Invoice only the amount permitted by the confirmed business/tax policy;
   deduct stock for the physically dispatched quantity. If order and handover are always one
   event, those quantities can be the same.
5. On **Finalize Bill**, revalidate and commit the invoice payload, stock movements, and a
   durable IRP-submission job in one database transaction. Allocate a number from a
   financial-year counter; use a serialized counter if a gapless sequence is confirmed as
   required. PostgreSQL `SEQUENCE` values survive rollback and may leave gaps. Determine tax
   from supplier location and legally determined place of supply, capturing delivery details,
   not merely the customer's billing state.
6. Submit applicable invoices to the IRP outside the database transaction, using retry-safe
   state handling and reconciliation for timeouts. Do not present an applicable invoice as
   issued until IRP acceptance. Keep failed/void/cancelled numbers and audit history; never
   silently reuse a number or delete an IRN. An IRP failure must appear in an operator queue.
7. Because current stock is computed live, the updated number is visible immediately to anyone
   else logged in, on any device.

**Production entry:** a simple form ("Produced 200 units of Lavender Jar Candle") writes a
positive `stock_ledger` entry (type `produced`). Available to both owner and worker roles.
This does not check raw-material availability (raw materials are out of scope for Phase 1 — see
Part C) — the UI should say so explicitly, so the entry isn't mistaken for a fully-verified
production record.

**Manual correction:** goes through the same ledger as an `adjustment` entry and *requires* a
reason note. No stock number changes silently.

**Negative-stock surfacing:** because overselling is allowed, a product's computed stock can go
negative. The dashboard shows a visible indicator for any product currently at or below zero —
without this, "warn but allow" would quietly reintroduce the same "nobody notices the
discrepancy" failure mode the project exists to eliminate.

**Concurrency note:** because overselling is warn-not-blocked, Phase 1 deliberately skips
reservation/locking logic for the "two simultaneous bills draining the last few units"
edge case — brief staleness between read and finalize is accepted as visible and correctable,
not a correctness bug, at this scale (1-3 concurrent users). Invoice numbering is the one place
that *does* need an explicit concurrency-safe mechanism (the `SEQUENCE` above), because a
collision there isn't a stale-read nuisance — it's a rejected/crashed finalize on the
legally-sensitive invoicing path.

### GST Compliance Details

Identified during review as under-specified in the original design; now explicit:
- **Tax breakup is persisted, not just computed at display time** — `cgst_amount`/
  `sgst_amount`/`igst_amount` are stored per line (see Data Model) so a reprinted invoice always
  shows the same figures it did originally.
- **Place of supply** is stored per bill (it is not always identical to the customer's billing
  address/state, and GST requires it as a distinct field).
- **Reverse charge applicability** is a mandatory field on every invoice (even when `false`), not
  an optional one.
- **Discount and round-off** are modeled as explicit, separate fields rather than folded into
  `subtotal`/`grand_total` opaquely.
- **E-invoicing (IRN + QR code)** — applicability and integration are in scope, subject to
  confirming PAN-wide aggregate-turnover history, taxpayer eligibility/exemptions, and document
  classes with the business's CA. The ₹5 crore threshold generally applies to notified persons
  based on aggregate turnover in any preceding FY from 2017-18; specified documents such as
  B2B/export invoices are covered, while B2C invoices are outside the IRN reporting flow. Do not
  state "every invoice". Validate current applicability and IRP rules before production launch.
- **IRP is an external system.** It cannot participate in a PostgreSQL transaction. Use a durable
  submission state machine/outbox with retry and reconciliation. Current IRP guidance limits
  IRN cancellation to 24 hours; retain cancelled records, and process later corrections through
  appropriate credit/debit notes. Include an exception queue/runbook and test against the IRP
  sandbox.
- **Invoice serial format.** Rule 46 requires a consecutive serial not exceeding 16 characters,
  unique for a financial year, using permitted characters. The old example
  `INV/2026-27/00001` is 17 characters. Choose a compliant series with the CA. PostgreSQL
  `SEQUENCE` prevents collisions but is not gapless because values survive rollback. If a
  gapless serial is confirmed as required, allocate through a per-FY serialized counter and
  retain void/cancelled numbers; obtain CA advice on voids and gaps.
- **Tax determination.** CGST+SGST versus IGST must use supplier location and legally determined
  place of supply, not simply customer billing state. Capture delivery/ship-to and other
  transaction facts. Make tax rates, HSN digit rules, reverse charge, discounts, rounding, and
  invoice fields versioned/configurable and confirm candle SKUs and actual transaction types
  with the CA.

### Outage Fallback Procedure

Full offline support remains out of scope for Phase 1 (connectivity is assumed reliable), but
Diwali/Puja — the single highest-stakes period — is also statistically the likeliest time for a
WiFi/power hiccup. Rather than building offline-first infrastructure speculatively, Phase 1
documents a simple manual fallback so an outage never means "cannot bill anyone":
- Keep a small pre-printed paper duplicate book as backup at the billing counter.
- If the system is unreachable, the father writes the bill by hand on the paper book instead,
  noting item, quantity, and customer as usual.
- Once connectivity returns, each paper bill is entered into the system as a normal bill (the
  system doesn't need to know it was late — it's just entered as of now, referencing the
  original paper slip number in a note).
- This procedure needs no code changes; it's an operational instruction, included here so it
  isn't lost or improvised under pressure on the day it's actually needed.

### Screens
- **Login** — role-based session.
- **Dashboard** — owner: sales summary + outstanding dues. worker: production-entry shortcut +
  stock overview only.
- **Billing** — customer select/create, line items with live stock + overselling warning,
  finalize → invoice generation, print view, PDF export.
- **Inventory** — product list with live computed stock, search/filter, production-entry form,
  manual adjustment form (reason required).
- **Customers** — list, create/edit, outstanding dues per customer.
- **Bill history** — past invoices, reprint/re-download PDF, update payment status.
- **User management** (owner only) — create/manage worker logins.

Worker-role users never see pricing, billing, or customer financial screens.

### Error Handling
- Bill finalization is atomic — invoice numbering, tax computation, and ledger writes succeed or
  fail together.
- Every ledger-mutating action requires a reason/reference.
- Server-side role checks gate every mutating action regardless of UI.

### Testing Approach
Given a single-developer-maintained small-scale app, automated tests focus narrowly on the places
a bug causes real damage:
- **Stock ledger math** — current stock always equals the correct sum of ledger entries.
- **Billing transaction** — a finalized bill always produces exactly one correct ledger entry per
  line item, correct tax computation, correctly incremented invoice number, and never partially
  commits on failure.
- **Concurrent invoice finalization** — two simultaneous finalize calls never produce a duplicate
  or skipped invoice number (added during review; this is exactly the scenario the `SEQUENCE`
  mechanism exists to handle, so it needs a test, not just an assumption).
- **GST split and rounding edge cases** — line-level CGST/SGST/IGST amounts always sum correctly
  to the bill-level tax total, including rounding (added during review).
The rest of the UI relies on manual click-through testing.

### Explicitly Out of Scope for Phase 1
- Raw material / bill-of-materials (BOM) tracking.
- LLM-assisted Excel parsing and voice-to-order capture (Phase 2).
- Full pending-orders / reminders dashboard (Phase 3) — Phase 1 only captures a minimal
  per-line shortfall note as a stopgap (see above); it does not build a dedicated orders/
  pending-fulfillment data model.
- Worker-drafted bills requiring owner approval (billing stays owner-only in Phase 1; revisit if
  real usage shows a bottleneck).
- Reporting/analytics and festive-season infrastructure load hardening (Phase 4).
- Full offline support (mitigated instead by the documented manual fallback procedure above).
- Hard-blocking overselling (deferred; revisit if real-world use shows a need).

## Part E — What Reviewers Should Focus On

This document was circulated to independent reviewers *before* an implementation plan was
written, specifically to catch gaps, risks, or missed opportunities while the design was still
cheap to change. Reviewers were asked to assume Parts A/B/C were fixed context (the "why"), and
to focus critique on Part D (the actual Phase 1 design) plus whether Part C's architectural
principles genuinely deliver on the Part B vision (especially the "flexible backend for future
sub-agentic workflows" requirement).

## Part F — Review Findings & Resolutions

### Independent audit of this review copy (2026-10-20)

This audit found several prior-review resolutions that were themselves incorrect or incomplete;
the amendments below supersede conflicting claims above.

**Must fix before implementation:**
- PostgreSQL `SEQUENCE` values do not roll back. The original claim that invoice number and bill
  row share one transaction and therefore cannot create a gap is false. Rule 46 requires a
  consecutive serial of at most 16 characters. The proposed sample `INV/2026-27/00001` is 17
  characters. Confirm with the CA whether a gapless counter is required; retain void/cancelled
  serials either way.
- IRP submission is a remote side effect and cannot be atomic with a database transaction. Save
  the invoice and a durable submission job first, then use a retryable IRP state machine and
  reconciliation. The prior plan's all-or-nothing invoice/IRN transaction is not implementable.
- Above-threshold turnover does not mean every invoice receives an IRN. Applicability depends on
  turnover calculation, notified taxpayer classes/exemptions, and document type. B2C invoices
  are not covered by the IRN reporting flow. Validate with the CA and IRP sandbox before launch.
- GST place of supply cannot be inferred solely from customer state. Capture delivery facts and
  support the transaction-specific rules. Freeze supplier/customer/product/tax snapshots on
  posted invoices so reprints remain legally identical after master-data edits.
- Add explicit returns, cancellations/credit notes, invoice corrections, duplicate-submit
  recovery, opening-stock import/count reconciliation, and an operator exception queue. An
  append-only ledger without reversal flows is incomplete for a live sales system.
- The current flow conflates customer order, tax invoice, and physical dispatch. If a customer
  orders 10 but only 8 are available, deciding whether to invoice all 10 and record 2 "owed" is
  a GST and fulfillment decision, not just a stock warning. Model ordered, invoiced, and shipped
  quantities separately (or define a CA-approved policy); decrement on-hand stock only for
  quantities physically dispatched, and retain the remaining quantity as an open fulfillment
  obligation. This boundary should be settled before billing implementation.
- A parallel run needs a precise cutover protocol: define which system is authoritative for each
  sale/stock movement, avoid double posting, seed and count opening stock, reconcile daily, and
  define rollback. Do not run two systems as independent stock truth.
- Security, backups/restore rehearsal, audit retention, account recovery, and basic operational
  monitoring/runbooks are launch requirements, not Phase 4 load hardening.

**Architecture adjustments:**
- Keep reusable deterministic domain commands, but have previews recalculate at commit and
  recheck permissions/stock. Future AI should submit a typed proposal for human approval.
  Scope idempotency keys by command/source and return the prior result on retries; provenance
  should identify initiating user, approver, and source.
- Treat `stock_ledger` as a source of truth only if posted entries are immutable in code and
  database permissions, with compensating entries for corrections. Link each movement to its
  originating bill line so retries cannot duplicate deductions.
- Derive bill payment status and amount due from append-only payments and reversals rather than
  storing competing mutable values. Define refunds and overpayments.
- The full-context plan and the companion detailed design both need these corrections applied
  before implementation; keep them aligned.

**End-to-end roadmap gap:**
The stated vision is broader than finished-stock billing: it includes supply, production,
packaging, fulfillment, and shipping. Current phases omit order lifecycle, returns, raw-material
procurement/receipts, BOM/yield/wastage, production work tracking, packaging, dispatch/delivery,
and reconciliation with the existing accounting workflow. Do not force all of this into Phase 1.
Before implementation, map one real order from customer request through dispatch/payment and
identify which steps must become system-of-record. Add later phases for order-to-cash/fulfillment
and procurement/manufacturing based on that map. Phase 3 should model a proper order and
fulfillment lifecycle, not only voice capture and reminders.

**Open source patterns worth borrowing:**
- ERPNext's stock ledger and Odoo's stock-move history support the movement-based audit trail.
  Borrow traceable source documents, adjustment reasons, reversals, and movement history; avoid
  adding valuation/location features until needed.
- Odoo's inventory adjustments distinguish a counted quantity from an applied adjustment.
  Include a count/reconciliation workflow that records counted quantity, expected quantity,
  delta, counter, and approval instead of asking users to guess an adjustment.

**Primary references checked on 2026-10-20:**
- [CBIC GST invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html) and [CGST Rules PDF](https://cbic-gst.gov.in/pdf/15102020_CGST-Rules-2017-Part-A-Rules.pdf): Rule 46 serial requirements and invoice particulars.
- [GST Council Notification 10/2023](https://gstcouncil.gov.in/node/4365): notified ₹5 crore threshold effective 1 August 2023.
- [IRIS IRP e-invoice FAQ](https://einvoice6.gst.gov.in/content/faq-powered-by-irisirp/) and [e-invoice mandate](https://einvoice6.gst.gov.in/content/einvoice-mandate/): document coverage and IRN/QR flow; [cancellation guidance](https://einvoice6.gst.gov.in/content/kb/cancelling-e-invoice/).
- [PostgreSQL sequence documentation](https://www.postgresql.org/docs/current/functions-sequence.html): `nextval` is concurrent-safe but not rolled back and cannot guarantee gaplessness.
- [Odoo stock move history](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/reporting/moves_history.html) and [inventory adjustment procedure](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html).

Three earlier review passes were run against this plan — business/domain fit,
technical architecture/correctness, and future extensibility for agentic workflows. The
independent audit above found additional errors in those earlier resolutions. Treat the audit
addendum as the latest decision record; this historical section is retained for provenance, not
as proof that every prior finding was correct.

**Fixed directly (correctness/legal gaps, not matters of preference):**
- No concurrency-safe invoice numbering mechanism → Postgres `SEQUENCE`, reset per financial
  year.
- GST tax breakup never actually persisted, and no stored home-state/place-of-supply/reverse-
  charge fields → added `business_profile`, per-line tax-split columns, `place_of_supply`,
  `reverse_charge_applicable`, controlled state codes.
- Payment tracking via a single mutable field contradicted the plan's own audit-trail principle
  → replaced with an append-only `payment_log`.
- Negative/oversold stock had no surfacing mechanism → added a dashboard indicator.

**Resolved via stakeholder decision (asked directly, now reflected in Part C):**
- GST e-invoicing (IRN/QR) — confirmed in scope; turnover is above the threshold.
- Minimal shortfall note on oversold line items — confirmed, added to Phase 1.
- Worker-drafted bills during peak season — confirmed **not** adding this; owner-only stays as
  originally designed.
- Internet outage during Diwali — confirmed adding a documented manual (paper-based) fallback
  procedure, no code changes.

**Added cheaply now for Phase 2/3, with no Phase 1 behavior change:**
- Idempotency keys on ledger-style tables.
- `actor_type`/`source_metadata` on ledger-style tables, to distinguish agent-authored writes
  from human ones later.
- Dry-run/preview mode on the core mutation functions, and not hardcoding their transaction
  boundaries — this is what makes "LLM proposes, human reviews, then commits" actually buildable
  later without reimplementing validation logic.

**Explicitly evaluated and left deferred (real gaps, but correctly out of Phase 1's scope):**
- A dedicated pending-orders/draft-order data model for Phase 3 — purely additive, doesn't touch
  anything in Phase 1's schema, so there's no cost to deferring it.
- Raw-material/BOM tracking — unchanged from the original scoping decision; a UI note was added
  clarifying that production entries aren't checked against raw material availability.

**Reviewed and found sound as originally designed (no change):**
- The immutable stock-ledger model and server-side role enforcement generalize cleanly to future
  agentic callers without modification.
- The rejection of a separate Python backend and of building on ERPNext/Odoo both held up under
  review — the Python rejection because Claude's API needs no particular backend language, and
  the ERPNext/Odoo rejection on customization-cost grounds (though the review noted this means
  concurrency-safe numbering, jurisdiction-aware tax, and auditable ledgers are being built from
  scratch rather than reused from a mature system — a reason to budget real design/test effort,
  not a reason to reverse the decision).
