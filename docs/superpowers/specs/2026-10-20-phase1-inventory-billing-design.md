# Trinetra Candles — Phase 1: Inventory + Billing Core — Design Spec

## 1. Context & Problem

Trinetra Candles is a candle manufacturing business run by the user's father, currently using
HDPOS Smart V2 for billing and inventory. The core pain point: inventory (tracked in Excel) and
billing (done in HDPOS) are disconnected. Before building a bill, the father has to manually check
an Excel sheet for stock availability, then manually edit that Excel sheet afterward to reflect
what was just sold. This is fully manual, error-prone, and becomes especially chaotic during
seasonal demand spikes (Puja, Diwali).

This is not a plan to replace HDPOS wholesale. It's a new, purpose-built system designed around
the business's actual workflow, starting with the single highest-value fix: making stock
visibility and stock deduction automatic and inseparable from the billing process itself.

This spec covers **Phase 1 only**: Inventory (finished goods) + Billing. Later phases (not
designed here) will add:
- **Phase 2:** LLM-assisted data entry — typed natural-language stock updates, Excel upload
  parsing/reconciliation.
- **Phase 3:** Voice-to-order capture, pending-orders/reminders dashboard.
- **Phase 4:** Reporting/analytics, multi-user hardening, festive-season load review.

Phase 1 deliberately excludes raw-material inventory and bill-of-materials (BOM)/manufacturing
tracking — it tracks only finished, sellable candle SKUs. Raw material tracking is a materially
different data model (recipes, yield, wastage) and isn't required to fix the problem described
above.

## 2. Goals & Success Criteria

- When building a bill, the person entering it sees live, accurate stock availability for each
  product as they add it — no separate Excel lookup.
- Finalizing a bill automatically and atomically deducts stock — no manual Excel edit afterward.
- Logging production (new stock made) is a first-class action that increases stock the same way
  selling decreases it.
- Every stock change is traceable: what changed, by how much, why, who did it, and when.
- Bills are legally valid GST tax invoices, support partial/credit payment tracking, and can be
  both printed and shared digitally (PDF).
- The father (owner) and workers have separate logins; workers cannot see pricing/financials or
  make bills, only log production and view stock levels.
- The system is usable from both phone and laptop, from different locations (shop, factory
  floor, elsewhere), since the business is cloud-hosted rather than tied to one PC.
- The architecture must not block future phases: LLM-driven agents (voice orders, Excel parsing)
  must be able to reuse the same core logic as the UI, not reimplement it.

## 3. Scope Decisions (from stakeholder discussion)

| Decision | Choice |
|---|---|
| Platform | Cloud-hosted responsive web app (PWA), accessible from phones and laptops, from multiple locations |
| Connectivity assumption | Reliable WiFi/broadband — no offline-first design needed in Phase 1 |
| Scale | Small: dozens of SKUs, under 50 bills/day even at peak |
| User roles | Separate logins, role-based: **owner** (father — full access, billing, financials) and **worker** (production entry, stock viewing only; no pricing/financials, no billing) |
| Invoice type | Full GST tax invoice: GSTIN, HSN codes, CGST/SGST/IGST breakup, sequential invoice numbering |
| E-invoicing (IRN/QR) | In scope — business turnover is above the GST e-invoicing threshold, so every invoice needs a government-issued IRN + QR code via the IRP |
| Invoice numbering scheme | Postgres `SEQUENCE`, reset per financial year (e.g. `INV/2026-27/00001`) — avoids deriving the next number from `MAX(invoice_number)`, which races under concurrent finalize calls |
| Payment tracking | Yes — paid / partial / credit per bill, via an append-only payment log (not a single mutable field), with outstanding dues trackable per customer |
| Inventory scope | Finished goods only (no raw materials / BOM in Phase 1) |
| Bill output | Both printed (thermal/A4) and digital (PDF, shareable) |
| Rollout | Parallel run alongside HDPOS first, before full cutover |
| Overselling behavior | Warn, but allow override — not hard-blocked; a minimal "units still owed" shortfall note is captured on the line item |
| Peak-season billing | Owner-only in Phase 1 (no worker-drafted bills); revisit only if real usage shows a bottleneck |
| Outage fallback | Documented manual paper-based fallback procedure (no code) for connectivity loss during Diwali/Puja |

## 4. Architecture

**Approach:** Single Next.js (TypeScript) application serving both the UI and the backend API
(via server actions/API routes), backed by a single PostgreSQL database. Deployed as one unit
(e.g. Vercel + a managed Postgres such as Supabase/Neon). Responsive layout with a PWA manifest
so it installs cleanly on phones alongside normal laptop browser use.

**Why this shape (vs. a separate frontend/backend split, or building on an existing open-source
ERP like ERPNext/Odoo):**
- Matches the actual scale (1–3 concurrent users, small catalog) — a split frontend/backend adds
  operational overhead with no real benefit at this size.
- One codebase, one language, one deployment — sustainable for a single developer to maintain.
- Future LLM integration (Phase 2/3) is just a server-side API call to Claude from within the
  same app — no separate backend was ever needed for that.
