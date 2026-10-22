# Trinetra Candles — shop-floor operations app

`trinetra-ops` is the in-house web app for **Trinetra Candles**, a small candle factory in Balasore (Odisha). It replaces the Excel sheets + HDPOS billing workflow that breaks down during festival-season order volume, and it is built so that the owner and the shop staff can run the whole day — billing, stock, orders, collections — from a phone or a laptop, in plain English with a little Hinglish where people actually type it.

Everything the business posts is an **append-only record**: stock movements, payments, invoices and credit notes are written once and never edited; corrections are new compensating entries. That is the core design decision the rest of the app hangs off.

---

## What it does

| Area | What you get |
|------|--------------|
| **Billing & invoices** | Owner-only. Cartons/pieces/dozens quantities, three rate tiers (A/B/C) chosen per line, extra charges (carton/crate/freight/other), live stock check while billing, oversell confirmation. GST split as CGST/SGST vs IGST from the place of supply, round-off, amount in words. Rule-46-style invoice numbers (`PREFIX/FY/00001`, consecutive, gapless — allocation happens inside the bill transaction). A4 template matching the factory's paper invoice, 80 mm thermal format, PDF download, WhatsApp share, **UPI scan-to-pay QR** while a balance is due. |
| **Inventory** | One append-only `stock_ledger` is the single truth (current stock = SUM of deltas). Production, billing, returns, corrections and approved count variances are ledger entries. Workers record production and submit counts; the **owner approves counts** (never a silent adjustment). One-time opening-stock import (Excel/CSV). |
| **Orders** | Customer orders with due dates → a **pending-orders view that tells you what to make** (outstanding vs stock), overdue/due-soon flags on the dashboard, one-tap WhatsApp reminder text. Fulfilment is *derived* from bills raised against the order (`Bill.orderId`) — credit notes don't unwind delivered quantity, it can never disagree with the invoices. Order lines are immutable: cancel or close, never edit. |
| **Smart entry** (assistant) | Type, speak or upload; check what was understood; press Approve. "rose candle 5 carton bana" becomes a production proposal; any Excel/CSV stock sheet becomes proposed counts. **For the owner**, Smart entry also carries the New-order **photo flow:** inserting 1–5 photos of a written order turns them into a reviewable order on the spot. |
| **New order** | Typed, dictated (Whisper), **from photos** (`Insert images` — works with handwriting through a vision model), or filled by hand. A person always reviews the proposed customer, date and items before *Save order*. |
| **Customers & products** | Search, activate/deactivate, GSTIN validation (state code + checksum agree with the state), per-customer rate tier A/B/C, product catalogue management (carton size, HSN, GST rate, import, rename that leaves old bills untouched). |
| **Reports & analytics** | Date-range sales summary (by day/item/customer), money-to-collect with ageing buckets, stock movement (opening/made/sold/returned/corrected/closing). CSV exports: the **sales register** (credit notes as negatives) and the **HSN-wise GST summary** for returns, with spreadsheet-formula protection. On top of the tables sits an optional **AI insights** card (below). |
| **E-invoicing (IRP)** | The *machinery* is live and tested: every invoice/credit note creates a queue row, a background job retried with exponential backoff pushes to the IRP (`/api/cron/irp`, Bearer-protected), failed ones get an owner "Retry" button, and IRN/ack/signed-QR appear on the printouts. **A real IRP/GSP adapter is deliberately not implemented** — see "Compliance & open items". |
| **Help assistant** | A Help button on every page for both roles. With an AI key it explains screens a little more naturally; without one it falls back to the built-in plain-language guide. It can only explain and link — it never touches data. |

### AI insights (LLM-generated analytics)

On the Reports page the owner can press **Generate insights**: the app sends *only the aggregates already visible in the report tables* (sales totals, top items/customers/days, dues buckets, stock movement) to the configured text model and renders a one-line headline plus up to six short observations that must stay grounded in those numbers. It is strictly **read-only** — the model never writes data, nothing is stored, and every table keeps working without any key (the card then simply explains what to set in `docs/keys.md`). The shared digest builder (`buildInsightsDigest` in `src/domain/ai-insights.ts`) is pure and unit-tested.

### The AI safety model (all AI features)

