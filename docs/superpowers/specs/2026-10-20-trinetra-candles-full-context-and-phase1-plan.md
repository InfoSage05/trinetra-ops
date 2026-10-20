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
| Payments | Track paid / partial / credit per bill, with per-customer outstanding dues | B2B/distributor sales commonly happen on credit; need visibility into what's owed |
| Inventory scope | Finished goods only — no raw material or bill-of-materials (BOM) tracking yet | Raw material/BOM tracking is a materially different, more complex data model (recipes, yield, wastage) and isn't required to fix the stated problem; deferred to a future phase if ever needed |
| Bill output | Both printed (thermal/A4) and digital (PDF, shareable via WhatsApp/email) | Matches current practice (printed) while adding flexibility distributors increasingly expect (digital) |
| Rollout | Parallel run alongside HDPOS before full cutover | Reduces risk during transition; avoids switching systems during the Diwali rush itself |
| Overselling | Warn, but allow override — not hard-blocked | Real-world billing sometimes needs to proceed even if the ledger is momentarily behind physical reality; owner stays in control rather than being blocked |

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

## Part D — Phase 1 Detailed Design

### Data Model
- **`users`** — id, name, email, password_hash, role (`owner` | `worker`), created_at
- **`customers`** — id, name, phone, address, state (tax jurisdiction), gstin (nullable, for B2B)
- **`products`** — id, name, sku, unit, hsn_code, unit_price, gst_rate
- **`stock_ledger`** — id, product_id, quantity_delta (+/-), type (`produced` | `billed` |
  `adjustment`), reference_bill_id (nullable), reason (required for `adjustment`), created_by,
  created_at. *Current stock for a product = `SUM(quantity_delta)` for that product.*
- **`bills`** — id, invoice_number (sequential, unique), customer_id, bill_date, subtotal,
  tax_total, grand_total, payment_status (`paid` | `partial` | `credit`), amount_paid,
  amount_due, created_by, created_at
- **`bill_line_items`** — id, bill_id, product_id, quantity, unit_price, tax_rate, line_total

### Core Flow — Billing with Live Stock + Auto-Deduction
1. Owner starts a bill, selects/creates the customer.
2. Selecting a product on a line item immediately shows live available stock (computed from
   `stock_ledger`).
3. If entered quantity exceeds available stock, an inline warning appears (e.g. "Only 8
   available, you entered 10") — entry is not blocked.
4. On **Finalize Bill**, one database transaction: assigns next sequential invoice number,
   computes tax per line (CGST+SGST if customer state == business state, else IGST), records
   payment status/amount due, and writes one negative `stock_ledger` entry per line item (type
   `billed`, linked to the bill). All-or-nothing — no partial saves.
5. Because current stock is computed live, the updated number is visible immediately to anyone
   else logged in, on any device.

**Production entry:** a simple form ("Produced 200 units of Lavender Jar Candle") writes a
positive `stock_ledger` entry (type `produced`). Available to both owner and worker roles.

**Manual correction:** goes through the same ledger as an `adjustment` entry and *requires* a
reason note. No stock number changes silently.

**Concurrency note:** because overselling is warn-not-blocked, Phase 1 deliberately skips
reservation/locking logic for the "two simultaneous bills draining the last few units"
edge case — brief staleness between read and finalize is accepted as visible and correctable,
not a correctness bug, at this scale (1-3 concurrent users).

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
Given a single-developer-maintained small-scale app, automated tests focus narrowly on the two
places a bug causes real damage:
- **Stock ledger math** — current stock always equals the correct sum of ledger entries.
- **Billing transaction** — a finalized bill always produces exactly one correct ledger entry per
  line item, correct tax computation, correctly incremented invoice number, and never partially
  commits on failure.
The rest of the UI relies on manual click-through testing.

### Explicitly Out of Scope for Phase 1
- Raw material / bill-of-materials (BOM) tracking.
- LLM-assisted Excel parsing and voice-to-order capture (Phase 2).
- Pending orders / reminders dashboard (Phase 3).
- Reporting/analytics, offline support, festive-season load hardening (Phase 4).
- Hard-blocking overselling (deferred; revisit if real-world use shows a need).

## Part E — What Reviewers Should Focus On

This document is being circulated to independent reviewers *before* an implementation plan is
written, specifically to catch gaps, risks, or missed opportunities while the design is still
cheap to change. Reviewers should assume Parts A/B/C are fixed context (the "why"), and focus
critique on Part D (the actual Phase 1 design) plus whether Part C's architectural principles
genuinely deliver on the Part B vision (especially the "flexible backend for future sub-agentic
workflows" requirement). Concrete, prioritized suggestions are far more useful than general
praise or a restatement of the plan.