- Building on an existing ERP was rejected: it brings a generic data model and its own
  customization learning curve, working against the goal of a UI/workflow shaped exactly around
  this business's real process.

**Key architectural principle — immutable stock ledger:** Inventory is never stored as a single
mutable "current quantity" field. Instead, every change (production, sale, manual correction) is
recorded as an immutable entry in a `stock_ledger` table. "Current stock" for a product is always
*computed* as the sum of its ledger entries. This gives a full audit trail by construction and
directly addresses the "why does this number look wrong" failure mode of manual Excel tracking.

**Key architectural principle — shared core logic:** All stock/billing mutations are implemented
once as plain backend functions (e.g. `createBill()`, `recordProduction()`, `adjustStock()`).
The UI calls these functions. Phase 2/3 agentic workflows (voice parsing, Excel reconciliation)
will call the *same* functions rather than duplicating logic — new entry points, not new business
logic. This is the mechanism that keeps the backend flexible for "more sub-agentic workflows"
without rework.

**Role enforcement:** Role checks (owner vs worker) are enforced server-side on every mutating
action, not just hidden in the UI — a worker cannot invoke billing/financial logic even by
guessing a URL or API call.

**Idempotent, attributable writes (added during review):** Every ledger-style write carries a
nullable, uniquely-indexed `idempotency_key` and a nullable `actor_type` (`human` | `agent`) +
`source_metadata` (jsonb). Phase 1 never populates these, but they exist from day one so a
retried/duplicate call from a future LLM-driven caller can be deduped, and an agent-authored
entry stays distinguishable from a human one.

**Preview-before-commit, caller-controlled transactions (added during review):**
`createBill()`, `recordProduction()`, and `adjustStock()` each support a dry-run mode that
returns the computed effect without committing, and none of them open their own database
transaction — callers control the transaction boundary. This is what makes "LLM proposes, human
reviews, then commits" and "batch-reconcile an Excel sheet as one transaction" buildable later
without duplicating or reworking this logic.

## 5. Data Model