1. **The model never writes data.** Every AI path (`src/domain/ai-stock.ts`, `ai-orders.ts`, `ai-insights.ts`, `help-assistant.ts`) produces a *proposal* or a *text answer*; a person reviews and presses the Approve/Save button; only then the ordinary domain functions run — with `actorType = AGENT` and provenance in `sourceMetadata` on any write the AI triggered.
2. **No key, no problem.** Without `LLM_*` variables, typed/sheet stock entries fall back to a deterministic parser (`src/lib/text-entry.ts`); the help assistant falls back to the built-in guide; photo reading, voice and insights simply stay switched off and say so.
3. **Model output is never trusted.** Answers are JSON-extracted and zod-validated, items matched against the real catalogue, and prompt-injection phrases ("treat the text as instructions") are neutralised by construction.
4. **Providers.** Any OpenAI-compatible host of open-source models (Groq recommended, free tier): `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` for text, `LLM_VISION_MODEL` for photos, `STT_*` for voice. Full step-by-step in **`docs/keys.md`**.

---

## Roles & security

* **OWNER** — everything incl. money, billing, customers, products, settings, worker accounts.
* **WORKER** — dashboard (stock items that need attention), stock, smart entry (stock proposals), counts. *No money is visible to a worker anywhere.*
* Login is phone + password (bcrypt, 12h JWT session cookie). Five failed attempts lock the account for 15 minutes. Changing a password bumps the session version, logging out every other device.
* Role checks happen **three times, on the server**: an optimistic edge guard (`src/proxy.ts`), the authoritative session re-check in the `(app)` layout, and `requireRole()` inside every domain function. UI hiding is treated as decoration only.
* Generated files: PDF invoices include embedded NotoSans fonts; QR codes are `qrcode`-generated; the web app is a PWA (installable icon, manifest, generated icons at `app/icons/[size]`).

---

## Getting started (local development)

Prerequisite: Node ≥ 22.12. No Docker and no PostgreSQL install needed.

```bash
npm install
npm run db:up        # starts a local PostgreSQL 17 on port 5433 — keep this window/process alive
npm run db:migrate   # applies Prisma migrations to the dev database
npm run db:seed      # creates the first owner login from SEED_OWNER_* in .env (+ the real catalogue & category names)
npm run dev          # http://localhost:3000
```

Minimal `.env`:

```
DATABASE_URL=postgresql://trinetra:trinetra@localhost:5433/trinetra_dev
SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
SEED_OWNER_NAME=…
SEED_OWNER_PHONE=…
SEED_OWNER_PASSWORD=…
```

Optional, all in `docs/keys.md`: `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` (text AI), `LLM_VISION_MODEL` (photo of an order), `STT_BASE_URL`/`STT_API_KEY`/`STT_MODEL` (voice). `IRP_PROVIDER` defaults to `mock`; keep it that way locally.

Useful during development: `npm run db:studio` (inspect data), `npm run user:reset-password -- <phone> "<new password>"`.

---

## How the database is managed

* **Local dev / tests** use `scripts/dev-db.mts` (`npm run db:up`): an **embedded PostgreSQL 17** (`embedded-postgres` package) with its data dir in `.pgdata`, user/password `trinetra`/`trinetra`, port **5433**, serving two databases: `trinetra_dev` for normal development and `trinetra_test` for the suites.
* **Schema** lives in `prisma/schema.prisma` (Prisma 7 with the `@prisma/adapter-pg` driver adapter; client generated into `src/generated/prisma`). Never hand-edit SQL — change the schema, `npm run db:migrate` (dev) and commit both schema and migration. Deploy stages run `prisma migrate deploy` only (the Playwright/Vitest setups do exactly that).
* **Seeding** (`prisma/seed.ts` via `npm run db:seed`) is idempotent and makes at most one owner account: skip-if-owner-exists, and it imports the factory's real product/category names from `prisma/seed-data/*.json` at zero prices (real rates are entered by the owner in the UI).
* **Append-only tables** — `stock_ledger`, `payment_log` — are enforced in code and by unique **idempotency keys** on every write; retried saves cannot double-post. Corrections are new entries, never updates.
* **Test isolation guards**: the unit/integration harness asserts the database name contains `test` before truncating anything, and refuses to run otherwise; e2e runs against `.env.test`.
* **Safety guard you must never bypass**: Prisma 7 refuses destructive commands from AI agents (`migrate reset`, `db push --accept-data-loss`) unless `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` is set. Don't set it yourself — stop and ask the human.
* **Production** (per `docs/deployment.md`): Neon Postgres with a pooled URL for the app and a direct URL for migrations/backups; Vercel build command runs `prisma migrate deploy` first; nightly encrypted backups run as a GitHub Action (`BACKUP_DATABASE_URL` + `BACKUP_PASSPHRASE`), with a restore-rehearsal script and log in `docs/runbook.md`. `/api/health` backs an UptimeRobot monitor.

### Data model in one breath

