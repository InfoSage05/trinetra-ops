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
| E-invoicing (IRN/QR) | **In scope** — business confirmed turnover is above the GST e-invoicing threshold | Legally required, not optional: every invoice must carry a government-issued IRN and QR code from the IRP. This is a real scope addition identified during review, not just a schema tweak — see Part D's GST Compliance Details |
| Invoice numbering scheme | Postgres `SEQUENCE`, reset per financial year (e.g. `INV/2026-27/00001`) | Avoids the race condition of deriving the next number from `MAX(invoice_number)`, and matches standard GST practice (CGST Rule 46) of per-financial-year sequential numbering |
| Payments | Track paid / partial / credit per bill, via an append-only payment log (not a single mutable field), with per-customer outstanding dues | B2B/distributor sales commonly happen on credit, often paid off in installments; a log preserves *when* and *how much* was paid each time, matching the audit-trail principle already used for stock |
| Inventory scope | Finished goods only — no raw material or bill-of-materials (BOM) tracking yet | Raw material/BOM tracking is a materially different, more complex data model (recipes, yield, wastage) and isn't required to fix the stated problem; deferred to a future phase if ever needed |
| Bill output | Both printed (thermal/A4) and digital (PDF, shareable via WhatsApp/email) | Matches current practice (printed) while adding flexibility distributors increasingly expect (digital) |
| Rollout | Parallel run alongside HDPOS before full cutover | Reduces risk during transition; avoids switching systems during the Diwali rush itself |
| Overselling | Warn, but allow override — not hard-blocked | Real-world billing sometimes needs to proceed even if the ledger is momentarily behind physical reality; owner stays in control rather than being blocked |
| Shortfall tracking | A minimal "units still owed" note is captured on the bill line item when overselling happens | Cheap stopgap confirmed during review: without this, Phase 1 only makes the stock *number* accurate, it doesn't record what's actually still owed to the customer — the full pending-orders workflow stays Phase 3's job |
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
  Needed because CGST+SGST-vs-IGST determination requires comparing the *business's* state to
  the customer's state, and nothing in the original design stored the business's own side of
  that comparison.
- **`customers`** — id, name, phone, address, state (a controlled GST state code, not free
  text — avoids silently misclassifying tax due to "Odisha" vs "ODISHA" vs "Orissa"-style
  mismatches), gstin (nullable, for B2B)
- **`products`** — id, name, sku, unit, hsn_code, unit_price, gst_rate
- **`stock_ledger`** — id, product_id, quantity_delta (+/-), type (`produced` | `billed` |
  `adjustment`), reference_bill_id (nullable), reason (required for `adjustment`), created_by,
  idempotency_key (nullable, unique), actor_type (`human` | `agent`, default `human`),
  source_metadata (jsonb, nullable), created_at. *Current stock for a product =
  `SUM(quantity_delta)` for that product.*
- **`bills`** — id, invoice_number (assigned from a per-financial-year `SEQUENCE`, unique),
  customer_id, bill_date, subtotal, cgst_total, sgst_total, igst_total, discount_total
  (nullable), round_off (nullable), tax_total, grand_total, place_of_supply (state code),
  reverse_charge_applicable (boolean, default false), irn (nullable — government-issued Invoice
  Reference Number), qr_code_data (nullable), payment_status (`paid` | `partial` | `credit`,
  computed from `payment_log`), amount_due (computed), created_by, idempotency_key (nullable,
  unique), actor_type, source_metadata (jsonb, nullable), created_at
- **`bill_line_items`** — id, bill_id, product_id, quantity, unit_price, tax_rate, cgst_amount,
  sgst_amount, igst_amount, line_total, shortfall_quantity (nullable — units still owed if this
  line was billed while oversold), shortfall_note (nullable)
- **`payment_log`** — id, bill_id, amount, method (cash/UPI/bank transfer/cheque/etc.), paid_at,
  recorded_by, note (nullable). `bills.amount_paid`/`amount_due`/`payment_status` are computed
  from this log, the same way stock is computed from `stock_ledger` — a single running total
  would otherwise lose the "when was how much paid" history that matters for a credit-heavy
  B2B business paying off dues in installments.

### Core Flow — Billing with Live Stock + Auto-Deduction
1. Owner starts a bill, selects/creates the customer.
2. Selecting a product on a line item immediately shows live available stock (computed from
   `stock_ledger`).
3. If entered quantity exceeds available stock, an inline warning appears (e.g. "Only 8
   available, you entered 10") — entry is not blocked.
4. If any line is oversold, the father can still proceed, but must confirm — and the shortfall
   (e.g. "2 units still owed") is captured on that line item rather than silently disappearing.
5. On **Finalize Bill**, one database transaction: pulls the next invoice number from the
   per-financial-year `SEQUENCE` (not derived from `MAX(invoice_number)`, which is the race
   condition identified during review), computes and *stores* the CGST/SGST/IGST split per line
   (CGST+SGST if customer state == business's own state from `business_profile`, else IGST),
   generates the IRN + QR code via the government IRP (required — turnover is above the
   e-invoicing threshold), and writes one negative `stock_ledger` entry per line item (type
   `billed`, linked to the bill). All-or-nothing — no partial saves, and a failed finalize
   cannot leave a gap-causing partial invoice number because the sequence advance and the bill
   row are part of the same transaction.
6. Because current stock is computed live, the updated number is visible immediately to anyone
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
- **E-invoicing (IRN + QR code)** — in scope. The business's turnover is above the GST
  e-invoicing threshold, so Phase 1 must integrate with the government IRP to generate an IRN
  and QR code per invoice at finalize time. This is a genuine scope addition (a third-party API
  dependency with its own credentials/sandbox-vs-production concerns), not just a schema
  change, and should be sized accordingly in the implementation plan.
- **Invoice numbering** resets per financial year via a Postgres `SEQUENCE` (e.g.
  `INV/2026-27/00001`), matching standard GST practice (CGST Rule 46) and avoiding the
  `MAX(invoice_number)+1` race condition identified during review.

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

Three independent review passes were run against this plan — business/domain fit, technical
architecture/correctness, and future-extensibility for agentic workflows. All findings below have
already been folded into Parts C/D above; this section exists as a record of what was found and
how it was resolved.

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