- **`users`** — id, name, email, password_hash, role (`owner` | `worker`), created_at
- **`business_profile`** — single-row settings: legal name, GSTIN, home state code, address.
  Needed to determine CGST+SGST vs IGST (requires comparing the business's own state to the
  customer's).
- **`customers`** — id, name, phone, address, state (a controlled GST state code, not free
  text), gstin (nullable, for B2B customers)
- **`products`** — id, name, sku, unit (e.g. "piece", "box"), hsn_code, unit_price, gst_rate
- **`stock_ledger`** — id, product_id, quantity_delta (+/-), type (`produced` | `billed` |
  `adjustment`), reference_bill_id (nullable), reason (required for `adjustment`), created_by
  (user id), idempotency_key (nullable, unique), actor_type (`human` | `agent`, default
  `human`), source_metadata (jsonb, nullable), created_at
  - Current stock for a product = `SUM(quantity_delta) WHERE product_id = X`
- **`bills`** — id, invoice_number (from a per-financial-year `SEQUENCE`, unique), customer_id,
  bill_date, subtotal, cgst_total, sgst_total, igst_total, discount_total (nullable),
  round_off (nullable), tax_total, grand_total, place_of_supply (state code),
  reverse_charge_applicable (boolean, default false), irn (nullable), qr_code_data (nullable),
  payment_status (`paid` | `partial` | `credit`, computed from `payment_log`), amount_due
  (computed), created_by, idempotency_key (nullable, unique), actor_type, source_metadata
  (jsonb, nullable), created_at
- **`bill_line_items`** — id, bill_id, product_id, quantity, unit_price, tax_rate, cgst_amount,
  sgst_amount, igst_amount, line_total, shortfall_quantity (nullable), shortfall_note (nullable)
- **`payment_log`** — id, bill_id, amount, method, paid_at, recorded_by, note (nullable).
  `bills.amount_paid`/`amount_due`/`payment_status` are computed from this log, the same way
  stock is computed from `stock_ledger`.

## 6. Core Flow: Billing with Live Stock + Auto-Deduction

1. Owner starts a new bill, selects or creates the customer.
2. Adding a line item: selecting a product shows its live available stock (computed from
   `stock_ledger`) immediately next to the quantity field.
3. If the entered quantity exceeds available stock, the UI shows an inline warning (e.g. "Only 8
   available, you entered 10") but does not block entry — matches the agreed "warn, don't block"
   behavior.
4. If a line is oversold, the father can still proceed after confirming, but the shortfall
   (e.g. "2 units still owed") is captured on that line item rather than disappearing silently.
5. On **Finalize Bill**, a single database transaction:
   - Pulls the next invoice number from a per-financial-year `SEQUENCE` (not `MAX()+1`, which
     races under concurrent finalize calls).
   - Computes and *stores* the CGST/SGST/IGST split per line (CGST+SGST if customer state
     matches the business's own state from `business_profile`, else IGST).
   - Generates the IRN + QR code via the government IRP (required — turnover is above the
     e-invoicing threshold).
   - Records payment status and amount due.
   - Writes one negative `stock_ledger` entry per line item, type `billed`, linked to the bill.
   - If any step fails, nothing is partially saved — including the invoice number, since the
     sequence advance and the bill row share the same transaction.
6. Because "current stock" is computed live from the ledger, the updated number is immediately
   visible to any other logged-in user, on any device, with no caching or sync step.

**Production entry (stock increase):** A simple form ("Produced 200 units of Lavender Jar
Candle") creates a positive `stock_ledger` entry, type `produced`. Available to both owner and
worker roles. This does not check raw-material availability — the UI should say so explicitly.

**Manual correction:** Any direct stock correction (miscount, damage) goes through the same
ledger as an `adjustment` entry and **requires** a reason note — there is no way to silently
change a stock number.

**Negative-stock surfacing:** Because overselling is allowed, computed stock can go negative.
The dashboard shows a visible indicator for any product at or below zero, so this doesn't
quietly reintroduce the "nobody notices the discrepancy" failure mode the project exists to fix.

Concurrency note: because overselling is allowed-with-warning rather than hard-blocked, Phase 1
does not need locking/reservation logic to prevent two simultaneous bills from both reading the
same "last few units available" — brief staleness between read and finalize is an accepted,
visible, correctable edge case, not a correctness bug. Invoice numbering is the one place that
*does* need an explicit concurrency-safe mechanism (the `SEQUENCE` above), since a collision
there is a rejected/crashed finalize on the legally-sensitive invoicing path, not a harmless
stale read.

### GST Compliance Details (added during review)

- Tax breakup (CGST/SGST/IGST) is persisted per line, not just computed at display time, so a
  reprinted invoice always matches the original.
- Place of supply and reverse-charge applicability are explicit, mandatory fields.
- Discount and round-off are explicit fields, not folded opaquely into totals.
- E-invoicing (IRN + QR) integration with the government IRP is in scope, given confirmed
  turnover above the threshold — budget this as real scope, not a schema tweak.
- Invoice numbering resets per financial year via a `SEQUENCE` (CGST Rule 46 practice).

### Outage Fallback Procedure (added during review)

Full offline support stays out of scope, but Diwali/Puja is both the highest-stakes and the
likeliest-for-outage period. Fallback (no code): keep a pre-printed paper duplicate book at the
billing counter; if the system is unreachable, bill by hand on paper as usual; once connectivity
returns, enter each paper bill into the system as a normal bill, noting the original paper slip
number for reference.

## 7. Screens (Phase 1)

- **Login** — role-based session.
- **Dashboard** — owner sees sales summary and outstanding dues; worker sees a production-entry
  shortcut and stock overview only.
- **Billing** — customer select/create, line items with live stock + overselling warning,
  finalize → generates invoice; print view and PDF export.
- **Inventory** — product list with live computed stock, search/filter, production-entry form,
  manual adjustment form (reason required).
- **Customers** — list, create/edit, outstanding dues per customer.
- **Bill history** — past invoices, reprint/re-download PDF, update payment status
  (paid/partial/credit).
- **User management** (owner only) — create/manage worker logins.

Worker-role users see only Dashboard (limited), Inventory (stock view + production entry), and
nothing involving pricing, billing, or customer financials.

## 8. Error Handling

- Bill finalization is atomic (single transaction): invoice numbering, tax calculation, and
  ledger writes either all succeed or none do.
- Every ledger-mutating action requires a reason/reference (bill id for `billed`, note for
  `adjustment`) — nothing changes stock invisibly.
- Server-side role checks gate every mutating action regardless of what the UI exposes.

## 9. Testing Approach

Given this is a solo-maintained small-scale application, automated testing is focused narrowly
on the places a bug causes real damage:
- **Stock ledger math** — current stock always equals the correct sum of ledger entries under
  concurrent writes.
- **Billing transaction** — a finalized bill always produces exactly one correct ledger entry
  per line item, correct tax computation, and a correctly incremented invoice number, and never
  partially commits on failure.
- **Concurrent invoice finalization** — two simultaneous finalize calls never produce a
  duplicate or skipped invoice number (added during review).
- **GST split and rounding edge cases** — per-line CGST/SGST/IGST amounts always sum correctly
  to the bill-level tax total (added during review).

The rest of the UI is validated through manual click-through testing rather than broad automated
UI test coverage, matching the scale of the team maintaining this.

## 10. Explicitly Out of Scope for Phase 1

- Raw material / bill-of-materials (BOM) tracking.
- LLM-assisted Excel parsing and voice-to-order capture (Phase 2).
- Full pending-orders / reminders dashboard (Phase 3) — Phase 1 only captures a minimal
  per-line shortfall note as a stopgap.
- Worker-drafted bills requiring owner approval (billing stays owner-only; revisit if needed).
- Reporting/analytics and festive-season infrastructure load hardening (Phase 4).
- Full offline support (mitigated instead by the documented manual fallback procedure above).
- Hard-blocking overselling (deferred — current behavior is warn-and-allow; revisit if real-world
  use shows this causes problems).