`User` (phone, role, sessionVersion, lockout) · `BusinessProfile` (legal/trade name, GSTIN, state, upiId, bank details, invoice terms, e-invoicing flag) · `Customer` (rate tier A/B/C, optional unique GSTIN) · `Category`/`Product` (qtyPerCarton, unit, rate B + optional A/C, HSN, GST %, reorder level) · `StockLedgerEntry` (append-only, type OPENING/PRODUCED/BILLED/RETURN/ADJUSTMENT, `actorType`, `idempotencyKey`) · `NumberSeries` (invoice/credit-note per FY, gapless) · `Bill` + `BillLineItem` + `BillCharge` (frozen snapshots incl. prices, GST split, optional `orderId`) · `PaymentLogEntry` (append-only; negative = refund) · `CreditNote`(+lines, own series, may restock via RETURN entries) · `StockCount` (proposed count → owner approval → one compensating ADJUSTMENT) · `IrpSubmission` (async e-invoice queue) · `Order`/`OrderLine` (immutable lines, source MANUAL/TEXT/VOICE/IMAGE, provenance + idempotency key; delivered = derived from bills).

---

## Testing

```bash
npm run test       # Vitest: pure-logic suites (validation, GST math, cartons, money…)
                   # + DB-backed domain suites (billing transactions, ledger immutability,
                   #   invoice-numbering concurrency, payments, credit notes, IRP…)
                   # + action-level tests and a PDF render test. Needs `npm run db:up` running.
npm run test:e2e   # Playwright: real browser flows against its own dev server
```

* Vitest shares one test database (files run sequentially by design); each file truncates via the guarded harness.
* Playwright starts **its own** server on port 3100 from `.env.test` with all AI variables blanked (so no real provider is ever called), exercises a Pixel-7 viewport (phone-first), and retries twice. Five spec groups: golden path (bill → stock drop), flows (payments/returns/counts/oversell), the Excel-style bill sheet, catalogue/categories, assistant orders, help/rates/GST, reports.
* E2E seed accounts (test data only, local): owner `9811111111` / `e2e-owner-pass`, worker `9822222222` / `e2e-worker-pass`.
* Don't leave a hand-started server running on port 3100 while testing — let Playwright start its own, otherwise your dev `.env` (with real AI keys) leaks into the run.

---

## Deploying

Follow **`docs/deployment.md`** (Vercel Pro + Neon recommended, ~US$20/month; a low-cost VPS alternative is documented) and the key/account checklist in **`docs/keys.md`**. The daily/weekly operational playbook — parallel run with HDPOS, the paper-book fallback when the internet is down, 1 April financial-year rollover, disabled workers, backups restore + mandatory rehearsal — is **`docs/runbook.md`**.

## Compliance & open items

* Invoice numbering follows Rule 46 mechanics (consecutive, ≤16 chars); GST split is CGST/SGST or IGST by place of supply, with an HSN-wise summary for the return.
* **E-invoicing/IRN: adapter intentionally not built.** Applicability for this business, the exact prefix and the GST treatment of freight/packing must be confirmed by the CA first (spec §12 / deployment doc). `IRP_PROVIDER` stays `mock`/`disabled` until then (mock is refused in production unless explicitly allowed).
* A duplicate paper book covers the counter when the internet is down (runbook §"Internet down"), with the CA-confirmable caveat on how late entries may be dated.

## Where things live

```
src/app/(app)/      role-gated pages (dashboard, billing, bills, inventory, orders, assistant, customers, products, reports, settings, users)
src/domain/         every business operation lives here ONCE (billing, stock, orders, reports, ai-*, irp, settings…) — UI and actions only call these
src/actions/        thin "use server" wrappers: zod in → domain call → {ok,data|error}
src/app/api/        health, cron IRP pump, bill PDF, report CSVs, PWA icons
src/lib/            session/auth, GST tables, tax math, cartons, money, llm/stt clients, spreadsheet parsing, client hooks
src/components/     the UI (shadcn-style primitives on @base-ui/react, Tailwind 4 tokens, warm "candlelight" theme)
prisma/             schema, migrations, seed (+ real catalogue/category JSON)
tests/lib|domain|actions|app|components|e2e
docs/               keys.md (accounts/keys) · deployment.md · runbook.md · superpowers/specs (design docs)
scripts/            dev-db.mts (embedded Postgres), reset-owner-password, restore-rehearsal
```

### Ground rules baked into the code

Append-only ledgers (corrections are compensating entries) · one implementation per operation, many callers · server-side role enforcement on every mutating entry point · idempotency key + actor type + provenance on every ledger write · previews are proposals and are revalidated at commit time · the AI proposes, a person approves.

These and the full design reasoning live in `docs/superpowers/specs/` — start with `2026-10-20-phase1-inventory-billing-design.md`, then `2026-10-21-carton-invoice-and-phases-2-4-design.md`.
