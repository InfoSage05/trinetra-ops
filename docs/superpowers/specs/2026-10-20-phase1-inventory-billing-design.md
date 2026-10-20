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
| Payment tracking | Yes — paid / partial / credit per bill, with outstanding dues trackable per customer |
| Inventory scope | Finished goods only (no raw materials / BOM in Phase 1) |
| Bill output | Both printed (thermal/A4) and digital (PDF, shareable) |
| Rollout | Parallel run alongside HDPOS first, before full cutover |
| Overselling behavior | Warn, but allow override — not hard-blocked |

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

## 5. Data Model

- **`users`** — id, name, email, password_hash, role (`owner` | `worker`), created_at
- **`customers`** — id, name, phone, address, state (for tax jurisdiction), gstin (nullable, for
  B2B customers)
- **`products`** — id, name, sku, unit (e.g. "piece", "box"), hsn_code, unit_price, gst_rate
- **`stock_ledger`** — id, product_id, quantity_delta (+/-), type (`produced` | `billed` |
  `adjustment`), reference_bill_id (nullable), reason (required for `adjustment`), created_by
  (user id), created_at
  - Current stock for a product = `SUM(quantity_delta) WHERE product_id = X`
- **`bills`** — id, invoice_number (sequential, unique), customer_id, bill_date, subtotal,
  tax_total, grand_total, payment_status (`paid` | `partial` | `credit`), amount_paid,
  amount_due, created_by, created_at
- **`bill_line_items`** — id, bill_id, product_id, quantity, unit_price, tax_rate, line_total

## 6. Core Flow: Billing with Live Stock + Auto-Deduction

1. Owner starts a new bill, selects or creates the customer.
2. Adding a line item: selecting a product shows its live available stock (computed from
   `stock_ledger`) immediately next to the quantity field.
3. If the entered quantity exceeds available stock, the UI shows an inline warning (e.g. "Only 8
   available, you entered 10") but does not block entry — matches the agreed "warn, don't block"
   behavior.
4. On **Finalize Bill**, a single database transaction:
   - Assigns the next sequential invoice number.
   - Computes tax per line (CGST+SGST if customer state matches business state, else IGST).
   - Records payment status and amount due.
   - Writes one negative `stock_ledger` entry per line item, type `billed`, linked to the bill.
   - If any step fails, nothing is partially saved.
5. Because "current stock" is computed live from the ledger, the updated number is immediately
   visible to any other logged-in user, on any device, with no caching or sync step.

**Production entry (stock increase):** A simple form ("Produced 200 units of Lavender Jar
Candle") creates a positive `stock_ledger` entry, type `produced`. Available to both owner and
worker roles.

**Manual correction:** Any direct stock correction (miscount, damage) goes through the same
ledger as an `adjustment` entry and **requires** a reason note — there is no way to silently
change a stock number.

Concurrency note: because overselling is allowed-with-warning rather than hard-blocked, Phase 1
does not need locking/reservation logic to prevent two simultaneous bills from both reading the
same "last few units available" — brief staleness between read and finalize is an accepted,
visible, correctable edge case, not a correctness bug.

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
on the two places a bug causes real damage:
- **Stock ledger math** — current stock always equals the correct sum of ledger entries under
  concurrent writes.
- **Billing transaction** — a finalized bill always produces exactly one correct ledger entry
  per line item, correct tax computation, and a correctly incremented invoice number, and never
  partially commits on failure.

The rest of the UI is validated through manual click-through testing rather than broad automated
UI test coverage, matching the scale of the team maintaining this.

## 10. Explicitly Out of Scope for Phase 1

- Raw material / bill-of-materials (BOM) tracking.
- LLM-assisted Excel parsing and voice-to-order capture (Phase 2).
- Pending orders / reminders dashboard (Phase 3).
- Reporting/analytics, offline support, and festive-season load hardening (Phase 4).
- Hard-blocking overselling (deferred — current behavior is warn-and-allow; revisit if real-world
  use shows this causes problems).
