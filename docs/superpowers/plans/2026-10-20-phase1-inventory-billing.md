# Phase 1: Inventory + Billing Core — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 1 of Trinetra Candles' custom system: live-stock-aware GST billing with atomic stock deduction, payments, returns (credit notes), opening-stock import, physical stock counts, an e-invoice (IRP) submission queue, and a simple phone-friendly UI the owner and workers can use without training.

**Architecture:** One Next.js 16 app (UI + server actions + route handlers) on one PostgreSQL 17 database through Prisma 7. Every stock and money change is an append-only ledger row, and the database itself rejects edits to posted rows. All business rules live in `src/domain/*`. Each domain function validates its own input with zod, checks the caller's role, and takes a database handle so callers control the transaction. UI server actions are thin wrappers, and future AI agents (Phase 2/3) call the same domain functions.

**Tech Stack:** Node.js 24 LTS, Next.js 16 (App Router, Turbopack), React 19, TypeScript 5.9 (strict), PostgreSQL 17 (Docker locally, Neon in production), Prisma 7 + `@prisma/adapter-pg`, zod 4, decimal.js, bcryptjs, jose, Tailwind CSS 4 + shadcn/ui, @react-pdf/renderer 4, qrcode, exceljs + papaparse, Vitest, Playwright, GitHub Actions. All are free and open source.

**Spec:** `docs/superpowers/specs/2026-10-20-phase1-inventory-billing-design.md` (v2). Read it first; this plan implements it.

---

## Revision Notes (v1 → v2)

v1 was reviewed line by line before any code was written. These defects would have caused failures during execution and are fixed here:

| # | v1 defect | v2 fix |
|---|---|---|
| 1 | Domain code used `prisma` (dev DB) while tests seeded/truncated `testPrisma` (test DB) — almost every domain test would fail | One client. Vitest loads `.env.test` before any import, so `@/lib/db` *is* the test DB in tests; a guard refuses to truncate any database whose name lacks `test` |
| 2 | Raw SQL used `next_serial`/`financial_year`, but Prisma creates camelCase columns | Convention: tables are `@@map`ped to snake_case, columns stay camelCase and are always double-quoted in raw SQL (`"nextSerial"`) |
| 3 | Server actions returned Prisma `Decimal` objects to client components (not serializable → runtime error) | `runAction()` converts every Decimal to a string (`toPlain`) and returns `{ ok, data } \| { ok, error }` |
| 4 | Thrown server-action errors are replaced by a generic message in production builds, so users never see why something failed | Domain errors are typed (`DomainError`, `ValidationError`, `ForbiddenError`) and turned into user-readable results instead of being thrown across the network |
| 5 | Idempotency used "catch unique violation, then re-read" *inside* a transaction — impossible in Postgres (the transaction is already aborted) | Ledger rows use `createMany({ skipDuplicates: true })` (`ON CONFLICT DO NOTHING`) then re-read; bills catch the conflict *outside* the transaction |
| 6 | Financial year computed in UTC — a bill at 00:30 IST on 1 April got last year's number | All business dates use `Asia/Kolkata` |
| 7 | Next.js 14 APIs (`cookies()` sync, `middleware.ts`, sync `params`) | Next.js 16: `await cookies()`, `proxy.ts`, `params: Promise<…>` |
| 8 | Prisma 6-style client (`datasources` override, `@prisma/client` import) | Prisma 7: `prisma.config.ts`, `prisma-client` generator, `PrismaPg` adapter |
| 9 | No product, customer, business-profile or number-series management; billing would throw on first use | Tasks 11–13 and 22 add settings, master data, Excel import and first-run seed |
| 10 | No route protection; server actions (public POST endpoints) had no auth | `proxy.ts` redirects; every action calls a domain function that enforces role; layouts re-check the session against the DB |
| 11 | Billing UI asked a layman to type database IDs; place of supply hard-coded to `"OD"` | Searchable product/customer pickers, state picker defaulting to the customer's state, no IDs ever shown |
| 12 | Credit notes didn't reduce dues; over-returns allowed; two lines of the same product could oversell unnoticed; stock count approvable twice; B2C bills queued for IRP | Each fixed with a test |
| 13 | Windows blockers: `createdb`, `$DATABASE_URL_TEST` shell expansion, native `bcrypt` | Docker Compose Postgres, `dotenv-cli` npm scripts, pure-JS `bcryptjs` |
| 14 | Invoice serial `TC-2627-000001`; credit notes needed a duplicate counter table | One `number_series` table keyed by (series, FY); serial `TC/2627/00001` (13 chars, Rule 46 ≤ 16, only `/` and alphanumerics) |
| 15 | PDF used a font without the ₹ glyph; omitted Rule 46 particulars | Noto Sans embedded; one shared invoice view model feeds the screen, print and PDF, with all particulars |
| 16 | Stock-count approval re-sized the adjustment against stock *at approval time*, silently erasing production logged between counting and approving | Apply the discrepancy found at count time (`counted − expected`), as ERPNext stock reconciliation does and spec §5 states (Task 18) |
| 17 | Domain functions trusted their callers' input (e.g. negative "production" could reduce stock) | Every domain function validates with zod itself, so future AI agents calling the domain directly get the same protection as the UI |
| 18 | No CI, no E2E test, no backups; deployment target (Vercel Hobby) prohibits commercial use | Tasks 27–29: Playwright phone-viewport test, GitHub Actions CI, nightly encrypted backups with a rehearsed restore, deployment guide (Vercel Pro + Neon, or a VPS) |

Additions beyond the spec, chosen for this business and borrowed from open-source practice (see Design References): line discounts and per-bill price override, round-off to the nearest rupee, amount in words (Indian lakh/crore), GSTIN checksum validation, reorder levels and low-stock alerts, a "don't restock damaged returns" option, UPI "scan to pay" QR on invoices, WhatsApp share, A4 + 80 mm thermal print layouts, Excel import of products and opening stock, login lockout, instant worker deactivation, CI, nightly encrypted backups.

---

## Global Constraints

Every task implicitly includes these. Copy exact values; do not improvise.

- **Scope:** finished goods only, with no raw material/BOM. Billing and physical handover are one event (spec §1).
- **Overselling** is allowed only after explicit confirmation (`confirmShortfall: true`). The shortfall is stored on the line (spec §3, §6).
- **Immutable ledgers.** Rows in `stock_ledger`, `payment_log`, `bills`, `bill_line_items`, `credit_notes` and `credit_note_lines` are never updated or deleted. Postgres triggers enforce this (Task 3). Corrections are new compensating rows. `stock_counts`, `irp_submissions`, `number_series` and master data are mutable by design.
- **Idempotency.** Every ledger-style write carries a unique `idempotencyKey`. A retry with the same key returns the original result. A retry with the same key but different content raises `IDEMPOTENCY_CONFLICT`.
- **Attribution.** Ledger rows carry `createdBy` (user id), `actorType` (`HUMAN` | `AGENT`, default `HUMAN`) and optional `sourceMetadata` (JSON).
- **Domain functions** live only in `src/domain/`. They take `session` first (or `db` for read helpers), validate input with zod via `parseInput`, call `requireRole`, and never trust the UI.
- **Transactions.** Low-level helpers (`writeLedgerEntry`, `allocateNumber`, `getStockLevels`, …) take a `db: Db` argument and never open their own transaction. Top-level operations (`createBill`, `recordReturn`, …) open exactly one `prisma.$transaction`.
- **Money and quantity** use `decimal.js` in code and `Decimal(12,2)` in the database. JavaScript `number` arithmetic on money is forbidden. Values are written to Prisma as strings (`.toFixed(2)`).
- **Rounding** is `ROUND_HALF_UP` to 2 dp per tax component per line. Bill totals are sums of rounded line values. The grand total is rounded to the nearest rupee, with the difference stored in `roundOff`.
- **Time.** Business dates and financial years use `Asia/Kolkata`. The financial year runs April–March and is labelled `"2026-27"`.
- **Invoice serial** format is `{PREFIX}/{YYyy}/{NNNNN}`, e.g. `TC/2627/00001`. The prefix is 1–4 of `[A-Z0-9]`. The serial is ≤ 16 characters and gapless. Numbers come from the `number_series` table, never a Postgres `SEQUENCE`.
- **IRP (e-invoice)** is never called inside a DB transaction. A submission is queued only when `businessProfile.einvoicingApplicable` is true *and* the customer has a GSTIN (B2B).
- **Roles.** `OWNER` can do everything. `WORKER` can view stock, record production and submit stock counts. Nothing else.
- **Raw SQL** must double-quote camelCase column names (`"nextSerial"`) and use `@@map`ped table names (`"number_series"`).
- **Scale:** dozens of SKUs, < 50 bills/day, 1–3 concurrent users. Do not add caching, queues or infrastructure sized beyond this.
- **Definition of done for every task:** the task's tests pass, `npm run typecheck` passes, `npm run lint` passes, and the full suite `npm test` still passes.

## Review Focus

Failure modes most likely to hurt a real user. Each one is pinned to a test in the named task.

- **Double-tapped "Finalize bill"** (two identical requests in flight). Exactly one bill and one stock deduction must result, and both requests return the same bill. Pinned to Tasks 15 and 23.
- **Two lines for the same product** in one bill (e.g. 5 + 5 with 8 in stock). The shortfall must be detected across both lines. Pinned to Task 14.
- **A worker calling an owner-only server action directly**, bypassing the hidden button. It must be rejected by the domain layer. Pinned to Tasks 5, 8, 15, 22, 23 and 25.
- **A bill created at 00:30 IST on 1 April.** It must get the *new* financial year's series. Pinned to Tasks 4 and 9.
- **A return after partial payment.** Dues must drop by the credit note amount, and returning more than was billed must be refused. Pinned to Tasks 16 and 17.

---

## Design References (open-source inspiration)

| Product | What we borrow | Where |
|---|---|---|
| ERPNext / Frappe (+ India Compliance app) | Immutable Stock Ledger Entry, with reposting replaced by compensating entries; "naming series" per financial year; GSTIN checksum validation; item reorder level; e-invoice submissions as a retryable queue with an operator view | Tasks 3, 4, 7, 9, 19, 20, 26 |
| Odoo Inventory | Inventory adjustment as *counted* vs *applied*. A count is a proposal reviewed before it is applied. We apply the count-time discrepancy, ERPNext-style, so later moves survive | Task 18 |
| InvenTree | Stocktake as its own auditable record; low-stock dashboards | Tasks 18, 20, 26 |
| Invoice Ninja / Crater | Payments as a separate log (partial payments, refunds); invoice PDF templates; amount in words; share link | Tasks 4, 16, 24 |
| GNUKhata (Indian FOSS accounting) | Indian GST invoice layout conventions (HSN-wise lines, CGST/SGST/IGST columns, place of supply) | Tasks 20, 24 |

We deliberately do **not** adopt warehouses, valuation layers, multi-currency, or the general ledger. These are out of scope for Phase 1 (spec §15).

## Open Items to Confirm with the CA (before production cutover)

Code is configurable for each. Do not hard-code assumptions.
1. Whether e-invoicing applies to this business and which documents need it. Toggle: Settings → *E-invoicing applicable*. Credit notes to registered customers are queued too.
2. The invoice prefix (Settings → Number series).
3. The GST rate and HSN code (4/6/8 digits) for each candle SKU. Rates in this plan's tests are arbitrary fixtures, not tax advice. Candle rates changed in the 2025 GST rate rationalisation, so confirm current rates.
4. Place-of-supply treatment for anything other than plain intra-state or inter-state goods sales.
5. The process for entering bills written on paper during an outage (runbook, Task 29).
6. Which GSP/IRP API provider to use. Phase 1 ships the queue and a mock client; a real provider adapter is a small follow-up once credentials exist.

---

## File Structure

```
.
├── docker-compose.yml               # local Postgres 17 on port 5433 (dev + test DBs)
├── docker/init-test-db.sql
├── prisma.config.ts                 # Prisma 7 config (schema path, migrations, seed, URL)
├── prisma/
│   ├── schema.prisma
│   ├── migrations/                  # generated + one hand-written trigger migration
│   └── seed.ts                      # creates the first owner login (idempotent)
├── scripts/
│   ├── reset-owner-password.ts
│   └── restore-rehearsal.sh
├── next.config.ts
├── playwright.config.ts
├── vitest.config.ts
├── .env.example / .env.test (committed, no secrets) / .env (git-ignored)
├── .github/workflows/ci.yml, backup.yml
├── docs/runbook.md, docs/deployment.md
├── src/
│   ├── proxy.ts                     # optimistic route guard (Next 16 "proxy")
│   ├── generated/prisma/            # Prisma client output (git-ignored, regenerated)
│   ├── assets/fonts/                # Noto Sans TTFs for PDFs
│   ├── lib/                         # framework-agnostic utilities (pure where possible)
│   │   ├── db.ts                    # Prisma client singleton + Db type
│   │   ├── errors.ts                # DomainError, ValidationError, ForbiddenError, NotFoundError
│   │   ├── validation.ts            # zod field helpers + parseInput
│   │   ├── money.ts                 # Decimal helpers, INR formatting, amount in words
│   │   ├── time.ts                  # IST helpers, financial year
│   │   ├── gst.ts                   # state codes, GSTIN validation
│   │   ├── auth.ts                  # passwords, session JWT, requireRole
│   │   ├── session.ts               # server-only: read/write session cookie, DB-checked
│   │   ├── action-result.ts         # runAction + toPlain (Decimal → string)
│   │   ├── prisma-errors.ts         # isUniqueConstraintError
│   │   └── spreadsheet.ts           # parse .xlsx/.csv uploads
│   ├── domain/                      # ALL business rules; the only writers of ledgers
│   │   ├── authentication.ts        # authenticate (lockout)
│   │   ├── settings.ts              # business profile, number series setup
│   │   ├── products.ts / customers.ts / users.ts
│   │   ├── stock.ts                 # ledger core, production, adjustment, opening import
│   │   ├── numbering.ts             # allocateNumber (gapless, per FY)
│   │   ├── tax.ts                   # pure GST maths
│   │   ├── billing.ts               # previewBill, createBill
│   │   ├── payments.ts / credit-notes.ts / stock-counts.ts
│   │   ├── irp.ts                   # IRP client interface, mock, queue worker
│   │   ├── reports.ts               # dashboard queries
│   │   └── invoice-view.ts          # one view model for screen, print and PDF
│   ├── actions/                     # "use server" thin wrappers: session → domain → runAction
│   ├── components/ui/               # shadcn/ui (generated)
│   ├── components/                  # app components (pickers, invoice, nav…)
│   └── app/                         # routes (see Tasks 21–26)
└── tests/
    ├── setup/global-setup.ts, per-file-setup.ts
    ├── helpers/db.ts, factories.ts
    ├── lib/*.test.ts, domain/*.test.ts, actions/*.test.ts
    └── e2e/*.spec.ts                # Playwright
```

## Conventions Every Task Follows

- **Shell:** run every command from the repo root (`E:\Trinetra Candles`) in Git Bash. Docker Desktop must be running.
- **Imports** use the `@/` alias (`@/lib/money`). Prisma types come from `@/generated/prisma/client`. If TypeScript says a model type isn't exported from there, look in `src/generated/prisma/`. Prisma 7 splits output into `client.ts`, `models.ts` and `enums.ts`. Import from whichever file exports it.
- **Enums in code** are string literals (`"OWNER"`). Prisma accepts them, and they avoid generated-enum import churn.
- **When a step's actual output differs from "Expected",** stop and fix the cause or report it. Do not edit the test to make it pass unless the step says the test is wrong.
- **Prisma's AI-agent guard.** Prisma 7 refuses destructive commands (`prisma migrate reset`, `prisma db push --accept-data-loss`, or a `migrate dev` that needs a reset) when it detects an AI agent. It asks for `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`. An executing agent must **never set that variable itself**: stop and ask the human. No step in this plan needs a destructive Prisma command. If one seems necessary, something has drifted, so report it.
- **Verified before writing.** The plan's riskiest assumptions were executed during review on Node 24.15, npm 11.17, Prisma 7.10.1 + `@prisma/adapter-pg` against real Postgres, and zod 4.6. They held:
  - concurrent idempotent `createMany({ skipDuplicates })` inside transactions;
  - `P2002` on unique violations;
  - trigger messages surfacing through Prisma, with `TRUNCATE` unaffected;
  - gapless `UPDATE … RETURNING` numbering under rollback and 8-way concurrency;
  - the `FOR UPDATE SKIP LOCKED` claim query;
  - the compound key name `series_financialYear`;
  - `Prisma.Decimal`;
  - zod's `flattenError`/`refine` paths;
  - the GSTIN checksums;
  - `₹1,23,456.50` formatting;
  - IST financial-year boundaries.
- **Commit messages** follow Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).

---

### Task 1: Toolchain, Scaffold, Local Database, Test Harness

**Files:**
- Create (via scaffolder): `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `src/app/*`
- Create: `docker-compose.yml`, `docker/init-test-db.sql`, `.env`, `.env.test`, `.env.example`, `.gitattributes`
- Create: `prisma/schema.prisma`, `prisma.config.ts`, `src/lib/db.ts`
- Create: `vitest.config.ts`, `tests/setup/global-setup.ts`, `tests/setup/per-file-setup.ts`, `tests/helpers/db.ts`
- Test: `tests/lib/db-harness.test.ts`

**Interfaces:**
- Produces: `prisma` and `type Db` from `@/lib/db`. `resetDb()` and `assertTestDatabase(url?)` from `tests/helpers/db.ts`. Every later test file calls `beforeEach(resetDb)`. npm scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`, `db:up`, `db:down`, `db:migrate`, `db:generate`, `db:seed`, `db:studio`.

- [ ] **Step 1: Check prerequisites**

Run:
```bash
node -v && npm -v && docker --version && docker compose version && git --version
```
Expected: Node `v24.x` (or `v22.12+`), npm 11+, Docker 24+, Compose v2. If Node is older, install Node 24 LTS from nodejs.org first.

**If `docker: command not found`** (Docker was not installed on the development PC when this plan was reviewed), pick one:
- **(a) Recommended:** install Docker Desktop for Windows (it works on Windows 11 Home via WSL 2). Reboot, start Docker Desktop, and re-run this step.
- **(b) Without Docker:** install PostgreSQL 17 from https://www.postgresql.org/download/windows/ (EDB installer). Set **port 5433** during setup and remember the `postgres` password. Then run, in a new Git Bash window:
  ```bash
  "/c/Program Files/PostgreSQL/17/bin/psql" -U postgres -p 5433 -c "CREATE ROLE trinetra LOGIN PASSWORD 'trinetra' CREATEDB;" -c "CREATE DATABASE trinetra_dev OWNER trinetra;" -c "CREATE DATABASE trinetra_test OWNER trinetra;"
  ```
  Then skip Steps 5 and 7, since the `.env` URLs in Step 6 already point at `localhost:5433`. In Task 29, run the restore rehearsal with the same `psql`/`pg_restore` binaries instead of `docker exec`.

- [ ] **Step 2: Scaffold Next.js 16 into a temp folder and move it in**

`create-next-app` refuses to run in a folder that already contains `AGENTS.md`, `CLAUDE.md` and `docs/`, so scaffold beside it and copy without overwriting:

```bash
npx create-next-app@16 .scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git --yes
rm -rf .scaffold/node_modules .scaffold/README.md
cp -rn .scaffold/. .
rm -rf .scaffold
npm install
```
Expected: `src/app/page.tsx`, `package.json`, `next.config.ts` and `eslint.config.mjs` now exist at the repo root. `AGENTS.md`, `CLAUDE.md` and `docs/` are untouched (`git status` shows them unmodified).

- [ ] **Step 3: Make the package ESM (required by Prisma 7) and pin the engine**

```bash
npm pkg set type=module
npm pkg set engines.node=">=22.12"
```

- [ ] **Step 4: Install dependencies (exact majors matter)**

```bash
npm install @prisma/client@7 @prisma/adapter-pg@7 pg zod@4 decimal.js bcryptjs@3 jose server-only @react-pdf/renderer@4 qrcode exceljs papaparse
npm install -D prisma@7 typescript@5 tsx dotenv dotenv-cli vitest @vitejs/plugin-react vite-tsconfig-paths @types/pg @types/qrcode @types/papaparse @playwright/test
```
Expected: both commands finish without `ERR!`. Peer-dependency *warnings* are fine.

`typescript@5` is pinned on purpose. TypeScript 7 (the native rewrite) is now npm's `latest`, but keep 5.x until Next.js documents TypeScript 7 support for its build-time type checking.

- [ ] **Step 4b: Approve install scripts (npm 11.16+ warns; npm 12 blocks them)**

```bash
npm approve-scripts --allow-scripts-pending
```
This lists dependencies with install scripts. Expect well-known packages such as `prisma`, `@prisma/engines`, `esbuild`, `sharp` and `unrs-resolver`. If the list contains only packages you recognise from the commands above (or their dependencies), approve them:
```bash
npm approve-scripts --all
```
This writes an `allowScripts` block into `package.json`; commit it. If an unfamiliar package appears, stop and check it before approving.

- [ ] **Step 5: Local Postgres via Docker (dev + test databases)**

Create `docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:17
    container_name: trinetra-db
    environment:
      POSTGRES_USER: trinetra
      POSTGRES_PASSWORD: trinetra
      POSTGRES_DB: trinetra_dev
    ports:
      - "5433:5432"   # 5433 avoids clashing with any Postgres already installed on Windows
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/init-test-db.sql:/docker-entrypoint-initdb.d/init-test-db.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U trinetra -d trinetra_dev"]
      interval: 5s
      timeout: 5s
      retries: 10
volumes:
  pgdata:
```

Create `docker/init-test-db.sql`:
```sql
CREATE DATABASE trinetra_test;
```

- [ ] **Step 6: Environment files**

Generate a secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create `.env` (git-ignored; paste the secret you just generated):
```
DATABASE_URL="postgresql://trinetra:trinetra@localhost:5433/trinetra_dev"
SESSION_SECRET="<paste-64-hex-chars-here>"
BCRYPT_COST="12"
IRP_PROVIDER="mock"
CRON_SECRET="dev-cron-secret-change-me"
SEED_OWNER_NAME="Owner"
SEED_OWNER_PHONE="9999999999"
SEED_OWNER_PASSWORD="change-me-now-123"
```

Create `.env.test` (committed — it only points at the local throwaway test DB):
```
DATABASE_URL="postgresql://trinetra:trinetra@localhost:5433/trinetra_test"
SESSION_SECRET="test-only-secret-that-is-at-least-32-characters-long"
BCRYPT_COST="4"
IRP_PROVIDER="mock"
CRON_SECRET="test-cron-secret"
```

Create `.env.example` (committed): same keys as `.env`, with empty values for `SESSION_SECRET` and `SEED_OWNER_PASSWORD`, and these extra production-only keys documented as comments:
```
# DIRECT_DATABASE_URL=   (production: Neon direct, non-pooled URL used for migrations)
# ALLOW_MOCK_IRP=        (never set in production unless deliberately testing)
```

Edit `.gitignore` (created by the scaffolder): add these lines at the end so the committed env files are not ignored and generated code is:
```
!.env.example
!.env.test
/src/generated/
/test-results/
/playwright-report/
```

Create `.gitattributes` (stops the CRLF warnings seen so far on Windows):
```
* text=auto eol=lf
*.png binary
*.ttf binary
```

- [ ] **Step 7: Start the database**

```bash
npm pkg set scripts.db:up="docker compose up -d --wait db" scripts.db:down="docker compose down"
npm run db:up
docker exec trinetra-db psql -U trinetra -d trinetra_dev -c "SELECT datname FROM pg_database WHERE datname LIKE 'trinetra%';"
```
Expected: two rows, `trinetra_dev` and `trinetra_test`. If only `trinetra_dev` appears, the volume existed before the init script was added. Run `docker compose down -v && npm run db:up`. This deletes local data, which is fine at this stage.

- [ ] **Step 8: Prisma 7 config and empty schema**

Create `prisma.config.ts`:
```typescript
import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations need a direct (non-pooled) connection in production; locally both are the same.
// A placeholder keeps `prisma generate` (which never connects) working in CI before env is set.
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://unset:unset@localhost:5432/unset";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url },
});
```

Create `prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

Run:
```bash
mkdir -p prisma/migrations   # migrate deploy (run by the test harness) expects the folder to exist
npx prisma generate
```
Expected: `Generated Prisma Client ... to ./src/generated/prisma`.

- [ ] **Step 9: Write `src/lib/db.ts`**

```typescript
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

/** Any Prisma handle: the root client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 10: Test harness**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    globalSetup: ["./tests/setup/global-setup.ts"],
    setupFiles: ["./tests/setup/per-file-setup.ts"],
    fileParallelism: false, // all test files share one database
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
```

Create `tests/setup/global-setup.ts` (runs once, applies migrations to the test DB):
```typescript
import { execSync } from "node:child_process";
import { config } from "dotenv";

export default function globalSetup() {
  const parsed = config({ path: ".env.test", override: true }).parsed ?? {};
  if (!parsed.DATABASE_URL?.includes("test")) {
    throw new Error(".env.test DATABASE_URL must point at a database whose name contains 'test'");
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, ...parsed } });
}
```

Create `tests/setup/per-file-setup.ts` (runs in each test worker *before* the test file is imported):
```typescript
import { config } from "dotenv";
import { afterAll, vi } from "vitest";

config({ path: ".env.test", override: true });

// Next.js-only modules that cannot run under Vitest.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

afterAll(async () => {
  const { prisma } = await import("@/lib/db");
  await prisma.$disconnect();
});
```

Create `tests/helpers/db.ts`:
```typescript
import { prisma } from "@/lib/db";

export function assertTestDatabase(url = process.env.DATABASE_URL): void {
  const dbName = url ? new URL(url).pathname.replace("/", "") : "";
  if (!dbName.includes("test")) {
    throw new Error(`Refusing to reset database "${dbName}": tests may only touch a database whose name contains "test"`);
  }
}

/** Empties every application table. Table list is discovered, so it never drifts from the schema. */
export async function resetDb(): Promise<void> {
  assertTestDatabase();
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
```

- [ ] **Step 11: Write the harness test**

```typescript
// tests/lib/db-harness.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, assertTestDatabase } from "../helpers/db";

describe("test harness", () => {
  beforeEach(resetDb);

  it("connects to the test database, not the dev database", async () => {
    const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    expect(rows[0].db).toBe("trinetra_test");
  });

  it("refuses to reset a non-test database", () => {
    expect(() => assertTestDatabase("postgresql://u:p@localhost:5433/trinetra_dev")).toThrow(/Refusing/);
    expect(() => assertTestDatabase("postgresql://u:p@localhost:5433/trinetra_test")).not.toThrow();
  });
});
```

- [ ] **Step 12: npm scripts, lint ignore, Next config**

```bash
npm pkg set scripts.lint="eslint ." scripts.typecheck="tsc --noEmit" scripts.test="vitest run" scripts.test:watch="vitest"
npm pkg set scripts.db:migrate="prisma migrate dev" scripts.db:generate="prisma generate" scripts.db:seed="prisma db seed" scripts.db:studio="prisma studio"
npm pkg set scripts.postinstall="prisma generate"
```

In `eslint.config.mjs`, find the `ignores` array (the scaffolder's config contains one with `.next/**`) and add `"src/generated/**"` to it. If there is no `ignores` entry, add `{ ignores: ["src/generated/**", ".next/**"] }` as the first element of the exported array.

Replace `next.config.ts` with:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packages that must run as plain Node modules on the server (native-ish or large).
  serverExternalPackages: ["@react-pdf/renderer", "exceljs", "pg"],
  // Fonts are read from disk by the PDF route; make sure they ship with the deployment.
  outputFileTracingIncludes: {
    "/api/bills/[id]/pdf": ["./src/assets/fonts/**"],
  },
};

export default nextConfig;
```

- [ ] **Step 13: Verify everything**

```bash
npm test
npm run typecheck
npm run lint
npm run dev
```
Expected: 2 tests PASS (global setup prints "No pending migrations to apply" or similar). Typecheck and lint pass. `npm run dev` serves the default Next.js page at http://localhost:3000. Stop it with Ctrl+C.

- [ ] **Step 14: Commit**

```bash
git add -A
git status   # confirm .env is NOT listed and src/generated/ is NOT listed
git commit -m "chore: scaffold Next.js 16, Prisma 7, Docker Postgres and Vitest harness"
```

---

### Task 2: Database Schema (all Phase 1 tables)

The schema is one cohesive unit: relations cross every table, so it ships as one migration. Every later task relies on these exact model and field names.

**Files:**
- Modify: `prisma/schema.prisma`
- Create (generated): `prisma/migrations/<timestamp>_init/migration.sql`
- Test: `tests/domain/schema.test.ts`

**Interfaces:**
- Produces: models `User`, `BusinessProfile`, `Customer`, `Product`, `StockLedgerEntry`, `NumberSeries`, `Bill`, `BillLineItem`, `PaymentLogEntry`, `CreditNote`, `CreditNoteLine`, `StockCount`, `IrpSubmission`; enums `Role`, `ActorType`, `StockLedgerType`, `PaymentMethod`. `NumberSeries.series` and `IrpSubmission.status`/`documentType` are deliberately plain `String` because raw SQL touches them (Tasks 9 and 19), and Postgres enum columns would need casts there.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/domain/schema.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "../helpers/db";

describe("schema", () => {
  beforeEach(resetDb);

  it("stores a full bill graph: customer, product, bill, line, ledger, payment, credit note, IRP job", async () => {
    const user = await prisma.user.create({ data: { name: "Owner", phone: "9000000001", passwordHash: "x", role: "OWNER" } });
    const customer = await prisma.customer.create({ data: { name: "Ramesh Traders", billingAddress: "Market Rd, Cuttack", stateCode: "21" } });
    const product = await prisma.product.create({
      data: { sku: "LJC-01", name: "Lavender Jar Candle", hsnCode: "3406", unitPrice: "150.00", gstRate: "18.00" },
    });
    await prisma.numberSeries.create({ data: { series: "INVOICE", financialYear: "2026-27", prefix: "TC" } });

    const bill = await prisma.bill.create({
      data: {
        invoiceNumber: "TC/2627/00001", financialYear: "2026-27", customerId: customer.id,
        customerName: customer.name, customerAddress: customer.billingAddress, customerStateCode: "21",
        supplierLegalName: "Trinetra Candles", supplierGstin: "21AAAAA0000A1ZE", supplierAddress: "Factory Rd", supplierStateCode: "21",
        placeOfSupply: "21", grossTotal: "150.00", discountTotal: "0.00", taxableTotal: "150.00",
        cgstTotal: "13.50", sgstTotal: "13.50", igstTotal: "0.00", taxTotal: "27.00", roundOff: "0.00", grandTotal: "177.00",
        createdBy: user.id, idempotencyKey: "schema-bill-1",
        lineItems: {
          create: [{
            lineNo: 1, productId: product.id, productName: product.name, productSku: product.sku, hsnCode: "3406", unit: "pcs",
            quantity: "1.00", unitPrice: "150.00", taxableValue: "150.00", gstRate: "18.00",
            cgstAmount: "13.50", sgstAmount: "13.50", igstAmount: "0.00", lineTotal: "177.00",
          }],
        },
        payments: { create: [{ amount: "177.00", method: "CASH", recordedBy: user.id, idempotencyKey: "schema-pay-1" }] },
      },
      include: { lineItems: true, payments: true },
    });

    await prisma.stockLedgerEntry.create({
      data: { productId: product.id, quantityDelta: "-1.00", type: "BILLED", createdBy: user.id, idempotencyKey: "schema-led-1" },
    });
    const note = await prisma.creditNote.create({
      data: {
        creditNoteNumber: "CN/2627/00001", financialYear: "2026-27", billId: bill.id, reason: "Damaged", restock: false,
        taxableTotal: "150.00", cgstTotal: "13.50", sgstTotal: "13.50", igstTotal: "0.00", taxTotal: "27.00",
        roundOff: "0.00", grandTotal: "177.00", createdBy: user.id, idempotencyKey: "schema-cn-1",
        lines: {
          create: [{
            billLineItemId: bill.lineItems[0].id, productId: product.id, quantity: "1.00", taxableValue: "150.00",
            cgstAmount: "13.50", sgstAmount: "13.50", igstAmount: "0.00", lineTotal: "177.00",
          }],
        },
      },
    });
    const job = await prisma.irpSubmission.create({ data: { documentType: "INVOICE", billId: bill.id } });

    expect(bill.lineItems).toHaveLength(1);
    expect(bill.payments[0].amount.toString()).toBe("177");
    expect(note.restock).toBe(false);
    expect(job.status).toBe("PENDING");
  });

  it("enforces unique idempotency keys on ledger rows", async () => {
    const product = await prisma.product.create({
      data: { sku: "RJC-01", name: "Rose Jar Candle", hsnCode: "3406", unitPrice: "150.00", gstRate: "18.00" },
    });
    const row = { productId: product.id, quantityDelta: "5.00", type: "PRODUCED" as const, createdBy: "u1", idempotencyKey: "dup-key" };
    await prisma.stockLedgerEntry.create({ data: row });
    await expect(prisma.stockLedgerEntry.create({ data: row })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/schema.test.ts`
Expected: FAIL. TypeScript/Vitest reports that `prisma.user` (and the other models) don't exist.

- [ ] **Step 3: Write the schema**

Replace `prisma/schema.prisma` with:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum Role {
  OWNER
  WORKER
}

enum ActorType {
  HUMAN
  AGENT
}

enum StockLedgerType {
  OPENING
  PRODUCED
  BILLED
  RETURN
  ADJUSTMENT
}

enum PaymentMethod {
  CASH
  UPI
  BANK_TRANSFER
  CHEQUE
  CARD
  OTHER
}

model User {
  id                 String    @id @default(cuid())
  name               String
  phone              String    @unique
  passwordHash       String
  role               Role
  isActive           Boolean   @default(true)
  sessionVersion     Int       @default(0)
  mustChangePassword Boolean   @default(false)
  failedLoginCount   Int       @default(0)
  lockedUntil        DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@map("users")
}

model BusinessProfile {
  id                   String   @id @default("default")
  legalName            String
  tradeName            String?
  gstin                String
  stateCode            String
  addressLine1         String
  addressLine2         String?
  city                 String
  pincode              String
  phone                String
  email                String?
  upiId                String?
  bankDetails          String?
  invoiceTerms         String?
  einvoicingApplicable Boolean  @default(false)
  updatedAt            DateTime @updatedAt

  @@map("business_profile")
}

model Customer {
  id             String   @id @default(cuid())
  name           String
  phone          String?
  gstin          String?  @unique
  billingAddress String
  stateCode      String
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  bills          Bill[]

  @@index([name])
  @@map("customers")
}

model Product {
  id                 String             @id @default(cuid())
  sku                String             @unique
  name               String
  unit               String             @default("pcs")
  hsnCode            String
  unitPrice          Decimal            @db.Decimal(12, 2)
  gstRate            Decimal            @db.Decimal(5, 2)
  reorderLevel       Decimal            @default(0) @db.Decimal(12, 2)
  isActive           Boolean            @default(true)
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
  stockLedgerEntries StockLedgerEntry[]
  stockCounts        StockCount[]
  billLineItems      BillLineItem[]

  @@index([name])
  @@map("products")
}

model StockLedgerEntry {
  id              String          @id @default(cuid())
  productId       String
  product         Product         @relation(fields: [productId], references: [id])
  quantityDelta   Decimal         @db.Decimal(12, 2)
  type            StockLedgerType
  reason          String?
  sourceReference String?
  createdBy       String
  actorType       ActorType       @default(HUMAN)
  sourceMetadata  Json?
  idempotencyKey  String          @unique
  createdAt       DateTime        @default(now())

  @@index([productId, createdAt])
  @@map("stock_ledger")
}

model NumberSeries {
  series        String // "INVOICE" | "CREDIT_NOTE"
  financialYear String // "2026-27"
  prefix        String
  nextSerial    Int      @default(1)
  createdAt     DateTime @default(now())

  @@id([series, financialYear])
  @@map("number_series")
}

model Bill {
  id                String            @id @default(cuid())
  invoiceNumber     String            @unique
  financialYear     String
  billDate          DateTime          @default(now())
  customerId        String
  customer          Customer          @relation(fields: [customerId], references: [id])
  customerName      String
  customerGstin     String?
  customerAddress   String
  customerStateCode String
  customerPhone     String?
  supplierLegalName String
  supplierGstin     String
  supplierAddress   String
  supplierStateCode String
  placeOfSupply     String
  deliveryAddress   String            @default("")
  reverseCharge     Boolean           @default(false)
  grossTotal        Decimal           @db.Decimal(12, 2)
  discountTotal     Decimal           @db.Decimal(12, 2)
  taxableTotal      Decimal           @db.Decimal(12, 2)
  cgstTotal         Decimal           @db.Decimal(12, 2)
  sgstTotal         Decimal           @db.Decimal(12, 2)
  igstTotal         Decimal           @db.Decimal(12, 2)
  taxTotal          Decimal           @db.Decimal(12, 2)
  roundOff          Decimal           @db.Decimal(12, 2)
  grandTotal        Decimal           @db.Decimal(12, 2)
  notes             String?
  createdBy         String
  actorType         ActorType         @default(HUMAN)
  sourceMetadata    Json?
  idempotencyKey    String            @unique
  createdAt         DateTime          @default(now())
  lineItems         BillLineItem[]
  payments          PaymentLogEntry[]
  creditNotes       CreditNote[]
  irpSubmission     IrpSubmission?

  @@index([customerId])
  @@index([billDate])
  @@map("bills")
}

model BillLineItem {
  id                String           @id @default(cuid())
  billId            String
  bill              Bill             @relation(fields: [billId], references: [id])
  lineNo            Int
  productId         String
  product           Product          @relation(fields: [productId], references: [id])
  productName       String
  productSku        String
  hsnCode           String
  unit              String
  quantity          Decimal          @db.Decimal(12, 2)
  unitPrice         Decimal          @db.Decimal(12, 2)
  discountAmount    Decimal          @default(0) @db.Decimal(12, 2)
  taxableValue      Decimal          @db.Decimal(12, 2)
  gstRate           Decimal          @db.Decimal(5, 2)
  cgstAmount        Decimal          @db.Decimal(12, 2)
  sgstAmount        Decimal          @db.Decimal(12, 2)
  igstAmount        Decimal          @db.Decimal(12, 2)
  lineTotal         Decimal          @db.Decimal(12, 2)
  shortfallQuantity Decimal?         @db.Decimal(12, 2)
  creditNoteLines   CreditNoteLine[]

  @@unique([billId, lineNo])
  @@map("bill_line_items")
}

model PaymentLogEntry {
  id             String        @id @default(cuid())
  billId         String
  bill           Bill          @relation(fields: [billId], references: [id])
  amount         Decimal       @db.Decimal(12, 2) // negative = refund
  method         PaymentMethod
  reference      String?
  note           String?
  paidAt         DateTime      @default(now())
  recordedBy     String
  actorType      ActorType     @default(HUMAN)
  idempotencyKey String        @unique
  createdAt      DateTime      @default(now())

  @@index([billId])
  @@map("payment_log")
}

model CreditNote {
  id               String           @id @default(cuid())
  creditNoteNumber String           @unique
  financialYear    String
  noteDate         DateTime         @default(now())
  billId           String
  bill             Bill             @relation(fields: [billId], references: [id])
  reason           String
  restock          Boolean
  taxableTotal     Decimal          @db.Decimal(12, 2)
  cgstTotal        Decimal          @db.Decimal(12, 2)
  sgstTotal        Decimal          @db.Decimal(12, 2)
  igstTotal        Decimal          @db.Decimal(12, 2)
  taxTotal         Decimal          @db.Decimal(12, 2)
  roundOff         Decimal          @db.Decimal(12, 2)
  grandTotal       Decimal          @db.Decimal(12, 2)
  createdBy        String
  actorType        ActorType        @default(HUMAN)
  idempotencyKey   String           @unique
  createdAt        DateTime         @default(now())
  lines            CreditNoteLine[]
  irpSubmission    IrpSubmission?

  @@index([billId])
  @@map("credit_notes")
}

model CreditNoteLine {
  id             String       @id @default(cuid())
  creditNoteId   String
  creditNote     CreditNote   @relation(fields: [creditNoteId], references: [id])
  billLineItemId String
  billLineItem   BillLineItem @relation(fields: [billLineItemId], references: [id])
  productId      String
  quantity       Decimal      @db.Decimal(12, 2)
  taxableValue   Decimal      @db.Decimal(12, 2)
  cgstAmount     Decimal      @db.Decimal(12, 2)
  sgstAmount     Decimal      @db.Decimal(12, 2)
  igstAmount     Decimal      @db.Decimal(12, 2)
  lineTotal      Decimal      @db.Decimal(12, 2)

  @@index([billLineItemId])
  @@map("credit_note_lines")
}

model StockCount {
  id               String    @id @default(cuid())
  productId        String
  product          Product   @relation(fields: [productId], references: [id])
  countedQuantity  Decimal   @db.Decimal(12, 2)
  expectedQuantity Decimal   @db.Decimal(12, 2)
  note             String?
  countedBy        String
  countedAt        DateTime  @default(now())
  approvedBy       String?
  approvedAt       DateTime?
  appliedDelta     Decimal?  @db.Decimal(12, 2)
  discardedBy      String?
  discardedAt      DateTime?

  @@index([productId])
  @@map("stock_counts")
}

model IrpSubmission {
  id            String      @id @default(cuid())
  documentType  String // "INVOICE" | "CREDIT_NOTE"
  billId        String?     @unique
  bill          Bill?       @relation(fields: [billId], references: [id])
  creditNoteId  String?     @unique
  creditNote    CreditNote? @relation(fields: [creditNoteId], references: [id])
  status        String      @default("PENDING") // PENDING | SUBMITTING | ACCEPTED | REJECTED | FAILED
  attemptCount  Int         @default(0)
  nextAttemptAt DateTime    @default(now())
  lastError     String?
  irn           String?
  ackNumber     String?
  ackDate       DateTime?
  signedQrCode  String?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@index([status, nextAttemptAt])
  @@map("irp_submissions")
}
```

- [ ] **Step 4: Create the migration and regenerate the client**

```bash
npx prisma migrate dev --name init
npx prisma generate
```
Expected: `migrations/<timestamp>_init/migration.sql` is created and applied to `trinetra_dev`, and the client regenerates. (Prisma 7's `migrate dev` no longer runs `generate` itself, so run it explicitly.)

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS. Global setup applies the `init` migration to `trinetra_test` first.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck && npm run lint
git add prisma tests/domain/schema.test.ts
git commit -m "feat: add Phase 1 database schema"
```

---

### Task 3: Database-Enforced Ledger Immutability

The spec requires posted ledger rows to be immutable "in code *and* in database permissions". A trigger makes the database itself reject `UPDATE`/`DELETE`, so no bug, script or future agent can silently rewrite history. `TRUNCATE`, used only by the test reset, is unaffected.

**Files:**
- Create: `prisma/migrations/<timestamp>_ledger_immutability/migration.sql` (hand-written)
- Test: `tests/domain/immutability.test.ts`

**Interfaces:**
- Produces: any `UPDATE`/`DELETE` on `stock_ledger`, `payment_log`, `bills`, `bill_line_items`, `credit_notes` or `credit_note_lines` fails with a message containing `immutable`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/domain/immutability.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "../helpers/db";

describe("ledger immutability", () => {
  beforeEach(resetDb);

  it("rejects UPDATE and DELETE on stock_ledger rows", async () => {
    const product = await prisma.product.create({
      data: { sku: "IMM-1", name: "Test Candle", hsnCode: "3406", unitPrice: "10.00", gstRate: "18.00" },
    });
    const entry = await prisma.stockLedgerEntry.create({
      data: { productId: product.id, quantityDelta: "5.00", type: "PRODUCED", createdBy: "u1", idempotencyKey: "imm-1" },
    });

    await expect(
      prisma.stockLedgerEntry.update({ where: { id: entry.id }, data: { quantityDelta: "500.00" } })
    ).rejects.toThrow(/immutable/);
    await expect(prisma.stockLedgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/immutable/);

    const reread = await prisma.stockLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(reread.quantityDelta.toString()).toBe("5");
  });

  it("still allows normal updates on mutable tables (products)", async () => {
    const product = await prisma.product.create({
      data: { sku: "IMM-2", name: "Old Name", hsnCode: "3406", unitPrice: "10.00", gstRate: "18.00" },
    });
    const updated = await prisma.product.update({ where: { id: product.id }, data: { name: "New Name" } });
    expect(updated.name).toBe("New Name");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/immutability.test.ts`
Expected: FAIL. The first test's `update` succeeds instead of rejecting.

- [ ] **Step 3: Create an empty migration and write the trigger SQL**

```bash
npx prisma migrate dev --create-only --name ledger_immutability
```
Open the newly created `prisma/migrations/<timestamp>_ledger_immutability/migration.sql` (currently empty or a comment) and replace its contents with:

```sql
-- Posted ledger rows are append-only. Corrections must be new compensating rows.
CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are immutable; append a compensating entry instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_ledger_immutable BEFORE UPDATE OR DELETE ON "stock_ledger"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER payment_log_immutable BEFORE UPDATE OR DELETE ON "payment_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER bills_immutable BEFORE UPDATE OR DELETE ON "bills"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER bill_line_items_immutable BEFORE UPDATE OR DELETE ON "bill_line_items"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER credit_notes_immutable BEFORE UPDATE OR DELETE ON "credit_notes"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER credit_note_lines_immutable BEFORE UPDATE OR DELETE ON "credit_note_lines"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
```

Apply it:
```bash
npx prisma migrate dev
```
Expected: `Applying migration <timestamp>_ledger_immutability`. If Prisma says the schema is in sync and offers to create another migration, decline. The SQL migration is intentionally not reflected in `schema.prisma` (Prisma has no trigger syntax).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS, including the immutability tests and all earlier tests (`resetDb` uses TRUNCATE, which these row triggers do not block).

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations tests/domain/immutability.test.ts
git commit -m "feat: enforce ledger immutability with database triggers"
```

---

### Task 4: Core Libraries — Errors, Validation, Money, Time, GST

Pure, database-free building blocks. Getting these exactly right removes whole classes of bugs later: floating-point money, UTC dates, and bad GSTINs.

**Files:**
- Create: `src/lib/errors.ts`, `src/lib/validation.ts`, `src/lib/money.ts`, `src/lib/time.ts`, `src/lib/gst.ts`
- Test: `tests/lib/money.test.ts`, `tests/lib/time.test.ts`, `tests/lib/gst.test.ts`, `tests/lib/validation.test.ts`

**Interfaces:**
- Produces:
  - `errors.ts`: `DomainError(code, message)`, `ValidationError(message, fieldErrors?)` (code `VALIDATION`), `ForbiddenError(message?)` (code `FORBIDDEN`), `NotFoundError(what)` (code `NOT_FOUND`).
  - `money.ts`: `D(value)`, `ZERO`, `round2`, `sumDecimals`, `toFixed2`, `roundToRupee` → `{ rounded, roundOff }`, `formatINR`, `formatQuantity`, `amountInWords`.
  - `time.ts`: `IST_TIMEZONE`, `istDateParts(date)`, `financialYearOf(date?)` → `"2026-27"`, `financialYearShort("2026-27")` → `"2627"`, `istDayRange(date?)` → `{ start, end }`, `formatDateIN(date)` → `"20-10-2026"`.
  - `gst.ts`: `GST_STATES` (code → name), `isValidStateCode`, `stateName`, `isValidGstin`, `gstinCheckCharacter`, `stateCodeFromGstin`, `isValidHsn`.
  - `validation.ts`: zod field helpers `quantity`, `nonNegativeQuantity`, `signedQuantity`, `money`, `positiveMoney`, `signedMoney`, `entityId`, `idempotencyKey`, `requiredText(label, max?)`, `optionalText(max?)`, `phone`, `stateCode`, `optionalGstin`, `hsnCode`, `gstRate`; and `parseInput(schema, input)`, which throws `ValidationError`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/money.test.ts
import { describe, it, expect } from "vitest";
import { D, round2, sumDecimals, roundToRupee, formatINR, amountInWords, toFixed2 } from "@/lib/money";

describe("money", () => {
  it("rounds half up to 2 dp", () => {
    expect(round2("10.005").toFixed(2)).toBe("10.01");
    expect(round2("10.004").toFixed(2)).toBe("10.00");
  });
  it("adds without floating-point drift", () => {
    expect(sumDecimals(["0.10", "0.20"]).toFixed(2)).toBe("0.30");
  });
  it("accepts Prisma-style Decimal objects via toString()", () => {
    expect(D({ toString: () => "12.50" }).toFixed(2)).toBe("12.50");
  });
  it("rounds to the nearest rupee and reports the round-off", () => {
    const a = roundToRupee("39.33");
    expect(a.rounded.toFixed(2)).toBe("39.00");
    expect(a.roundOff.toFixed(2)).toBe("-0.33");
    expect(roundToRupee("39.50").rounded.toFixed(2)).toBe("40.00");
  });
  it("formats Indian currency with lakh grouping", () => {
    expect(formatINR("123456.5")).toBe("₹1,23,456.50");
  });
  it("writes amounts in Indian words", () => {
    expect(amountInWords("1180")).toBe("One Thousand One Hundred Eighty Rupees Only");
    expect(amountInWords("123456789.50")).toBe(
      "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Rupees and Fifty Paise Only"
    );
    expect(amountInWords("0")).toBe("Zero Rupees Only");
  });
  it("formats to a 2dp string for database writes", () => {
    expect(toFixed2("7")).toBe("7.00");
  });
});
```

```typescript
// tests/lib/time.test.ts
import { describe, it, expect } from "vitest";
import { financialYearOf, financialYearShort, istDayRange, formatDateIN } from "@/lib/time";

describe("time (IST)", () => {
  it("maps mid-year dates to the FY that started in April", () => {
    expect(financialYearOf(new Date("2026-10-20T06:00:00Z"))).toBe("2026-27");
    expect(financialYearOf(new Date("2027-02-15T06:00:00Z"))).toBe("2026-27");
  });
  it("uses IST, not UTC, at the 1 April boundary", () => {
    // 2027-03-31 19:00 UTC is 2027-04-01 00:30 IST → new financial year
    expect(financialYearOf(new Date("2027-03-31T19:00:00Z"))).toBe("2027-28");
  });
  it("shortens FY labels for invoice serials", () => {
    expect(financialYearShort("2026-27")).toBe("2627");
    expect(() => financialYearShort("2026")).toThrow();
  });
  it("computes the IST calendar day as a UTC range", () => {
    const { start, end } = istDayRange(new Date("2026-10-20T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-19T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-20T18:30:00.000Z");
  });
  it("formats dates as dd-mm-yyyy in IST", () => {
    expect(formatDateIN(new Date("2026-10-19T20:00:00Z"))).toBe("20-10-2026");
  });
});
```

```typescript
// tests/lib/gst.test.ts
import { describe, it, expect } from "vitest";
import { isValidGstin, gstinCheckCharacter, stateCodeFromGstin, isValidStateCode, stateName, isValidHsn } from "@/lib/gst";

describe("gst", () => {
  it("computes the GSTIN check character (mod-36)", () => {
    expect(gstinCheckCharacter("27AAPFU0939F1Z")).toBe("V");
    expect(gstinCheckCharacter("21AAAAA0000A1Z")).toBe("E");
    expect(gstinCheckCharacter("21BBBBB1111B1Z")).toBe("Z");
  });
  it("validates GSTIN format and checksum", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false); // bad checksum
    expect(isValidGstin("27AAPFU0939F1V")).toBe(false);  // too short
    expect(isValidGstin("99AAPFU0939F1ZV")).toBe(false); // unknown state
  });
  it("derives the state from a GSTIN", () => {
    expect(stateCodeFromGstin("21AAAAA0000A1ZE")).toBe("21");
    expect(stateName("21")).toBe("Odisha");
    expect(isValidStateCode("27")).toBe(true);
    expect(isValidStateCode("XX")).toBe(false);
  });
  it("accepts 4, 6 or 8 digit HSN codes only", () => {
    expect(isValidHsn("3406")).toBe(true);
    expect(isValidHsn("340600")).toBe(true);
    expect(isValidHsn("34060010")).toBe(true);
    expect(isValidHsn("34060")).toBe(false);
    expect(isValidHsn("ABCD")).toBe(false);
  });
});
```

```typescript
// tests/lib/validation.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseInput, quantity, signedMoney, phone, optionalGstin } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";

describe("validation", () => {
  const schema = z.object({ qty: quantity, amount: signedMoney, mobile: phone, gstin: optionalGstin });

  it("normalises valid input", () => {
    const out = parseInput(schema, { qty: "1,200", amount: -50, mobile: "+91 98765 43210", gstin: " 27aapfu0939f1zv " });
    expect(out).toEqual({ qty: "1200", amount: "-50", mobile: "9876543210", gstin: "27AAPFU0939F1ZV" });
  });

  it("treats an empty GSTIN as absent", () => {
    expect(parseInput(schema, { qty: "1", amount: "5", mobile: "9876543210", gstin: "" }).gstin).toBeUndefined();
  });

  it("throws ValidationError with a readable message and field errors", () => {
    try {
      parseInput(schema, { qty: "0", amount: "5", mobile: "9876543210" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toMatch(/greater than 0/);
      expect((e as ValidationError).fieldErrors.qty?.[0]).toMatch(/greater than 0/);
    }
  });

  it("rejects more than 2 decimals and non-numbers", () => {
    expect(() => parseInput(z.object({ q: quantity }), { q: "1.005" })).toThrow(ValidationError);
    expect(() => parseInput(z.object({ q: quantity }), { q: "abc" })).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Write `src/lib/errors.ts`**

```typescript
export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  readonly fieldErrors: Record<string, string[]>;
  constructor(message: string, fieldErrors: Record<string, string[]> = {}) {
    super("VALIDATION", message);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You do not have permission to do this.") {
    super("FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super("NOT_FOUND", `${what} was not found.`);
    this.name = "NotFoundError";
  }
}
```

- [ ] **Step 4: Write `src/lib/money.ts`**

```typescript
import Decimal from "decimal.js";

export type DecimalInput = Decimal.Value | { toString(): string };

/** Converts strings, numbers, decimal.js values and Prisma Decimal objects into decimal.js. */
export function D(value: DecimalInput): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "object" && value !== null) return new Decimal(value.toString());
  return new Decimal(value);
}

export const ZERO = new Decimal(0);

export function round2(value: DecimalInput): Decimal {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function sumDecimals(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0));
}

/** The canonical way to hand a money/quantity value to Prisma. */
export function toFixed2(value: DecimalInput): string {
  return round2(value).toFixed(2);
}

export function roundToRupee(value: DecimalInput): { rounded: Decimal; roundOff: Decimal } {
  const exact = round2(value);
  const rounded = exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { rounded, roundOff: rounded.minus(exact) };
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatINR(value: DecimalInput): string {
  return inr.format(round2(value).toNumber());
}

export function formatQuantity(value: DecimalInput): string {
  return round2(value).toString(); // "12.5", "12", "-3"
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  const unit = n % 10;
  return unit ? `${TENS[Math.floor(n / 10)]} ${ONES[unit]}` : TENS[Math.floor(n / 10)];
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

function integerToIndianWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const rest = n % 1_000;
  return [
    crore ? `${integerToIndianWords(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    rest ? belowThousand(rest) : "",
  ].filter(Boolean).join(" ");
}

export function amountInWords(value: DecimalInput): string {
  const amount = round2(value).abs();
  const rupees = amount.floor();
  const paise = amount.minus(rupees).times(100).toNumber();
  const paiseWords = paise ? ` and ${belowHundred(paise)} Paise` : "";
  return `${integerToIndianWords(rupees.toNumber())} Rupees${paiseWords} Only`;
}
```

- [ ] **Step 5: Write `src/lib/time.ts`**

```typescript
export const IST_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1000;

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

export function istDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = partsFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Indian financial year (April–March) in IST, e.g. "2026-27". */
export function financialYearOf(date: Date = new Date()): string {
  const { year, month } = istDateParts(date);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function financialYearShort(financialYear: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(financialYear);
  if (!match) throw new Error(`Invalid financial year "${financialYear}"`);
  return `${match[1].slice(2)}${match[2]}`;
}

export function istDayRange(date: Date = new Date()): { start: Date; end: Date } {
  const { year, month, day } = istDateParts(date);
  const start = new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function formatDateIN(date: Date): string {
  const { year, month, day } = istDateParts(date);
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
}
```

- [ ] **Step 6: Write `src/lib/gst.ts`**

```typescript
/** GST state/UT codes (as used in GSTINs and e-invoice place of supply). Verify against the GST portal list. */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "97": "Other Territory",
};

export function isValidStateCode(code: string): boolean {
  return Object.hasOwn(GST_STATES, code);
}

export function stateName(code: string): string {
  return GST_STATES[code] ?? code;
}

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Mod-36 check character over the first 14 characters (the algorithm the GST system uses). */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export function isValidGstin(gstin: string): boolean {
  if (!GSTIN_PATTERN.test(gstin)) return false;
  if (!isValidStateCode(gstin.slice(0, 2))) return false;
  return gstinCheckCharacter(gstin.slice(0, 14)) === gstin[14];
}

export function stateCodeFromGstin(gstin: string): string {
  return gstin.slice(0, 2);
}

export function isValidHsn(hsn: string): boolean {
  return /^\d{4}(\d{2}){0,2}$/.test(hsn);
}
```

- [ ] **Step 7: Write `src/lib/validation.ts`**

```typescript
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { isValidGstin, isValidHsn, isValidStateCode } from "@/lib/gst";

const DECIMAL_2DP = /^-?\d{1,10}(\.\d{1,2})?$/;

function decimalField(message: string, check: (n: number) => boolean) {
  return z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(/,/g, ""))
    .refine((v) => DECIMAL_2DP.test(v) && check(Number(v)), message);
}

export const quantity = decimalField("Enter a quantity greater than 0 (up to 2 decimals).", (n) => n > 0);
export const nonNegativeQuantity = decimalField("Enter 0 or more (up to 2 decimals).", (n) => n >= 0);
export const signedQuantity = decimalField("Enter a non-zero quantity, e.g. -3 or 5.", (n) => n !== 0);
export const money = decimalField("Enter an amount of 0 or more (up to 2 decimals).", (n) => n >= 0);
export const positiveMoney = decimalField("Enter an amount greater than 0.", (n) => n > 0);
export const signedMoney = decimalField("Enter a non-zero amount (use minus for a refund).", (n) => n !== 0);
export const gstRate = decimalField("GST rate must be between 0 and 40.", (n) => n >= 0 && n <= 40);

export const entityId = z.string().trim().min(1, "Required");
export const idempotencyKey = z.string().trim().min(8).max(200);

export const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const optionalText = (max = 500) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const phone = z
  .string()
  .transform((v) => v.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, ""))
  .refine((v) => /^[6-9]\d{9}$/.test(v), "Enter a 10-digit mobile number");

export const stateCode = z.string().trim().refine(isValidStateCode, "Choose a state");

export const optionalGstin = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || isValidGstin(v), "GSTIN is not valid. Check for typos.");

export const hsnCode = z.string().trim().refine(isValidHsn, "HSN must be 4, 6 or 8 digits");

/** Validates and normalises input, throwing a ValidationError with a readable first message. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const flat = z.flattenError(result.error);
    throw new ValidationError(
      result.error.issues[0]?.message ?? "Some details are not valid.",
      flat.fieldErrors as Record<string, string[]>
    );
  }
  return result.data;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/lib`
Expected: PASS. If `formatINR` fails only on the currency symbol or spacing, the Node build lacks full ICU data. Node 24 from nodejs.org ships full ICU, so check `node -p "process.versions.icu"` and use the official build.

- [ ] **Step 9: Commit**

```bash
npm run typecheck && npm run lint
git add src/lib tests/lib
git commit -m "feat: add core money, time, GST and validation libraries"
```

---

### Task 5: Authentication — Passwords, Session Tokens, Lockout, DB-Checked Sessions

Login is by **mobile number + password**, because workers may not have email. The session is a signed JWT in an httpOnly cookie. On every request, `getSession()` also checks the database, so deactivating a worker or resetting their password takes effect immediately via the `sessionVersion` bump.

**Files:**
- Create: `src/lib/auth.ts`, `src/domain/authentication.ts`, `src/lib/session.ts`
- Test: `tests/lib/auth.test.ts`, `tests/domain/authentication.test.ts`, `tests/lib/session.test.ts`

**Interfaces:**
- Consumes: `User` model (Task 2), `phone` validator (Task 4), `ForbiddenError` (Task 4).
- Produces:
  - `auth.ts` (pure; safe to import from `proxy.ts`): `type Role`, `type SessionClaims = { userId; role; sessionVersion }`, `type Session = { userId; role; name; mustChangePassword }`, `SESSION_COOKIE = "tc_session"`, `SESSION_TTL_SECONDS`, `hashPassword`, `verifyPassword`, `signSessionToken(claims)`, `verifySessionToken(token)` → `SessionClaims | null`, `requireRole(session, allowed)` (assertion function; throws `ForbiddenError`).
  - `authentication.ts`: `authenticate(phone, password, now?)` → `{ ok: true, claims } | { ok: false, error }`. Locks for 15 minutes after 5 failures. Messages never reveal whether the number exists.
  - `session.ts` (server-only): `getSession()` → `Session | null` (JWT valid + user active + `sessionVersion` matches), `setSessionCookie(claims)`, `clearSessionCookie()`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/auth.test.ts
import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken, requireRole } from "@/lib/auth";
import { ForbiddenError } from "@/lib/errors";

describe("auth primitives", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("round-trips session claims", async () => {
    const token = await signSessionToken({ userId: "u1", role: "WORKER", sessionVersion: 3 });
    expect(await verifySessionToken(token)).toEqual({ userId: "u1", role: "WORKER", sessionVersion: 3 });
  });

  it("rejects tampered tokens and tokens signed with another key", async () => {
    const token = await signSessionToken({ userId: "u1", role: "OWNER", sessionVersion: 0 });
    expect(await verifySessionToken(token.slice(0, -2) + "xx")).toBeNull();
    const forged = await new SignJWT({ role: "OWNER", sv: 0 })
      .setProtectedHeader({ alg: "HS256" }).setSubject("u1").setExpirationTime("1h")
      .sign(new TextEncoder().encode("some-other-secret-that-is-32-chars-long!!"));
    expect(await verifySessionToken(forged)).toBeNull();
  });

  it("requireRole blocks missing sessions and wrong roles", () => {
    const worker = { userId: "u1", role: "WORKER" as const, name: "W", mustChangePassword: false };
    expect(() => requireRole(null, ["OWNER", "WORKER"])).toThrow(ForbiddenError);
    expect(() => requireRole(worker, ["OWNER"])).toThrow(ForbiddenError);
    expect(() => requireRole(worker, ["OWNER", "WORKER"])).not.toThrow();
  });
});
```

```typescript
// tests/domain/authentication.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { authenticate, MAX_FAILED_LOGINS } from "@/domain/authentication";
import { resetDb } from "../helpers/db";

async function createUser(isActive = true) {
  return prisma.user.create({
    data: { name: "Worker", phone: "9876543210", passwordHash: await hashPassword("secret-pass-1"), role: "WORKER", isActive },
  });
}

describe("authenticate", () => {
  beforeEach(resetDb);

  it("accepts the right phone (in any common format) and password", async () => {
    const user = await createUser();
    const result = await authenticate("+91 98765 43210", "secret-pass-1");
    expect(result).toEqual({ ok: true, claims: { userId: user.id, role: "WORKER", sessionVersion: 0 } });
  });

  it("gives the same generic error for wrong password and unknown phone", async () => {
    await createUser();
    const wrongPassword = await authenticate("9876543210", "nope");
    const unknownPhone = await authenticate("9123456789", "nope");
    expect(wrongPassword).toEqual({ ok: false, error: "Wrong phone number or password." });
    expect(unknownPhone).toEqual(wrongPassword);
  });

  it("rejects deactivated users", async () => {
    await createUser(false);
    expect((await authenticate("9876543210", "secret-pass-1")).ok).toBe(false);
  });

  it("locks the account after repeated failures, even for the right password", async () => {
    await createUser();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await authenticate("9876543210", "nope");
    const locked = await authenticate("9876543210", "secret-pass-1");
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error).toMatch(/Too many wrong attempts/);

    const later = new Date(Date.now() + 16 * 60 * 1000);
    expect((await authenticate("9876543210", "secret-pass-1", later)).ok).toBe(true);
  });
});
```

```typescript
// tests/lib/session.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { signSessionToken } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { resetDb } from "../helpers/db";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

function withCookie(token: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === "tc_session" && token ? { name, value: token } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

describe("getSession", () => {
  beforeEach(resetDb);

  it("returns the session for an active user with a matching session version", async () => {
    const user = await prisma.user.create({ data: { name: "Owner", phone: "9000000001", passwordHash: "x", role: "OWNER" } });
    withCookie(await signSessionToken({ userId: user.id, role: "OWNER", sessionVersion: 0 }));
    expect(await getSession()).toEqual({ userId: user.id, role: "OWNER", name: "Owner", mustChangePassword: false });
  });

  it("returns null when there is no cookie", async () => {
    withCookie(undefined);
    expect(await getSession()).toBeNull();
  });

  it("returns null after the user is deactivated or their session version changes", async () => {
    const user = await prisma.user.create({ data: { name: "Worker", phone: "9000000002", passwordHash: "x", role: "WORKER" } });
    withCookie(await signSessionToken({ userId: user.id, role: "WORKER", sessionVersion: 0 }));

    await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: 1 } });
    expect(await getSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/auth.test.ts tests/domain/authentication.test.ts tests/lib/session.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Write `src/lib/auth.ts`**

```typescript
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { ForbiddenError } from "@/lib/errors";

export type Role = "OWNER" | "WORKER";
export type SessionClaims = { userId: string; role: Role; sessionVersion: number };
export type Session = { userId: string; role: Role; name: string; mustChangePassword: boolean };

export const SESSION_COOKIE = "tc_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // one working day

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, Number(process.env.BCRYPT_COST ?? 12));
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, sv: claims.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    const role = payload.role;
    if (typeof payload.sub !== "string" || (role !== "OWNER" && role !== "WORKER") || typeof payload.sv !== "number") {
      return null;
    }
    return { userId: payload.sub, role, sessionVersion: payload.sv };
  } catch {
    return null;
  }
}

export function requireRole(session: Session | null, allowed: readonly Role[]): asserts session is Session {
  if (!session) throw new ForbiddenError("Your session has ended. Please log in again.");
  if (!allowed.includes(session.role)) throw new ForbiddenError();
}
```

- [ ] **Step 4: Write `src/domain/authentication.ts`**

```typescript
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { verifyPassword, type SessionClaims } from "@/lib/auth";
import { phone as phoneSchema } from "@/lib/validation";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

const GENERIC_ERROR = "Wrong phone number or password.";
// Comparing against a dummy hash keeps response time similar whether or not the number exists.
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser", 4);

export type AuthResult = { ok: true; claims: SessionClaims } | { ok: false; error: string };

export async function authenticate(rawPhone: string, password: string, now: Date = new Date()): Promise<AuthResult> {
  const parsed = phoneSchema.safeParse(rawPhone);
  const user = parsed.success ? await prisma.user.findUnique({ where: { phone: parsed.data } }) : null;

  if (!user || !user.isActive) {
    await verifyPassword(password, DUMMY_HASH);
    return { ok: false, error: GENERIC_ERROR };
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
    return { ok: false, error: `Too many wrong attempts. Try again in ${minutes} minute(s).` };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await prisma.user.update({
      where: { id: user.id },
      data: lock
        ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) }
        : { failedLoginCount: failed },
    });
    return { ok: false, error: lock ? `Too many wrong attempts. Try again in ${LOCKOUT_MINUTES} minute(s).` : GENERIC_ERROR };
  }

  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  }
  return { ok: true, claims: { userId: user.id, role: user.role, sessionVersion: user.sessionVersion } };
}
```

- [ ] **Step 5: Write `src/lib/session.ts`**

```typescript
import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSessionToken, verifySessionToken, type Session, type SessionClaims } from "@/lib/auth";

/** The authoritative session check: valid token AND active user AND current session version. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.userId } });
  if (!user || !user.isActive || user.sessionVersion !== claims.sessionVersion) return null;
  return { userId: user.id, role: user.role, name: user.name, mustChangePassword: user.mustChangePassword };
}

export async function setSessionCookie(claims: SessionClaims): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, await signSessionToken(claims), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/lib/auth.test.ts tests/domain/authentication.test.ts tests/lib/session.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm run lint
git add src/lib/auth.ts src/lib/session.ts src/domain/authentication.ts tests
git commit -m "feat: add phone login with lockout and DB-checked sessions"
```

---

### Task 6: Test Factories and Server-Action Plumbing

**Files:**
- Create: `tests/helpers/factories.ts`
- Create: `src/lib/action-result.ts`, `src/lib/prisma-errors.ts`
- Test: `tests/lib/action-result.test.ts`, `tests/lib/prisma-errors.test.ts`

**Interfaces:**
- Produces:
  - Factories (used by every later test): `makeUser(role?, opts?)` → `Session` (opts: `name`, `phone`, `password`, `isActive`), `makeBusinessProfile(overrides?)`, `makeSeries(series?, opts?)`, `makeCustomer(overrides?)`, `makeProduct(overrides?)`, `addStock(productId, quantity, type?)`, `setupBillingWorld()` → `{ owner, worker, customer, product }` (business profile in Odisha, INVOICE + CREDIT_NOTE series for the current FY, 100 units in stock). Constants: `ODISHA = "21"`, `MAHARASHTRA = "27"`, `BUSINESS_GSTIN = "21AAAAA0000A1ZE"`, `ODISHA_CUSTOMER_GSTIN = "21BBBBB1111B1ZZ"`, `MAHARASHTRA_CUSTOMER_GSTIN = "27AAPFU0939F1ZV"` (all checksum-valid).
  - `runAction(fn)` → `Promise<ActionResult<Plain<T>>>` where `ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; error: string; fieldErrors?: Record<string, string[]> }`. `toPlain(value)` converts every Decimal to a string (deep) and keeps Dates. Every server action in Tasks 21–25 returns `runAction(...)`.
  - `isUniqueConstraintError(error)` → `boolean`.

- [ ] **Step 1: Write the failing tests**

> Note: `Prisma.Decimal` is the Decimal class Prisma returns for `@db.Decimal` columns. If your generated client version doesn't export it on `Prisma`, use `import Decimal from "decimal.js"` instead in this test. Prisma's Decimal *is* decimal.js, so the behaviour under test is identical.

```typescript
// tests/lib/action-result.test.ts
import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { runAction, toPlain } from "@/lib/action-result";
import { DomainError, ValidationError } from "@/lib/errors";

describe("toPlain", () => {
  it("turns Prisma Decimals into strings at any depth and keeps Dates", () => {
    const when = new Date("2026-10-20T00:00:00Z");
    const plain = toPlain({ a: new Prisma.Decimal("13.50"), list: [{ b: new Prisma.Decimal("2") }], when, n: 3, s: "x", nil: null });
    expect(plain).toEqual({ a: "13.5", list: [{ b: "2" }], when, n: 3, s: "x", nil: null });
  });
});

describe("runAction", () => {
  it("wraps success", async () => {
    expect(await runAction(async () => ({ total: new Prisma.Decimal("10") }))).toEqual({ ok: true, data: { total: "10" } });
  });
  it("returns domain errors as readable results", async () => {
    const result = await runAction(async () => { throw new DomainError("SHORTFALL_NOT_CONFIRMED", "Confirm the shortfall first."); });
    expect(result).toEqual({ ok: false, code: "SHORTFALL_NOT_CONFIRMED", error: "Confirm the shortfall first." });
  });
  it("includes field errors for validation failures", async () => {
    const result = await runAction(async () => { throw new ValidationError("Bad qty", { qty: ["Bad qty"] }); });
    expect(result).toEqual({ ok: false, code: "VALIDATION", error: "Bad qty", fieldErrors: { qty: ["Bad qty"] } });
  });
  it("hides unexpected errors behind a friendly message and logs them", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runAction(async () => { throw new Error("connection reset"); });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNEXPECTED");
      expect(result.error).not.toMatch(/connection reset/);
    }
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

```typescript
// tests/lib/prisma-errors.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { resetDb } from "../helpers/db";

describe("isUniqueConstraintError", () => {
  beforeEach(resetDb);

  it("recognises a real unique violation from the database", async () => {
    await prisma.user.create({ data: { name: "A", phone: "9000000009", passwordHash: "x", role: "OWNER" } });
    const error = await prisma.user
      .create({ data: { name: "B", phone: "9000000009", passwordHash: "x", role: "OWNER" } })
      .catch((e: unknown) => e);
    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isUniqueConstraintError(new Error("timeout"))).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/action-result.test.ts tests/lib/prisma-errors.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Write `src/lib/action-result.ts`**

```typescript
import { DomainError, ValidationError } from "@/lib/errors";

type DecimalLike = { toFixed(dp?: number): string; isZero(): boolean };

/** The JSON-safe shape a value takes after toPlain(): Decimals become strings. */
export type Plain<T> = T extends DecimalLike
  ? string
  : T extends Date
    ? Date
    : T extends readonly (infer U)[]
      ? Plain<U>[]
      : T extends object
        ? { [K in keyof T]: Plain<T[K]> }
        : T;

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; error: string; fieldErrors?: Record<string, string[]> };

function isDecimalLike(value: unknown): value is DecimalLike {
  return (
    typeof value === "object" && value !== null &&
    typeof (value as DecimalLike).toFixed === "function" &&
    typeof (value as DecimalLike).isZero === "function"
  );
}

export function toPlain<T>(value: T): Plain<T> {
  if (isDecimalLike(value)) return value.toString() as Plain<T>;
  if (value === null || typeof value !== "object" || value instanceof Date) return value as Plain<T>;
  if (Array.isArray(value)) return value.map((v) => toPlain(v)) as Plain<T>;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)])) as Plain<T>;
}

const UNEXPECTED_MESSAGE = "Something went wrong. Please try again. If it keeps happening, tell the owner.";

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<Plain<T>>> {
  try {
    return { ok: true, data: toPlain(await fn()) };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, code: error.code, error: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof DomainError) return { ok: false, code: error.code, error: error.message };
    console.error("[action] unexpected error", error);
    return { ok: false, code: "UNEXPECTED", error: UNEXPECTED_MESSAGE };
  }
}
```

- [ ] **Step 4: Write `src/lib/prisma-errors.ts`**

```typescript
/** True for a Postgres unique violation, however the Prisma driver adapter surfaces it. */
export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; cause?: { code?: unknown } };
  return (
    e.code === "P2002" ||
    e.cause?.code === "23505" ||
    (typeof e.message === "string" && /unique constraint/i.test(e.message))
  );
}
```

- [ ] **Step 5: Write `tests/helpers/factories.ts`**

```typescript
import { prisma } from "@/lib/db";
import { hashPassword, type Role, type Session } from "@/lib/auth";
import { financialYearOf } from "@/lib/time";
import type { Prisma } from "@/generated/prisma/client";

export const ODISHA = "21";
export const MAHARASHTRA = "27";
export const BUSINESS_GSTIN = "21AAAAA0000A1ZE";
export const ODISHA_CUSTOMER_GSTIN = "21BBBBB1111B1ZZ";
export const MAHARASHTRA_CUSTOMER_GSTIN = "27AAPFU0939F1ZV";

let counter = 0;
const nextId = () => ++counter;

export async function makeUser(
  role: Role = "OWNER",
  opts: { name?: string; phone?: string; password?: string; isActive?: boolean } = {}
): Promise<Session> {
  const n = nextId();
  const user = await prisma.user.create({
    data: {
      name: opts.name ?? `${role === "OWNER" ? "Owner" : "Worker"} ${n}`,
      phone: opts.phone ?? `9${String(n).padStart(9, "0")}`,
      passwordHash: opts.password ? await hashPassword(opts.password) : "not-a-real-hash",
      role,
      isActive: opts.isActive ?? true,
    },
  });
  return { userId: user.id, role, name: user.name, mustChangePassword: false };
}

export async function makeBusinessProfile(overrides: Partial<Prisma.BusinessProfileCreateInput> = {}) {
  const data = {
    legalName: "Trinetra Candles", gstin: BUSINESS_GSTIN, stateCode: ODISHA,
    addressLine1: "Plot 12, Industrial Estate", city: "Cuttack", pincode: "753001", phone: "9437000000",
    ...overrides,
  };
  return prisma.businessProfile.upsert({ where: { id: "default" }, create: data, update: data });
}

export async function makeSeries(
  series: "INVOICE" | "CREDIT_NOTE" = "INVOICE",
  opts: { prefix?: string; financialYear?: string } = {}
) {
  return prisma.numberSeries.create({
    data: { series, prefix: opts.prefix ?? (series === "INVOICE" ? "TC" : "CN"), financialYear: opts.financialYear ?? financialYearOf() },
  });
}

export async function makeCustomer(overrides: Partial<Prisma.CustomerUncheckedCreateInput> = {}) {
  const n = nextId();
  return prisma.customer.create({
    data: { name: `Customer ${n}`, phone: `8${String(n).padStart(9, "0")}`, billingAddress: "Market Road, Cuttack", stateCode: ODISHA, ...overrides },
  });
}

export async function makeProduct(overrides: Partial<Prisma.ProductUncheckedCreateInput> = {}) {
  const n = nextId();
  return prisma.product.create({
    data: { sku: `SKU-${n}`, name: `Candle ${n}`, hsnCode: "3406", unitPrice: "150.00", gstRate: "18.00", ...overrides },
  });
}

/** Writes a ledger row directly (no domain rules), for arranging test state only. */
export async function addStock(
  productId: string,
  quantity: string,
  type: "OPENING" | "PRODUCED" | "ADJUSTMENT" = "PRODUCED"
) {
  return prisma.stockLedgerEntry.create({
    data: {
      productId, quantityDelta: quantity, type, createdBy: "fixture",
      reason: type === "ADJUSTMENT" ? "fixture" : null, idempotencyKey: `fixture:${nextId()}`,
    },
  });
}

export async function setupBillingWorld() {
  await makeBusinessProfile();
  await makeSeries("INVOICE");
  await makeSeries("CREDIT_NOTE");
  const owner = await makeUser("OWNER");
  const worker = await makeUser("WORKER");
  const customer = await makeCustomer();
  const product = await makeProduct();
  await addStock(product.id, "100.00");
  return { owner, worker, customer, product };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm run lint
git add src/lib/action-result.ts src/lib/prisma-errors.ts tests
git commit -m "feat: add action result wrapper, unique-violation helper and test factories"
```

---

### Task 7: Stock Ledger Core — Levels and Idempotent Writes

**Files:**
- Create: `src/domain/stock.ts`
- Test: `tests/domain/stock-ledger.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 1), money helpers (Task 4), `DomainError`/`ValidationError` (Task 4).
- Produces: `type LedgerType`. `getStockLevels(db, productIds?)` → `Map<productId, Decimal>`, with ids that have no entries mapped to 0. `getCurrentStock(db, productId)` → `Decimal`. `writeLedgerEntry(db, { productId, quantityDelta, type, reason?, sourceReference?, createdBy, idempotencyKey, actorType?, sourceMetadata? })` → `StockLedgerEntry`. **This is the only function in the codebase allowed to insert into `stock_ledger`.** It enforces sign rules: `OPENING`, `PRODUCED` and `RETURN` must be > 0; `BILLED` must be < 0; `ADJUSTMENT` must be non-zero and carry a reason.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/stock-ledger.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { getCurrentStock, getStockLevels, writeLedgerEntry } from "@/domain/stock";
import { DomainError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeProduct } from "../helpers/factories";

describe("stock ledger core", () => {
  beforeEach(resetDb);

  it("computes stock as the sum of entries, and 0 for products with none", async () => {
    const a = await makeProduct();
    const b = await makeProduct();
    await writeLedgerEntry(prisma, { productId: a.id, quantityDelta: "100", type: "OPENING", createdBy: "u", idempotencyKey: "k-open-a" });
    await writeLedgerEntry(prisma, { productId: a.id, quantityDelta: "-30", type: "BILLED", createdBy: "u", idempotencyKey: "k-bill-a" });

    const levels = await getStockLevels(prisma, [a.id, b.id]);
    expect(levels.get(a.id)?.toFixed(2)).toBe("70.00");
    expect(levels.get(b.id)?.toFixed(2)).toBe("0.00");
    expect((await getCurrentStock(prisma, a.id)).toFixed(2)).toBe("70.00");
  });

  it("returns the original row when the same idempotency key is replayed", async () => {
    const p = await makeProduct();
    const input = { productId: p.id, quantityDelta: "50", type: "PRODUCED" as const, createdBy: "u", idempotencyKey: "k-replay" };
    const first = await writeLedgerEntry(prisma, input);
    const second = await writeLedgerEntry(prisma, input);
    expect(second.id).toBe(first.id);
    expect((await getCurrentStock(prisma, p.id)).toFixed(2)).toBe("50.00");
  });

  it("is safe when identical writes race each other", async () => {
    const p = await makeProduct();
    const input = { productId: p.id, quantityDelta: "5", type: "PRODUCED" as const, createdBy: "u", idempotencyKey: "k-race" };
    await Promise.all(Array.from({ length: 5 }, () => prisma.$transaction((tx) => writeLedgerEntry(tx, input))));
    expect(await prisma.stockLedgerEntry.count({ where: { productId: p.id } })).toBe(1);
  });

  it("refuses to reuse a key for a different change", async () => {
    const p = await makeProduct();
    await writeLedgerEntry(prisma, { productId: p.id, quantityDelta: "5", type: "PRODUCED", createdBy: "u", idempotencyKey: "k-conflict" });
    await expect(
      writeLedgerEntry(prisma, { productId: p.id, quantityDelta: "9", type: "PRODUCED", createdBy: "u", idempotencyKey: "k-conflict" })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("enforces sign rules and adjustment reasons", async () => {
    const p = await makeProduct();
    const base = { productId: p.id, createdBy: "u" };
    await expect(writeLedgerEntry(prisma, { ...base, quantityDelta: "-5", type: "PRODUCED", idempotencyKey: "k-s1" })).rejects.toThrow(ValidationError);
    await expect(writeLedgerEntry(prisma, { ...base, quantityDelta: "5", type: "BILLED", idempotencyKey: "k-s2" })).rejects.toThrow(ValidationError);
    await expect(writeLedgerEntry(prisma, { ...base, quantityDelta: "-2", type: "ADJUSTMENT", idempotencyKey: "k-s3" })).rejects.toThrow(/reason/i);
    await expect(writeLedgerEntry(prisma, { ...base, quantityDelta: "0", type: "ADJUSTMENT", reason: "x", idempotencyKey: "k-s4" })).rejects.toThrow(DomainError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/stock-ledger.test.ts`
Expected: FAIL, because `@/domain/stock` doesn't exist yet.

- [ ] **Step 3: Write `src/domain/stock.ts`**

```typescript
import Decimal from "decimal.js";
import type { Db } from "@/lib/db";
import type { Prisma, StockLedgerEntry } from "@/generated/prisma/client";
import { DomainError, ValidationError } from "@/lib/errors";
import { D, ZERO, toFixed2, type DecimalInput } from "@/lib/money";

export type LedgerType = "OPENING" | "PRODUCED" | "BILLED" | "RETURN" | "ADJUSTMENT";

export type LedgerWrite = {
  productId: string;
  quantityDelta: DecimalInput;
  type: LedgerType;
  reason?: string;
  sourceReference?: string;
  createdBy: string;
  idempotencyKey: string;
  actorType?: "HUMAN" | "AGENT";
  sourceMetadata?: Prisma.InputJsonValue;
};

const SIGN_RULE: Record<LedgerType, "positive" | "negative" | "nonzero"> = {
  OPENING: "positive",
  PRODUCED: "positive",
  RETURN: "positive",
  BILLED: "negative",
  ADJUSTMENT: "nonzero",
};

export async function getStockLevels(db: Db, productIds?: string[]): Promise<Map<string, Decimal>> {
  const rows = await db.stockLedgerEntry.groupBy({
    by: ["productId"],
    where: productIds ? { productId: { in: productIds } } : undefined,
    _sum: { quantityDelta: true },
  });
  const levels = new Map<string, Decimal>();
  for (const id of productIds ?? []) levels.set(id, ZERO);
  for (const row of rows) levels.set(row.productId, D(row._sum.quantityDelta ?? 0));
  return levels;
}

export async function getCurrentStock(db: Db, productId: string): Promise<Decimal> {
  return (await getStockLevels(db, [productId])).get(productId) ?? ZERO;
}

/**
 * The single writer of stock_ledger. Idempotent: replaying a key returns the original row.
 * Uses ON CONFLICT DO NOTHING (createMany + skipDuplicates) so a duplicate never aborts the
 * caller's transaction, which a caught unique-violation would.
 */
export async function writeLedgerEntry(db: Db, input: LedgerWrite): Promise<StockLedgerEntry> {
  const delta = D(input.quantityDelta);
  const rule = SIGN_RULE[input.type];
  if (delta.isZero()) throw new DomainError("ZERO_QUANTITY", "A stock change cannot be zero.");
  if (rule === "positive" && delta.isNegative()) throw new ValidationError(`${input.type} must increase stock.`);
  if (rule === "negative" && delta.isPositive()) throw new ValidationError(`${input.type} must decrease stock.`);
  if (input.type === "ADJUSTMENT" && !input.reason?.trim()) {
    throw new ValidationError("A reason is required for every stock adjustment.");
  }

  const quantityDelta = toFixed2(delta);
  await db.stockLedgerEntry.createMany({
    data: [{
      productId: input.productId,
      quantityDelta,
      type: input.type,
      reason: input.reason?.trim() || null,
      sourceReference: input.sourceReference ?? null,
      createdBy: input.createdBy,
      idempotencyKey: input.idempotencyKey,
      actorType: input.actorType ?? "HUMAN",
      sourceMetadata: input.sourceMetadata,
    }],
    skipDuplicates: true,
  });

  const entry = await db.stockLedgerEntry.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
  if (entry.productId !== input.productId || entry.type !== input.type || !D(entry.quantityDelta).equals(D(quantityDelta))) {
    throw new DomainError("IDEMPOTENCY_CONFLICT", "This request was already processed with different details.");
  }
  return entry;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/stock-ledger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/stock.ts tests/domain/stock-ledger.test.ts
git commit -m "feat: add idempotent stock ledger core with sign rules"
```

---

### Task 8: Production Entry and Stock Adjustments

**Files:**
- Modify: `src/domain/stock.ts` (append)
- Test: `tests/domain/stock-mutations.test.ts`

**Interfaces:**
- Consumes: `writeLedgerEntry` (Task 7), `requireRole` (Task 5), validators (Task 4).
- Produces:
  - `recordProduction(session, { productId, quantity, note?, idempotencyKey })`, for `OWNER` or `WORKER`. Quantity must be > 0, so a worker cannot *reduce* stock through production entry. The product must be active.
  - `adjustStock(session, { productId, quantityDelta, reason, idempotencyKey })`, for `OWNER` only. The delta is signed and non-zero, and a reason is required.
  - Both return the `StockLedgerEntry`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/stock-mutations.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { recordProduction, adjustStock, getCurrentStock } from "@/domain/stock";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeProduct, makeUser } from "../helpers/factories";

describe("recordProduction", () => {
  beforeEach(resetDb);

  it("lets a worker add produced stock", async () => {
    const worker = await makeUser("WORKER");
    const p = await makeProduct();
    await recordProduction(worker, { productId: p.id, quantity: "200", idempotencyKey: "prod-0001" });
    expect((await getCurrentStock(prisma, p.id)).toFixed(2)).toBe("200.00");
  });

  it("rejects zero or negative quantities (production can never reduce stock)", async () => {
    const worker = await makeUser("WORKER");
    const p = await makeProduct();
    await expect(recordProduction(worker, { productId: p.id, quantity: "-5", idempotencyKey: "prod-0002" })).rejects.toThrow(ValidationError);
    await expect(recordProduction(worker, { productId: p.id, quantity: "0", idempotencyKey: "prod-0003" })).rejects.toThrow(ValidationError);
  });

  it("rejects inactive products and logged-out callers", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct({ isActive: false });
    await expect(recordProduction(owner, { productId: p.id, quantity: "5", idempotencyKey: "prod-0004" })).rejects.toMatchObject({ code: "PRODUCT_INACTIVE" });
    await expect(recordProduction(null, { productId: p.id, quantity: "5", idempotencyKey: "prod-0005" })).rejects.toThrow(ForbiddenError);
  });
});

describe("adjustStock", () => {
  beforeEach(resetDb);

  it("lets the owner correct stock with a reason", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct();
    await recordProduction(owner, { productId: p.id, quantity: "50", idempotencyKey: "prod-0006" });
    const entry = await adjustStock(owner, { productId: p.id, quantityDelta: "-3", reason: "Broken in storage", idempotencyKey: "adj-0001" });
    expect(entry.reason).toBe("Broken in storage");
    expect((await getCurrentStock(prisma, p.id)).toFixed(2)).toBe("47.00");
  });

  it("rejects workers even when they call the function directly", async () => {
    const worker = await makeUser("WORKER");
    const p = await makeProduct();
    await expect(
      adjustStock(worker, { productId: p.id, quantityDelta: "-3", reason: "bypassing the UI", idempotencyKey: "adj-0002" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("requires a reason", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct();
    await expect(adjustStock(owner, { productId: p.id, quantityDelta: "-3", reason: "  ", idempotencyKey: "adj-0003" })).rejects.toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/stock-mutations.test.ts`
Expected: FAIL, because `recordProduction`/`adjustStock` are not exported yet.

- [ ] **Step 3: Append to `src/domain/stock.ts`**

Add these imports to the top of the file (merge with the existing ones):
```typescript
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { entityId, idempotencyKey, optionalText, parseInput, quantity, requiredText, signedQuantity } from "@/lib/validation";
```

Then append:
```typescript
async function requireActiveProduct(db: Db, productId: string) {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) throw new NotFoundError("Product");
  if (!product.isActive) throw new DomainError("PRODUCT_INACTIVE", `${product.name} is marked inactive.`);
  return product;
}

export const recordProductionSchema = z.object({
  productId: entityId,
  quantity,
  note: optionalText(300),
  idempotencyKey,
});

export async function recordProduction(session: Session | null, rawInput: unknown): Promise<StockLedgerEntry> {
  requireRole(session, ["OWNER", "WORKER"]);
  const input = parseInput(recordProductionSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    await requireActiveProduct(tx, input.productId);
    return writeLedgerEntry(tx, {
      productId: input.productId,
      quantityDelta: input.quantity,
      type: "PRODUCED",
      reason: input.note,
      createdBy: session.userId,
      idempotencyKey: `production:${input.idempotencyKey}`,
    });
  });
}

export const adjustStockSchema = z.object({
  productId: entityId,
  quantityDelta: signedQuantity,
  reason: requiredText("Reason", 300),
  idempotencyKey,
});

export async function adjustStock(session: Session | null, rawInput: unknown): Promise<StockLedgerEntry> {
  requireRole(session, ["OWNER"]);
  const input = parseInput(adjustStockSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    await requireActiveProduct(tx, input.productId);
    return writeLedgerEntry(tx, {
      productId: input.productId,
      quantityDelta: input.quantityDelta,
      type: "ADJUSTMENT",
      reason: input.reason,
      createdBy: session.userId,
      idempotencyKey: `adjustment:${input.idempotencyKey}`,
    });
  });
}
```

Note the key prefixes (`production:`, `adjustment:`). They scope a client-supplied key to its operation, so the same UUID can never collide across different operations (spec §4 principle 4).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/stock.ts tests/domain/stock-mutations.test.ts
git commit -m "feat: add production entry and owner-only stock adjustments"
```

---

### Task 9: Gapless Document Numbering (Invoices and Credit Notes)

One `number_series` row per (series, financial year), the same idea as ERPNext's naming series. The allocation `UPDATE … RETURNING` takes a row lock and runs **inside the caller's transaction**, so concurrent bills queue for a few milliseconds and a rolled-back bill also rolls back its number. A Postgres `SEQUENCE` would leave a gap.

**Files:**
- Create: `src/domain/numbering.ts`
- Test: `tests/domain/numbering.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 1), `financialYearShort` (Task 4), `NumberSeries` model (Task 2).
- Produces: `type NumberSeriesType = "INVOICE" | "CREDIT_NOTE"`, `MAX_SERIAL = 99999`, `formatDocumentNumber(prefix, financialYear, serial)` → e.g. `"TC/2627/00001"`, `allocateNumber(db, series, financialYear)` → string. Throws `DomainError("SERIES_MISSING")` if the owner hasn't created the series (Task 11 adds that). Tasks 15 and 17 call `allocateNumber` inside their transaction.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/numbering.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { allocateNumber, formatDocumentNumber } from "@/domain/numbering";
import { resetDb } from "../helpers/db";
import { makeSeries } from "../helpers/factories";

const FY = "2026-27";
const serialOf = (n: string) => Number(n.split("/")[2]);

describe("formatDocumentNumber", () => {
  it("produces Rule 46-safe serials (≤16 chars, only A-Z 0-9 /)", () => {
    const n = formatDocumentNumber("TC", FY, 1);
    expect(n).toBe("TC/2627/00001");
    expect(formatDocumentNumber("ABCD", FY, 99999)).toHaveLength(15);
    expect(n).toMatch(/^[A-Z0-9/]{1,16}$/);
  });
  it("rejects bad prefixes and exhausted series", () => {
    expect(() => formatDocumentNumber("tc", FY, 1)).toThrow();
    expect(() => formatDocumentNumber("ABCDE", FY, 1)).toThrow();
    expect(() => formatDocumentNumber("TC", FY, 100000)).toThrow(/exhausted/i);
  });
});

describe("allocateNumber", () => {
  beforeEach(resetDb);

  it("explains clearly when the series has not been set up", async () => {
    await expect(allocateNumber(prisma, "INVOICE", FY)).rejects.toMatchObject({ code: "SERIES_MISSING" });
  });

  it("allocates consecutive numbers, independently per series", async () => {
    await makeSeries("INVOICE", { financialYear: FY });
    await makeSeries("CREDIT_NOTE", { financialYear: FY });
    expect(await allocateNumber(prisma, "INVOICE", FY)).toBe("TC/2627/00001");
    expect(await allocateNumber(prisma, "INVOICE", FY)).toBe("TC/2627/00002");
    expect(await allocateNumber(prisma, "CREDIT_NOTE", FY)).toBe("CN/2627/00001");
  });

  it("does not leave a gap when the surrounding transaction rolls back", async () => {
    await makeSeries("INVOICE", { financialYear: FY });
    const first = await allocateNumber(prisma, "INVOICE", FY);
    await expect(
      prisma.$transaction(async (tx) => {
        await allocateNumber(tx, "INVOICE", FY);
        throw new Error("bill insert failed");
      })
    ).rejects.toThrow("bill insert failed");
    const next = await allocateNumber(prisma, "INVOICE", FY);
    expect(serialOf(next)).toBe(serialOf(first) + 1);
  });

  it("gives every concurrent transaction a distinct, gapless serial", async () => {
    await makeSeries("INVOICE", { financialYear: FY });
    const numbers = await Promise.all(
      Array.from({ length: 8 }, () => prisma.$transaction((tx) => allocateNumber(tx, "INVOICE", FY)))
    );
    expect(numbers.map(serialOf).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/numbering.test.ts`
Expected: FAIL, because the module doesn't exist yet.

- [ ] **Step 3: Write `src/domain/numbering.ts`**

```typescript
import type { Db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { financialYearShort } from "@/lib/time";

export type NumberSeriesType = "INVOICE" | "CREDIT_NOTE";
export const MAX_SERIAL = 99_999;
const LABEL: Record<NumberSeriesType, string> = { INVOICE: "invoice", CREDIT_NOTE: "credit note" };

export function formatDocumentNumber(prefix: string, financialYear: string, serial: number): string {
  if (!/^[A-Z0-9]{1,4}$/.test(prefix)) {
    throw new DomainError("INVALID_PREFIX", "Number prefix must be 1–4 capital letters or digits.");
  }
  if (!Number.isInteger(serial) || serial < 1 || serial > MAX_SERIAL) {
    throw new DomainError("SERIES_EXHAUSTED", `Number series exhausted at ${MAX_SERIAL}; create a new prefix.`);
  }
  // GST Rule 46: consecutive serial, ≤ 16 characters, only alphanumerics, "-" and "/".
  return `${prefix}/${financialYearShort(financialYear)}/${String(serial).padStart(5, "0")}`;
}

/** Must be called inside the transaction that creates the document, so a rollback returns the number. */
export async function allocateNumber(db: Db, series: NumberSeriesType, financialYear: string): Promise<string> {
  const rows = await db.$queryRaw<{ serial: number; prefix: string }[]>`
    UPDATE "number_series"
    SET "nextSerial" = "nextSerial" + 1
    WHERE "series" = ${series} AND "financialYear" = ${financialYear}
    RETURNING "nextSerial" - 1 AS "serial", "prefix"`;
  if (rows.length === 0) {
    throw new DomainError(
      "SERIES_MISSING",
      `No ${LABEL[series]} number series is set up for financial year ${financialYear}. Set it up in Settings → Number series.`
    );
  }
  return formatDocumentNumber(rows[0].prefix, financialYear, Number(rows[0].serial));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/numbering.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/numbering.ts tests/domain/numbering.test.ts
git commit -m "feat: add gapless per-financial-year document numbering"
```

---

### Task 10: GST Tax Engine (pure)

**Files:**
- Create: `src/domain/tax.ts`
- Test: `tests/domain/tax.test.ts`

**Interfaces:**
- Consumes: money helpers (Task 4), `ValidationError` (Task 4).
- Produces:
  - `isInterState(supplierStateCode, placeOfSupply)` → boolean.
  - `taxOnTaxableValue(taxableValue, gstRate, interState)` → `{ cgstAmount, sgstAmount, igstAmount }`.
  - `computeLine({ quantity, unitPrice, discountAmount?, gstRate }, interState)` → `LineAmounts` (`grossAmount, discountAmount, taxableValue, cgstAmount, sgstAmount, igstAmount, lineTotal`).
  - `computeTotals(lines)` → `DocumentTotals` (`grossTotal, discountTotal, taxableTotal, cgstTotal, sgstTotal, igstTotal, taxTotal, roundOff, grandTotal`). Totals are **sums of already-rounded line values**, and the grand total is rounded to the rupee. Used by billing (Tasks 14–15) and credit notes (Task 17).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/tax.test.ts
import { describe, it, expect } from "vitest";
import { computeLine, computeTotals, isInterState, taxOnTaxableValue } from "@/domain/tax";
import { ValidationError } from "@/lib/errors";

const s = (d: { toFixed(n: number): string }) => d.toFixed(2);

describe("tax engine", () => {
  it("splits intra-state tax into equal CGST and SGST", () => {
    const line = computeLine({ quantity: "10", unitPrice: "150", gstRate: "18" }, false);
    expect([s(line.taxableValue), s(line.cgstAmount), s(line.sgstAmount), s(line.igstAmount), s(line.lineTotal)])
      .toEqual(["1500.00", "135.00", "135.00", "0.00", "1770.00"]);
  });

  it("charges only IGST for inter-state supply", () => {
    expect(isInterState("21", "27")).toBe(true);
    const line = computeLine({ quantity: "10", unitPrice: "150", gstRate: "18" }, true);
    expect([s(line.cgstAmount), s(line.igstAmount)]).toEqual(["0.00", "270.00"]);
  });

  it("taxes the value after discount", () => {
    const line = computeLine({ quantity: "10", unitPrice: "150", discountAmount: "100", gstRate: "18" }, false);
    expect([s(line.grossAmount), s(line.taxableValue), s(line.cgstAmount), s(line.lineTotal)])
      .toEqual(["1500.00", "1400.00", "126.00", "1652.00"]);
  });

  it("rejects a discount larger than the line amount", () => {
    expect(() => computeLine({ quantity: "1", unitPrice: "10", discountAmount: "11", gstRate: "18" }, false)).toThrow(ValidationError);
  });

  it("rounds each tax component half-up to the paisa", () => {
    const t = taxOnTaxableValue("33.33", "18", false); // 33.33 × 9% = 2.9997
    expect([s(t.cgstAmount), s(t.sgstAmount)]).toEqual(["3.00", "3.00"]);
  });

  it("totals exactly equal the sum of lines, and round the grand total to the rupee", () => {
    const lines = [
      computeLine({ quantity: "1", unitPrice: "33.33", gstRate: "18" }, false), // tax 6.00
      computeLine({ quantity: "1", unitPrice: "19.99", gstRate: "12" }, false), // tax 1.20 + 1.20
    ];
    const t = computeTotals(lines);
    expect([s(t.taxableTotal), s(t.taxTotal), s(t.roundOff), s(t.grandTotal)]).toEqual(["53.32", "8.40", "0.28", "62.00"]);
    expect(s(t.cgstTotal.plus(t.sgstTotal).plus(t.igstTotal))).toBe(s(t.taxTotal));
    expect(s(t.taxableTotal.plus(t.taxTotal).plus(t.roundOff))).toBe(s(t.grandTotal));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/tax.test.ts`
Expected: FAIL, because the module doesn't exist yet.

- [ ] **Step 3: Write `src/domain/tax.ts`**

```typescript
import Decimal from "decimal.js";
import { ValidationError } from "@/lib/errors";
import { D, round2, roundToRupee, sumDecimals, type DecimalInput } from "@/lib/money";

export type TaxSplit = { cgstAmount: Decimal; sgstAmount: Decimal; igstAmount: Decimal };
export type LineAmounts = TaxSplit & {
  grossAmount: Decimal;
  discountAmount: Decimal;
  taxableValue: Decimal;
  lineTotal: Decimal;
};
export type DocumentTotals = {
  grossTotal: Decimal; discountTotal: Decimal; taxableTotal: Decimal;
  cgstTotal: Decimal; sgstTotal: Decimal; igstTotal: Decimal; taxTotal: Decimal;
  roundOff: Decimal; grandTotal: Decimal;
};

export function isInterState(supplierStateCode: string, placeOfSupply: string): boolean {
  return supplierStateCode !== placeOfSupply;
}

export function taxOnTaxableValue(taxableValue: DecimalInput, gstRate: DecimalInput, interState: boolean): TaxSplit {
  const value = D(taxableValue);
  const rate = D(gstRate);
  if (interState) {
    return { cgstAmount: new Decimal(0), sgstAmount: new Decimal(0), igstAmount: round2(value.times(rate).div(100)) };
  }
  const half = round2(value.times(rate).div(200));
  return { cgstAmount: half, sgstAmount: half, igstAmount: new Decimal(0) };
}

export function computeLine(
  input: { quantity: DecimalInput; unitPrice: DecimalInput; discountAmount?: DecimalInput; gstRate: DecimalInput },
  interState: boolean
): LineAmounts {
  const grossAmount = round2(D(input.quantity).times(D(input.unitPrice)));
  const discountAmount = round2(input.discountAmount ?? 0);
  if (discountAmount.isNegative() || discountAmount.greaterThan(grossAmount)) {
    throw new ValidationError("Discount must be between 0 and the line amount.");
  }
  const taxableValue = grossAmount.minus(discountAmount);
  const tax = taxOnTaxableValue(taxableValue, input.gstRate, interState);
  const lineTotal = taxableValue.plus(tax.cgstAmount).plus(tax.sgstAmount).plus(tax.igstAmount);
  return { grossAmount, discountAmount, taxableValue, ...tax, lineTotal };
}

export function computeTotals(
  lines: Array<TaxSplit & { taxableValue: Decimal; grossAmount?: Decimal; discountAmount?: Decimal }>
): DocumentTotals {
  const taxableTotal = sumDecimals(lines.map((l) => l.taxableValue));
  const cgstTotal = sumDecimals(lines.map((l) => l.cgstAmount));
  const sgstTotal = sumDecimals(lines.map((l) => l.sgstAmount));
  const igstTotal = sumDecimals(lines.map((l) => l.igstAmount));
  const taxTotal = cgstTotal.plus(sgstTotal).plus(igstTotal);
  const { rounded, roundOff } = roundToRupee(taxableTotal.plus(taxTotal));
  return {
    grossTotal: sumDecimals(lines.map((l) => l.grossAmount ?? l.taxableValue)),
    discountTotal: sumDecimals(lines.map((l) => l.discountAmount ?? 0)),
    taxableTotal, cgstTotal, sgstTotal, igstTotal, taxTotal, roundOff, grandTotal: rounded,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/tax.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/tax.ts tests/domain/tax.test.ts
git commit -m "feat: add GST tax engine with discounts and rupee round-off"
```

---

### Task 11: Settings and Master Data — Business Profile, Number Series, Products, Customers

**Files:**
- Create: `src/domain/settings.ts`, `src/domain/products.ts`, `src/domain/customers.ts`
- Test: `tests/domain/settings.test.ts`, `tests/domain/products.test.ts`, `tests/domain/customers.test.ts`

**Interfaces:**
- Consumes: validators and GST helpers (Task 4), `requireRole` (Task 5), `financialYearOf` (Task 4).
- Produces:
  - `settings.ts`: `businessProfileSchema`, `getBusinessProfile(db?)` → profile or `null`, `requireBusinessProfile(db)` (throws `DomainError("SETUP_INCOMPLETE")`), `saveBusinessProfile(session, input)` (OWNER; derives `stateCode` from the GSTIN), `ensureNumberSeries(session, { series, prefix, financialYear? })` (OWNER; idempotent; prefix locked once a number has been used), `getNumberSeriesStatus(db, financialYear?)` → `{ series, exists, prefix, nextSerial }[]`.
  - `products.ts`: `productSchema`, `createProduct(session, input)`, `updateProduct(session, { id, ...fields })`, `setProductActive(session, { id, isActive })` (all OWNER), `listProducts(session, { search?, includeInactive? })` (OWNER or WORKER).
  - `customers.ts`: `customerSchema`, `createCustomer`, `updateCustomer`, `setCustomerActive`, `searchCustomers(session, { query?, limit? })` (all OWNER). A GSTIN's first two digits must match the chosen state.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/settings.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { saveBusinessProfile, requireBusinessProfile, ensureNumberSeries, getNumberSeriesStatus } from "@/domain/settings";
import { allocateNumber } from "@/domain/numbering";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { financialYearOf } from "@/lib/time";
import { resetDb } from "../helpers/db";
import { makeUser, BUSINESS_GSTIN } from "../helpers/factories";

const profileInput = {
  legalName: "Trinetra Candles", gstin: BUSINESS_GSTIN.toLowerCase(), addressLine1: "Plot 12, Industrial Estate",
  city: "Cuttack", pincode: "753001", phone: "9437000000", upiId: "trinetra@upi",
};

describe("settings", () => {
  beforeEach(resetDb);

  it("tells the user to finish setup before billing", async () => {
    await expect(requireBusinessProfile(prisma)).rejects.toMatchObject({ code: "SETUP_INCOMPLETE" });
  });

  it("saves the profile, normalising the GSTIN and deriving the state", async () => {
    const owner = await makeUser("OWNER");
    const saved = await saveBusinessProfile(owner, profileInput);
    expect(saved.gstin).toBe(BUSINESS_GSTIN);
    expect(saved.stateCode).toBe("21");
    expect((await requireBusinessProfile(prisma)).legalName).toBe("Trinetra Candles");
  });

  it("rejects an invalid GSTIN and non-owners", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    await expect(saveBusinessProfile(owner, { ...profileInput, gstin: "21AAAAA0000A1ZX" })).rejects.toThrow(ValidationError);
    await expect(saveBusinessProfile(worker, profileInput)).rejects.toThrow(ForbiddenError);
  });

  it("creates number series idempotently and locks the prefix once used", async () => {
    const owner = await makeUser("OWNER");
    const fy = financialYearOf();
    await ensureNumberSeries(owner, { series: "INVOICE", prefix: "TC" });
    await ensureNumberSeries(owner, { series: "INVOICE", prefix: "TCX" }); // unused yet → prefix may change
    expect((await getNumberSeriesStatus(prisma)).find((s) => s.series === "INVOICE")).toMatchObject({ exists: true, prefix: "TCX" });

    await allocateNumber(prisma, "INVOICE", fy);
    await expect(ensureNumberSeries(owner, { series: "INVOICE", prefix: "TC" })).rejects.toMatchObject({ code: "SERIES_IN_USE" });
    expect((await getNumberSeriesStatus(prisma)).find((s) => s.series === "CREDIT_NOTE")?.exists).toBe(false);
  });
});
```

```typescript
// tests/domain/products.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createProduct, updateProduct, setProductActive, listProducts } from "@/domain/products";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

const lavender = { sku: "ljc-01", name: "Lavender Jar Candle", hsnCode: "3406", unitPrice: "150", gstRate: "18", reorderLevel: "20" };

describe("products", () => {
  beforeEach(resetDb);

  it("creates a product with normalised SKU and defaults", async () => {
    const owner = await makeUser("OWNER");
    const p = await createProduct(owner, lavender);
    expect(p.sku).toBe("LJC-01");
    expect(p.unit).toBe("pcs");
    expect(p.unitPrice.toString()).toBe("150");
  });

  it("rejects duplicate SKUs, bad HSN codes, and workers", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    await createProduct(owner, lavender);
    await expect(createProduct(owner, lavender)).rejects.toMatchObject({ code: "DUPLICATE_SKU" });
    await expect(createProduct(owner, { ...lavender, sku: "X1", hsnCode: "34060" })).rejects.toThrow(ValidationError);
    await expect(createProduct(worker, { ...lavender, sku: "X2" })).rejects.toThrow(ForbiddenError);
  });

  it("updates, deactivates and searches products", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    const p = await createProduct(owner, lavender);
    await createProduct(owner, { ...lavender, sku: "RJC-01", name: "Rose Jar Candle" });
    await updateProduct(owner, { id: p.id, ...lavender, unitPrice: "160" });
    await setProductActive(owner, { id: p.id, isActive: false });

    expect((await listProducts(worker, { search: "jar" })).map((x) => x.name)).toEqual(["Rose Jar Candle"]);
    const all = await listProducts(owner, { search: "jar", includeInactive: true });
    expect(all.find((x) => x.id === p.id)?.unitPrice.toString()).toBe("160");
  });
});
```

```typescript
// tests/domain/customers.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createCustomer, updateCustomer, searchCustomers } from "@/domain/customers";
import { ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeUser, MAHARASHTRA_CUSTOMER_GSTIN } from "../helpers/factories";

describe("customers", () => {
  beforeEach(resetDb);

  it("creates a walk-in (B2C) customer without GSTIN", async () => {
    const owner = await makeUser("OWNER");
    const c = await createCustomer(owner, { name: "Walk-in", billingAddress: "Cuttack", stateCode: "21", phone: "" });
    expect(c.gstin).toBeNull();
    expect(c.phone).toBeNull();
  });

  it("requires the state to match the GSTIN", async () => {
    const owner = await makeUser("OWNER");
    await expect(
      createCustomer(owner, { name: "Pune Traders", billingAddress: "Pune", stateCode: "21", gstin: MAHARASHTRA_CUSTOMER_GSTIN })
    ).rejects.toThrow(ValidationError);
    const ok = await createCustomer(owner, { name: "Pune Traders", billingAddress: "Pune", stateCode: "27", gstin: MAHARASHTRA_CUSTOMER_GSTIN });
    expect(ok.stateCode).toBe("27");
    await expect(
      createCustomer(owner, { name: "Copy", billingAddress: "Pune", stateCode: "27", gstin: MAHARASHTRA_CUSTOMER_GSTIN })
    ).rejects.toMatchObject({ code: "DUPLICATE_GSTIN" });
  });

  it("updates and searches by name, phone or GSTIN", async () => {
    const owner = await makeUser("OWNER");
    const c = await createCustomer(owner, { name: "Ramesh Traders", billingAddress: "Cuttack", stateCode: "21", phone: "9876500001" });
    await updateCustomer(owner, { id: c.id, name: "Ramesh Traders & Sons", billingAddress: "Cuttack", stateCode: "21", phone: "9876500001" });
    expect((await searchCustomers(owner, { query: "sons" }))[0].id).toBe(c.id);
    expect((await searchCustomers(owner, { query: "98765" }))[0].id).toBe(c.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domain/settings.test.ts tests/domain/products.test.ts tests/domain/customers.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Write `src/domain/settings.ts`**

```typescript
import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { isValidGstin, stateCodeFromGstin } from "@/lib/gst";
import { financialYearOf } from "@/lib/time";
import { optionalText, parseInput, phone, requiredText } from "@/lib/validation";
import type { NumberSeriesType } from "@/domain/numbering";

export const businessProfileSchema = z.object({
  legalName: requiredText("Legal name"),
  tradeName: optionalText(200),
  gstin: z.string().trim().toUpperCase().refine(isValidGstin, "GSTIN is not valid. Check for typos."),
  addressLine1: requiredText("Address", 200),
  addressLine2: optionalText(200),
  city: requiredText("City", 100),
  pincode: z.string().trim().regex(/^\d{6}$/, "PIN code must be 6 digits"),
  phone,
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().transform((v) => v || undefined),
  upiId: z
    .string().trim().optional().transform((v) => v || undefined)
    .refine((v) => v === undefined || /^[\w.-]{2,}@[A-Za-z]{2,}$/.test(v), "UPI ID looks wrong (example: name@okhdfcbank)"),
  bankDetails: optionalText(500),
  invoiceTerms: optionalText(1000),
  einvoicingApplicable: z.boolean().default(false),
});

export async function getBusinessProfile(db: Db = prisma) {
  return db.businessProfile.findUnique({ where: { id: "default" } });
}

export async function requireBusinessProfile(db: Db) {
  const profile = await getBusinessProfile(db);
  if (!profile) {
    throw new DomainError("SETUP_INCOMPLETE", "Fill in your business details in Settings before billing.");
  }
  return profile;
}

export async function saveBusinessProfile(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(businessProfileSchema, rawInput);
  const data = {
    ...input,
    tradeName: input.tradeName ?? null, addressLine2: input.addressLine2 ?? null, email: input.email ?? null,
    upiId: input.upiId ?? null, bankDetails: input.bankDetails ?? null, invoiceTerms: input.invoiceTerms ?? null,
    stateCode: stateCodeFromGstin(input.gstin),
  };
  return prisma.businessProfile.upsert({ where: { id: "default" }, create: data, update: data });
}

const seriesSchema = z.object({
  series: z.enum(["INVOICE", "CREDIT_NOTE"]),
  prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/, "Prefix must be 1–4 letters or digits"),
  financialYear: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export async function ensureNumberSeries(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(seriesSchema, rawInput);
  const financialYear = input.financialYear ?? financialYearOf();
  const key = { series_financialYear: { series: input.series, financialYear } };

  const existing = await prisma.numberSeries.findUnique({ where: key });
  if (!existing) return prisma.numberSeries.create({ data: { series: input.series, financialYear, prefix: input.prefix } });
  if (existing.prefix === input.prefix) return existing;
  if (existing.nextSerial > 1) {
    throw new DomainError("SERIES_IN_USE", "This series has already issued numbers; its prefix can no longer change this year.");
  }
  return prisma.numberSeries.update({ where: key, data: { prefix: input.prefix } });
}

export async function getNumberSeriesStatus(db: Db, financialYear: string = financialYearOf()) {
  const rows = await db.numberSeries.findMany({ where: { financialYear } });
  return (["INVOICE", "CREDIT_NOTE"] as NumberSeriesType[]).map((series) => {
    const row = rows.find((r) => r.series === series);
    return { series, financialYear, exists: Boolean(row), prefix: row?.prefix ?? null, nextSerial: row?.nextSerial ?? null };
  });
}
```

> If TypeScript rejects `series_financialYear` as the compound-key name, open `src/generated/prisma/models/NumberSeries.ts` and use the `WhereUniqueInput` key name it shows. Prisma names it `<field1>_<field2>` by default.

- [ ] **Step 4: Write `src/domain/products.ts`**

```typescript
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError } from "@/lib/errors";
import { toFixed2 } from "@/lib/money";
import { entityId, gstRate, hsnCode, money, nonNegativeQuantity, parseInput, requiredText } from "@/lib/validation";

export const productSchema = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_/-]{0,39}$/, "SKU may use letters, digits, - _ / (max 40)"),
  name: requiredText("Name", 120),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  hsnCode,
  unitPrice: money,
  gstRate,
  reorderLevel: nonNegativeQuantity.default("0"),
});

function toData(input: z.output<typeof productSchema>) {
  return { ...input, unitPrice: toFixed2(input.unitPrice), gstRate: toFixed2(input.gstRate), reorderLevel: toFixed2(input.reorderLevel) };
}

async function assertSkuFree(sku: string, exceptId?: string) {
  const clash = await prisma.product.findUnique({ where: { sku } });
  if (clash && clash.id !== exceptId) throw new DomainError("DUPLICATE_SKU", `SKU ${sku} is already used by "${clash.name}".`);
}

export async function createProduct(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(productSchema, rawInput);
  await assertSkuFree(input.sku);
  return prisma.product.create({ data: toData(input) });
}

export async function updateProduct(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { id, ...input } = parseInput(productSchema.extend({ id: entityId }), rawInput);
  if (!(await prisma.product.findUnique({ where: { id } }))) throw new NotFoundError("Product");
  await assertSkuFree(input.sku, id);
  return prisma.product.update({ where: { id }, data: toData(input) });
}

export async function setProductActive(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(z.object({ id: entityId, isActive: z.boolean() }), rawInput);
  return prisma.product.update({ where: { id: input.id }, data: { isActive: input.isActive } });
}

export async function listProducts(session: Session | null, rawInput: unknown = {}) {
  requireRole(session, ["OWNER", "WORKER"]);
  const input = parseInput(z.object({ search: z.string().trim().optional(), includeInactive: z.boolean().default(false) }), rawInput);
  return prisma.product.findMany({
    where: {
      ...(input.includeInactive ? {} : { isActive: true }),
      ...(input.search
        ? { OR: [{ name: { contains: input.search, mode: "insensitive" } }, { sku: { contains: input.search, mode: "insensitive" } }] }
        : {}),
    },
    orderBy: { name: "asc" },
  });
}
```

- [ ] **Step 5: Write `src/domain/customers.ts`**

```typescript
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError } from "@/lib/errors";
import { stateCodeFromGstin } from "@/lib/gst";
import { entityId, optionalGstin, parseInput, requiredText, stateCode } from "@/lib/validation";

const optionalPhone = z
  .string()
  .optional()
  .transform((v) => v?.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "") || undefined)
  .refine((v) => v === undefined || /^[6-9]\d{9}$/.test(v), "Enter a 10-digit mobile number or leave it empty");

const customerFields = z.object({
  name: requiredText("Name", 150),
  phone: optionalPhone,
  gstin: optionalGstin,
  billingAddress: requiredText("Address", 300),
  stateCode,
});

const stateMatchesGstin = (c: { gstin?: string; stateCode: string }) => !c.gstin || stateCodeFromGstin(c.gstin) === c.stateCode;
const STATE_MISMATCH = { message: "State must match the first two digits of the GSTIN", path: ["stateCode"] };

export const customerSchema = customerFields.refine(stateMatchesGstin, STATE_MISMATCH);
const updateCustomerSchema = customerFields.extend({ id: entityId }).refine(stateMatchesGstin, STATE_MISMATCH);

async function assertGstinFree(gstin: string | undefined, exceptId?: string) {
  if (!gstin) return;
  const clash = await prisma.customer.findUnique({ where: { gstin } });
  if (clash && clash.id !== exceptId) throw new DomainError("DUPLICATE_GSTIN", `GSTIN already belongs to "${clash.name}".`);
}

export async function createCustomer(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(customerSchema, rawInput);
  await assertGstinFree(input.gstin);
  return prisma.customer.create({ data: { ...input, phone: input.phone ?? null, gstin: input.gstin ?? null } });
}

export async function updateCustomer(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { id, ...input } = parseInput(updateCustomerSchema, rawInput);
  if (!(await prisma.customer.findUnique({ where: { id } }))) throw new NotFoundError("Customer");
  await assertGstinFree(input.gstin, id);
  return prisma.customer.update({ where: { id }, data: { ...input, phone: input.phone ?? null, gstin: input.gstin ?? null } });
}

export async function setCustomerActive(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(z.object({ id: entityId, isActive: z.boolean() }), rawInput);
  return prisma.customer.update({ where: { id: input.id }, data: { isActive: input.isActive } });
}

export async function searchCustomers(session: Session | null, rawInput: unknown = {}) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(z.object({ query: z.string().trim().optional(), limit: z.number().int().min(1).max(100).default(20) }), rawInput);
  const q = input.query;
  return prisma.customer.findMany({
    where: {
      isActive: true,
      ...(q
        ? { OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q.replace(/\D/g, "") || q } },
            { gstin: { contains: q.toUpperCase() } },
          ] }
        : {}),
    },
    orderBy: { name: "asc" },
    take: input.limit,
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/settings.ts src/domain/products.ts src/domain/customers.ts tests/domain
git commit -m "feat: add business profile, number series, product and customer management"
```

---

### Task 12: Users, First-Run Seed, and Owner Password Recovery

At this scale (1–3 people who see each other daily), the owner sets a temporary password for a worker, and the worker must change it at next login. No SMS or email provider is needed. If the owner forgets their own password, the developer runs a one-line script.

**Files:**
- Create: `src/domain/users.ts`, `prisma/seed.ts`, `scripts/reset-owner-password.ts`
- Test: `tests/domain/users.test.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` (Task 5), `phone` validator (Task 4).
- Produces: `createUser(session, { name, phone, role, temporaryPassword })`, `setUserActive(session, { userId, isActive })`, `setTemporaryPassword(session, { userId, temporaryPassword })`, `listUsers(session)` (all OWNER), and `changeOwnPassword(session, { currentPassword, newPassword })` (any logged-in user), which returns fresh `SessionClaims` so the caller can re-issue the cookie. Deactivating a user or resetting their password increments `sessionVersion`, so that user's open sessions end immediately. npm scripts: `db:seed`, `user:reset-password`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/users.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createUser, setUserActive, setTemporaryPassword, changeOwnPassword, listUsers } from "@/domain/users";
import { authenticate } from "@/domain/authentication";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

describe("users", () => {
  beforeEach(resetDb);

  it("lets the owner add a worker who must change the temporary password", async () => {
    const owner = await makeUser("OWNER");
    const worker = await createUser(owner, { name: "Sita", phone: "9876543211", role: "WORKER", temporaryPassword: "temp-pass-1" });
    expect(worker.mustChangePassword).toBe(true);
    expect((await authenticate("9876543211", "temp-pass-1")).ok).toBe(true);
    await expect(createUser(owner, { name: "Dup", phone: "9876543211", role: "WORKER", temporaryPassword: "temp-pass-1" }))
      .rejects.toMatchObject({ code: "DUPLICATE_PHONE" });
  });

  it("deactivating a worker ends their sessions; the owner cannot deactivate themselves", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    await setUserActive(owner, { userId: worker.userId, isActive: false });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: worker.userId } });
    expect(row.isActive).toBe(false);
    expect(row.sessionVersion).toBe(1);
    await expect(setUserActive(owner, { userId: owner.userId, isActive: false })).rejects.toMatchObject({ code: "CANNOT_DEACTIVATE_SELF" });
  });

  it("resets a worker's password and unlocks them", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER", { phone: "9876543212", password: "old-pass-12" });
    await prisma.user.update({ where: { id: worker.userId }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
    await setTemporaryPassword(owner, { userId: worker.userId, temporaryPassword: "fresh-pass-1" });
    expect((await authenticate("9876543212", "fresh-pass-1")).ok).toBe(true);
  });

  it("changes your own password only with the current one", async () => {
    const worker = await makeUser("WORKER", { phone: "9876543213", password: "current-pass" });
    await expect(changeOwnPassword(worker, { currentPassword: "wrong", newPassword: "brand-new-pass" }))
      .rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(changeOwnPassword(worker, { currentPassword: "current-pass", newPassword: "short" })).rejects.toThrow(ValidationError);
    const claims = await changeOwnPassword(worker, { currentPassword: "current-pass", newPassword: "brand-new-pass" });
    expect(claims.sessionVersion).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: worker.userId } })).mustChangePassword).toBe(false);
  });

  it("only owners manage users", async () => {
    const worker = await makeUser("WORKER");
    await expect(listUsers(worker)).rejects.toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/users.test.ts`
Expected: FAIL, because the module doesn't exist yet.

- [ ] **Step 3: Write `src/domain/users.ts`**

```typescript
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, requireRole, verifyPassword, type Session, type SessionClaims } from "@/lib/auth";
import { DomainError, NotFoundError } from "@/lib/errors";
import { entityId, parseInput, phone, requiredText } from "@/lib/validation";

const password = z.string().min(8, "Password must be at least 8 characters").max(72, "Password is too long");

const publicFields = { id: true, name: true, phone: true, role: true, isActive: true, mustChangePassword: true, createdAt: true } as const;

export async function createUser(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(
    z.object({ name: requiredText("Name", 100), phone, role: z.enum(["OWNER", "WORKER"]), temporaryPassword: password }),
    rawInput
  );
  if (await prisma.user.findUnique({ where: { phone: input.phone } })) {
    throw new DomainError("DUPLICATE_PHONE", "Someone already uses this mobile number to log in.");
  }
  return prisma.user.create({
    data: { name: input.name, phone: input.phone, role: input.role, passwordHash: await hashPassword(input.temporaryPassword), mustChangePassword: true },
    select: publicFields,
  });
}

export async function setUserActive(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(z.object({ userId: entityId, isActive: z.boolean() }), rawInput);
  if (input.userId === session.userId && !input.isActive) {
    throw new DomainError("CANNOT_DEACTIVATE_SELF", "You cannot deactivate your own login.");
  }
  return prisma.user.update({
    where: { id: input.userId },
    data: { isActive: input.isActive, sessionVersion: { increment: 1 } },
    select: publicFields,
  });
}

export async function setTemporaryPassword(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(z.object({ userId: entityId, temporaryPassword: password }), rawInput);
  return prisma.user.update({
    where: { id: input.userId },
    data: {
      passwordHash: await hashPassword(input.temporaryPassword), mustChangePassword: true,
      failedLoginCount: 0, lockedUntil: null, sessionVersion: { increment: 1 },
    },
    select: publicFields,
  });
}

export async function changeOwnPassword(session: Session | null, rawInput: unknown): Promise<SessionClaims> {
  requireRole(session, ["OWNER", "WORKER"]);
  const input = parseInput(
    z.object({ currentPassword: z.string().min(1), newPassword: password })
      .refine((v) => v.currentPassword !== v.newPassword, { message: "Choose a different new password", path: ["newPassword"] }),
    rawInput
  );
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) throw new NotFoundError("User");
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new DomainError("WRONG_PASSWORD", "Your current password is not correct.");
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, sessionVersion: { increment: 1 } },
  });
  return { userId: updated.id, role: updated.role, sessionVersion: updated.sessionVersion };
}

export async function listUsers(session: Session | null) {
  requireRole(session, ["OWNER"]);
  return prisma.user.findMany({ select: publicFields, orderBy: [{ role: "asc" }, { name: "asc" }] });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/users.test.ts`
Expected: PASS

- [ ] **Step 5: Write the seed script `prisma/seed.ts`**

```typescript
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const existingOwner = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (existingOwner) {
    console.log(`Owner already exists (${existingOwner.phone}); nothing to seed.`);
    return;
  }
  const name = process.env.SEED_OWNER_NAME ?? "Owner";
  const phone = process.env.SEED_OWNER_PHONE;
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) throw new Error("Set SEED_OWNER_PHONE to a 10-digit mobile number in .env");
  if (!password || password.length < 8) throw new Error("Set SEED_OWNER_PASSWORD (8+ characters) in .env");

  await prisma.user.create({
    data: { name, phone, role: "OWNER", passwordHash: await hashPassword(password), mustChangePassword: true },
  });
  console.log(`Created owner login ${phone}. You will be asked to change the password on first login.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 6: Write `scripts/reset-owner-password.ts`**

```typescript
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

// Usage: npm run user:reset-password -- 9999999999 "temporary-pass-123"
async function main() {
  const [phone, temporaryPassword] = process.argv.slice(2);
  if (!phone || !temporaryPassword || temporaryPassword.length < 8) {
    throw new Error('Usage: npm run user:reset-password -- <10-digit phone> "<temporary password, 8+ chars>"');
  }
  const user = await prisma.user.update({
    where: { phone },
    data: {
      passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, isActive: true,
      failedLoginCount: 0, lockedUntil: null, sessionVersion: { increment: 1 },
    },
  });
  console.log(`Password reset for ${user.name} (${user.phone}). They must change it at next login.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 7: Wire the scripts and run the seed against the dev DB**

```bash
npm pkg set scripts.user:reset-password="tsx scripts/reset-owner-password.ts"
npm run db:seed
npm run db:seed
```
Expected: the first run prints `Created owner login 9999999999…`, and the second prints `Owner already exists…`. That shows the seed is idempotent. If `tsx` can't resolve `@/…` imports, check that `tsconfig.json` has `"paths": { "@/*": ["./src/*"] }`; tsx reads it.

- [ ] **Step 8: Commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/domain/users.ts prisma/seed.ts scripts/reset-owner-password.ts package.json tests/domain/users.test.ts
git commit -m "feat: add user management, first-run owner seed and password recovery script"
```

---

### Task 13: Excel/CSV Import — Products and Opening Stock

Onboarding is by upload: one sheet of products, and one sheet of opening stock counted on the cut-over day. Every import is **preview first, then commit**, reporting row-numbered problems, the same "propose → review → apply" pattern Phase 2's AI reconciliation will reuse. Re-uploading the same opening-stock batch is a no-op. A second, different opening batch for the same product is refused, because that would double the stock.

**Files:**
- Create: `src/lib/spreadsheet.ts`, `src/domain/imports.ts`
- Modify: `src/domain/stock.ts` (append opening-stock import)
- Test: `tests/lib/spreadsheet.test.ts`, `tests/domain/imports.test.ts`

**Interfaces:**
- Consumes: `productSchema` (Task 11), `writeLedgerEntry` (Task 7), validators (Task 4).
- Produces:
  - `parseSpreadsheet(data: ArrayBuffer, fileName)` → `{ headers: string[]; rows: { rowNumber; values: Record<normalisedHeader, string> }[] }`. Accepts `.xlsx` and `.csv` only. Headers are normalised to lowercase alphanumerics (`"GST %"` → `"gst"`), and there is a 2000-row limit.
  - `mapProductRows(rows)` / `mapOpeningStockRows(rows)` → typed row inputs. Column aliases: SKU = `sku`/`code`/`itemcode`; Name = `name`/`productname`/`item`; HSN = `hsn`/`hsncode`; GST = `gst`/`gstrate`/`gstpercent`/`taxrate`; Price = `price`/`unitprice`/`rate`/`mrp`; Unit = `unit`/`uom`; Reorder = `reorderlevel`/`reorder`/`minstock`; Quantity = `quantity`/`qty`/`stock`/`openingstock`.
  - `importProducts(session, { rows, dryRun })` → `{ errors: {rowNumber, message}[], toCreate, toUpdate, created, updated }` (OWNER). It never throws for row problems; it reports them.
  - `previewOpeningStock(session, { importBatchId, rows })` → `{ ready, problems }` and `importOpeningStock(session, { importBatchId, rows })` → `{ imported }` (OWNER; throws `ValidationError` if any problems remain).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/spreadsheet.test.ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseSpreadsheet } from "@/lib/spreadsheet";
import { ValidationError } from "@/lib/errors";

async function xlsx(rows: (string | number)[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((r) => ws.addRow(r));
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer).buffer;
}

describe("parseSpreadsheet", () => {
  it("reads .xlsx with normalised headers, numbers as text, and real row numbers", async () => {
    const data = await xlsx([["SKU", "GST %", "Opening Stock"], ["LJC-01", 18, 120], [], ["RJC-01", 12, 40]]);
    const { headers, rows } = await parseSpreadsheet(data, "stock.xlsx");
    expect(headers).toEqual(["sku", "gst", "openingstock"]);
    expect(rows).toEqual([
      { rowNumber: 2, values: { sku: "LJC-01", gst: "18", openingstock: "120" } },
      { rowNumber: 4, values: { sku: "RJC-01", gst: "12", openingstock: "40" } },
    ]);
  });

  it("reads .csv including a UTF-8 BOM and quoted commas", async () => {
    const BOM = String.fromCharCode(0xfeff);
    const text = `${BOM}SKU,Name,Qty\nLJC-01,"Lavender, Jar",1200\n`;
    const { rows } = await parseSpreadsheet(new TextEncoder().encode(text).buffer as ArrayBuffer, "s.csv");
    expect(rows[0].values).toEqual({ sku: "LJC-01", name: "Lavender, Jar", qty: "1200" });
  });

  it("rejects other file types", async () => {
    await expect(parseSpreadsheet(new ArrayBuffer(4), "old.xls")).rejects.toThrow(ValidationError);
  });
});
```

```typescript
// tests/domain/imports.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { importProducts, mapProductRows, mapOpeningStockRows } from "@/domain/imports";
import { previewOpeningStock, importOpeningStock, getCurrentStock } from "@/domain/stock";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeProduct, makeUser } from "../helpers/factories";

const row = (rowNumber: number, values: Record<string, string>) => ({ rowNumber, values });

describe("product import", () => {
  beforeEach(resetDb);

  it("creates new SKUs and updates existing ones after a clean dry run", async () => {
    const owner = await makeUser("OWNER");
    await makeProduct({ sku: "LJC-01", name: "Old Name" });
    const rows = mapProductRows([
      row(2, { sku: "LJC-01", name: "Lavender Jar", hsn: "3406", gst: "18", price: "150" }),
      row(3, { code: "RJC-01", productname: "Rose Jar", hsncode: "3406", gstrate: "18", rate: "140", uom: "box" }),
    ]);
    const dry = await importProducts(owner, { rows, dryRun: true });
    expect(dry).toMatchObject({ errors: [], toCreate: 1, toUpdate: 1, created: 0, updated: 0 });

    const done = await importProducts(owner, { rows, dryRun: false });
    expect(done).toMatchObject({ errors: [], created: 1, updated: 1 });
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: "RJC-01" } })).unit).toBe("box");
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: "LJC-01" } })).name).toBe("Lavender Jar");
  });

  it("reports row-numbered problems and writes nothing", async () => {
    const owner = await makeUser("OWNER");
    const rows = mapProductRows([
      row(2, { sku: "A1", name: "Ok", hsn: "3406", gst: "18", price: "10" }),
      row(3, { sku: "A1", name: "Duplicate", hsn: "3406", gst: "18", price: "10" }),
      row(4, { sku: "B1", name: "Bad HSN", hsn: "34", gst: "18", price: "10" }),
    ]);
    const result = await importProducts(owner, { rows, dryRun: false });
    expect(result.errors.map((e) => e.rowNumber)).toEqual([3, 4]);
    expect(await prisma.product.count()).toBe(0);
  });
});

describe("opening stock import", () => {
  beforeEach(resetDb);

  it("previews problems: unknown SKU, bad quantity, duplicate SKU", async () => {
    const owner = await makeUser("OWNER");
    await makeProduct({ sku: "LJC-01" });
    const rows = mapOpeningStockRows([
      row(2, { sku: "LJC-01", qty: "120" }),
      row(3, { sku: "NOPE", qty: "5" }),
      row(4, { sku: "LJC-01", qty: "1" }),
      row(5, { sku: "LJC-01", qty: "-1" }),
    ]);
    const preview = await previewOpeningStock(owner, { importBatchId: "cutover-2026-11-01", rows });
    expect(preview.ready).toHaveLength(1);
    expect(preview.problems.map((p) => p.rowNumber)).toEqual([3, 4, 5]);
    await expect(importOpeningStock(owner, { importBatchId: "cutover-2026-11-01", rows })).rejects.toThrow(ValidationError);
  });

  it("imports once; same batch again is a no-op; a different batch for the same product is refused", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct({ sku: "LJC-01" });
    const rows = mapOpeningStockRows([row(2, { sku: "LJC-01", openingstock: "120" })]);

    expect(await importOpeningStock(owner, { importBatchId: "cutover-a", rows })).toEqual({ imported: 1 });
    expect(await importOpeningStock(owner, { importBatchId: "cutover-a", rows })).toEqual({ imported: 1 });
    expect((await getCurrentStock(prisma, p.id)).toFixed(2)).toBe("120.00");

    const preview = await previewOpeningStock(owner, { importBatchId: "cutover-b", rows });
    expect(preview.problems[0].message).toMatch(/already has opening stock/);
  });

  it("is owner-only", async () => {
    const worker = await makeUser("WORKER");
    await expect(previewOpeningStock(worker, { importBatchId: "x-batch", rows: [] })).rejects.toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/spreadsheet.test.ts tests/domain/imports.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Write `src/lib/spreadsheet.ts`**

```typescript
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { ValidationError } from "@/lib/errors";

export type SheetRow = { rowNumber: number; values: Record<string, string> };
export const MAX_IMPORT_ROWS = 2000;

export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue); // formula
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return String(value.text); // hyperlink
    return "";
  }
  return String(value).trim();
}

async function readMatrix(data: ArrayBuffer, fileName: string): Promise<{ rowNumber: number; cells: string[] }[]> {
  const name = fileName.toLowerCase();
  if (name.endsWith(".csv")) {
    const raw = new TextDecoder("utf-8").decode(data);
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // strip Excel's UTF-8 BOM
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
    return parsed.data.map((cells, i) => ({ rowNumber: i + 1, cells: cells.map((c) => String(c ?? "").trim()) }));
  }
  if (name.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    // exceljs typings for load() vary across @types/node versions; at runtime it accepts a Node Buffer.
    await workbook.xlsx.load(Buffer.from(data) as never);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ValidationError("The Excel file has no sheets.");
    const out: { rowNumber: number; cells: string[] }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cellText(cell.value); });
      out.push({ rowNumber: row.number, cells: Array.from(cells, (c) => c ?? "") });
    });
    return out;
  }
  throw new ValidationError("Upload an Excel (.xlsx) or CSV (.csv) file. Old .xls files: open in Excel and 'Save As' .xlsx.");
}

export async function parseSpreadsheet(data: ArrayBuffer, fileName: string): Promise<{ headers: string[]; rows: SheetRow[] }> {
  const matrix = (await readMatrix(data, fileName)).filter((r) => r.cells.some((c) => c !== ""));
  if (matrix.length === 0) throw new ValidationError("The file is empty.");
  const [headerRow, ...body] = matrix;
  if (body.length > MAX_IMPORT_ROWS) throw new ValidationError(`Too many rows (max ${MAX_IMPORT_ROWS}). Split the file.`);
  const headers = headerRow.cells.map(normaliseHeader);
  const rows = body.map(({ rowNumber, cells }) => ({
    rowNumber,
    values: Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()]).filter(([h]) => h !== "")),
  }));
  return { headers, rows };
}
```

- [ ] **Step 4: Write `src/domain/imports.ts`**

```typescript
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import type { SheetRow } from "@/lib/spreadsheet";
import { toFixed2 } from "@/lib/money";
import { parseInput } from "@/lib/validation";
import { productSchema } from "@/domain/products";

function pick(values: Record<string, string>, aliases: string[]): string | undefined {
  for (const alias of aliases) if (values[alias] !== undefined && values[alias] !== "") return values[alias];
  return undefined;
}

export type ProductRowInput = { rowNumber: number; sku?: string; name?: string; hsnCode?: string; gstRate?: string; unitPrice?: string; unit?: string; reorderLevel?: string };
export type OpeningRowInput = { rowNumber: number; sku?: string; quantity?: string };

export function mapProductRows(rows: SheetRow[]): ProductRowInput[] {
  return rows.map(({ rowNumber, values: v }) => ({
    rowNumber,
    sku: pick(v, ["sku", "code", "itemcode"]),
    name: pick(v, ["name", "productname", "item"]),
    hsnCode: pick(v, ["hsn", "hsncode"]),
    gstRate: pick(v, ["gst", "gstrate", "gstpercent", "taxrate"]),
    unitPrice: pick(v, ["price", "unitprice", "rate", "mrp"]),
    unit: pick(v, ["unit", "uom"]),
    reorderLevel: pick(v, ["reorderlevel", "reorder", "minstock"]),
  }));
}

export function mapOpeningStockRows(rows: SheetRow[]): OpeningRowInput[] {
  return rows.map(({ rowNumber, values: v }) => ({
    rowNumber,
    sku: pick(v, ["sku", "code", "itemcode"]),
    quantity: pick(v, ["quantity", "qty", "stock", "openingstock"]),
  }));
}

const importProductsSchema = z.object({
  rows: z.array(z.object({ rowNumber: z.number().int() }).passthrough()).max(2000),
  dryRun: z.boolean().default(true),
});

export async function importProducts(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { rows, dryRun } = parseInput(importProductsSchema, rawInput);

  const errors: { rowNumber: number; message: string }[] = [];
  const valid: z.output<typeof productSchema>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const result = productSchema.safeParse(row);
    if (!result.success) {
      errors.push({ rowNumber: row.rowNumber, message: result.error.issues[0]?.message ?? "Invalid row" });
    } else if (seen.has(result.data.sku)) {
      errors.push({ rowNumber: row.rowNumber, message: `SKU ${result.data.sku} appears more than once in the file` });
    } else {
      seen.add(result.data.sku);
      valid.push(result.data);
    }
  }

  const existing = new Set(
    (await prisma.product.findMany({ where: { sku: { in: valid.map((v) => v.sku) } }, select: { sku: true } })).map((p) => p.sku)
  );
  const summary = { errors, toCreate: valid.filter((v) => !existing.has(v.sku)).length, toUpdate: valid.filter((v) => existing.has(v.sku)).length, created: 0, updated: 0 };
  if (dryRun || errors.length > 0) return summary;

  await prisma.$transaction(async (tx) => {
    for (const p of valid) {
      const data = { ...p, unitPrice: toFixed2(p.unitPrice), gstRate: toFixed2(p.gstRate), reorderLevel: toFixed2(p.reorderLevel) };
      await tx.product.upsert({ where: { sku: p.sku }, create: data, update: data });
    }
  });
  return { ...summary, created: summary.toCreate, updated: summary.toUpdate };
}
```

- [ ] **Step 5: Append opening-stock import to `src/domain/stock.ts`**

Add `import { nonNegativeQuantity } from "@/lib/validation";` to the existing validation import list, and `import { ValidationError } from "@/lib/errors";` if not already imported. Then append:

```typescript
const openingImportSchema = z.object({
  importBatchId: z.string().trim().min(3).max(100),
  rows: z.array(z.object({ rowNumber: z.number().int(), sku: z.string().optional(), quantity: z.string().optional() })).max(2000),
});

export type OpeningPreview = {
  ready: { rowNumber: number; productId: string; sku: string; name: string; quantity: string }[];
  problems: { rowNumber: number; sku: string; message: string }[];
};

const openingKey = (batch: string, productId: string) => `opening:${batch}:${productId}`;

async function buildOpeningPreview(db: Db, input: z.output<typeof openingImportSchema>): Promise<OpeningPreview> {
  const skus = input.rows.map((r) => (r.sku ?? "").trim().toUpperCase()).filter(Boolean);
  const products = await db.product.findMany({ where: { sku: { in: skus } } });
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const priorOpenings = await db.stockLedgerEntry.findMany({
    where: { type: "OPENING", productId: { in: products.map((p) => p.id) } },
    select: { productId: true, idempotencyKey: true },
  });

  const ready: OpeningPreview["ready"] = [];
  const problems: OpeningPreview["problems"] = [];
  const seen = new Set<string>();

  for (const row of input.rows) {
    const sku = (row.sku ?? "").trim().toUpperCase();
    const qty = nonNegativeQuantity.safeParse(row.quantity ?? "");
    const product = bySku.get(sku);
    const fail = (message: string) => problems.push({ rowNumber: row.rowNumber, sku, message });

    if (!sku) fail("SKU is missing");
    else if (seen.has(sku)) fail(`SKU ${sku} appears more than once in the file`);
    else if (!product) fail(`No product with SKU ${sku}. Add or import it first.`);
    else if (!product.isActive) fail(`${product.name} is inactive`);
    else if (!qty.success) fail(qty.error.issues[0]?.message ?? "Invalid quantity");
    else if (priorOpenings.some((o) => o.productId === product.id && o.idempotencyKey !== openingKey(input.importBatchId, product.id))) {
      fail(`${product.name} already has opening stock from an earlier import. Use a stock count to correct it.`);
    } else {
      ready.push({ rowNumber: row.rowNumber, productId: product.id, sku, name: product.name, quantity: qty.data });
    }
    if (sku) seen.add(sku);
  }
  return { ready, problems };
}

export async function previewOpeningStock(session: Session | null, rawInput: unknown): Promise<OpeningPreview> {
  requireRole(session, ["OWNER"]);
  return buildOpeningPreview(prisma, parseInput(openingImportSchema, rawInput));
}

export async function importOpeningStock(session: Session | null, rawInput: unknown): Promise<{ imported: number }> {
  requireRole(session, ["OWNER"]);
  const input = parseInput(openingImportSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    const preview = await buildOpeningPreview(tx, input);
    if (preview.problems.length > 0) {
      throw new ValidationError(`Fix ${preview.problems.length} problem(s) in the file before importing.`);
    }
    for (const line of preview.ready) {
      if (D(line.quantity).isZero()) continue;
      await writeLedgerEntry(tx, {
        productId: line.productId, quantityDelta: line.quantity, type: "OPENING",
        reason: `Opening stock import ${input.importBatchId}`, createdBy: session.userId,
        idempotencyKey: openingKey(input.importBatchId, line.productId),
      });
    }
    return { imported: preview.ready.length };
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm run lint
git add src/lib/spreadsheet.ts src/domain/imports.ts src/domain/stock.ts tests
git commit -m "feat: add Excel/CSV import for products and opening stock with preview"
```

---

### Task 14: Bill Preview — Live Stock, Combined-Line Shortfall, Tax

**Files:**
- Create: `src/domain/billing.ts`
- Test: `tests/domain/billing-preview.test.ts`

**Interfaces:**
- Consumes: `requireBusinessProfile` (Task 11), `getStockLevels` (Task 7), `computeLine`/`computeTotals`/`isInterState` (Task 10), validators (Task 4).
- Produces:
  - Schemas `billLineSchema`, `billDraftSchema` (`customerId`, `placeOfSupply` state code, `deliveryAddress?`, `notes?`, `lines[1..100]` of `{ productId, quantity, unitPrice?, discountAmount? }`), and `PAYMENT_METHODS`.
  - `previewBill(session, draft)` → `BillPreview` (OWNER). The preview has totals, `interState`, `placeOfSupplyName`, `hasShortfall`, and `lines[]` with `availableBefore` and `shortfallQuantity`. It is read-only.
  - Internal `computeBill(db, draft)`, shared with `createBill` (Task 15) so the commit recomputes everything from current data rather than trusting a preview (spec §4 principle 5).
  - Stock availability is tracked **across lines**, so two lines of one product are checked against their combined quantity.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/billing-preview.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { previewBill } from "@/domain/billing";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { addStock, makeCustomer, makeProduct, makeUser, setupBillingWorld, MAHARASHTRA } from "../helpers/factories";

const s = (v: { toFixed(n: number): string }) => v.toFixed(2);

describe("previewBill", () => {
  beforeEach(resetDb);

  it("prices an in-stock intra-state bill", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const preview = await previewBill(owner, { customerId: customer.id, placeOfSupply: "21", lines: [{ productId: product.id, quantity: "10" }] });
    expect(preview.interState).toBe(false);
    expect(preview.hasShortfall).toBe(false);
    expect(s(preview.lines[0].availableBefore)).toBe("100.00");
    expect([s(preview.cgstTotal), s(preview.sgstTotal), s(preview.grandTotal)]).toEqual(["135.00", "135.00", "1770.00"]);
  });

  it("charges IGST when the place of supply is another state", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const preview = await previewBill(owner, { customerId: customer.id, placeOfSupply: MAHARASHTRA, lines: [{ productId: product.id, quantity: "10" }] });
    expect(preview.interState).toBe(true);
    expect(preview.placeOfSupplyName).toBe("Maharashtra");
    expect(s(preview.igstTotal)).toBe("270.00");
  });

  it("detects a shortfall across two lines of the same product", async () => {
    const { owner, customer } = await setupBillingWorld();
    const scarce = await makeProduct();
    await addStock(scarce.id, "8.00");
    const preview = await previewBill(owner, {
      customerId: customer.id, placeOfSupply: "21",
      lines: [{ productId: scarce.id, quantity: "5" }, { productId: scarce.id, quantity: "5" }],
    });
    expect(preview.lines[0].shortfallQuantity).toBeNull();
    expect(s(preview.lines[1].availableBefore)).toBe("3.00");
    expect(s(preview.lines[1].shortfallQuantity!)).toBe("2.00");
    expect(preview.hasShortfall).toBe(true);
  });

  it("applies a price override and a line discount", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const preview = await previewBill(owner, {
      customerId: customer.id, placeOfSupply: "21",
      lines: [{ productId: product.id, quantity: "10", unitPrice: "140", discountAmount: "100" }],
    });
    expect([s(preview.lines[0].taxableValue), s(preview.grandTotal)]).toEqual(["1300.00", "1534.00"]);
  });

  it("explains what is missing or wrong", async () => {
    const owner = await makeUser("OWNER");
    const customer = await makeCustomer();
    const product = await makeProduct();
    await expect(previewBill(owner, { customerId: customer.id, placeOfSupply: "21", lines: [{ productId: product.id, quantity: "1" }] }))
      .rejects.toMatchObject({ code: "SETUP_INCOMPLETE" });

    const world = await setupBillingWorld();
    await prisma.product.update({ where: { id: world.product.id }, data: { isActive: false } });
    await expect(previewBill(world.owner, { customerId: world.customer.id, placeOfSupply: "21", lines: [{ productId: world.product.id, quantity: "1" }] }))
      .rejects.toMatchObject({ code: "PRODUCT_INACTIVE" });
    await expect(previewBill(world.owner, { customerId: world.customer.id, placeOfSupply: "21", lines: [] })).rejects.toThrow(ValidationError);
    await expect(previewBill(world.worker, { customerId: world.customer.id, placeOfSupply: "21", lines: [] })).rejects.toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/billing-preview.test.ts`
Expected: FAIL, because `@/domain/billing` doesn't exist yet.

- [ ] **Step 3: Write `src/domain/billing.ts`**

```typescript
import Decimal from "decimal.js";
import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { stateName } from "@/lib/gst";
import { D, ZERO } from "@/lib/money";
import { entityId, money, optionalText, parseInput, quantity, stateCode } from "@/lib/validation";
import { computeLine, computeTotals, isInterState, type DocumentTotals, type LineAmounts } from "@/domain/tax";
import { getStockLevels } from "@/domain/stock";
import { requireBusinessProfile } from "@/domain/settings";

export const PAYMENT_METHODS = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"] as const;

export const billLineSchema = z.object({
  productId: entityId,
  quantity,
  unitPrice: money.optional(),
  discountAmount: money.optional(),
});

export const billDraftSchema = z.object({
  customerId: entityId,
  placeOfSupply: stateCode,
  deliveryAddress: optionalText(300),
  notes: optionalText(500),
  lines: z.array(billLineSchema).min(1, "Add at least one item.").max(100, "A bill can have at most 100 lines."),
});

export type BillDraft = z.output<typeof billDraftSchema>;

export type PreviewLine = LineAmounts & {
  productId: string; productName: string; productSku: string; hsnCode: string; unit: string;
  quantity: Decimal; unitPrice: Decimal; gstRate: Decimal;
  availableBefore: Decimal; shortfallQuantity: Decimal | null;
};

export type BillPreview = DocumentTotals & {
  customerId: string; customerName: string; placeOfSupply: string; placeOfSupplyName: string;
  interState: boolean; hasShortfall: boolean; lines: PreviewLine[];
};

/** Shared by previewBill and createBill: always computed from current database state. */
export async function computeBill(db: Db, draft: BillDraft) {
  const profile = await requireBusinessProfile(db);
  const customer = await db.customer.findUnique({ where: { id: draft.customerId } });
  if (!customer) throw new NotFoundError("Customer");
  if (!customer.isActive) throw new DomainError("CUSTOMER_INACTIVE", `${customer.name} is marked inactive.`);

  const productIds = [...new Set(draft.lines.map((l) => l.productId))];
  const products = new Map((await db.product.findMany({ where: { id: { in: productIds } } })).map((p) => [p.id, p]));
  const remaining = await getStockLevels(db, productIds);
  const interState = isInterState(profile.stateCode, draft.placeOfSupply);

  const lines: PreviewLine[] = draft.lines.map((line, index) => {
    const product = products.get(line.productId);
    if (!product) throw new NotFoundError(`Product on line ${index + 1}`);
    if (!product.isActive) throw new DomainError("PRODUCT_INACTIVE", `${product.name} is marked inactive.`);

    const qty = D(line.quantity);
    const unitPrice = D(line.unitPrice ?? product.unitPrice);
    let amounts: LineAmounts;
    try {
      amounts = computeLine({ quantity: qty, unitPrice, discountAmount: line.discountAmount, gstRate: product.gstRate }, interState);
    } catch (error) {
      if (error instanceof ValidationError) throw new ValidationError(`Line ${index + 1} (${product.name}): ${error.message}`);
      throw error;
    }

    const availableBefore = remaining.get(product.id) ?? ZERO;
    const usable = Decimal.max(availableBefore, ZERO);
    remaining.set(product.id, availableBefore.minus(qty));

    return {
      ...amounts,
      productId: product.id, productName: product.name, productSku: product.sku, hsnCode: product.hsnCode, unit: product.unit,
      quantity: qty, unitPrice, gstRate: D(product.gstRate),
      availableBefore, shortfallQuantity: qty.greaterThan(usable) ? qty.minus(usable) : null,
    };
  });

  const preview: BillPreview = {
    ...computeTotals(lines),
    customerId: customer.id, customerName: customer.name,
    placeOfSupply: draft.placeOfSupply, placeOfSupplyName: stateName(draft.placeOfSupply),
    interState, hasShortfall: lines.some((l) => l.shortfallQuantity !== null), lines,
  };
  return { preview, profile, customer };
}

export async function previewBill(session: Session | null, rawInput: unknown): Promise<BillPreview> {
  requireRole(session, ["OWNER"]);
  return (await computeBill(prisma, parseInput(billDraftSchema, rawInput))).preview;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/billing-preview.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/billing.ts tests/domain/billing-preview.test.ts
git commit -m "feat: add bill preview with cross-line stock check"
```

---

### Task 15: Create Bill — Atomic Commit, Shortfall Confirmation, Double-Submit Safety

**Files:**
- Modify: `src/domain/billing.ts` (append)
- Test: `tests/domain/billing-create.test.ts`

**Interfaces:**
- Consumes: `computeBill` (Task 14), `allocateNumber` (Task 9), `writeLedgerEntry` (Task 7), `isUniqueConstraintError` (Task 6), `financialYearOf` (Task 4).
- Produces: `createBillSchema` (= draft + `idempotencyKey`, `confirmShortfall` (default false), optional `initialPayment { amount, method, reference? }`), and `createBill(session, input)` → `Bill & { lineItems: BillLineItem[] }` (OWNER). It does all of this in **one** transaction:
  - recomputes the bill and refuses an unconfirmed shortfall (`SHORTFALL_NOT_CONFIRMED`);
  - allocates the invoice number;
  - snapshots supplier, customer and product details;
  - posts one `BILLED` ledger row per line (`sourceReference = "bill_line:<id>"`);
  - records the initial payment;
  - queues an IRP job only if e-invoicing applies **and** the customer has a GSTIN.

  A duplicate key, sequential or concurrent, returns the original bill.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/billing-create.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { getCurrentStock } from "@/domain/stock";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeBusinessProfile, makeCustomer, setupBillingWorld, ODISHA_CUSTOMER_GSTIN } from "../helpers/factories";

const stock = async (id: string) => (await getCurrentStock(prisma, id)).toFixed(2);

describe("createBill", () => {
  beforeEach(resetDb);

  it("commits bill, number, snapshots and stock deduction together", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const bill = await createBill(owner, {
      customerId: customer.id, placeOfSupply: "21", idempotencyKey: "bill-key-0001",
      lines: [{ productId: product.id, quantity: "10" }],
    });

    expect(bill.invoiceNumber).toMatch(/^TC\/\d{4}\/00001$/);
    expect(bill.grandTotal.toString()).toBe("1770");
    expect(bill.customerName).toBe(customer.name);
    expect(bill.supplierGstin).toBe("21AAAAA0000A1ZE");
    expect(await stock(product.id)).toBe("90.00");

    const entry = await prisma.stockLedgerEntry.findFirstOrThrow({ where: { type: "BILLED" } });
    expect(entry.sourceReference).toBe(`bill_line:${bill.lineItems[0].id}`);

    // Later catalogue edits must not change a posted invoice.
    await prisma.product.update({ where: { id: product.id }, data: { name: "Renamed", unitPrice: "999.00" } });
    const reread = await prisma.billLineItem.findFirstOrThrow({ where: { billId: bill.id } });
    expect([reread.productName, reread.unitPrice.toString()]).toEqual([product.name, "150"]);
  });

  it("refuses an unconfirmed shortfall without consuming a number, then bills it when confirmed", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const draft = { customerId: customer.id, placeOfSupply: "21", lines: [{ productId: product.id, quantity: "150" }] };

    await expect(createBill(owner, { ...draft, idempotencyKey: "bill-key-0002" })).rejects.toMatchObject({ code: "SHORTFALL_NOT_CONFIRMED" });
    expect(await prisma.bill.count()).toBe(0);

    const bill = await createBill(owner, { ...draft, idempotencyKey: "bill-key-0003", confirmShortfall: true });
    expect(bill.invoiceNumber.endsWith("/00001")).toBe(true); // the refused attempt did not burn a number
    expect(bill.lineItems[0].shortfallQuantity?.toString()).toBe("50");
    expect(await stock(product.id)).toBe("-50.00");
  });

  it("returns the original bill for a replayed key", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const input = { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "bill-key-0004", lines: [{ productId: product.id, quantity: "10" }] };
    const first = await createBill(owner, input);
    const second = await createBill(owner, input);
    expect(second.id).toBe(first.id);
    expect(await prisma.bill.count()).toBe(1);
    expect(await stock(product.id)).toBe("90.00");
  });

  it("survives a double-tapped Finalize (two identical requests at once)", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const input = { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "bill-key-0005", lines: [{ productId: product.id, quantity: "10" }] };
    const [a, b] = await Promise.all([createBill(owner, input), createBill(owner, input)]);
    expect(a.id).toBe(b.id);
    expect(await prisma.bill.count()).toBe(1);
    expect(await stock(product.id)).toBe("90.00");

    const next = await createBill(owner, { ...input, idempotencyKey: "bill-key-0006" });
    expect(next.invoiceNumber.endsWith("/00002")).toBe(true); // still gapless
  });

  it("applies two different concurrent bills exactly once each", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const base = { customerId: customer.id, placeOfSupply: "21" };
    const [a, b] = await Promise.all([
      createBill(owner, { ...base, idempotencyKey: "bill-key-0007", lines: [{ productId: product.id, quantity: "10" }] }),
      createBill(owner, { ...base, idempotencyKey: "bill-key-0008", lines: [{ productId: product.id, quantity: "15" }] }),
    ]);
    expect(a.invoiceNumber).not.toBe(b.invoiceNumber);
    expect(await stock(product.id)).toBe("75.00");
  });

  it("records payment received at billing, but not more than the total", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const base = { customerId: customer.id, placeOfSupply: "21", lines: [{ productId: product.id, quantity: "10" }] };
    const bill = await createBill(owner, { ...base, idempotencyKey: "bill-key-0009", initialPayment: { amount: "500", method: "UPI" } });
    expect((await prisma.paymentLogEntry.findFirstOrThrow({ where: { billId: bill.id } })).amount.toString()).toBe("500");
    await expect(createBill(owner, { ...base, idempotencyKey: "bill-key-0010", initialPayment: { amount: "5000", method: "CASH" } }))
      .rejects.toThrow(ValidationError);
  });

  it("queues e-invoice submission only for registered (B2B) customers when e-invoicing applies", async () => {
    const { owner, customer: b2c, product } = await setupBillingWorld();
    await makeBusinessProfile({ einvoicingApplicable: true });
    const b2b = await makeCustomer({ gstin: ODISHA_CUSTOMER_GSTIN });
    const line = [{ productId: product.id, quantity: "1" }];

    const b2cBill = await createBill(owner, { customerId: b2c.id, placeOfSupply: "21", idempotencyKey: "bill-key-0011", lines: line });
    const b2bBill = await createBill(owner, { customerId: b2b.id, placeOfSupply: "21", idempotencyKey: "bill-key-0012", lines: line });
    expect(await prisma.irpSubmission.findUnique({ where: { billId: b2cBill.id } })).toBeNull();
    expect((await prisma.irpSubmission.findUniqueOrThrow({ where: { billId: b2bBill.id } })).status).toBe("PENDING");
  });

  it("rejects workers", async () => {
    const { worker, customer, product } = await setupBillingWorld();
    await expect(createBill(worker, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "bill-key-0013", lines: [{ productId: product.id, quantity: "1" }] }))
      .rejects.toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/billing-create.test.ts`
Expected: FAIL, because `createBill` is not exported yet.

- [ ] **Step 3: Append `createBill` to `src/domain/billing.ts`**

Add to the imports at the top:
```typescript
import type { Bill, BillLineItem } from "@/generated/prisma/client";
import { toFixed2 } from "@/lib/money";
import { financialYearOf } from "@/lib/time";
import { idempotencyKey, positiveMoney } from "@/lib/validation";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { allocateNumber } from "@/domain/numbering";
import { writeLedgerEntry } from "@/domain/stock";
```
(Merge with the existing import lines from the same modules; don't duplicate them.)

Append:
```typescript
export const createBillSchema = billDraftSchema.extend({
  idempotencyKey,
  confirmShortfall: z.boolean().default(false),
  initialPayment: z.object({ amount: positiveMoney, method: z.enum(PAYMENT_METHODS), reference: optionalText(100) }).optional(),
});

export type CreatedBill = Bill & { lineItems: BillLineItem[] };
const withLines = { lineItems: { orderBy: { lineNo: "asc" as const } } };

function describeShortfall(preview: BillPreview): string {
  const items = preview.lines
    .filter((l) => l.shortfallQuantity)
    .map((l) => `${l.productName} (short by ${l.shortfallQuantity!.toString()})`)
    .join(", ");
  return `Not enough stock: ${items}. Confirm to bill anyway; the shortfall will be recorded as still owed.`;
}

export async function createBill(session: Session | null, rawInput: unknown): Promise<CreatedBill> {
  requireRole(session, ["OWNER"]);
  const input = parseInput(createBillSchema, rawInput);
  const key = `bill:${input.idempotencyKey}`;

  const existing = await prisma.bill.findUnique({ where: { idempotencyKey: key }, include: withLines });
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      const { preview, profile, customer } = await computeBill(tx, input);
      if (preview.hasShortfall && !input.confirmShortfall) {
        throw new DomainError("SHORTFALL_NOT_CONFIRMED", describeShortfall(preview));
      }
      if (input.initialPayment && D(input.initialPayment.amount).greaterThan(preview.grandTotal)) {
        throw new ValidationError("Payment received cannot be more than the bill total.");
      }

      const financialYear = financialYearOf();
      const invoiceNumber = await allocateNumber(tx, "INVOICE", financialYear);

      const bill = await tx.bill.create({
        data: {
          invoiceNumber, financialYear, customerId: customer.id,
          customerName: customer.name, customerGstin: customer.gstin, customerAddress: customer.billingAddress,
          customerStateCode: customer.stateCode, customerPhone: customer.phone,
          supplierLegalName: profile.legalName, supplierGstin: profile.gstin, supplierStateCode: profile.stateCode,
          supplierAddress: [profile.addressLine1, profile.addressLine2, `${profile.city} - ${profile.pincode}`].filter(Boolean).join(", "),
          placeOfSupply: preview.placeOfSupply, deliveryAddress: input.deliveryAddress ?? "", notes: input.notes ?? null,
          grossTotal: toFixed2(preview.grossTotal), discountTotal: toFixed2(preview.discountTotal),
          taxableTotal: toFixed2(preview.taxableTotal), cgstTotal: toFixed2(preview.cgstTotal),
          sgstTotal: toFixed2(preview.sgstTotal), igstTotal: toFixed2(preview.igstTotal),
          taxTotal: toFixed2(preview.taxTotal), roundOff: toFixed2(preview.roundOff), grandTotal: toFixed2(preview.grandTotal),
          createdBy: session.userId, idempotencyKey: key,
          lineItems: {
            create: preview.lines.map((l, i) => ({
              lineNo: i + 1, productId: l.productId, productName: l.productName, productSku: l.productSku,
              hsnCode: l.hsnCode, unit: l.unit, quantity: toFixed2(l.quantity), unitPrice: toFixed2(l.unitPrice),
              discountAmount: toFixed2(l.discountAmount), taxableValue: toFixed2(l.taxableValue), gstRate: toFixed2(l.gstRate),
              cgstAmount: toFixed2(l.cgstAmount), sgstAmount: toFixed2(l.sgstAmount), igstAmount: toFixed2(l.igstAmount),
              lineTotal: toFixed2(l.lineTotal), shortfallQuantity: l.shortfallQuantity ? toFixed2(l.shortfallQuantity) : null,
            })),
          },
        },
        include: withLines,
      });

      for (const line of bill.lineItems) {
        await writeLedgerEntry(tx, {
          productId: line.productId, quantityDelta: D(line.quantity).negated(), type: "BILLED",
          reason: `Invoice ${invoiceNumber}`, sourceReference: `bill_line:${line.id}`,
          createdBy: session.userId, idempotencyKey: `bill-line:${line.id}`,
        });
      }

      if (input.initialPayment) {
        await tx.paymentLogEntry.create({
          data: {
            billId: bill.id, amount: toFixed2(input.initialPayment.amount), method: input.initialPayment.method,
            reference: input.initialPayment.reference ?? null, recordedBy: session.userId, idempotencyKey: `${key}:initial-payment`,
          },
        });
      }

      if (profile.einvoicingApplicable && customer.gstin) {
        await tx.irpSubmission.create({ data: { documentType: "INVOICE", billId: bill.id } });
      }
      return bill;
    });
  } catch (error) {
    // A concurrent duplicate lost the race on the unique key; its transaction (and invoice number) rolled back.
    if (isUniqueConstraintError(error)) {
      const winner = await prisma.bill.findUnique({ where: { idempotencyKey: key }, include: withLines });
      if (winner) return winner;
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS. If the double-tap test fails with a Prisma transaction timeout, check that `src/lib/db.ts` sets `transactionOptions` (Task 1, Step 9).

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/billing.ts tests/domain/billing-create.test.ts
git commit -m "feat: add atomic bill creation with shortfall confirmation and double-submit safety"
```

---

### Task 16: Payments — Installments, Refunds, Derived Status

**Files:**
- Create: `src/domain/payments.ts`
- Test: `tests/domain/payments.test.ts`

**Interfaces:**
- Consumes: `PAYMENT_METHODS` (Task 14), `Bill`/`PaymentLogEntry`/`CreditNote` models.
- Produces:
  - `recordPayment(session, { billId, amount, method, reference?, note?, paidAt?, idempotencyKey })` (OWNER). `amount` is signed: negative is a refund. Overpaying the balance is refused. So is refunding more than was received.
  - `getPaymentSummaries(db, billIds)` → `Map<billId, PaymentSummary>`, and `getPaymentSummary(db, billId)` → `PaymentSummary`.
  - `PaymentSummary = { billId, grandTotal, creditedTotal, netReceivable, amountPaid, amountDue, status: "PAID" | "PARTIAL" | "UNPAID" }`. Credit notes reduce `netReceivable`; this was a v1 gap. Nothing is stored as a mutable total. The spec's "credit" status is shown to users as *Unpaid (on credit)*.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/payments.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { recordPayment, getPaymentSummary } from "@/domain/payments";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { setupBillingWorld } from "../helpers/factories";

async function billOf1770() {
  const world = await setupBillingWorld();
  const bill = await createBill(world.owner, {
    customerId: world.customer.id, placeOfSupply: "21", idempotencyKey: "pay-bill-0001",
    lines: [{ productId: world.product.id, quantity: "10" }],
  });
  return { ...world, bill };
}
const pay = (amount: string, key: string, method = "CASH") => ({ amount, method, idempotencyKey: key });

describe("payments", () => {
  beforeEach(resetDb);

  it("moves from UNPAID to PARTIAL to PAID across installments", async () => {
    const { owner, bill } = await billOf1770();
    expect(await getPaymentSummary(prisma, bill.id)).toMatchObject({ status: "UNPAID" });

    await recordPayment(owner, { billId: bill.id, ...pay("500", "pay-key-0001") });
    const partial = await getPaymentSummary(prisma, bill.id);
    expect([partial.status, partial.amountDue.toFixed(2)]).toEqual(["PARTIAL", "1270.00"]);

    await recordPayment(owner, { billId: bill.id, ...pay("1270", "pay-key-0002", "UPI") });
    const paid = await getPaymentSummary(prisma, bill.id);
    expect([paid.status, paid.amountDue.toFixed(2)]).toEqual(["PAID", "0.00"]);
  });

  it("refuses overpayment and over-refund, allows a valid refund", async () => {
    const { owner, bill } = await billOf1770();
    await expect(recordPayment(owner, { billId: bill.id, ...pay("1771", "pay-key-0003") })).rejects.toThrow(ValidationError);
    await recordPayment(owner, { billId: bill.id, ...pay("1770", "pay-key-0004") });
    await expect(recordPayment(owner, { billId: bill.id, ...pay("-1771", "pay-key-0005") })).rejects.toThrow(ValidationError);
    await recordPayment(owner, { billId: bill.id, ...pay("-200", "pay-key-0006"), note: "Refund for 1 damaged unit" });
    expect((await getPaymentSummary(prisma, bill.id)).amountPaid.toFixed(2)).toBe("1570.00");
  });

  it("returns the original entry for a replayed key", async () => {
    const { owner, bill } = await billOf1770();
    const a = await recordPayment(owner, { billId: bill.id, ...pay("100", "pay-key-0007") });
    const b = await recordPayment(owner, { billId: bill.id, ...pay("100", "pay-key-0007") });
    expect(b.id).toBe(a.id);
    expect(await prisma.paymentLogEntry.count({ where: { billId: bill.id } })).toBe(1);
  });

  it("is owner-only", async () => {
    const { worker, bill } = await billOf1770();
    await expect(recordPayment(worker, { billId: bill.id, ...pay("100", "pay-key-0008") })).rejects.toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/payments.test.ts`
Expected: FAIL, because the module doesn't exist yet.

- [ ] **Step 3: Write `src/domain/payments.ts`**

```typescript
import Decimal from "decimal.js";
import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import type { PaymentLogEntry } from "@/generated/prisma/client";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { D, ZERO, formatINR, toFixed2 } from "@/lib/money";
import { entityId, idempotencyKey, optionalText, parseInput, signedMoney } from "@/lib/validation";
import { PAYMENT_METHODS } from "@/domain/billing";

export type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID";
export type PaymentSummary = {
  billId: string; grandTotal: Decimal; creditedTotal: Decimal; netReceivable: Decimal;
  amountPaid: Decimal; amountDue: Decimal; status: PaymentStatus;
};

export async function getPaymentSummaries(db: Db, billIds: string[]): Promise<Map<string, PaymentSummary>> {
  if (billIds.length === 0) return new Map();
  const [bills, paid, credited] = await Promise.all([
    db.bill.findMany({ where: { id: { in: billIds } }, select: { id: true, grandTotal: true } }),
    db.paymentLogEntry.groupBy({ by: ["billId"], where: { billId: { in: billIds } }, _sum: { amount: true } }),
    db.creditNote.groupBy({ by: ["billId"], where: { billId: { in: billIds } }, _sum: { grandTotal: true } }),
  ]);
  const paidBy = new Map(paid.map((p) => [p.billId, D(p._sum.amount ?? 0)]));
  const creditedBy = new Map(credited.map((c) => [c.billId, D(c._sum.grandTotal ?? 0)]));

  return new Map(bills.map((b) => {
    const grandTotal = D(b.grandTotal);
    const creditedTotal = creditedBy.get(b.id) ?? ZERO;
    const amountPaid = paidBy.get(b.id) ?? ZERO;
    const netReceivable = Decimal.max(grandTotal.minus(creditedTotal), ZERO);
    const amountDue = netReceivable.minus(amountPaid);
    const status: PaymentStatus = amountDue.lessThanOrEqualTo(0) ? "PAID" : amountPaid.greaterThan(0) ? "PARTIAL" : "UNPAID";
    return [b.id, { billId: b.id, grandTotal, creditedTotal, netReceivable, amountPaid, amountDue, status }];
  }));
}

export async function getPaymentSummary(db: Db, billId: string): Promise<PaymentSummary> {
  const summary = (await getPaymentSummaries(db, [billId])).get(billId);
  if (!summary) throw new NotFoundError("Bill");
  return summary;
}

export const recordPaymentSchema = z.object({
  billId: entityId,
  amount: signedMoney,
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(100),
  note: optionalText(300),
  paidAt: z.coerce.date().optional().refine((d) => !d || d.getTime() <= Date.now() + 5 * 60_000, "Payment date cannot be in the future"),
  idempotencyKey,
});

export async function recordPayment(session: Session | null, rawInput: unknown): Promise<PaymentLogEntry> {
  requireRole(session, ["OWNER"]);
  const input = parseInput(recordPaymentSchema, rawInput);
  const key = `payment:${input.idempotencyKey}`;

  return prisma.$transaction(async (tx) => {
    const replay = await tx.paymentLogEntry.findUnique({ where: { idempotencyKey: key } });
    if (replay) {
      if (replay.billId !== input.billId || !D(replay.amount).equals(D(input.amount))) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "This payment was already recorded with different details.");
      }
      return replay;
    }

    // Serialise payments per bill so balance checks can't race.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "bills" WHERE "id" = ${input.billId} FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError("Bill");

    const summary = await getPaymentSummary(tx, input.billId);
    const amount = D(input.amount);
    if (amount.isPositive() && amount.greaterThan(summary.amountDue)) {
      throw new ValidationError(
        summary.amountDue.lessThanOrEqualTo(0) ? "This bill is already fully paid." : `Amount is more than the balance due (${formatINR(summary.amountDue)}).`
      );
    }
    if (amount.isNegative() && summary.amountPaid.plus(amount).isNegative()) {
      throw new ValidationError(`Refund cannot be more than the amount received (${formatINR(summary.amountPaid)}).`);
    }

    return tx.paymentLogEntry.create({
      data: {
        billId: input.billId, amount: toFixed2(amount), method: input.method,
        reference: input.reference ?? null, note: input.note ?? null, paidAt: input.paidAt ?? new Date(),
        recordedBy: session.userId, idempotencyKey: key,
      },
    });
  });
}
```

(The bill row lock serialises payments for the same bill, so a plain `create` after the replay check is race-free here. Different bills don't block each other.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/payments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/payments.ts tests/domain/payments.test.ts
git commit -m "feat: add payments with installments, refunds and derived status"
```

---

### Task 17: Returns — Credit Notes

**Files:**
- Create: `src/domain/credit-notes.ts`
- Test: `tests/domain/credit-notes.test.ts`

**Interfaces:**
- Consumes: `taxOnTaxableValue`/`computeTotals`/`isInterState` (Task 10), `allocateNumber` (Task 9), `writeLedgerEntry` (Task 7), `requireBusinessProfile` (Task 11), `getPaymentSummary` (Task 16, in tests).
- Produces: `recordReturn(session, { billId, reason, restock (default true), lines: { billLineItemId, quantity }[], idempotencyKey })` → `CreditNote & { lines }` (OWNER).
  - Tax is computed from the **bill's own snapshot**: the same place of supply and rates as the original invoice.
  - A line can never be returned beyond what was billed minus earlier returns. The final return of a line uses the exact remaining taxable value, so rounding never credits more than was invoiced.
  - `restock: false` (damaged goods) issues the credit without adding stock back.
  - An IRP job is queued for B2B bills when e-invoicing applies.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/credit-notes.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { recordReturn } from "@/domain/credit-notes";
import { recordPayment, getPaymentSummary } from "@/domain/payments";
import { getCurrentStock } from "@/domain/stock";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { sumDecimals } from "@/lib/money";
import { resetDb } from "../helpers/db";
import { makeBusinessProfile, makeCustomer, setupBillingWorld, ODISHA_CUSTOMER_GSTIN } from "../helpers/factories";

async function world(lines?: { quantity: string; unitPrice?: string; discountAmount?: string }) {
  const w = await setupBillingWorld();
  const bill = await createBill(w.owner, {
    customerId: w.customer.id, placeOfSupply: "21", idempotencyKey: "cn-bill-0001",
    lines: [{ productId: w.product.id, quantity: "10", ...lines }],
  });
  return { ...w, bill, lineId: bill.lineItems[0].id };
}

describe("recordReturn", () => {
  beforeEach(resetDb);

  it("issues a numbered credit note with the invoice's tax treatment and restocks", async () => {
    const { owner, bill, lineId, product } = await world();
    const note = await recordReturn(owner, { billId: bill.id, reason: "Customer returned 2", lines: [{ billLineItemId: lineId, quantity: "2" }], idempotencyKey: "cn-key-0001" });
    expect(note.creditNoteNumber).toMatch(/^CN\/\d{4}\/00001$/);
    expect([note.taxableTotal.toString(), note.cgstTotal.toString(), note.grandTotal.toString()]).toEqual(["300", "27", "354"]);
    expect((await getCurrentStock(prisma, product.id)).toFixed(2)).toBe("92.00");
  });

  it("does not restock damaged goods when restock is false", async () => {
    const { owner, bill, lineId, product } = await world();
    await recordReturn(owner, { billId: bill.id, reason: "Broken in transit", restock: false, lines: [{ billLineItemId: lineId, quantity: "2" }], idempotencyKey: "cn-key-0002" });
    expect((await getCurrentStock(prisma, product.id)).toFixed(2)).toBe("90.00");
  });

  it("reduces the customer's balance due", async () => {
    const { owner, bill, lineId } = await world();
    await recordPayment(owner, { billId: bill.id, amount: "500", method: "CASH", idempotencyKey: "cn-pay-0001" });
    await recordReturn(owner, { billId: bill.id, reason: "Returned 2", lines: [{ billLineItemId: lineId, quantity: "2" }], idempotencyKey: "cn-key-0003" });
    const summary = await getPaymentSummary(prisma, bill.id);
    expect([summary.netReceivable.toFixed(2), summary.amountDue.toFixed(2), summary.status]).toEqual(["1416.00", "916.00", "PARTIAL"]);
  });

  it("never returns more than was billed", async () => {
    const { owner, bill, lineId } = await world();
    await recordReturn(owner, { billId: bill.id, reason: "First", lines: [{ billLineItemId: lineId, quantity: "9" }], idempotencyKey: "cn-key-0004" });
    await expect(recordReturn(owner, { billId: bill.id, reason: "Second", lines: [{ billLineItemId: lineId, quantity: "2" }], idempotencyKey: "cn-key-0005" }))
      .rejects.toThrow(/Only 1 /);
  });

  it("credits exactly the invoiced taxable value across several partial returns", async () => {
    // 3 × 10.00 − 0.01 discount = 29.99 taxable; per-unit 9.99666…
    const w = await setupBillingWorld();
    const bill = await createBill(w.owner, {
      customerId: w.customer.id, placeOfSupply: "21", idempotencyKey: "cn-bill-0002",
      lines: [{ productId: w.product.id, quantity: "3", unitPrice: "10", discountAmount: "0.01" }],
    });
    const lineId = bill.lineItems[0].id;
    for (const k of ["a", "b", "c"]) {
      await recordReturn(w.owner, { billId: bill.id, reason: "unit", lines: [{ billLineItemId: lineId, quantity: "1" }], idempotencyKey: `cn-key-round-${k}` });
    }
    const lines = await prisma.creditNoteLine.findMany({ where: { billLineItemId: lineId } });
    expect(sumDecimals(lines.map((l) => l.taxableValue)).toFixed(2)).toBe("29.99");
  });

  it("rejects items from other bills, replays by key, and blocks workers", async () => {
    const { owner, worker, bill, lineId } = await world();
    await expect(recordReturn(owner, { billId: bill.id, reason: "x", lines: [{ billLineItemId: "not-on-bill", quantity: "1" }], idempotencyKey: "cn-key-0006" }))
      .rejects.toThrow(ValidationError);
    const input = { billId: bill.id, reason: "Replay", lines: [{ billLineItemId: lineId, quantity: "1" }], idempotencyKey: "cn-key-0007" };
    const a = await recordReturn(owner, input);
    const b = await recordReturn(owner, input);
    expect(b.id).toBe(a.id);
    await expect(recordReturn(worker, { ...input, idempotencyKey: "cn-key-0008" })).rejects.toThrow(ForbiddenError);
  });

  it("queues an e-invoice credit note for B2B bills when e-invoicing applies", async () => {
    const w = await setupBillingWorld();
    await makeBusinessProfile({ einvoicingApplicable: true });
    const b2b = await makeCustomer({ gstin: ODISHA_CUSTOMER_GSTIN });
    const bill = await createBill(w.owner, { customerId: b2b.id, placeOfSupply: "21", idempotencyKey: "cn-bill-0003", lines: [{ productId: w.product.id, quantity: "2" }] });
    const note = await recordReturn(w.owner, { billId: bill.id, reason: "Return", lines: [{ billLineItemId: bill.lineItems[0].id, quantity: "1" }], idempotencyKey: "cn-key-0009" });
    expect((await prisma.irpSubmission.findUniqueOrThrow({ where: { creditNoteId: note.id } })).documentType).toBe("CREDIT_NOTE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/credit-notes.test.ts`
Expected: FAIL, because the module doesn't exist yet.

- [ ] **Step 3: Write `src/domain/credit-notes.ts`**

```typescript
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { CreditNote, CreditNoteLine } from "@/generated/prisma/client";
import { requireRole, type Session } from "@/lib/auth";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { D, ZERO, formatQuantity, round2, toFixed2 } from "@/lib/money";
import { financialYearOf } from "@/lib/time";
import { entityId, idempotencyKey, parseInput, quantity, requiredText } from "@/lib/validation";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { computeTotals, isInterState, taxOnTaxableValue } from "@/domain/tax";
import { allocateNumber } from "@/domain/numbering";
import { requireBusinessProfile } from "@/domain/settings";
import { writeLedgerEntry } from "@/domain/stock";

export const recordReturnSchema = z.object({
  billId: entityId,
  reason: requiredText("Reason", 300),
  restock: z.boolean().default(true),
  lines: z
    .array(z.object({ billLineItemId: entityId, quantity }))
    .min(1, "Choose at least one item to return.")
    .max(100)
    .refine((lines) => new Set(lines.map((l) => l.billLineItemId)).size === lines.length, "Each item can appear only once."),
  idempotencyKey,
});

export type CreatedCreditNote = CreditNote & { lines: CreditNoteLine[] };

export async function recordReturn(session: Session | null, rawInput: unknown): Promise<CreatedCreditNote> {
  requireRole(session, ["OWNER"]);
  const input = parseInput(recordReturnSchema, rawInput);
  const key = `credit-note:${input.idempotencyKey}`;

  const existing = await prisma.creditNote.findUnique({ where: { idempotencyKey: key }, include: { lines: true } });
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialise returns per bill so "already returned" can't race.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "bills" WHERE "id" = ${input.billId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError("Bill");
      const bill = await tx.bill.findUniqueOrThrow({ where: { id: input.billId }, include: { lineItems: true } });
      const profile = await requireBusinessProfile(tx);

      const previous = await tx.creditNoteLine.groupBy({
        by: ["billLineItemId"],
        where: { billLineItemId: { in: bill.lineItems.map((l) => l.id) } },
        _sum: { quantity: true, taxableValue: true },
      });
      const prev = new Map(previous.map((p) => [p.billLineItemId, { qty: D(p._sum.quantity ?? 0), taxable: D(p._sum.taxableValue ?? 0) }]));
      const interState = isInterState(bill.supplierStateCode, bill.placeOfSupply);

      const lines = input.lines.map((requested) => {
        const original = bill.lineItems.find((l) => l.id === requested.billLineItemId);
        if (!original) throw new ValidationError("That item is not on this bill.");
        const already = prev.get(original.id) ?? { qty: ZERO, taxable: ZERO };
        const returnable = D(original.quantity).minus(already.qty);
        const qty = D(requested.quantity);
        if (qty.greaterThan(returnable)) {
          throw new ValidationError(`Only ${formatQuantity(returnable)} of ${original.productName} can still be returned.`);
        }
        const taxableValue = qty.equals(returnable)
          ? D(original.taxableValue).minus(already.taxable) // last return of this line: exact remainder
          : round2(D(original.taxableValue).div(D(original.quantity)).times(qty));
        const tax = taxOnTaxableValue(taxableValue, original.gstRate, interState);
        return { original, qty, taxableValue, ...tax, lineTotal: taxableValue.plus(tax.cgstAmount).plus(tax.sgstAmount).plus(tax.igstAmount) };
      });

      const totals = computeTotals(lines);
      const financialYear = financialYearOf();
      const creditNoteNumber = await allocateNumber(tx, "CREDIT_NOTE", financialYear);

      const note = await tx.creditNote.create({
        data: {
          creditNoteNumber, financialYear, billId: bill.id, reason: input.reason, restock: input.restock,
          taxableTotal: toFixed2(totals.taxableTotal), cgstTotal: toFixed2(totals.cgstTotal), sgstTotal: toFixed2(totals.sgstTotal),
          igstTotal: toFixed2(totals.igstTotal), taxTotal: toFixed2(totals.taxTotal), roundOff: toFixed2(totals.roundOff),
          grandTotal: toFixed2(totals.grandTotal), createdBy: session.userId, idempotencyKey: key,
          lines: {
            create: lines.map((l) => ({
              billLineItemId: l.original.id, productId: l.original.productId, quantity: toFixed2(l.qty),
              taxableValue: toFixed2(l.taxableValue), cgstAmount: toFixed2(l.cgstAmount), sgstAmount: toFixed2(l.sgstAmount),
              igstAmount: toFixed2(l.igstAmount), lineTotal: toFixed2(l.lineTotal),
            })),
          },
        },
        include: { lines: true },
      });

      if (input.restock) {
        for (const line of note.lines) {
          await writeLedgerEntry(tx, {
            productId: line.productId, quantityDelta: line.quantity, type: "RETURN",
            reason: `Credit note ${creditNoteNumber}`, sourceReference: `credit_note_line:${line.id}`,
            createdBy: session.userId, idempotencyKey: `credit-note-line:${line.id}`,
          });
        }
      }

      if (profile.einvoicingApplicable && bill.customerGstin) {
        await tx.irpSubmission.create({ data: { documentType: "CREDIT_NOTE", creditNoteId: note.id } });
      }
      return note;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const winner = await prisma.creditNote.findUnique({ where: { idempotencyKey: key }, include: { lines: true } });
      if (winner) return winner;
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/credit-notes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/credit-notes.ts tests/domain/credit-notes.test.ts
git commit -m "feat: add credit notes with over-return guard, exact remainder and optional restock"
```

---

### Task 18: Physical Stock Counts — Count, Then Approve

**Design correction vs v1.** v1 re-sized the adjustment against stock at *approval* time. Suppose a worker counts 48 while the system says 50, and 10 candles are then produced before the owner approves. v1 would set stock to 48, silently erasing the 10 new candles. The correct rule, ERPNext's stock-reconciliation semantics and also what spec §5 says ("writes an adjustment entry for the delta"), is to apply the **discrepancy found at count time**: `counted − expected`. That gives 58. Movements recorded after the count stay intact. The pending list shows how many movements happened since the count, so the owner can judge whether a recount is wiser.

**Files:**
- Create: `src/domain/stock-counts.ts`
- Test: `tests/domain/stock-counts.test.ts`

**Interfaces:**
- Consumes: `getCurrentStock`/`writeLedgerEntry`/`recordProduction` (Tasks 7–8).
- Produces:
  - `submitStockCount(session, { productId, countedQuantity, note? })` → `StockCount` (OWNER or WORKER). It snapshots `expectedQuantity` and touches no stock.
  - `approveStockCount(session, { stockCountId })` → `StockCount` (OWNER). It posts exactly one `ADJUSTMENT` of `counted − expected` (none if zero) and records `appliedDelta`.
  - `discardStockCount(session, { stockCountId })` (OWNER).
  - Approving or discarding twice throws `ALREADY_RESOLVED`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/stock-counts.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { submitStockCount, approveStockCount, discardStockCount } from "@/domain/stock-counts";
import { getCurrentStock, recordProduction } from "@/domain/stock";
import { ForbiddenError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { addStock, makeProduct, makeUser } from "../helpers/factories";

const stock = async (id: string) => (await getCurrentStock(prisma, id)).toFixed(2);

describe("stock counts", () => {
  beforeEach(resetDb);

  it("a submitted count changes nothing until approved, then applies the discrepancy once", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    const p = await makeProduct();
    await addStock(p.id, "50.00");

    const count = await submitStockCount(worker, { productId: p.id, countedQuantity: "48" });
    expect(count.expectedQuantity.toString()).toBe("50");
    expect(await stock(p.id)).toBe("50.00");

    const approved = await approveStockCount(owner, { stockCountId: count.id });
    expect(approved.appliedDelta?.toString()).toBe("-2");
    expect(await stock(p.id)).toBe("48.00");
    expect(await prisma.stockLedgerEntry.count({ where: { productId: p.id, type: "ADJUSTMENT" } })).toBe(1);
  });

  it("keeps production recorded between the count and the approval", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct();
    await addStock(p.id, "50.00");
    const count = await submitStockCount(owner, { productId: p.id, countedQuantity: "48" }); // 2 missing
    await recordProduction(owner, { productId: p.id, quantity: "10", idempotencyKey: "count-prod-0001" });
    await approveStockCount(owner, { stockCountId: count.id });
    expect(await stock(p.id)).toBe("58.00");
  });

  it("cannot be approved twice, even concurrently, and discarded counts change nothing", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct();
    await addStock(p.id, "50.00");
    const count = await submitStockCount(owner, { productId: p.id, countedQuantity: "45" });
    const results = await Promise.allSettled([
      approveStockCount(owner, { stockCountId: count.id }),
      approveStockCount(owner, { stockCountId: count.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stock(p.id)).toBe("45.00");

    const other = await submitStockCount(owner, { productId: p.id, countedQuantity: "1" });
    await discardStockCount(owner, { stockCountId: other.id });
    await expect(approveStockCount(owner, { stockCountId: other.id })).rejects.toMatchObject({ code: "ALREADY_RESOLVED" });
    expect(await stock(p.id)).toBe("45.00");
  });

  it("only owners approve", async () => {
    const worker = await makeUser("WORKER");
    const p = await makeProduct();
    const count = await submitStockCount(worker, { productId: p.id, countedQuantity: "1" });
    await expect(approveStockCount(worker, { stockCountId: count.id })).rejects.toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/stock-counts.test.ts`
Expected: FAIL, because the module doesn't exist yet.

- [ ] **Step 3: Write `src/domain/stock-counts.ts`**

```typescript
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { StockCount } from "@/generated/prisma/client";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError } from "@/lib/errors";
import { D, formatQuantity, toFixed2 } from "@/lib/money";
import { entityId, nonNegativeQuantity, optionalText, parseInput } from "@/lib/validation";
import { getCurrentStock, writeLedgerEntry } from "@/domain/stock";

const ALREADY_RESOLVED = () => new DomainError("ALREADY_RESOLVED", "This count has already been approved or discarded.");

export async function submitStockCount(session: Session | null, rawInput: unknown): Promise<StockCount> {
  requireRole(session, ["OWNER", "WORKER"]);
  const input = parseInput(z.object({ productId: entityId, countedQuantity: nonNegativeQuantity, note: optionalText(300) }), rawInput);
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new NotFoundError("Product");
  const expected = await getCurrentStock(prisma, product.id);
  return prisma.stockCount.create({
    data: {
      productId: product.id, countedQuantity: toFixed2(input.countedQuantity), expectedQuantity: toFixed2(expected),
      note: input.note ?? null, countedBy: session.userId,
    },
  });
}

export async function approveStockCount(session: Session | null, rawInput: unknown): Promise<StockCount> {
  requireRole(session, ["OWNER"]);
  const { stockCountId } = parseInput(z.object({ stockCountId: entityId }), rawInput);
  return prisma.$transaction(async (tx) => {
    // Claim the count atomically; a concurrent second approval re-checks this WHERE after the first commits.
    const claimed = await tx.stockCount.updateMany({
      where: { id: stockCountId, approvedAt: null, discardedAt: null },
      data: { approvedBy: session.userId, approvedAt: new Date() },
    });
    if (claimed.count === 0) {
      if (!(await tx.stockCount.findUnique({ where: { id: stockCountId } }))) throw new NotFoundError("Stock count");
      throw ALREADY_RESOLVED();
    }
    const count = await tx.stockCount.findUniqueOrThrow({ where: { id: stockCountId } });
    const delta = D(count.countedQuantity).minus(D(count.expectedQuantity)); // discrepancy found at count time
    if (!delta.isZero()) {
      await writeLedgerEntry(tx, {
        productId: count.productId, quantityDelta: delta, type: "ADJUSTMENT",
        reason: `Physical count: counted ${formatQuantity(count.countedQuantity)}, system showed ${formatQuantity(count.expectedQuantity)}`,
        sourceReference: `stock_count:${count.id}`, createdBy: session.userId, idempotencyKey: `stock-count:${count.id}`,
      });
    }
    return tx.stockCount.update({ where: { id: count.id }, data: { appliedDelta: toFixed2(delta) } });
  });
}

export async function discardStockCount(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { stockCountId } = parseInput(z.object({ stockCountId: entityId }), rawInput);
  const result = await prisma.stockCount.updateMany({
    where: { id: stockCountId, approvedAt: null, discardedAt: null },
    data: { discardedBy: session.userId, discardedAt: new Date() },
  });
  if (result.count === 0) throw ALREADY_RESOLVED();
  return { discarded: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/stock-counts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/stock-counts.ts tests/domain/stock-counts.test.ts
git commit -m "feat: add physical stock counts applying the count-time discrepancy"
```

---

### Task 19: E-Invoice (IRP) Submission Queue

The IRP is an external government system, so it is never called inside a bill's transaction (spec §6–7). Bills and credit notes only *queue* a job (Tasks 15 and 17). A worker drains the queue: a cron route every few minutes, plus a "Retry now" button. Jobs are *claimed* with `FOR UPDATE SKIP LOCKED`, so two overlapping runs never submit the same document twice. Transient failures retry with exponential backoff. Rejections wait for a human. Phase 1 ships a `MockIrpClient` behind an `IrpClient` interface. A real GSP adapter is a small follow-up once the CA confirms applicability and credentials exist (Open Item 6). The mock is **refused in production** unless explicitly allowed.

**Files:**
- Create: `src/domain/irp.ts`, `src/app/api/cron/irp/route.ts`
- Test: `tests/domain/irp.test.ts`

**Interfaces:**
- Consumes: `IrpSubmission`, `Bill`, `CreditNote` models; jobs created by Tasks 15 and 17.
- Produces:
  - `type IrpDocument`, `type IrpResult`, `interface IrpClient { name; submit(doc) }`, `class MockIrpClient(behaviour: "accept" | "reject" | "throw")`.
  - `getIrpClient(env?)` → `IrpClient | null` (`IRP_PROVIDER` = `disabled` | `mock`).
  - `IRP_MAX_ATTEMPTS = 8`, `submitPendingIrpJobs(client, { now?, limit? })` → `{ claimed, accepted, rejected, failed }`.
  - `retryIrpSubmission(session, { submissionId })` (OWNER).
  - Route `GET /api/cron/irp`, authorised by `Authorization: Bearer $CRON_SECRET`.
- **Database timezone must stay UTC**, the default for both Docker Postgres and Neon. The raw claim query compares Prisma's UTC timestamps.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/irp.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { recordReturn } from "@/domain/credit-notes";
import { MockIrpClient, getIrpClient, retryIrpSubmission, submitPendingIrpJobs } from "@/domain/irp";
import { GET as cronGET } from "@/app/api/cron/irp/route";
import { resetDb } from "../helpers/db";
import { makeBusinessProfile, makeCustomer, setupBillingWorld, ODISHA_CUSTOMER_GSTIN } from "../helpers/factories";

async function queuedB2BBill() {
  const w = await setupBillingWorld();
  await makeBusinessProfile({ einvoicingApplicable: true });
  const customer = await makeCustomer({ gstin: ODISHA_CUSTOMER_GSTIN });
  const bill = await createBill(w.owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "irp-bill-0001", lines: [{ productId: w.product.id, quantity: "2" }] });
  return { ...w, bill };
}
const jobFor = (billId: string) => prisma.irpSubmission.findUniqueOrThrow({ where: { billId } });

describe("IRP queue", () => {
  beforeEach(resetDb);

  it("submits a queued invoice and stores the IRN, ack and QR", async () => {
    const { bill } = await queuedB2BBill();
    expect(await submitPendingIrpJobs(new MockIrpClient("accept"))).toEqual({ claimed: 1, accepted: 1, rejected: 0, failed: 0 });
    const job = await jobFor(bill.id);
    expect(job.status).toBe("ACCEPTED");
    expect(job.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(job.ackNumber).toBeTruthy();
    expect(job.signedQrCode).toBeTruthy();
  });

  it("backs off after a transient failure and retries once the delay has passed", async () => {
    const { bill } = await queuedB2BBill();
    await submitPendingIrpJobs(new MockIrpClient("throw"));
    const failed = await jobFor(bill.id);
    expect([failed.status, failed.attemptCount]).toEqual(["FAILED", 1]);
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    expect((await submitPendingIrpJobs(new MockIrpClient("accept"))).claimed).toBe(0);
    const later = new Date(failed.nextAttemptAt.getTime() + 1000);
    expect((await submitPendingIrpJobs(new MockIrpClient("accept"), { now: later })).accepted).toBe(1);
  });

  it("leaves rejections for a human, who can retry them", async () => {
    const { owner, bill } = await queuedB2BBill();
    await submitPendingIrpJobs(new MockIrpClient("reject"));
    expect((await jobFor(bill.id)).status).toBe("REJECTED");
    expect((await submitPendingIrpJobs(new MockIrpClient("accept"))).claimed).toBe(0);

    const job = await jobFor(bill.id);
    await retryIrpSubmission(owner, { submissionId: job.id });
    expect((await submitPendingIrpJobs(new MockIrpClient("accept"))).accepted).toBe(1);
  });

  it("reclaims jobs stuck in SUBMITTING after a crash", async () => {
    const { bill } = await queuedB2BBill();
    const job = await jobFor(bill.id);
    await prisma.$executeRaw`UPDATE "irp_submissions" SET "status" = 'SUBMITTING', "updatedAt" = ${new Date(Date.now() - 3_600_000)} WHERE "id" = ${job.id}`;
    expect((await submitPendingIrpJobs(new MockIrpClient("accept"))).accepted).toBe(1);
  });

  it("submits credit notes too", async () => {
    const { owner, bill } = await queuedB2BBill();
    const note = await recordReturn(owner, { billId: bill.id, reason: "Return", lines: [{ billLineItemId: bill.lineItems[0].id, quantity: "1" }], idempotencyKey: "irp-cn-0001" });
    await submitPendingIrpJobs(new MockIrpClient("accept"));
    expect((await prisma.irpSubmission.findUniqueOrThrow({ where: { creditNoteId: note.id } })).status).toBe("ACCEPTED");
  });

  it("refuses the mock client in production unless explicitly allowed", () => {
    expect(getIrpClient({ IRP_PROVIDER: "disabled" })).toBeNull();
    expect(getIrpClient({ IRP_PROVIDER: "mock", NODE_ENV: "test" })?.name).toBe("mock");
    expect(() => getIrpClient({ IRP_PROVIDER: "mock", NODE_ENV: "production" })).toThrow(/not allowed in production/);
    expect(getIrpClient({ IRP_PROVIDER: "mock", NODE_ENV: "production", ALLOW_MOCK_IRP: "true" })?.name).toBe("mock");
  });

  it("protects the cron route with CRON_SECRET", async () => {
    await queuedB2BBill();
    expect((await cronGET(new Request("http://x/api/cron/irp"))).status).toBe(401);
    const ok = await cronGET(new Request("http://x/api/cron/irp", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ accepted: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/irp.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Write `src/domain/irp.ts`**

```typescript
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { entityId, parseInput } from "@/lib/validation";

export type IrpDocument = {
  submissionId: string;
  documentType: "INVOICE" | "CREDIT_NOTE";
  documentNumber: string;
  documentDate: Date;
  sellerGstin: string;
  buyerGstin: string;
  totalValue: string;
};

export type IrpResult =
  | { outcome: "accepted"; irn: string; ackNumber: string; ackDate: Date; signedQrCode: string }
  | { outcome: "rejected"; error: string };

export interface IrpClient {
  readonly name: string;
  submit(document: IrpDocument): Promise<IrpResult>;
}

/** Deterministic stand-in for development and tests. Never used in production unless ALLOW_MOCK_IRP=true. */
export class MockIrpClient implements IrpClient {
  readonly name = "mock";
  constructor(private readonly behaviour: "accept" | "reject" | "throw" = "accept") {}

  async submit(doc: IrpDocument): Promise<IrpResult> {
    if (this.behaviour === "throw") throw new Error("Mock IRP timeout");
    if (this.behaviour === "reject") return { outcome: "rejected", error: "Mock IRP: schema validation failed" };
    const irn = createHash("sha256").update(`${doc.sellerGstin}|${doc.documentType}|${doc.documentNumber}`).digest("hex");
    return {
      outcome: "accepted", irn, ackNumber: String(randomInt(10 ** 11, 10 ** 12)), ackDate: new Date(),
      signedQrCode: `MOCK-QR|${doc.documentNumber}|${doc.totalValue}|${irn.slice(0, 12)}`,
    };
  }
}

export function getIrpClient(env: Record<string, string | undefined> = process.env): IrpClient | null {
  const provider = env.IRP_PROVIDER ?? "disabled";
  if (provider === "disabled") return null;
  if (provider === "mock") {
    if (env.NODE_ENV === "production" && env.ALLOW_MOCK_IRP !== "true") {
      throw new Error("IRP_PROVIDER=mock is not allowed in production: mock IRNs are not legally valid. Configure a real provider or set IRP_PROVIDER=disabled.");
    }
    return new MockIrpClient("accept");
  }
  throw new Error(`Unknown IRP_PROVIDER "${provider}"`);
}

export const IRP_MAX_ATTEMPTS = 8;
const STALE_SUBMITTING_MS = 10 * 60_000;

function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** (attempt - 1), 6 * 60 * 60_000); // 1m, 2m, 4m … capped at 6h
}

async function buildDocument(submissionId: string): Promise<IrpDocument> {
  const job = await prisma.irpSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { bill: true, creditNote: { include: { bill: true } } },
  });
  if (job.documentType === "INVOICE" && job.bill) {
    return {
      submissionId, documentType: "INVOICE", documentNumber: job.bill.invoiceNumber, documentDate: job.bill.billDate,
      sellerGstin: job.bill.supplierGstin, buyerGstin: job.bill.customerGstin ?? "", totalValue: job.bill.grandTotal.toString(),
    };
  }
  if (job.documentType === "CREDIT_NOTE" && job.creditNote) {
    const note = job.creditNote;
    return {
      submissionId, documentType: "CREDIT_NOTE", documentNumber: note.creditNoteNumber, documentDate: note.noteDate,
      sellerGstin: note.bill.supplierGstin, buyerGstin: note.bill.customerGstin ?? "", totalValue: note.grandTotal.toString(),
    };
  }
  throw new Error(`IRP submission ${submissionId} has no linked document`);
}

export async function submitPendingIrpJobs(client: IrpClient, opts: { now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_SUBMITTING_MS);
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "irp_submissions" SET "status" = 'SUBMITTING', "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "irp_submissions"
      WHERE ("status" IN ('PENDING', 'FAILED') AND "nextAttemptAt" <= ${now} AND "attemptCount" < ${IRP_MAX_ATTEMPTS})
         OR ("status" = 'SUBMITTING' AND "updatedAt" < ${staleBefore})
      ORDER BY "createdAt"
      LIMIT ${opts.limit ?? 20}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;

  const tally = { claimed: claimed.length, accepted: 0, rejected: 0, failed: 0 };
  for (const { id } of claimed) {
    try {
      const result = await client.submit(await buildDocument(id));
      if (result.outcome === "accepted") {
        await prisma.irpSubmission.update({
          where: { id },
          data: { status: "ACCEPTED", irn: result.irn, ackNumber: result.ackNumber, ackDate: result.ackDate, signedQrCode: result.signedQrCode, lastError: null, attemptCount: { increment: 1 } },
        });
        tally.accepted++;
      } else {
        await prisma.irpSubmission.update({ where: { id }, data: { status: "REJECTED", lastError: result.error, attemptCount: { increment: 1 } } });
        tally.rejected++;
      }
    } catch (error) {
      const job = await prisma.irpSubmission.findUniqueOrThrow({ where: { id } });
      const attempt = job.attemptCount + 1;
      await prisma.irpSubmission.update({
        where: { id },
        data: {
          status: "FAILED", attemptCount: attempt, lastError: error instanceof Error ? error.message : String(error),
          nextAttemptAt: new Date(now.getTime() + backoffMs(attempt)),
        },
      });
      tally.failed++;
    }
  }
  return tally;
}

export async function retryIrpSubmission(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { submissionId } = parseInput(z.object({ submissionId: entityId }), rawInput);
  const result = await prisma.irpSubmission.updateMany({
    where: { id: submissionId, status: { in: ["FAILED", "REJECTED"] } },
    data: { status: "PENDING", attemptCount: 0, nextAttemptAt: new Date(), lastError: null },
  });
  if (result.count === 0) throw new DomainError("NOT_RETRYABLE", "Only failed or rejected e-invoices can be retried.");
  return { queued: true };
}
```

- [ ] **Step 4: Write `src/app/api/cron/irp/route.ts`**

```typescript
import { getIrpClient, submitPendingIrpJobs } from "@/domain/irp";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const client = getIrpClient();
  if (!client) return Response.json({ skipped: "IRP_PROVIDER is disabled" });
  return Response.json(await submitPendingIrpJobs(client));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/irp.ts src/app/api/cron tests/domain/irp.test.ts
git commit -m "feat: add e-invoice submission queue with backoff, retry and cron route"
```

---

### Task 20: Reports and the Invoice View Model

**Files:**
- Create: `src/domain/reports.ts`, `src/domain/invoice-view.ts`
- Test: `tests/domain/reports.test.ts`, `tests/domain/invoice-view.test.ts`

**Interfaces:**
- Consumes: `getStockLevels` (Task 7), `getPaymentSummaries` (Task 16), money/time/GST helpers (Task 4), `getBusinessProfile` (Task 11).
- Produces (`reports.ts`):
  - `getStockOverview(session, { search? })` (OWNER or WORKER; **no prices**, since workers never see money) → `{ id, sku, name, unit, stock, reorderLevel, status: "NEGATIVE" | "LOW" | "OK" }[]`.
  - `getOwnerDashboard(session)` (OWNER) → `{ today: { billCount, salesTotal }, totalDue, topDues[], negativeStock[], lowStock[], irpIssues[], pendingCounts[] }`.
  - `listPendingStockCounts(session)` (OWNER) → includes `productName` and `movementsSinceCount`.
  - `listBills(session, { search?, status?, take? })` (OWNER) → bills with their `PaymentSummary`.
- Produces (`invoice-view.ts`): `getInvoiceView(session, billId)` (OWNER) → `InvoiceView`. One object holds everything the screen, print page and PDF need: Rule 46 particulars, lines, an HSN/rate tax summary, amount in words, payments, credit notes, IRP details, and `upiPayUri` when a balance is due and a UPI ID is configured.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain/reports.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { recordPayment } from "@/domain/payments";
import { submitStockCount } from "@/domain/stock-counts";
import { recordProduction } from "@/domain/stock";
import { getOwnerDashboard, getStockOverview, listBills, listPendingStockCounts } from "@/domain/reports";
import { ForbiddenError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { addStock, makeProduct, setupBillingWorld } from "../helpers/factories";

describe("reports", () => {
  beforeEach(resetDb);

  it("flags negative and low stock without exposing prices to workers", async () => {
    const { worker } = await setupBillingWorld(); // main product: 100 in stock
    const low = await makeProduct({ name: "Low Candle", reorderLevel: "20.00" });
    await addStock(low.id, "5.00");
    const neg = await makeProduct({ name: "Oversold Candle" });
    await prisma.stockLedgerEntry.create({ data: { productId: neg.id, quantityDelta: "-3.00", type: "BILLED", createdBy: "x", idempotencyKey: "neg-1" } });

    const overview = await getStockOverview(worker, {});
    expect(overview.find((r) => r.id === low.id)?.status).toBe("LOW");
    expect(overview.find((r) => r.id === neg.id)?.status).toBe("NEGATIVE");
    expect(Object.keys(overview[0])).not.toContain("unitPrice");
  });

  it("summarises today's sales, dues and pending work for the owner only", async () => {
    const { owner, worker, customer, product } = await setupBillingWorld();
    const bill = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "rep-bill-0001", lines: [{ productId: product.id, quantity: "10" }] });
    await recordPayment(owner, { billId: bill.id, amount: "770", method: "CASH", idempotencyKey: "rep-pay-0001" });
    const count = await submitStockCount(worker, { productId: product.id, countedQuantity: "85" });
    await recordProduction(worker, { productId: product.id, quantity: "5", idempotencyKey: "rep-prod-0001" });

    const dash = await getOwnerDashboard(owner);
    expect(dash.today).toMatchObject({ billCount: 1 });
    expect(dash.today.salesTotal.toFixed(2)).toBe("1770.00");
    expect(dash.totalDue.toFixed(2)).toBe("1000.00");
    expect(dash.topDues[0]).toMatchObject({ customerId: customer.id });

    const pending = await listPendingStockCounts(owner);
    expect(pending[0]).toMatchObject({ id: count.id, productName: product.name, movementsSinceCount: 1 });
    await expect(getOwnerDashboard(worker)).rejects.toThrow(ForbiddenError);
  });

  it("lists bills with payment status and filters by status", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const paid = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "rep-bill-0002", lines: [{ productId: product.id, quantity: "1" }], initialPayment: { amount: "177", method: "CASH" } });
    await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "rep-bill-0003", lines: [{ productId: product.id, quantity: "1" }] });
    const unpaid = await listBills(owner, { status: "UNPAID" });
    expect(unpaid).toHaveLength(1);
    expect(unpaid[0].id).not.toBe(paid.id);
    expect((await listBills(owner, { search: paid.invoiceNumber }))[0].payment.status).toBe("PAID");
  });
});
```

```typescript
// tests/domain/invoice-view.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { getInvoiceView } from "@/domain/invoice-view";
import { resetDb } from "../helpers/db";
import { makeBusinessProfile, makeProduct, addStock, setupBillingWorld } from "../helpers/factories";

describe("getInvoiceView", () => {
  beforeEach(resetDb);

  it("contains every particular the printed invoice needs", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    await makeBusinessProfile({ upiId: "trinetra@okhdfcbank", invoiceTerms: "Goods once sold will not be taken back." });
    const second = await makeProduct({ gstRate: "12.00", hsnCode: "340600" });
    await addStock(second.id, "10.00");
    const bill = await createBill(owner, {
      customerId: customer.id, placeOfSupply: "21", idempotencyKey: "view-bill-0001",
      lines: [{ productId: product.id, quantity: "10" }, { productId: second.id, quantity: "1" }],
    });

    const view = await getInvoiceView(owner, bill.id);
    expect(view.invoiceNumber).toBe(bill.invoiceNumber);
    expect(view.supplier.gstin).toBe("21AAAAA0000A1ZE");
    expect(view.placeOfSupplyLabel).toBe("Odisha (21)");
    expect(view.reverseCharge).toBe("No");
    expect(view.lines).toHaveLength(2);
    expect(view.taxSummary.map((t) => [t.hsnCode, t.gstRate])).toEqual([["3406", "18"], ["340600", "12"]]);
    expect(view.amountInWords).toMatch(/Rupees/);
    expect(view.payment.status).toBe("UNPAID");
    expect(view.upiPayUri).toMatch(/^upi:\/\/pay\?pa=trinetra%40okhdfcbank&pn=Trinetra%20Candles&am=\d+\.\d{2}&cu=INR&tn=/);
    expect(view.terms).toBe("Goods once sold will not be taken back.");
    expect(await prisma.bill.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domain/reports.test.ts tests/domain/invoice-view.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Write `src/domain/reports.ts`**

```typescript
import Decimal from "decimal.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { D, ZERO, sumDecimals } from "@/lib/money";
import { istDayRange } from "@/lib/time";
import { parseInput } from "@/lib/validation";
import { getStockLevels } from "@/domain/stock";
import { getPaymentSummaries, type PaymentStatus } from "@/domain/payments";

export type StockStatus = "NEGATIVE" | "LOW" | "OK";

export async function getStockOverview(session: Session | null, rawInput: unknown = {}) {
  requireRole(session, ["OWNER", "WORKER"]);
  const { search } = parseInput(z.object({ search: z.string().trim().optional() }), rawInput);
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } : {}),
    },
    select: { id: true, sku: true, name: true, unit: true, reorderLevel: true },
    orderBy: { name: "asc" },
  });
  const levels = await getStockLevels(prisma, products.map((p) => p.id));
  return products.map((p) => {
    const stock = levels.get(p.id) ?? ZERO;
    const status: StockStatus = stock.isNegative() ? "NEGATIVE" : stock.lessThanOrEqualTo(D(p.reorderLevel)) && D(p.reorderLevel).greaterThan(0) ? "LOW" : "OK";
    return { id: p.id, sku: p.sku, name: p.name, unit: p.unit, stock, reorderLevel: D(p.reorderLevel), status };
  });
}

export async function listPendingStockCounts(session: Session | null) {
  requireRole(session, ["OWNER"]);
  const counts = await prisma.stockCount.findMany({
    where: { approvedAt: null, discardedAt: null },
    include: { product: { select: { name: true, sku: true } } },
    orderBy: { countedAt: "asc" },
  });
  return Promise.all(counts.map(async (c) => ({
    id: c.id, productId: c.productId, productName: c.product.name, sku: c.product.sku,
    countedQuantity: c.countedQuantity, expectedQuantity: c.expectedQuantity,
    delta: D(c.countedQuantity).minus(D(c.expectedQuantity)), countedBy: c.countedBy, countedAt: c.countedAt, note: c.note,
    movementsSinceCount: await prisma.stockLedgerEntry.count({ where: { productId: c.productId, createdAt: { gt: c.countedAt } } }),
  })));
}

export async function getOwnerDashboard(session: Session | null) {
  requireRole(session, ["OWNER"]);
  const { start, end } = istDayRange();
  const [todayBills, allBills, stock, irpIssues, pendingCounts] = await Promise.all([
    prisma.bill.findMany({ where: { billDate: { gte: start, lt: end } }, select: { grandTotal: true } }),
    prisma.bill.findMany({ select: { id: true, customerId: true, customerName: true } }),
    getStockOverview(session, {}),
    prisma.irpSubmission.findMany({
      where: { OR: [{ status: { in: ["FAILED", "REJECTED"] } }, { status: "PENDING", createdAt: { lt: new Date(Date.now() - 60 * 60_000) } }] },
      include: { bill: { select: { invoiceNumber: true } }, creditNote: { select: { creditNoteNumber: true } } },
      orderBy: { createdAt: "asc" },
    }),
    listPendingStockCounts(session),
  ]);

  const summaries = await getPaymentSummaries(prisma, allBills.map((b) => b.id));
  const dueByCustomer = new Map<string, { customerId: string; customerName: string; amountDue: Decimal }>();
  for (const b of allBills) {
    const due = summaries.get(b.id)?.amountDue ?? ZERO;
    if (due.lessThanOrEqualTo(0)) continue;
    const entry = dueByCustomer.get(b.customerId) ?? { customerId: b.customerId, customerName: b.customerName, amountDue: ZERO };
    entry.amountDue = entry.amountDue.plus(due);
    dueByCustomer.set(b.customerId, entry);
  }
  const dues = [...dueByCustomer.values()].sort((a, b) => b.amountDue.comparedTo(a.amountDue));

  return {
    today: { billCount: todayBills.length, salesTotal: sumDecimals(todayBills.map((b) => b.grandTotal)) },
    totalDue: sumDecimals(dues.map((d) => d.amountDue)),
    topDues: dues.slice(0, 10),
    negativeStock: stock.filter((s) => s.status === "NEGATIVE"),
    lowStock: stock.filter((s) => s.status === "LOW"),
    irpIssues: irpIssues.map((j) => ({
      id: j.id, status: j.status, lastError: j.lastError, attemptCount: j.attemptCount,
      documentNumber: j.bill?.invoiceNumber ?? j.creditNote?.creditNoteNumber ?? "",
      billId: j.billId,
    })),
    pendingCounts,
  };
}

export async function listBills(session: Session | null, rawInput: unknown = {}) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(
    z.object({
      search: z.string().trim().optional(),
      status: z.enum(["PAID", "PARTIAL", "UNPAID"]).optional(),
      take: z.number().int().min(1).max(500).default(100),
    }),
    rawInput
  );
  const bills = await prisma.bill.findMany({
    where: input.search
      ? { OR: [{ invoiceNumber: { contains: input.search, mode: "insensitive" } }, { customerName: { contains: input.search, mode: "insensitive" } }] }
      : {},
    orderBy: { billDate: "desc" },
    take: input.take,
    select: { id: true, invoiceNumber: true, billDate: true, customerName: true, grandTotal: true },
  });
  const summaries = await getPaymentSummaries(prisma, bills.map((b) => b.id));
  return bills
    .map((b) => ({ ...b, payment: summaries.get(b.id)! }))
    .filter((b) => !input.status || b.payment.status === (input.status as PaymentStatus));
}
```

- [ ] **Step 4: Write `src/domain/invoice-view.ts`**

```typescript
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { stateName } from "@/lib/gst";
import { D, amountInWords, sumDecimals } from "@/lib/money";
import { formatDateIN } from "@/lib/time";
import { getBusinessProfile } from "@/domain/settings";
import { getPaymentSummary } from "@/domain/payments";

export async function getInvoiceView(session: Session | null, billId: string) {
  requireRole(session, ["OWNER"]);
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      lineItems: { orderBy: { lineNo: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
      creditNotes: { orderBy: { noteDate: "asc" }, include: { lines: true } },
      irpSubmission: true,
    },
  });
  if (!bill) throw new NotFoundError("Bill");
  const profile = await getBusinessProfile(prisma);
  const payment = await getPaymentSummary(prisma, bill.id);

  // HSN-wise tax summary (one row per HSN + rate), as commonly printed on Indian GST invoices.
  const groups = new Map<string, typeof bill.lineItems>();
  for (const line of bill.lineItems) {
    const key = `${line.hsnCode}|${D(line.gstRate).toString()}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const taxSummary = [...groups.entries()].map(([key, lines]) => {
    const [hsnCode, gstRate] = key.split("|");
    return {
      hsnCode, gstRate,
      taxableValue: sumDecimals(lines.map((l) => l.taxableValue)),
      cgstAmount: sumDecimals(lines.map((l) => l.cgstAmount)),
      sgstAmount: sumDecimals(lines.map((l) => l.sgstAmount)),
      igstAmount: sumDecimals(lines.map((l) => l.igstAmount)),
    };
  });

  const due = payment.amountDue;
  const upiPayUri = profile?.upiId && due.greaterThan(0)
    ? `upi://pay?pa=${encodeURIComponent(profile.upiId)}&pn=${encodeURIComponent(profile.tradeName ?? profile.legalName)}&am=${due.toFixed(2)}&cu=INR&tn=${encodeURIComponent(bill.invoiceNumber)}`
    : null;

  return {
    id: bill.id,
    title: bill.customerGstin ? "TAX INVOICE" : "TAX INVOICE (B2C)",
    invoiceNumber: bill.invoiceNumber,
    invoiceDate: formatDateIN(bill.billDate),
    supplier: {
      name: bill.supplierLegalName, gstin: bill.supplierGstin, address: bill.supplierAddress,
      stateLabel: `${stateName(bill.supplierStateCode)} (${bill.supplierStateCode})`,
      phone: profile?.phone ?? null, email: profile?.email ?? null,
    },
    customer: {
      name: bill.customerName, gstin: bill.customerGstin, address: bill.customerAddress, phone: bill.customerPhone,
      stateLabel: `${stateName(bill.customerStateCode)} (${bill.customerStateCode})`,
    },
    placeOfSupplyLabel: `${stateName(bill.placeOfSupply)} (${bill.placeOfSupply})`,
    deliveryAddress: bill.deliveryAddress || null,
    interState: bill.supplierStateCode !== bill.placeOfSupply,
    reverseCharge: bill.reverseCharge ? "Yes" : "No",
    lines: bill.lineItems,
    taxSummary,
    totals: {
      grossTotal: bill.grossTotal, discountTotal: bill.discountTotal, taxableTotal: bill.taxableTotal,
      cgstTotal: bill.cgstTotal, sgstTotal: bill.sgstTotal, igstTotal: bill.igstTotal,
      taxTotal: bill.taxTotal, roundOff: bill.roundOff, grandTotal: bill.grandTotal,
    },
    amountInWords: amountInWords(bill.grandTotal),
    payment,
    payments: bill.payments,
    creditNotes: bill.creditNotes.map((n) => ({ id: n.id, number: n.creditNoteNumber, date: formatDateIN(n.noteDate), reason: n.reason, grandTotal: n.grandTotal, restock: n.restock, lines: n.lines })),
    irp: bill.irpSubmission
      ? { status: bill.irpSubmission.status, irn: bill.irpSubmission.irn, ackNumber: bill.irpSubmission.ackNumber,
          ackDate: bill.irpSubmission.ackDate ? formatDateIN(bill.irpSubmission.ackDate) : null, signedQrCode: bill.irpSubmission.signedQrCode,
          lastError: bill.irpSubmission.lastError, submissionId: bill.irpSubmission.id }
      : null,
    upiPayUri,
    bankDetails: profile?.bankDetails ?? null,
    terms: profile?.invoiceTerms ?? null,
    notes: bill.notes,
  };
}

export type InvoiceView = Awaited<ReturnType<typeof getInvoiceView>>;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add src/domain/reports.ts src/domain/invoice-view.ts tests/domain
git commit -m "feat: add stock overview, owner dashboard, bill list and invoice view model"
```

---

## UI Tasks (21–26): Conventions

These apply to every UI task, written for a non-technical owner and shop-floor workers:

- **Phone first.** Design for a 360 px wide screen, then make sure it also works on a laptop. Use large touch targets (`h-12` inputs and buttons), one primary action per screen, and plain words ("Save bill", not "Commit").
- **Never show a database ID.** Pick things by name or SKU through search pickers.
- **Money** is shown with `formatINR`. Quantities use `formatQuantity`. Dates are `dd-mm-yyyy` via `formatDateIN`.
- **Every mutation** goes through a server action in `src/actions/*` that returns `runAction(() => domainFn(await getSession(), input))`. Client code calls it through `callAction()`, which shows a toast on failure. Actions never re-implement rules.
- **Every form** that creates a ledger row holds one idempotency key from `useIdempotencyKey()` for its lifetime and renews it only after success. That is what makes a double-tap harmless.
- After a successful mutation, call `revalidatePath` for the affected pages inside the action, so server components re-render.
- **Workers** never see prices, totals, customers or bills. `proxy.ts` hides the routes, but the domain layer is what actually enforces it.

---

### Task 21: App Shell — UI Kit, Route Guard, Login, Password Change, Health, PWA

**Files:**
- Create: `src/proxy.ts`, `src/app/layout.tsx` (replace), `src/app/page.tsx` (replace), `src/app/manifest.ts`, `src/app/icons/[size]/route.tsx`
- Create: `src/app/login/page.tsx`, `src/components/login-form.tsx`, `src/app/logout/route.ts`
- Create: `src/app/(app)/layout.tsx`, `src/components/app-nav.tsx`, `src/app/(app)/account/password/page.tsx`, `src/components/change-password-form.tsx`
- Create: `src/app/api/health/route.ts`, `src/actions/auth.ts`, `src/lib/client/call-action.ts`, `src/lib/client/use-idempotency-key.ts`
- Test: `tests/app/proxy.test.ts`, `tests/actions/auth.test.ts`

**Interfaces:**
- Consumes: `verifySessionToken`/`SESSION_COOKIE` (Task 5), `getSession`/`setSessionCookie`/`clearSessionCookie` (Task 5), `authenticate` (Task 5), `changeOwnPassword` (Task 12), `runAction` (Task 6).
- Produces:
  - `proxy(request)`: redirects logged-out users to `/login?next=…` and workers away from owner-only routes. It sets the request header `x-pathname` so layouts know the current path.
  - `loginAction({ phone, password })` and `changePasswordAction({ currentPassword, newPassword })`.
  - Client helpers: `callAction(promise, { success? })` → data or `null` (toasts on error), and `useIdempotencyKey()` → `[key, renew]`. It works over plain-HTTP LAN too, where `crypto.randomUUID` is unavailable.
  - Layout `(app)`, which every signed-in page lives under.

- [ ] **Step 1: Install the UI kit (shadcn/ui on Tailwind 4)**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button input label card table dialog command popover select badge sonner textarea alert-dialog checkbox separator
```
Expected: `components.json` and `src/components/ui/*.tsx` are created, and `src/app/globals.css` is updated with theme variables. If `init` asks questions despite `-d`, accept the defaults.

- [ ] **Step 2: Write the failing tests**

```typescript
// tests/app/proxy.test.ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { signSessionToken } from "@/lib/auth";

async function request(path: string, role?: "OWNER" | "WORKER") {
  const headers = new Headers();
  if (role) headers.set("cookie", `tc_session=${await signSessionToken({ userId: "u1", role, sessionVersion: 0 })}`);
  return proxy(new NextRequest(new URL(path, "http://localhost:3000"), { headers }));
}
const location = (res: Response) => res.headers.get("location");

describe("proxy", () => {
  it("sends logged-out visitors to login, remembering where they were going", async () => {
    expect(location(await request("/bills?status=UNPAID"))).toBe("http://localhost:3000/login?next=%2Fbills%3Fstatus%3DUNPAID");
  });
  it("keeps workers out of owner-only areas", async () => {
    expect(location(await request("/billing/new", "WORKER"))).toBe("http://localhost:3000/dashboard");
    expect(location(await request("/api/bills/x/pdf", "WORKER"))).toBe("http://localhost:3000/dashboard");
    expect(location(await request("/inventory", "WORKER"))).toBeNull();
  });
  it("lets owners through and bounces logged-in users away from /login", async () => {
    expect(location(await request("/billing/new", "OWNER"))).toBeNull();
    expect(location(await request("/login", "OWNER"))).toBe("http://localhost:3000/dashboard");
    expect(location(await request("/login"))).toBeNull();
  });
});
```

```typescript
// tests/actions/auth.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getSession, setSessionCookie } from "@/lib/session";
import { loginAction, changePasswordAction } from "@/actions/auth";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

describe("auth actions", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(setSessionCookie).mockClear();
  });

  it("logs in and sets the cookie; reports a friendly error otherwise", async () => {
    await makeUser("WORKER", { phone: "9876543210", password: "secret-pass-1" });
    expect(await loginAction({ phone: "9876543210", password: "nope" })).toEqual({ ok: false, code: "LOGIN_FAILED", error: "Wrong phone number or password." });
    expect(setSessionCookie).not.toHaveBeenCalled();

    expect(await loginAction({ phone: "9876543210", password: "secret-pass-1" })).toEqual({ ok: true, data: { role: "WORKER" } });
    expect(setSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("changes the password and re-issues the session cookie", async () => {
    const worker = await makeUser("WORKER", { phone: "9876543219", password: "current-pass" });
    vi.mocked(getSession).mockResolvedValue(worker);
    const result = await changePasswordAction({ currentPassword: "current-pass", newPassword: "brand-new-pass" });
    expect(result).toEqual({ ok: true, data: { changed: true } });
    expect(setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ userId: worker.userId, sessionVersion: 1 }));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/app/proxy.test.ts tests/actions/auth.test.ts`
Expected: FAIL, because `@/proxy` and `@/actions/auth` don't exist yet.

- [ ] **Step 4: Write `src/proxy.ts`**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Optimistic guard only: real authorisation happens in layouts (DB-checked session) and domain functions.
const OWNER_ONLY = ["/billing", "/bills", "/customers", "/products", "/settings", "/users", "/print", "/api/bills"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/logout") return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token) : null;

  if (pathname === "/login") {
    return claims ? NextResponse.redirect(new URL("/dashboard", request.url)) : NextResponse.next();
  }
  if (!claims) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  if (claims.role === "WORKER" && OWNER_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|api/health|api/cron).*)"],
};
```

- [ ] **Step 5: Write `src/actions/auth.ts`**

```typescript
"use server";

import { runAction } from "@/lib/action-result";
import { DomainError } from "@/lib/errors";
import { getSession, setSessionCookie } from "@/lib/session";
import { authenticate } from "@/domain/authentication";
import { changeOwnPassword } from "@/domain/users";

export async function loginAction(input: { phone: string; password: string }) {
  return runAction(async () => {
    const result = await authenticate(String(input?.phone ?? ""), String(input?.password ?? ""));
    if (!result.ok) throw new DomainError("LOGIN_FAILED", result.error);
    await setSessionCookie(result.claims);
    return { role: result.claims.role };
  });
}

export async function changePasswordAction(input: { currentPassword: string; newPassword: string }) {
  return runAction(async () => {
    const claims = await changeOwnPassword(await getSession(), input);
    await setSessionCookie(claims);
    return { changed: true };
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/app/proxy.test.ts tests/actions/auth.test.ts`
Expected: PASS

- [ ] **Step 7: Client helpers**

`src/lib/client/call-action.ts`:
```typescript
"use client";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/** Awaits a server action; on failure shows the readable error as a toast and returns null. */
export async function callAction<T>(pending: Promise<ActionResult<T>>, opts: { success?: string } = {}): Promise<T | null> {
  try {
    const result = await pending;
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    if (opts.success) toast.success(opts.success);
    return result.data;
  } catch {
    toast.error("Could not reach the server. Check the internet connection and try again.");
    return null;
  }
}
```

`src/lib/client/use-idempotency-key.ts`:
```typescript
"use client";
import { useCallback, useState } from "react";

// crypto.randomUUID only exists on HTTPS/localhost; getRandomValues works everywhere (e.g. phone on shop Wi-Fi).
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One key per form instance. Call renew() only after the server confirmed success. */
export function useIdempotencyKey(): [string, () => void] {
  const [key, setKey] = useState(newIdempotencyKey);
  const renew = useCallback(() => setKey(newIdempotencyKey()), []);
  return [key, renew];
}
```

- [ ] **Step 8: Root layout, home redirect, manifest, generated icons, health route**

`src/app/layout.tsx`:
```tsx
import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = { title: "Trinetra Candles", description: "Billing and stock", applicationName: "Trinetra" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#7c2d12" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

`src/app/manifest.ts`:
```typescript
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trinetra Candles", short_name: "Trinetra", start_url: "/dashboard", display: "standalone",
    background_color: "#ffffff", theme_color: "#7c2d12",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
```

`src/app/icons/[size]/route.tsx` (PNG icons generated in code, so no image files to maintain):
```tsx
import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export function generateStaticParams() {
  return [{ size: "192" }, { size: "512" }];
}

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = (await params).size === "512" ? 512 : 192;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#7c2d12", color: "#fde68a", fontSize: size * 0.55, fontWeight: 700 }}>
        T
      </div>
    ),
    { width: size, height: size }
  );
}
```

`src/app/api/health/route.ts`:
```typescript
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, time: new Date().toISOString() });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
```

- [ ] **Step 9: Login, logout, signed-in layout, navigation, change password**

`src/app/login/page.tsx`:
```tsx
import { LoginForm } from "@/components/login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-2xl font-semibold">Trinetra Candles</h1>
      <LoginForm next={safeNext} />
    </main>
  );
}
```

`src/components/login-form.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/actions/auth";
import { callAction } from "@/lib/client/call-action";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const data = await callAction(loginAction({ phone, password }));
    setBusy(false);
    if (data) router.replace(next);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="phone">Mobile number</Label>
        <Input id="phone" inputMode="numeric" autoComplete="username" className="h-12 text-lg" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" className="h-12 text-lg" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" size="lg" className="h-12 w-full text-lg" disabled={busy}>{busy ? "Logging in…" : "Log in"}</Button>
    </form>
  );
}
```

`src/app/logout/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export async function GET(request: Request) {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", request.url));
}
```

`src/app/(app)/layout.tsx`:
```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { AppNav } from "@/components/app-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/logout"); // clears a stale cookie (deactivated user, reset password) without a redirect loop
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (session.mustChangePassword && pathname !== "/account/password") redirect("/account/password");

  return (
    <div className="min-h-dvh bg-muted/30">
      <AppNav name={session.name} role={session.role} />
      <main className="mx-auto max-w-5xl p-4 pb-16">{children}</main>
    </div>
  );
}
```

`src/components/app-nav.tsx`:
```tsx
import Link from "next/link";
import type { Role } from "@/lib/auth";

const OWNER_LINKS = [
  ["/dashboard", "Home"], ["/billing/new", "New bill"], ["/bills", "Bills"], ["/inventory", "Stock"],
  ["/customers", "Customers"], ["/products", "Products"], ["/settings", "Settings"],
] as const;
const WORKER_LINKS = [["/dashboard", "Home"], ["/inventory", "Stock"], ["/inventory/counts", "Count stock"]] as const;

export function AppNav({ name, role }: { name: string; role: Role }) {
  const links = role === "OWNER" ? OWNER_LINKS : WORKER_LINKS;
  return (
    <header className="sticky top-0 z-10 border-b bg-background">
      <div className="mx-auto flex max-w-5xl items-center gap-2 overflow-x-auto px-2 py-2">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium hover:bg-muted">{label}</Link>
        ))}
        <span className="ml-auto whitespace-nowrap text-sm text-muted-foreground">{name}</span>
        <Link href="/account/password" className="whitespace-nowrap px-2 text-sm underline">Password</Link>
        <Link href="/logout" prefetch={false} className="whitespace-nowrap px-2 text-sm underline">Log out</Link>
      </div>
    </header>
  );
}
```

`src/app/(app)/account/password/page.tsx`:
```tsx
import { ChangePasswordForm } from "@/components/change-password-form";

export default function ChangePasswordPage() {
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Change your password</h1>
      <p className="text-sm text-muted-foreground">Use at least 8 characters. Don't share it with anyone.</p>
      <ChangePasswordForm />
    </div>
  );
}
```

`src/components/change-password-form.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "@/actions/auth";
import { callAction } from "@/lib/client/call-action";

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const ok = await callAction(changePasswordAction({ currentPassword, newPassword }), { success: "Password changed" });
    setBusy(false);
    if (ok) router.replace("/dashboard");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="cur">Current password</Label><Input id="cur" type="password" className="h-12" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required /></div>
      <div className="space-y-2"><Label htmlFor="new">New password</Label><Input id="new" type="password" className="h-12" minLength={8} value={newPassword} onChange={(e) => setNew(e.target.value)} required /></div>
      <Button type="submit" size="lg" className="h-12 w-full" disabled={busy}>Save new password</Button>
    </form>
  );
}
```

Create a temporary `src/app/(app)/dashboard/page.tsx` so login has somewhere to land (Task 26 replaces it):
```tsx
export default function DashboardPage() {
  return <p>Dashboard coming in Task 26.</p>;
}
```

- [ ] **Step 10: Manual check**

```bash
npm run dev
```
1. Open http://localhost:3000. You are redirected to `/login`.
2. Log in with `SEED_OWNER_PHONE`/`SEED_OWNER_PASSWORD` from `.env`. You are sent to "Change your password", because the seed sets `mustChangePassword`.
3. Change the password. You land on the dashboard placeholder.
4. Visit http://localhost:3000/api/health. It shows `{"ok":true,…}`.
5. Visit http://localhost:3000/manifest.webmanifest and http://localhost:3000/icons/192. Both load.
6. In Chrome DevTools → Toggle device toolbar → 360 px wide, the nav scrolls horizontally and nothing overflows.

- [ ] **Step 11: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat: add app shell with route guard, phone login, forced password change and PWA manifest"
```

---

### Task 22: Settings, Products, Customers and Users Screens

**Files:**
- Create: `src/actions/settings.ts`, `src/actions/products.ts`, `src/actions/customers.ts`, `src/actions/users.ts`
- Create: `src/components/field.tsx`, `src/components/state-select.tsx`
- Create: `src/app/(app)/settings/page.tsx`, `src/components/business-profile-form.tsx`, `src/components/number-series-card.tsx`
- Create: `src/app/(app)/products/page.tsx`, `src/components/products-manager.tsx`
- Create: `src/app/(app)/customers/page.tsx`, `src/components/customers-manager.tsx`, `src/components/customer-dialog.tsx`
- Create: `src/app/(app)/users/page.tsx`, `src/components/users-manager.tsx`
- Test: `tests/actions/master-data.test.ts`

**Interfaces:**
- Consumes: the domain functions of Tasks 11–13, `parseSpreadsheet` (Task 13), `runAction` (Task 6), `callAction`/`useIdempotencyKey` (Task 21).
- Produces:
  - `saveBusinessProfileAction`, `ensureNumberSeriesAction`.
  - `createProductAction`, `updateProductAction`, `setProductActiveAction`, `importProductsAction(formData)` (fields `file` and `dryRun` = `"true" | "false"`).
  - `createCustomerAction`, `updateCustomerAction`, `setCustomerActiveAction`, `searchCustomersAction(query)`.
  - `createUserAction`, `setUserActiveAction`, `setTemporaryPasswordAction`.
  - `<CustomerDialog>`, reused by the billing screen (Task 23) for quick-add.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/actions/master-data.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { createProductAction, importProductsAction } from "@/actions/products";
import { createCustomerAction } from "@/actions/customers";
import { resetDb } from "../helpers/db";
import { makeUser, MAHARASHTRA_CUSTOMER_GSTIN } from "../helpers/factories";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

async function xlsxFile(rows: (string | number)[][]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Products");
  rows.forEach((r) => ws.addRow(r));
  return new File([new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer)], "products.xlsx");
}

describe("master data actions", () => {
  beforeEach(resetDb);

  it("creates products for owners and returns FORBIDDEN for workers", async () => {
    vi.mocked(getSession).mockResolvedValue(await makeUser("OWNER"));
    const ok = await createProductAction({ sku: "LJC-01", name: "Lavender", hsnCode: "3406", unitPrice: "150", gstRate: "18" });
    expect(ok.ok && ok.data.unitPrice).toBe("150"); // Decimal arrived as a plain string

    vi.mocked(getSession).mockResolvedValue(await makeUser("WORKER"));
    expect(await createProductAction({ sku: "X", name: "X", hsnCode: "3406", unitPrice: "1", gstRate: "18" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("previews then imports products from an uploaded Excel file", async () => {
    vi.mocked(getSession).mockResolvedValue(await makeUser("OWNER"));
    const file = await xlsxFile([["SKU", "Name", "HSN", "GST %", "Price"], ["LJC-01", "Lavender Jar", "3406", 18, 150]]);

    const form = (dryRun: boolean) => { const f = new FormData(); f.set("file", file); f.set("dryRun", String(dryRun)); return f; };
    expect(await importProductsAction(form(true))).toMatchObject({ ok: true, data: { toCreate: 1, created: 0 } });
    expect(await importProductsAction(form(false))).toMatchObject({ ok: true, data: { created: 1 } });
    expect(await prisma.product.count()).toBe(1);
  });

  it("returns field errors when the customer's state doesn't match the GSTIN", async () => {
    vi.mocked(getSession).mockResolvedValue(await makeUser("OWNER"));
    const result = await createCustomerAction({ name: "Pune Traders", billingAddress: "Pune", stateCode: "21", gstin: MAHARASHTRA_CUSTOMER_GSTIN });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { stateCode: [expect.stringMatching(/GSTIN/)] } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/master-data.test.ts`
Expected: FAIL, because the action modules don't exist yet.

- [ ] **Step 3: Write the server actions**

`src/actions/settings.ts`:
```typescript
"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { ensureNumberSeries, saveBusinessProfile } from "@/domain/settings";

export async function saveBusinessProfileAction(input: unknown) {
  return runAction(async () => {
    const profile = await saveBusinessProfile(await getSession(), input);
    revalidatePath("/settings");
    return profile;
  });
}

export async function ensureNumberSeriesAction(input: unknown) {
  return runAction(async () => {
    const series = await ensureNumberSeries(await getSession(), input);
    revalidatePath("/settings");
    return series;
  });
}
```

`src/actions/products.ts`:
```typescript
"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { parseSpreadsheet } from "@/lib/spreadsheet";
import { createProduct, setProductActive, updateProduct } from "@/domain/products";
import { importProducts, mapProductRows } from "@/domain/imports";

const refresh = () => { revalidatePath("/products"); revalidatePath("/inventory"); };

export async function createProductAction(input: unknown) {
  return runAction(async () => { const p = await createProduct(await getSession(), input); refresh(); return p; });
}

export async function updateProductAction(input: unknown) {
  return runAction(async () => { const p = await updateProduct(await getSession(), input); refresh(); return p; });
}

export async function setProductActiveAction(input: unknown) {
  return runAction(async () => { const p = await setProductActive(await getSession(), input); refresh(); return p; });
}

export async function importProductsAction(formData: FormData) {
  return runAction(async () => {
    const session = await getSession(); // checked again inside importProducts
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose an Excel or CSV file.");
    const { rows } = await parseSpreadsheet(await file.arrayBuffer(), file.name);
    const result = await importProducts(session, { rows: mapProductRows(rows), dryRun: formData.get("dryRun") !== "false" });
    if (result.created || result.updated) refresh();
    return result;
  });
}
```

`src/actions/customers.ts`:
```typescript
"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { createCustomer, searchCustomers, setCustomerActive, updateCustomer } from "@/domain/customers";

export async function createCustomerAction(input: unknown) {
  return runAction(async () => { const c = await createCustomer(await getSession(), input); revalidatePath("/customers"); return c; });
}

export async function updateCustomerAction(input: unknown) {
  return runAction(async () => { const c = await updateCustomer(await getSession(), input); revalidatePath("/customers"); return c; });
}

export async function setCustomerActiveAction(input: unknown) {
  return runAction(async () => { const c = await setCustomerActive(await getSession(), input); revalidatePath("/customers"); return c; });
}

export async function searchCustomersAction(query: string) {
  return runAction(async () => searchCustomers(await getSession(), { query, limit: 20 }));
}
```

`src/actions/users.ts`:
```typescript
"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { createUser, setTemporaryPassword, setUserActive } from "@/domain/users";

export async function createUserAction(input: unknown) {
  return runAction(async () => { const u = await createUser(await getSession(), input); revalidatePath("/users"); return u; });
}

export async function setUserActiveAction(input: unknown) {
  return runAction(async () => { const u = await setUserActive(await getSession(), input); revalidatePath("/users"); return u; });
}

export async function setTemporaryPasswordAction(input: unknown) {
  return runAction(async () => { const u = await setTemporaryPassword(await getSession(), input); revalidatePath("/users"); return u; });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/actions/master-data.test.ts`
Expected: PASS

- [ ] **Step 5: Shared form components**

`src/components/field.tsx`:
```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FieldProps = React.ComponentProps<typeof Input> & { label: string; id: string; hint?: string };

export function Field({ label, id, hint, className, ...props }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className={`h-11 ${className ?? ""}`} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
```

`src/components/state-select.tsx`:
```tsx
"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GST_STATES } from "@/lib/gst";

export function StateSelect({ id, value, onChange }: { id?: string; value: string; onChange: (code: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-11 w-full"><SelectValue placeholder="Choose state" /></SelectTrigger>
      <SelectContent>
        {Object.entries(GST_STATES).map(([code, name]) => (
          <SelectItem key={code} value={code}>{name} ({code})</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 6: Settings page (business profile + number series)**

`src/app/(app)/settings/page.tsx`:
```tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getBusinessProfile, getNumberSeriesStatus } from "@/domain/settings";
import { formatDocumentNumber } from "@/domain/numbering";
import { BusinessProfileForm } from "@/components/business-profile-form";
import { NumberSeriesCard } from "@/components/number-series-card";

export default async function SettingsPage() {
  const [profile, series] = await Promise.all([getBusinessProfile(prisma), getNumberSeriesStatus(prisma)]);
  const rows = series.map((s) => ({
    series: s.series, financialYear: s.financialYear, prefix: s.prefix,
    nextNumber: s.prefix && s.nextSerial ? formatDocumentNumber(s.prefix, s.financialYear, s.nextSerial) : null,
  }));
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>
      <BusinessProfileForm initial={profile} />
      <NumberSeriesCard rows={rows} />
      <Link href="/users" className="inline-block underline">Manage worker logins →</Link>
    </div>
  );
}
```

`src/components/business-profile-form.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/field";
import { saveBusinessProfileAction } from "@/actions/settings";
import { callAction } from "@/lib/client/call-action";

type Profile = {
  legalName: string; tradeName: string | null; gstin: string; addressLine1: string; addressLine2: string | null;
  city: string; pincode: string; phone: string; email: string | null; upiId: string | null;
  bankDetails: string | null; invoiceTerms: string | null; einvoicingApplicable: boolean;
} | null;

export function BusinessProfileForm({ initial }: { initial: Profile }) {
  const router = useRouter();
  const [f, setF] = useState({
    legalName: initial?.legalName ?? "", tradeName: initial?.tradeName ?? "", gstin: initial?.gstin ?? "",
    addressLine1: initial?.addressLine1 ?? "", addressLine2: initial?.addressLine2 ?? "", city: initial?.city ?? "",
    pincode: initial?.pincode ?? "", phone: initial?.phone ?? "", email: initial?.email ?? "", upiId: initial?.upiId ?? "",
    bankDetails: initial?.bankDetails ?? "", invoiceTerms: initial?.invoiceTerms ?? "", einvoicingApplicable: initial?.einvoicingApplicable ?? false,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (await callAction(saveBusinessProfileAction(f), { success: "Business details saved" })) router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Business details (printed on every invoice)</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field id="legalName" label="Legal name" value={f.legalName} onChange={set("legalName")} required />
          <Field id="tradeName" label="Shop / trade name (optional)" value={f.tradeName} onChange={set("tradeName")} />
          <Field id="gstin" label="GSTIN" value={f.gstin} onChange={set("gstin")} hint="15 characters; state is taken from the first two digits" required />
          <Field id="phone" label="Phone" inputMode="numeric" value={f.phone} onChange={set("phone")} required />
          <Field id="addressLine1" label="Address line 1" value={f.addressLine1} onChange={set("addressLine1")} required />
          <Field id="addressLine2" label="Address line 2" value={f.addressLine2} onChange={set("addressLine2")} />
          <Field id="city" label="City" value={f.city} onChange={set("city")} required />
          <Field id="pincode" label="PIN code" inputMode="numeric" value={f.pincode} onChange={set("pincode")} required />
          <Field id="email" label="Email (optional)" type="email" value={f.email} onChange={set("email")} />
          <Field id="upiId" label="UPI ID for 'scan to pay' (optional)" value={f.upiId} onChange={set("upiId")} hint="e.g. trinetra@okhdfcbank" />
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="bank">Bank details (optional)</Label><Textarea id="bank" value={f.bankDetails} onChange={set("bankDetails")} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="terms">Invoice terms (optional)</Label><Textarea id="terms" value={f.invoiceTerms} onChange={set("invoiceTerms")} /></div>
          <label className="flex items-start gap-3 sm:col-span-2">
            <Checkbox checked={f.einvoicingApplicable} onCheckedChange={(v) => setF({ ...f, einvoicingApplicable: v === true })} />
            <span className="text-sm">E-invoicing (IRN) applies to this business. <strong>Turn on only after your CA confirms it.</strong> Bills to customers with a GSTIN are then sent to the e-invoice portal.</span>
          </label>
          <Button type="submit" size="lg" className="sm:col-span-2">Save business details</Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

`src/components/number-series-card.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ensureNumberSeriesAction } from "@/actions/settings";
import { callAction } from "@/lib/client/call-action";

type Row = { series: "INVOICE" | "CREDIT_NOTE"; financialYear: string; prefix: string | null; nextNumber: string | null };
const LABEL = { INVOICE: "Invoices", CREDIT_NOTE: "Credit notes (returns)" };

export function NumberSeriesCard({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [prefixes, setPrefixes] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.series, r.prefix ?? (r.series === "INVOICE" ? "TC" : "CN")]))
  );

  async function save(series: Row["series"]) {
    if (await callAction(ensureNumberSeriesAction({ series, prefix: prefixes[series] }), { success: "Number series saved" })) router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Number series for {rows[0]?.financialYear}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {rows.map((r) => (
          <div key={r.series} className="flex flex-wrap items-end gap-3">
            <div className="min-w-40">
              <p className="font-medium">{LABEL[r.series]}</p>
              <p className="text-sm text-muted-foreground">{r.nextNumber ? `Next: ${r.nextNumber}` : "Not set up yet: billing is blocked until you save this"}</p>
            </div>
            <Input className="h-11 w-24 uppercase" maxLength={4} value={prefixes[r.series]} onChange={(e) => setPrefixes({ ...prefixes, [r.series]: e.target.value.toUpperCase() })} />
            <Button onClick={() => save(r.series)}>{r.prefix ? "Update prefix" : "Set up"}</Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Confirm the prefix with your CA. Once a number is used, the prefix is locked for the year. On 1 April, set up the new year's series here.</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Products page (list, add/edit, activate, Excel import)**

`src/app/(app)/products/page.tsx`:
```tsx
import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { listProducts } from "@/domain/products";
import { ProductsManager } from "@/components/products-manager";

export default async function ProductsPage() {
  const products = toPlain(await listProducts(await getSession(), { includeInactive: true }));
  return <ProductsManager products={products} />;
}
```

`src/components/products-manager.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/field";
import { createProductAction, importProductsAction, setProductActiveAction, updateProductAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";
import { formatINR } from "@/lib/money";

type Product = { id: string; sku: string; name: string; unit: string; hsnCode: string; unitPrice: string; gstRate: string; reorderLevel: string; isActive: boolean };
const EMPTY = { sku: "", name: "", unit: "pcs", hsnCode: "", unitPrice: "", gstRate: "", reorderLevel: "0" };
type ImportResult = { errors: { rowNumber: number; message: string }[]; toCreate: number; toUpdate: number; created: number; updated: number };

export function ProductsManager({ products }: { products: Product[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<(typeof EMPTY & { id?: string }) | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const visible = products.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase()));

  async function save() {
    if (!editing) return;
    const { id, ...fields } = editing;
    const done = await callAction(id ? updateProductAction({ id, ...fields }) : createProductAction(fields), { success: "Product saved" });
    if (done) { setEditing(null); router.refresh(); }
  }

  async function runImport(dryRun: boolean) {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("dryRun", String(dryRun));
    const result = await callAction(importProductsAction(form), dryRun ? {} : { success: "Products imported" });
    if (!result) return;
    if (dryRun) setPreview(result);
    else { setImportOpen(false); setPreview(null); setFile(null); router.refresh(); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Products</h1>
        <Button variant="outline" onClick={() => setImportOpen(true)}>Import from Excel</Button>
        <Button onClick={() => setEditing({ ...EMPTY })}>Add product</Button>
      </div>
      <Input placeholder="Search name or SKU" className="h-11" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="divide-y rounded-md border bg-background">
        {visible.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="mr-auto">
              <p className="font-medium">{p.name} {!p.isActive && <Badge variant="secondary">Inactive</Badge>}</p>
              <p className="text-sm text-muted-foreground">{p.sku} · HSN {p.hsnCode} · GST {p.gstRate}% · {formatINR(p.unitPrice)}/{p.unit}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing({ ...p })}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={async () => { if (await callAction(setProductActiveAction({ id: p.id, isActive: !p.isActive }))) router.refresh(); }}>
              {p.isActive ? "Deactivate" : "Activate"}
            </Button>
          </li>
        ))}
        {visible.length === 0 && <li className="p-6 text-center text-muted-foreground">No products yet. Add one or import from Excel.</li>}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit product" : "Add product"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="sku" label="SKU / code" value={editing.sku} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} />
              <Field id="name" label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <Field id="price" label="Price (before GST)" inputMode="decimal" value={editing.unitPrice} onChange={(e) => setEditing({ ...editing, unitPrice: e.target.value })} />
              <Field id="unit" label="Unit" value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} />
              <Field id="hsn" label="HSN code" inputMode="numeric" value={editing.hsnCode} onChange={(e) => setEditing({ ...editing, hsnCode: e.target.value })} />
              <Field id="gst" label="GST %" inputMode="decimal" value={editing.gstRate} onChange={(e) => setEditing({ ...editing, gstRate: e.target.value })} hint="Confirm with your CA" />
              <Field id="reorder" label="Warn when stock falls to" inputMode="decimal" value={editing.reorderLevel} onChange={(e) => setEditing({ ...editing, reorderLevel: e.target.value })} />
              <Button className="sm:col-span-2" size="lg" onClick={save}>Save</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) { setPreview(null); setFile(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Import products from Excel</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">First row must be headings: <b>SKU, Name, HSN, GST %, Price</b> (optional: Unit, Reorder level). Existing SKUs are updated.</p>
          <Input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
          {preview && (
            <div className="space-y-2 text-sm">
              <p>{preview.toCreate} new, {preview.toUpdate} to update.</p>
              {preview.errors.length > 0 && (
                <ul className="max-h-40 overflow-auto rounded border border-destructive/40 p-2 text-destructive">
                  {preview.errors.map((e) => <li key={e.rowNumber}>Row {e.rowNumber}: {e.message}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={!file} onClick={() => runImport(true)}>Check file</Button>
            <Button disabled={!preview || preview.errors.length > 0} onClick={() => runImport(false)}>Import</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 8: Customers page and reusable customer dialog**

`src/app/(app)/customers/page.tsx`:
```tsx
import { getSession } from "@/lib/session";
import { searchCustomers } from "@/domain/customers";
import { CustomersManager } from "@/components/customers-manager";

export default async function CustomersPage() {
  const customers = await searchCustomers(await getSession(), { limit: 100 });
  return <CustomersManager customers={customers} />;
}
```

`src/components/customer-dialog.tsx` (also used for quick-add while billing):
```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/field";
import { StateSelect } from "@/components/state-select";
import { createCustomerAction, updateCustomerAction } from "@/actions/customers";
import { callAction } from "@/lib/client/call-action";
import { isValidGstin, stateCodeFromGstin } from "@/lib/gst";

export type CustomerFormValue = { id?: string; name: string; phone: string; gstin: string; billingAddress: string; stateCode: string };
export type SavedCustomer = { id: string; name: string; phone: string | null; gstin: string | null; billingAddress: string; stateCode: string };

export function CustomerDialog({ open, initial, onClose, onSaved }: {
  open: boolean; initial: CustomerFormValue; onClose: () => void; onSaved: (customer: SavedCustomer) => void;
}) {
  const [c, setC] = useState(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) { setLastInitial(initial); setC(initial); } // reset when reopened for another customer

  function onGstin(value: string) {
    const gstin = value.trim().toUpperCase();
    setC({ ...c, gstin, stateCode: isValidGstin(gstin) ? stateCodeFromGstin(gstin) : c.stateCode });
  }

  async function save() {
    const { id, ...fields } = c;
    const saved = await callAction(id ? updateCustomerAction({ id, ...fields }) : createCustomerAction(fields), { success: "Customer saved" });
    if (saved) onSaved(saved);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{c.id ? "Edit customer" : "New customer"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field id="cname" label="Name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
          <Field id="cphone" label="Mobile (optional)" inputMode="numeric" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
          <Field id="cgstin" label="GSTIN (leave empty for unregistered)" value={c.gstin} onChange={(e) => onGstin(e.target.value)} />
          <Field id="caddr" label="Address" value={c.billingAddress} onChange={(e) => setC({ ...c, billingAddress: e.target.value })} />
          <div className="space-y-1.5"><Label htmlFor="cstate">State</Label><StateSelect id="cstate" value={c.stateCode} onChange={(stateCode) => setC({ ...c, stateCode })} /></div>
          <Button size="lg" onClick={save}>Save customer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

`src/components/customers-manager.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerDialog, type CustomerFormValue, type SavedCustomer } from "@/components/customer-dialog";
import { setCustomerActiveAction } from "@/actions/customers";
import { callAction } from "@/lib/client/call-action";
import { stateName } from "@/lib/gst";

const BLANK: CustomerFormValue = { name: "", phone: "", gstin: "", billingAddress: "", stateCode: "21" };

export function CustomersManager({ customers }: { customers: SavedCustomer[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CustomerFormValue | null>(null);
  const q = search.toLowerCase();
  const visible = customers.filter((c) => `${c.name} ${c.phone ?? ""} ${c.gstin ?? ""}`.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Customers</h1>
        <Button onClick={() => setEditing({ ...BLANK })}>Add customer</Button>
      </div>
      <Input placeholder="Search name, mobile or GSTIN" className="h-11" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="divide-y rounded-md border bg-background">
        {visible.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="mr-auto">
              <p className="font-medium">{c.name}</p>
              <p className="text-sm text-muted-foreground">{[c.phone, c.gstin ?? "Unregistered", stateName(c.stateCode)].filter(Boolean).join(" · ")}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing({ id: c.id, name: c.name, phone: c.phone ?? "", gstin: c.gstin ?? "", billingAddress: c.billingAddress, stateCode: c.stateCode })}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={async () => { if (await callAction(setCustomerActiveAction({ id: c.id, isActive: false }), { success: "Customer hidden" })) router.refresh(); }}>Hide</Button>
          </li>
        ))}
        {visible.length === 0 && <li className="p-6 text-center text-muted-foreground">No customers found.</li>}
      </ul>
      {editing && (
        <CustomerDialog open initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />
      )}
    </div>
  );
}
```

- [ ] **Step 9: Users page**

`src/app/(app)/users/page.tsx`:
```tsx
import { getSession } from "@/lib/session";
import { listUsers } from "@/domain/users";
import { UsersManager } from "@/components/users-manager";

export default async function UsersPage() {
  const session = await getSession();
  return <UsersManager users={await listUsers(session)} currentUserId={session!.userId} />;
}
```

`src/components/users-manager.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/field";
import { createUserAction, setTemporaryPasswordAction, setUserActiveAction } from "@/actions/users";
import { callAction } from "@/lib/client/call-action";

type User = { id: string; name: string; phone: string; role: "OWNER" | "WORKER"; isActive: boolean; mustChangePassword: boolean };

export function UsersManager({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", phone: "", temporaryPassword: "" });

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (await callAction(createUserAction({ ...form, role: "WORKER" }), { success: "Worker added. Tell them their temporary password." })) {
      setForm({ name: "", phone: "", temporaryPassword: "" });
      router.refresh();
    }
  }

  async function resetPassword(user: User) {
    const temporaryPassword = window.prompt(`New temporary password for ${user.name} (8+ characters):`);
    if (temporaryPassword && (await callAction(setTemporaryPasswordAction({ userId: user.id, temporaryPassword }), { success: "Password reset. They must change it at next login." }))) router.refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Logins</h1>
      <ul className="divide-y rounded-md border bg-background">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-2 p-3">
            <div className="mr-auto">
              <p className="font-medium">{u.name} <Badge variant="outline">{u.role === "OWNER" ? "Owner" : "Worker"}</Badge> {!u.isActive && <Badge variant="secondary">Disabled</Badge>}</p>
              <p className="text-sm text-muted-foreground">{u.phone}{u.mustChangePassword ? " · must change password" : ""}</p>
            </div>
            {u.id !== currentUserId && (
              <>
                <Button variant="outline" size="sm" onClick={() => resetPassword(u)}>Reset password</Button>
                <Button variant="ghost" size="sm" onClick={async () => { if (await callAction(setUserActiveAction({ userId: u.id, isActive: !u.isActive }))) router.refresh(); }}>
                  {u.isActive ? "Disable" : "Enable"}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <Card>
        <CardHeader><CardTitle>Add a worker</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
            <Field id="uname" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Field id="uphone" label="Mobile number" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
            <Field id="upass" label="Temporary password" value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} required minLength={8} />
            <Button type="submit" className="sm:col-span-3">Add worker</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 10: Manual check (owner login)**

1. **Settings:** save business details with your real GSTIN. An invalid GSTIN shows a red toast. Then set up both number series. "Next: TC/2627/00001" appears.
2. **Products:** add one product. Then import a 3-row Excel sheet. "Check file" shows counts or row errors, and "Import" adds them.
3. **Customers:** add a customer with a GSTIN. The state switches automatically to match the GSTIN.
4. **Users:** add a worker. Log out and log in as the worker. You are forced to change the password, then see only Home / Stock / Count stock. Typing `/settings` in the address bar sends you back to Home.

- [ ] **Step 11: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat: add settings, products, customers and users screens"
```

---

### Task 23: Billing Screen — Pickers, Live Stock, Shortfall Confirmation, Payment

**Files:**
- Modify: `src/domain/billing.ts` (append `listBillableProducts`)
- Create: `src/actions/billing.ts`
- Create: `src/app/(app)/billing/new/page.tsx`, `src/components/bill-form.tsx`, `src/components/product-picker.tsx`, `src/components/customer-picker.tsx`
- Test: `tests/actions/billing.test.ts`

**Interfaces:**
- Consumes: `previewBill`/`createBill` (Tasks 14–15), `searchCustomersAction`/`CustomerDialog` (Task 22), `getBusinessProfile`/`getNumberSeriesStatus` (Task 11), `useIdempotencyKey` (Task 21).
- Produces:
  - `listBillableProducts(session)` (OWNER) → active products with `unitPrice`, `gstRate`, `unit`, `stock`.
  - `previewBillAction(draft)`.
  - `createBillAction(input)` → `{ id, invoiceNumber }`. It revalidates `/bills`, `/inventory` and `/dashboard`.
  - Route `/billing/new`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/actions/billing.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { listBillableProducts } from "@/domain/billing";
import { previewBillAction, createBillAction } from "@/actions/billing";
import { resetDb } from "../helpers/db";
import { setupBillingWorld } from "../helpers/factories";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

describe("billing actions", () => {
  beforeEach(resetDb);

  it("lists billable products with price and live stock", async () => {
    const { owner, product } = await setupBillingWorld();
    const rows = await listBillableProducts(owner);
    expect(rows.find((r) => r.id === product.id)).toMatchObject({ name: product.name });
    expect(rows[0].stock.toFixed(2)).toBe("100.00");
  });

  it("returns a JSON-safe preview (Decimals as strings)", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    vi.mocked(getSession).mockResolvedValue(owner);
    const result = await previewBillAction({ customerId: customer.id, placeOfSupply: "21", lines: [{ productId: product.id, quantity: "10" }] });
    expect(result).toMatchObject({ ok: true, data: { grandTotal: "1770", hasShortfall: false } });
  });

  it("creates the bill once even if Save is pressed twice with the same key", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    vi.mocked(getSession).mockResolvedValue(owner);
    const input = { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "ui-key-00000001", lines: [{ productId: product.id, quantity: "2" }] };
    const [a, b] = await Promise.all([createBillAction(input), createBillAction(input)]);
    expect(a.ok && b.ok && a.data.id === b.data.id).toBe(true);
    expect(await prisma.bill.count()).toBe(1);
  });

  it("tells the UI when a shortfall needs confirmation, and blocks workers", async () => {
    const { owner, worker, customer, product } = await setupBillingWorld();
    vi.mocked(getSession).mockResolvedValue(owner);
    const draft = { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "ui-key-00000002", lines: [{ productId: product.id, quantity: "500" }] };
    expect(await createBillAction(draft)).toMatchObject({ ok: false, code: "SHORTFALL_NOT_CONFIRMED" });

    vi.mocked(getSession).mockResolvedValue(worker);
    expect(await createBillAction({ ...draft, idempotencyKey: "ui-key-00000003" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/billing.test.ts`
Expected: FAIL, because `listBillableProducts` and the actions don't exist yet.

- [ ] **Step 3: Append `listBillableProducts` to `src/domain/billing.ts`**

```typescript
export async function listBillableProducts(session: Session | null) {
  requireRole(session, ["OWNER"]);
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, sku: true, name: true, unit: true, unitPrice: true, gstRate: true },
    orderBy: { name: "asc" },
  });
  const levels = await getStockLevels(prisma, products.map((p) => p.id));
  return products.map((p) => ({ ...p, stock: levels.get(p.id) ?? ZERO }));
}
```

- [ ] **Step 4: Write `src/actions/billing.ts`**

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { createBill, previewBill } from "@/domain/billing";

export async function previewBillAction(draft: unknown) {
  return runAction(async () => previewBill(await getSession(), draft));
}

export async function createBillAction(input: unknown) {
  return runAction(async () => {
    const bill = await createBill(await getSession(), input);
    for (const path of ["/bills", "/inventory", "/dashboard"]) revalidatePath(path);
    return { id: bill.id, invoiceNumber: bill.invoiceNumber };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/actions/billing.test.ts`
Expected: PASS

- [ ] **Step 6: Pickers**

`src/components/product-picker.tsx`:
```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatINR, formatQuantity } from "@/lib/money";

export type BillableProduct = { id: string; sku: string; name: string; unit: string; unitPrice: string; gstRate: string; stock: string };

export function ProductPicker({ products, value, onSelect }: { products: BillableProduct[]; value: string; onSelect: (p: BillableProduct) => void }) {
  const [open, setOpen] = useState(false);
  const selected = products.find((p) => p.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-12 w-full justify-start truncate text-left">{selected ? selected.name : "Choose item…"}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,28rem)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Type name or code…" />
          <CommandList>
            <CommandEmpty>No matching item.</CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem key={p.id} value={`${p.name} ${p.sku}`} onSelect={() => { onSelect(p); setOpen(false); }}>
                  <div className="flex w-full justify-between gap-2">
                    <span>{p.name} <span className="text-muted-foreground">({p.sku})</span></span>
                    <span className="whitespace-nowrap text-sm text-muted-foreground">{formatQuantity(p.stock)} in stock · {formatINR(p.unitPrice)}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

`src/components/customer-picker.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CustomerDialog, type SavedCustomer } from "@/components/customer-dialog";
import { searchCustomersAction } from "@/actions/customers";

export function CustomerPicker({ value, onSelect, defaultStateCode }: { value: SavedCustomer | null; onSelect: (c: SavedCustomer) => void; defaultStateCode: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SavedCustomer[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      const result = await searchCustomersAction(query);
      if (result.ok) setResults(result.data);
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query]);

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-12 flex-1 justify-start truncate">{value ? value.name : "Choose customer…"}</Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(92vw,28rem)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Name, mobile or GSTIN…" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>No customer found.</CommandEmpty>
              <CommandGroup>
                {results.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={() => { onSelect(c); setOpen(false); }}>
                    {c.name} <span className="ml-2 text-muted-foreground">{c.phone ?? c.gstin ?? ""}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button variant="secondary" className="h-12" onClick={() => setAdding(true)}>+ New</Button>
      {adding && (
        <CustomerDialog
          open
          initial={{ name: query, phone: "", gstin: "", billingAddress: "", stateCode: defaultStateCode }}
          onClose={() => setAdding(false)}
          onSaved={(c) => { setAdding(false); onSelect(c); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: The billing page and form**

`src/app/(app)/billing/new/page.tsx`:
```tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { listBillableProducts } from "@/domain/billing";
import { getBusinessProfile, getNumberSeriesStatus } from "@/domain/settings";
import { BillForm } from "@/components/bill-form";

export default async function NewBillPage() {
  const session = await getSession();
  const [profile, series] = await Promise.all([getBusinessProfile(prisma), getNumberSeriesStatus(prisma)]);
  const invoiceSeriesReady = series.find((s) => s.series === "INVOICE")?.exists;
  if (!profile || !invoiceSeriesReady) {
    return (
      <div className="space-y-3 rounded-md border bg-background p-6">
        <h1 className="text-xl font-semibold">One-time setup needed</h1>
        <p>Before the first bill, fill in business details and set up the invoice number series.</p>
        <Link className="underline" href="/settings">Go to Settings →</Link>
      </div>
    );
  }
  const products = toPlain(await listBillableProducts(session));
  return <BillForm products={products} businessStateCode={profile.stateCode} />;
}
```

`src/components/bill-form.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomerPicker } from "@/components/customer-picker";
import { ProductPicker, type BillableProduct } from "@/components/product-picker";
import { StateSelect } from "@/components/state-select";
import type { SavedCustomer } from "@/components/customer-dialog";
import { createBillAction, previewBillAction } from "@/actions/billing";
import type { Plain } from "@/lib/action-result";
import type { BillPreview } from "@/domain/billing";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { formatINR, formatQuantity } from "@/lib/money";

type Line = { rowId: number; productId: string; quantity: string; unitPrice: string; discountAmount: string };
type PayMode = "FULL" | "PART" | "CREDIT";
const METHODS = [["CASH", "Cash"], ["UPI", "UPI"], ["BANK_TRANSFER", "Bank transfer"], ["CHEQUE", "Cheque"], ["CARD", "Card"]] as const;

let nextRowId = 1;
const blankLine = (): Line => ({ rowId: nextRowId++, productId: "", quantity: "1", unitPrice: "", discountAmount: "" });

export function BillForm({ products, businessStateCode }: { products: BillableProduct[]; businessStateCode: string }) {
  const router = useRouter();
  const [key, renewKey] = useIdempotencyKey();
  const [customer, setCustomer] = useState<SavedCustomer | null>(null);
  const [placeOfSupply, setPlaceOfSupply] = useState(businessStateCode);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [preview, setPreview] = useState<Plain<BillPreview> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [payMode, setPayMode] = useState<PayMode>("FULL");
  const [paidAmount, setPaidAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filledLines = lines.filter((l) => l.productId);
  const draft = {
    customerId: customer?.id ?? "",
    placeOfSupply,
    lines: filledLines.map((l) => ({
      productId: l.productId, quantity: l.quantity,
      ...(l.unitPrice ? { unitPrice: l.unitPrice } : {}),
      ...(l.discountAmount ? { discountAmount: l.discountAmount } : {}),
    })),
  };
  const draftJson = JSON.stringify(draft);

  // Live, authoritative totals and stock from the server (debounced).
  useEffect(() => {
    if (!customer || filledLines.length === 0) { setPreview(null); setPreviewError(null); return; }
    const timer = setTimeout(async () => {
      const result = await previewBillAction(JSON.parse(draftJson));
      if (result.ok) { setPreview(result.data); setPreviewError(null); } else { setPreviewError(result.error); }
    }, 400);
    return () => clearTimeout(timer);
  }, [draftJson]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (rowId: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.rowId === rowId ? { ...l, ...patch } : l)));
  const previewLineFor = (index: number) => preview?.lines[index];

  async function save(confirmShortfall: boolean) {
    if (!customer) return toast.error("Choose a customer first.");
    if (filledLines.length === 0) return toast.error("Add at least one item.");
    if (!preview) return toast.error(previewError ?? "Please wait for the total to update.");
    if (preview.hasShortfall && !confirmShortfall) {
      return setConfirmText(preview.lines.filter((l) => l.shortfallQuantity).map((l) => `${l.productName}: short by ${formatQuantity(l.shortfallQuantity!)}`).join("\n"));
    }
    const amount = payMode === "FULL" ? preview.grandTotal : payMode === "PART" ? paidAmount : "";
    setSaving(true);
    const result = await createBillAction({
      ...draft, idempotencyKey: key, confirmShortfall,
      ...(amount && Number(amount) > 0 ? { initialPayment: { amount, method } } : {}),
    });
    setSaving(false);
    if (result.ok) {
      renewKey();
      toast.success(`Bill ${result.data.invoiceNumber} saved`);
      router.push(`/bills/${result.data.id}`);
    } else if (result.code === "SHORTFALL_NOT_CONFIRMED") {
      setConfirmText(result.error); // stock changed since the preview
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-4 pb-28">
      <h1 className="text-xl font-semibold">New bill</h1>

      <Card><CardContent className="space-y-3 pt-6">
        <Label>Customer</Label>
        <CustomerPicker value={customer} defaultStateCode={businessStateCode} onSelect={(c) => { setCustomer(c); setPlaceOfSupply(c.stateCode); }} />
        <div className="space-y-1.5">
          <Label htmlFor="pos">Goods delivered to (place of supply)</Label>
          <StateSelect id="pos" value={placeOfSupply} onChange={setPlaceOfSupply} />
        </div>
      </CardContent></Card>

      {lines.map((line, index) => {
        const product = products.find((p) => p.id === line.productId);
        const pl = previewLineFor(filledLines.findIndex((l) => l.rowId === line.rowId));
        const available = pl ? pl.availableBefore : product?.stock;
        return (
          <Card key={line.rowId}><CardContent className="space-y-3 pt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Item {index + 1}</span>
              {lines.length > 1 && <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((l) => l.rowId !== line.rowId))}>Remove</Button>}
            </div>
            <ProductPicker products={products} value={line.productId} onSelect={(p) => update(line.rowId, { productId: p.id, unitPrice: "" })} />
            {product && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={pl?.shortfallQuantity ? "destructive" : "secondary"} className="text-sm">
                    In stock: {formatQuantity(available ?? "0")} {product.unit}
                  </Badge>
                  {pl?.shortfallQuantity && <span className="text-sm text-destructive">Short by {formatQuantity(pl.shortfallQuantity)}</span>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1"><Label>Qty</Label><Input aria-label="Quantity" className="h-12 text-lg" inputMode="decimal" value={line.quantity} onChange={(e) => update(line.rowId, { quantity: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Price</Label><Input className="h-12" inputMode="decimal" placeholder={product.unitPrice} value={line.unitPrice} onChange={(e) => update(line.rowId, { unitPrice: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Discount ₹</Label><Input className="h-12" inputMode="decimal" placeholder="0" value={line.discountAmount} onChange={(e) => update(line.rowId, { discountAmount: e.target.value })} /></div>
                </div>
                {pl && <p className="text-right text-sm">Line total {formatINR(pl.lineTotal)} <span className="text-muted-foreground">(GST {formatQuantity(pl.gstRate)}%)</span></p>}
              </>
            )}
          </CardContent></Card>
        );
      })}
      <Button variant="outline" className="h-12 w-full" onClick={() => setLines([...lines, blankLine()])}>+ Add another item</Button>

      {previewError && <p className="text-sm text-destructive">{previewError}</p>}

      {preview && (
        <Card><CardContent className="space-y-1 pt-6 text-sm">
          <Row label="Taxable value" value={formatINR(preview.taxableTotal)} />
          {preview.interState
            ? <Row label="IGST" value={formatINR(preview.igstTotal)} />
            : <><Row label="CGST" value={formatINR(preview.cgstTotal)} /><Row label="SGST" value={formatINR(preview.sgstTotal)} /></>}
          <Row label="Round off" value={formatINR(preview.roundOff)} />
          <div className="flex justify-between pt-2 text-xl font-semibold"><span>Total</span><span>{formatINR(preview.grandTotal)}</span></div>
        </CardContent></Card>
      )}

      <Card><CardContent className="space-y-3 pt-6">
        <Label>Payment</Label>
        <div className="grid grid-cols-3 gap-2">
          {([["FULL", "Paid fully"], ["PART", "Part paid"], ["CREDIT", "On credit"]] as const).map(([mode, label]) => (
            <Button key={mode} variant={payMode === mode ? "default" : "outline"} className="h-12" onClick={() => setPayMode(mode)}>{label}</Button>
          ))}
        </div>
        {payMode !== "CREDIT" && (
          <div className="grid grid-cols-2 gap-2">
            {payMode === "PART" && <Input className="h-12" inputMode="decimal" placeholder="Amount received" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />}
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-12 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
      </CardContent></Card>

      <div className="fixed inset-x-0 bottom-0 border-t bg-background p-3">
        <Button size="lg" className="mx-auto flex h-14 w-full max-w-5xl text-lg" disabled={saving} onClick={() => save(false)}>
          {saving ? "Saving…" : preview ? `Save bill · ${formatINR(preview.grandTotal)}` : "Save bill"}
        </Button>
      </div>

      <AlertDialog open={confirmText !== null} onOpenChange={(open) => !open && setConfirmText(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Not enough stock</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">{confirmText}{"\n\n"}Bill anyway? The shortfall is recorded as still owed to the customer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmText(null); void save(true); }}>Bill anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span>{value}</span></div>;
}
```

- [ ] **Step 8: Manual check (owner, phone-sized window)**

1. Open `/billing/new`. If Settings isn't done, the setup prompt shows.
2. Choose a customer by typing part of the name, or use **+ New** to add one inline.
3. Choose an item. "In stock" appears, and within half a second the line total and the totals card appear.
4. Enter a quantity above stock. The badge turns red and shows "Short by N". Press Save: the confirmation dialog appears. Press "Go back" and nothing is saved.
5. Press Save, then "Bill anyway". You land on the bill page (built in Task 24; a 404 is expected until then). Back on `/inventory` (Task 25), stock has dropped and can be negative.
6. Throttle the network in DevTools to "Slow 3G" and double-tap Save. Only one bill is created.

- [ ] **Step 9: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat: add phone-friendly billing screen with live stock and shortfall confirmation"
```

---

### Task 24: Bills — List, Detail, Print (A4 + Thermal), PDF, WhatsApp, Payments, Returns

One invoice layout component (`InvoiceDocument`) renders the on-screen bill and both print sizes. The PDF uses the same `InvoiceView` data, so every output shows identical figures.

**Files:**
- Create: `src/lib/share.ts`, `src/lib/qr.ts`
- Create: `src/actions/bills.ts`
- Create: `src/components/invoice-document.tsx`, `src/components/bill-actions.tsx`, `src/components/auto-print.tsx`, `src/components/invoice-pdf.tsx`
- Create: `src/app/(app)/bills/page.tsx`, `src/app/(app)/bills/[id]/page.tsx`, `src/app/print/bills/[id]/page.tsx`, `src/app/api/bills/[id]/pdf/route.ts`
- Create: `src/assets/fonts/NotoSans-Regular.ttf`, `src/assets/fonts/NotoSans-Bold.ttf` (downloaded, OFL licence)
- Test: `tests/lib/share.test.ts`, `tests/actions/bills.test.ts`, `tests/components/invoice-pdf.test.tsx`

**Interfaces:**
- Consumes: `getInvoiceView`/`InvoiceView` (Task 20), `listBills` (Task 20), `recordPayment` (Task 16), `recordReturn` (Task 17), `retryIrpSubmission` (Task 19).
- Produces:
  - `whatsappShareUrl(phone, text)` and `invoiceShareText(view)`.
  - `invoiceQrCodes(view)` → `{ irnQr, upiQr }` (PNG data URLs or null).
  - `recordPaymentAction`, `recordReturnAction`, `retryIrpAction`.
  - `renderInvoicePdf(view, qrs)` → `Buffer`.
  - Routes `/bills`, `/bills/[id]`, `/print/bills/[id]?format=a4|thermal`, `/api/bills/[id]/pdf`.

- [ ] **Step 1: Download the PDF fonts**

```bash
mkdir -p src/assets/fonts
curl -L -o src/assets/fonts/NotoSans-Regular.ttf https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf
curl -L -o src/assets/fonts/NotoSans-Bold.ttf https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf
node -e "for (const f of ['Regular','Bold']) { const b = require('fs').readFileSync('src/assets/fonts/NotoSans-'+f+'.ttf'); console.log(f, b.length, b.subarray(0,4).toString('hex')); }"
```
Expected: both files are larger than 300000 bytes and start with `00010000` (TrueType). If the download fails, get "Noto Sans" from fonts.google.com and copy `static/NotoSans-Regular.ttf` and `static/NotoSans-Bold.ttf` here. Noto Sans includes the ₹ sign, which the default PDF font lacks.

- [ ] **Step 2: Write the failing tests**

```typescript
// tests/lib/share.test.ts
import { describe, it, expect } from "vitest";
import { whatsappShareUrl, invoiceShareText } from "@/lib/share";

describe("share", () => {
  it("builds a WhatsApp link to an Indian mobile, or a picker link without one", () => {
    expect(whatsappShareUrl("+91 98765 43210", "Hi there")).toBe("https://wa.me/919876543210?text=Hi%20there");
    expect(whatsappShareUrl(null, "Hi")).toBe("https://wa.me/?text=Hi");
  });
  it("summarises an invoice in plain words", () => {
    const text = invoiceShareText({ supplierName: "Trinetra Candles", invoiceNumber: "TC/2627/00007", invoiceDate: "20-10-2026", grandTotal: "1770", amountDue: "1000", upiPayUri: null });
    expect(text).toContain("TC/2627/00007");
    expect(text).toContain("₹1,770.00");
    expect(text).toContain("Balance due: ₹1,000.00");
  });
});
```

```typescript
// tests/actions/bills.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getSession } from "@/lib/session";
import { createBill } from "@/domain/billing";
import { recordPaymentAction, recordReturnAction } from "@/actions/bills";
import { resetDb } from "../helpers/db";
import { setupBillingWorld } from "../helpers/factories";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

describe("bill actions", () => {
  beforeEach(resetDb);

  it("records a payment and a return through the UI actions", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    vi.mocked(getSession).mockResolvedValue(owner);
    const bill = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "ui-bill-00000001", lines: [{ productId: product.id, quantity: "10" }] });

    expect(await recordPaymentAction({ billId: bill.id, amount: "500", method: "UPI", idempotencyKey: "ui-pay-00000001" })).toMatchObject({ ok: true, data: { amount: "500" } });
    expect(await recordReturnAction({ billId: bill.id, reason: "Damaged", restock: false, lines: [{ billLineItemId: bill.lineItems[0].id, quantity: "1" }], idempotencyKey: "ui-ret-00000001" }))
      .toMatchObject({ ok: true, data: { grandTotal: "177" } });
  });
});
```

```tsx
// tests/components/invoice-pdf.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { createBill } from "@/domain/billing";
import { getInvoiceView } from "@/domain/invoice-view";
import { toPlain } from "@/lib/action-result";
import { invoiceQrCodes } from "@/lib/qr";
import { renderInvoicePdf } from "@/components/invoice-pdf";
import { resetDb } from "../helpers/db";
import { makeBusinessProfile, setupBillingWorld } from "../helpers/factories";

describe("renderInvoicePdf", () => {
  beforeEach(resetDb);

  it("renders a real PDF including the UPI QR code", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    await makeBusinessProfile({ upiId: "trinetra@okhdfcbank" });
    const bill = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "pdf-bill-00000001", lines: [{ productId: product.id, quantity: "3" }] });
    const view = toPlain(await getInvoiceView(owner, bill.id));
    const qrs = await invoiceQrCodes(view);
    expect(qrs.upiQr).toMatch(/^data:image\/png;base64,/);

    const pdf = await renderInvoicePdf(view, qrs);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/lib/share.test.ts tests/actions/bills.test.ts tests/components/invoice-pdf.test.tsx`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 4: Write `src/lib/share.ts` and `src/lib/qr.ts`**

```typescript
// src/lib/share.ts
import { formatINR } from "@/lib/money";

export function whatsappShareUrl(phone: string | null, text: string): string {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  const base = /^[6-9]\d{9}$/.test(digits) ? `https://wa.me/91${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function invoiceShareText(v: {
  supplierName: string; invoiceNumber: string; invoiceDate: string; grandTotal: string; amountDue: string; upiPayUri: string | null;
}): string {
  const lines = [
    `${v.supplierName}`,
    `Invoice ${v.invoiceNumber} dated ${v.invoiceDate}`,
    `Amount: ${formatINR(v.grandTotal)}`,
    Number(v.amountDue) > 0 ? `Balance due: ${formatINR(v.amountDue)}` : "Fully paid. Thank you!",
  ];
  if (v.upiPayUri && Number(v.amountDue) > 0) lines.push(`Pay by UPI: ${v.upiPayUri}`);
  return lines.join("\n");
}
```

```typescript
// src/lib/qr.ts
import QRCode from "qrcode";

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: "M" });
}

/** QR images for an invoice: the IRP-signed QR (once accepted) and a UPI "scan to pay" QR (while a balance is due). */
export async function invoiceQrCodes(view: { irp: { status: string; signedQrCode: string | null } | null; upiPayUri: string | null }) {
  const signed = view.irp?.status === "ACCEPTED" ? view.irp.signedQrCode : null;
  return {
    irnQr: signed ? await qrDataUrl(signed) : null,
    upiQr: view.upiPayUri ? await qrDataUrl(view.upiPayUri) : null,
  };
}
```

- [ ] **Step 5: Write `src/actions/bills.ts`**

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { recordPayment } from "@/domain/payments";
import { recordReturn } from "@/domain/credit-notes";
import { retryIrpSubmission } from "@/domain/irp";

function refresh(billId?: unknown) {
  if (typeof billId === "string") revalidatePath(`/bills/${billId}`);
  for (const path of ["/bills", "/dashboard", "/inventory"]) revalidatePath(path);
}

export async function recordPaymentAction(input: { billId: string } & Record<string, unknown>) {
  return runAction(async () => { const p = await recordPayment(await getSession(), input); refresh(input.billId); return p; });
}

export async function recordReturnAction(input: { billId: string } & Record<string, unknown>) {
  return runAction(async () => { const n = await recordReturn(await getSession(), input); refresh(input.billId); return n; });
}

export async function retryIrpAction(input: { submissionId: string; billId: string }) {
  return runAction(async () => { const r = await retryIrpSubmission(await getSession(), input); refresh(input.billId); return r; });
}
```

- [ ] **Step 6: Write the PDF component `src/components/invoice-pdf.tsx`**

```tsx
import path from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Plain } from "@/lib/action-result";
import type { InvoiceView } from "@/domain/invoice-view";
import { formatINR, formatQuantity } from "@/lib/money";

const fontDir = path.join(process.cwd(), "src", "assets", "fonts");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: path.join(fontDir, "NotoSans-Regular.ttf") },
    { src: path.join(fontDir, "NotoSans-Bold.ttf"), fontWeight: "bold" },
  ],
});

const s = StyleSheet.create({
  page: { fontFamily: "NotoSans", fontSize: 9, padding: 28, gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 14, fontWeight: "bold", textAlign: "center" },
  box: { border: "1pt solid #999", padding: 6 },
  bold: { fontWeight: "bold" },
  th: { flexDirection: "row", borderBottom: "1pt solid #999", paddingBottom: 3, fontWeight: "bold" },
  tr: { flexDirection: "row", paddingVertical: 2, borderBottom: "0.5pt solid #ddd" },
  c1: { width: "4%" }, c2: { width: "32%" }, c3: { width: "10%" }, c4: { width: "10%", textAlign: "right" },
  c5: { width: "12%", textAlign: "right" }, c6: { width: "8%", textAlign: "right" }, c7: { width: "12%", textAlign: "right" }, c8: { width: "12%", textAlign: "right" },
  qr: { width: 90, height: 90 },
});

type Qrs = { irnQr: string | null; upiQr: string | null };

function InvoicePdfDocument({ view, qrs }: { view: Plain<InvoiceView>; qrs: Qrs }) {
  const t = view.totals;
  return (
    <Document title={`Invoice ${view.invoiceNumber}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{view.title}</Text>
        <View style={s.row}>
          <View style={[s.box, { flex: 1 }]}>
            <Text style={s.bold}>{view.supplier.name}</Text>
            <Text>{view.supplier.address}</Text>
            <Text>GSTIN: {view.supplier.gstin}   State: {view.supplier.stateLabel}</Text>
            {view.supplier.phone && <Text>Phone: {view.supplier.phone}</Text>}
          </View>
          <View style={[s.box, { width: 180 }]}>
            <Text>Invoice No: <Text style={s.bold}>{view.invoiceNumber}</Text></Text>
            <Text>Date: {view.invoiceDate}</Text>
            <Text>Place of supply: {view.placeOfSupplyLabel}</Text>
            <Text>Reverse charge: {view.reverseCharge}</Text>
          </View>
        </View>
        <View style={s.box}>
          <Text style={s.bold}>Bill to: {view.customer.name}</Text>
          <Text>{view.customer.address}</Text>
          <Text>{view.customer.gstin ? `GSTIN: ${view.customer.gstin}` : "Unregistered"}   State: {view.customer.stateLabel}</Text>
          {view.deliveryAddress && <Text>Ship to: {view.deliveryAddress}</Text>}
        </View>
        <View>
          <View style={s.th}>
            <Text style={s.c1}>#</Text><Text style={s.c2}>Item</Text><Text style={s.c3}>HSN</Text><Text style={s.c4}>Qty</Text>
            <Text style={s.c5}>Rate</Text><Text style={s.c6}>GST%</Text><Text style={s.c7}>Taxable</Text><Text style={s.c8}>Amount</Text>
          </View>
          {view.lines.map((l) => (
            <View key={l.id} style={s.tr}>
              <Text style={s.c1}>{l.lineNo}</Text><Text style={s.c2}>{l.productName}</Text><Text style={s.c3}>{l.hsnCode}</Text>
              <Text style={s.c4}>{formatQuantity(l.quantity)} {l.unit}</Text><Text style={s.c5}>{formatINR(l.unitPrice)}</Text>
              <Text style={s.c6}>{formatQuantity(l.gstRate)}</Text><Text style={s.c7}>{formatINR(l.taxableValue)}</Text><Text style={s.c8}>{formatINR(l.lineTotal)}</Text>
            </View>
          ))}
        </View>
        <View style={s.row}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.bold}>Tax summary</Text>
            {view.taxSummary.map((r) => (
              <Text key={`${r.hsnCode}-${r.gstRate}`}>
                HSN {r.hsnCode} @ {r.gstRate}%: taxable {formatINR(r.taxableValue)}
                {view.interState ? `, IGST ${formatINR(r.igstAmount)}` : `, CGST ${formatINR(r.cgstAmount)}, SGST ${formatINR(r.sgstAmount)}`}
              </Text>
            ))}
            <Text>Amount in words: {view.amountInWords}</Text>
            {view.bankDetails && <Text>Bank: {view.bankDetails}</Text>}
            {view.terms && <Text>Terms: {view.terms}</Text>}
          </View>
          <View style={[s.box, { width: 180, gap: 2 }]}>
            {Number(t.discountTotal) > 0 && <View style={s.row}><Text>Discount</Text><Text>-{formatINR(t.discountTotal)}</Text></View>}
            <View style={s.row}><Text>Taxable value</Text><Text>{formatINR(t.taxableTotal)}</Text></View>
            {view.interState
              ? <View style={s.row}><Text>IGST</Text><Text>{formatINR(t.igstTotal)}</Text></View>
              : <><View style={s.row}><Text>CGST</Text><Text>{formatINR(t.cgstTotal)}</Text></View><View style={s.row}><Text>SGST</Text><Text>{formatINR(t.sgstTotal)}</Text></View></>}
            <View style={s.row}><Text>Round off</Text><Text>{formatINR(t.roundOff)}</Text></View>
            <View style={s.row}><Text style={s.bold}>Total</Text><Text style={s.bold}>{formatINR(t.grandTotal)}</Text></View>
          </View>
        </View>
        <View style={s.row}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            {qrs.irnQr && <View><Image style={s.qr} src={qrs.irnQr} /><Text>e-Invoice QR</Text></View>}
            {qrs.upiQr && <View><Image style={s.qr} src={qrs.upiQr} /><Text>Scan to pay {formatINR(view.payment.amountDue)}</Text></View>}
          </View>
          <View style={{ alignItems: "flex-end", justifyContent: "flex-end" }}>
            <Text>For {view.supplier.name}</Text>
            <Text style={{ marginTop: 28 }}>Authorised signatory</Text>
          </View>
        </View>
        {view.irp?.irn && <Text>IRN: {view.irp.irn}   Ack No: {view.irp.ackNumber}   Ack Date: {view.irp.ackDate}</Text>}
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(view: Plain<InvoiceView>, qrs: Qrs): Promise<Buffer> {
  return renderToBuffer(<InvoicePdfDocument view={view} qrs={qrs} />);
}
```

- [ ] **Step 7: Write the PDF route `src/app/api/bills/[id]/pdf/route.ts`**

```typescript
import { toPlain } from "@/lib/action-result";
import { DomainError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { invoiceQrCodes } from "@/lib/qr";
import { getInvoiceView } from "@/domain/invoice-view";
import { renderInvoicePdf } from "@/components/invoice-pdf";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const view = toPlain(await getInvoiceView(await getSession(), (await params).id));
    const pdf = await renderInvoicePdf(view, await invoiceQrCodes(view));
    const fileName = `${view.invoiceNumber.replaceAll("/", "-")}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName}"` },
    });
  } catch (error) {
    if (error instanceof DomainError) return new Response(error.message, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    throw error;
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/lib/share.test.ts tests/actions/bills.test.ts tests/components/invoice-pdf.test.tsx`
Expected: PASS

- [ ] **Step 9: HTML invoice (screen + print)**

`src/components/invoice-document.tsx` (a server component with no hooks, so it works on both pages):
```tsx
import type { Plain } from "@/lib/action-result";
import type { InvoiceView } from "@/domain/invoice-view";
import { formatINR, formatQuantity } from "@/lib/money";

type Props = { view: Plain<InvoiceView>; qrs: { irnQr: string | null; upiQr: string | null }; variant: "a4" | "thermal" };

export function InvoiceDocument({ view, qrs, variant }: Props) {
  const t = view.totals;
  const thermal = variant === "thermal";
  return (
    <article className={thermal ? "invoice-thermal mx-auto w-[72mm] text-[11px] leading-tight" : "invoice-a4 mx-auto max-w-[210mm] bg-white p-6 text-sm"}>
      <h1 className="text-center text-base font-bold">{view.title}</h1>
      <section className={thermal ? "text-center" : "mt-3 grid grid-cols-2 gap-4"}>
        <div>
          <p className="font-semibold">{view.supplier.name}</p>
          <p>{view.supplier.address}</p>
          <p>GSTIN: {view.supplier.gstin}</p>
          {view.supplier.phone && <p>Ph: {view.supplier.phone}</p>}
        </div>
        <div className={thermal ? "mt-1" : "text-right"}>
          <p>Invoice: <b>{view.invoiceNumber}</b></p>
          <p>Date: {view.invoiceDate}</p>
          <p>Place of supply: {view.placeOfSupplyLabel}</p>
          <p>Reverse charge: {view.reverseCharge}</p>
        </div>
      </section>
      <section className="mt-3 border-t pt-2">
        <p className="font-semibold">Bill to: {view.customer.name}</p>
        {!thermal && <p>{view.customer.address}</p>}
        <p>{view.customer.gstin ? `GSTIN: ${view.customer.gstin}` : "Unregistered"} · {view.customer.stateLabel}</p>
        {view.deliveryAddress && !thermal && <p>Ship to: {view.deliveryAddress}</p>}
      </section>
      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th>Item</th>
            {!thermal && <th>HSN</th>}
            <th className="text-right">Qty</th>
            <th className="text-right">Rate</th>
            {!thermal && <th className="text-right">GST%</th>}
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map((l) => (
            <tr key={l.id} className="border-b align-top">
              <td>{l.productName}{l.shortfallQuantity && !thermal ? <span className="block text-xs text-amber-700">Still owed: {formatQuantity(l.shortfallQuantity)}</span> : null}</td>
              {!thermal && <td>{l.hsnCode}</td>}
              <td className="text-right">{formatQuantity(l.quantity)}</td>
              <td className="text-right">{formatINR(l.unitPrice)}</td>
              {!thermal && <td className="text-right">{formatQuantity(l.gstRate)}</td>}
              <td className="text-right">{formatINR(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className={thermal ? "mt-2 space-y-0.5" : "mt-3 ml-auto w-64 space-y-0.5"}>
        {Number(t.discountTotal) > 0 && <Line label="Discount" value={`-${formatINR(t.discountTotal)}`} />}
        <Line label="Taxable value" value={formatINR(t.taxableTotal)} />
        {view.interState ? <Line label="IGST" value={formatINR(t.igstTotal)} /> : <><Line label="CGST" value={formatINR(t.cgstTotal)} /><Line label="SGST" value={formatINR(t.sgstTotal)} /></>}
        <Line label="Round off" value={formatINR(t.roundOff)} />
        <Line label="Total" value={formatINR(t.grandTotal)} bold />
      </section>
      <p className="mt-2">{view.amountInWords}</p>
      {!thermal && view.taxSummary.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <thead><tr className="border-b text-left"><th>HSN</th><th>GST%</th><th className="text-right">Taxable</th><th className="text-right">{view.interState ? "IGST" : "CGST + SGST"}</th></tr></thead>
          <tbody>
            {view.taxSummary.map((r) => (
              <tr key={`${r.hsnCode}-${r.gstRate}`}><td>{r.hsnCode}</td><td>{r.gstRate}</td><td className="text-right">{formatINR(r.taxableValue)}</td>
                <td className="text-right">{view.interState ? formatINR(r.igstAmount) : `${formatINR(r.cgstAmount)} + ${formatINR(r.sgstAmount)}`}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <section className={thermal ? "mt-2 flex flex-col items-center gap-2" : "mt-4 flex items-end justify-between gap-4"}>
        <div className="flex gap-4">
          {qrs.irnQr && <figure className="text-center"><img src={qrs.irnQr} alt="e-invoice QR" className="h-28 w-28" /><figcaption className="text-xs">e-Invoice</figcaption></figure>}
          {qrs.upiQr && <figure className="text-center"><img src={qrs.upiQr} alt="UPI QR" className="h-28 w-28" /><figcaption className="text-xs">Scan to pay {formatINR(view.payment.amountDue)}</figcaption></figure>}
        </div>
        {!thermal && <div className="text-right"><p>For {view.supplier.name}</p><p className="mt-10">Authorised signatory</p></div>}
      </section>
      {view.irp?.irn && <p className="mt-2 break-all text-xs">IRN: {view.irp.irn} · Ack {view.irp.ackNumber} · {view.irp.ackDate}</p>}
      {view.terms && <p className="mt-2 text-xs">{view.terms}</p>}
    </article>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "text-base font-bold" : ""}`}><span>{label}</span><span>{value}</span></div>;
}
```

`src/components/auto-print.tsx`:
```tsx
"use client";
import { useEffect } from "react";

export function AutoPrint() {
  useEffect(() => { const t = setTimeout(() => window.print(), 300); return () => clearTimeout(t); }, []);
  return null;
}
```

`src/app/print/bills/[id]/page.tsx` (outside the app layout so the print has no navigation):
```tsx
import { notFound, redirect } from "next/navigation";
import { toPlain } from "@/lib/action-result";
import { DomainError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { invoiceQrCodes } from "@/lib/qr";
import { getInvoiceView } from "@/domain/invoice-view";
import { InvoiceDocument } from "@/components/invoice-document";
import { AutoPrint } from "@/components/auto-print";

export default async function PrintBillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ format?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/logout");
  const [{ id }, { format }] = await Promise.all([params, searchParams]);
  let view;
  try {
    view = toPlain(await getInvoiceView(session, id));
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  const variant = format === "thermal" ? "thermal" : "a4";
  return (
    <>
      <style>{variant === "thermal" ? "@page { size: 80mm auto; margin: 3mm; } body { background: white; }" : "@page { size: A4; margin: 10mm; } body { background: white; }"}</style>
      <InvoiceDocument view={view} qrs={await invoiceQrCodes(view)} variant={variant} />
      <AutoPrint />
    </>
  );
}
```

- [ ] **Step 10: Bills list and bill detail with actions**

`src/app/(app)/bills/page.tsx`:
```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/session";
import { formatINR } from "@/lib/money";
import { formatDateIN } from "@/lib/time";
import { listBills } from "@/domain/reports";

const STATUS_LABEL = { PAID: "Paid", PARTIAL: "Part paid", UNPAID: "Unpaid (on credit)" } as const;

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q, status } = await searchParams;
  const validStatus = status === "PAID" || status === "PARTIAL" || status === "UNPAID" ? status : undefined;
  const bills = await listBills(await getSession(), { search: q || undefined, status: validStatus });
  return (
    <div className="space-y-4">
      <div className="flex items-center"><h1 className="mr-auto text-xl font-semibold">Bills</h1><Link className="underline" href="/billing/new">New bill</Link></div>
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Invoice no. or customer" className="h-11 flex-1 rounded-md border px-3" />
        <select name="status" defaultValue={validStatus ?? ""} className="h-11 rounded-md border px-2">
          <option value="">All</option><option value="UNPAID">Unpaid</option><option value="PARTIAL">Part paid</option><option value="PAID">Paid</option>
        </select>
        <button className="h-11 rounded-md border px-4">Search</button>
      </form>
      <ul className="divide-y rounded-md border bg-background">
        {bills.map((b) => (
          <li key={b.id}>
            <Link href={`/bills/${b.id}`} className="flex flex-wrap items-center gap-2 p-3 hover:bg-muted/50">
              <div className="mr-auto"><p className="font-medium">{b.invoiceNumber} · {b.customerName}</p><p className="text-sm text-muted-foreground">{formatDateIN(b.billDate)}</p></div>
              <div className="text-right"><p className="font-medium">{formatINR(b.grandTotal)}</p>
                <Badge variant={b.payment.status === "PAID" ? "secondary" : "destructive"}>{STATUS_LABEL[b.payment.status]}{b.payment.status !== "PAID" ? ` · due ${formatINR(b.payment.amountDue)}` : ""}</Badge></div>
            </Link>
          </li>
        ))}
        {bills.length === 0 && <li className="p-6 text-center text-muted-foreground">No bills found.</li>}
      </ul>
    </div>
  );
}
```

`src/app/(app)/bills/[id]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { toPlain } from "@/lib/action-result";
import { DomainError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { invoiceQrCodes } from "@/lib/qr";
import { getInvoiceView } from "@/domain/invoice-view";
import { InvoiceDocument } from "@/components/invoice-document";
import { BillActions } from "@/components/bill-actions";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let view;
  try {
    view = toPlain(await getInvoiceView(await getSession(), id));
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  return (
    <div className="space-y-4">
      <BillActions view={view} />
      <div className="overflow-x-auto rounded-md border bg-white">
        <InvoiceDocument view={view} qrs={await invoiceQrCodes(view)} variant="a4" />
      </div>
    </div>
  );
}
```

`src/components/bill-actions.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Plain } from "@/lib/action-result";
import type { InvoiceView } from "@/domain/invoice-view";
import { recordPaymentAction, recordReturnAction, retryIrpAction } from "@/actions/bills";
import { callAction } from "@/lib/client/call-action";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { D, formatINR, formatQuantity } from "@/lib/money";
import { invoiceShareText, whatsappShareUrl } from "@/lib/share";

export function BillActions({ view }: { view: Plain<InvoiceView> }) {
  const router = useRouter();
  const [payOpen, setPayOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [payKey, renewPayKey] = useIdempotencyKey();
  const [returnKey, renewReturnKey] = useIdempotencyKey();
  const [amount, setAmount] = useState(view.payment.amountDue);
  const [method, setMethod] = useState("CASH");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});

  const returned = new Map<string, number>();
  for (const note of view.creditNotes) for (const l of note.lines) returned.set(l.billLineItemId, (returned.get(l.billLineItemId) ?? 0) + Number(l.quantity));

  const share = whatsappShareUrl(view.customer.phone, invoiceShareText({
    supplierName: view.supplier.name, invoiceNumber: view.invoiceNumber, invoiceDate: view.invoiceDate,
    grandTotal: view.totals.grandTotal, amountDue: view.payment.amountDue, upiPayUri: view.upiPayUri,
  }));

  async function pay() {
    const ok = await callAction(recordPaymentAction({ billId: view.id, amount, method, idempotencyKey: payKey }), { success: "Payment recorded" });
    if (ok) { renewPayKey(); setPayOpen(false); router.refresh(); }
  }

  async function doReturn() {
    const lines = Object.entries(returnQty).filter(([, q]) => q && Number(q) > 0).map(([billLineItemId, quantity]) => ({ billLineItemId, quantity }));
    const ok = await callAction(recordReturnAction({ billId: view.id, reason, restock, lines, idempotencyKey: returnKey }), { success: "Credit note created" });
    if (ok) { renewReturnKey(); setReturnOpen(false); setReturnQty({}); setReason(""); router.refresh(); }
  }

  const due = D(view.payment.amountDue);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{view.invoiceNumber}</h1>
        <Badge variant={view.payment.status === "PAID" ? "secondary" : "destructive"}>
          {view.payment.status === "PAID" ? "Paid" : `Due ${formatINR(view.payment.amountDue)}`}
        </Badge>
        {view.irp && <Badge variant={view.irp.status === "ACCEPTED" ? "secondary" : "outline"}>e-Invoice: {view.irp.status.toLowerCase()}</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        {due.greaterThan(0) && <Button onClick={() => { setAmount(view.payment.amountDue); setPayOpen(true); }}>Record payment</Button>}
        <Button variant="outline" onClick={() => setReturnOpen(true)}>Return items</Button>
        <Button variant="outline" asChild><a href={`/print/bills/${view.id}?format=a4`} target="_blank" rel="noreferrer">Print A4</a></Button>
        <Button variant="outline" asChild><a href={`/print/bills/${view.id}?format=thermal`} target="_blank" rel="noreferrer">Print receipt</a></Button>
        <Button variant="outline" asChild><a href={`/api/bills/${view.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></Button>
        <Button variant="outline" asChild><a href={share} target="_blank" rel="noreferrer">WhatsApp</a></Button>
        {view.irp && (view.irp.status === "FAILED" || view.irp.status === "REJECTED") && (
          <Button variant="destructive" onClick={async () => { if (await callAction(retryIrpAction({ submissionId: view.irp!.submissionId, billId: view.id }), { success: "Queued for retry" })) router.refresh(); }}>Retry e-invoice</Button>
        )}
      </div>
      {view.irp?.lastError && <p className="text-sm text-destructive">e-Invoice problem: {view.irp.lastError}</p>}
      {view.creditNotes.length > 0 && (
        <p className="text-sm text-muted-foreground">Credit notes: {view.creditNotes.map((n) => `${n.number} (${formatINR(n.grandTotal)})`).join(", ")}</p>
      )}

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1"><Label>Amount (due {formatINR(view.payment.amountDue)})</Label><Input className="h-12 text-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-12 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{[["CASH", "Cash"], ["UPI", "UPI"], ["BANK_TRANSFER", "Bank transfer"], ["CHEQUE", "Cheque"], ["CARD", "Card"]].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="lg" onClick={pay}>Save payment</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Return items (credit note)</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {view.lines.map((l) => {
              const left = Number(l.quantity) - (returned.get(l.id) ?? 0);
              return (
                <div key={l.id} className="flex items-center gap-2">
                  <span className="flex-1 text-sm">{l.productName} <span className="text-muted-foreground">(can return {formatQuantity(String(left))})</span></span>
                  <Input className="h-11 w-24" inputMode="decimal" disabled={left <= 0} value={returnQty[l.id] ?? ""} onChange={(e) => setReturnQty({ ...returnQty, [l.id]: e.target.value })} />
                </div>
              );
            })}
            <div className="space-y-1"><Label>Reason</Label><Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. broken in transit" /></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={restock} onCheckedChange={(v) => setRestock(v === true)} /> Put returned items back into stock (untick if damaged)</label>
            <Button size="lg" onClick={doReturn}>Create credit note</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 11: Manual check**

1. Open a bill from `/bills`. Every figure matches the billing screen.
2. **Print A4** opens the print dialog; check the preview fits one A4 page. **Print receipt** prints on the 80 mm thermal printer: set its paper to 80 mm and margins to "None" in the browser print dialog once.
3. **PDF** opens with ₹ signs rendered, not boxes, and a scan-to-pay QR if a UPI ID is set and a balance is due.
4. **WhatsApp** opens a chat with the customer and a pre-filled message.
5. Record a part payment. The badge changes to the new due amount.
6. Return 1 item with "put back into stock" unticked. A credit note appears, the due amount falls, and stock is unchanged.

- [ ] **Step 12: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat: add bill list, invoice view, A4/thermal print, PDF, WhatsApp share, payments and returns"
```

---

### Task 25: Stock Screens — Overview, Production, Corrections, Counts, Opening Import

**Files:**
- Create: `src/actions/inventory.ts`
- Create: `src/app/(app)/inventory/page.tsx`, `src/components/stock-list.tsx`
- Create: `src/app/(app)/inventory/counts/page.tsx`, `src/components/counts-manager.tsx`
- Create: `src/app/(app)/inventory/opening-import/page.tsx`, `src/components/opening-import.tsx`
- Test: `tests/actions/inventory.test.ts`

**Interfaces:**
- Consumes: `recordProduction`/`adjustStock`/`previewOpeningStock`/`importOpeningStock` (Tasks 8, 13), `submitStockCount`/`approveStockCount`/`discardStockCount` (Task 18), `getStockOverview`/`listPendingStockCounts` (Task 20), `parseSpreadsheet`/`mapOpeningStockRows` (Task 13).
- Produces:
  - `recordProductionAction`, `adjustStockAction`, `submitStockCountAction`, `approveStockCountAction`, `discardStockCountAction`.
  - `previewOpeningStockAction(formData)` and `importOpeningStockAction(formData)` (fields `file` and `importBatchId`).
  - Routes `/inventory`, `/inventory/counts`, `/inventory/opening-import`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/actions/inventory.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getCurrentStock } from "@/domain/stock";
import {
  adjustStockAction, approveStockCountAction, importOpeningStockAction, previewOpeningStockAction,
  recordProductionAction, submitStockCountAction,
} from "@/actions/inventory";
import { resetDb } from "../helpers/db";
import { makeProduct, makeUser } from "../helpers/factories";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

const stock = async (id: string) => (await getCurrentStock(prisma, id)).toFixed(2);

describe("inventory actions", () => {
  beforeEach(resetDb);

  it("lets workers record production and submit counts, but not correct stock", async () => {
    const p = await makeProduct();
    vi.mocked(getSession).mockResolvedValue(await makeUser("WORKER"));
    expect(await recordProductionAction({ productId: p.id, quantity: "40", idempotencyKey: "inv-prod-0001" })).toMatchObject({ ok: true });
    expect(await submitStockCountAction({ productId: p.id, countedQuantity: "38" })).toMatchObject({ ok: true });
    expect(await adjustStockAction({ productId: p.id, quantityDelta: "-1", reason: "x", idempotencyKey: "inv-adj-0001" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await stock(p.id)).toBe("40.00");
  });

  it("lets the owner approve a count", async () => {
    const p = await makeProduct();
    const owner = await makeUser("OWNER");
    vi.mocked(getSession).mockResolvedValue(owner);
    await recordProductionAction({ productId: p.id, quantity: "40", idempotencyKey: "inv-prod-0002" });
    const count = await submitStockCountAction({ productId: p.id, countedQuantity: "37" });
    expect(count.ok).toBe(true);
    if (count.ok) await approveStockCountAction({ stockCountId: count.data.id });
    expect(await stock(p.id)).toBe("37.00");
  });

  it("previews and imports opening stock from a CSV upload", async () => {
    vi.mocked(getSession).mockResolvedValue(await makeUser("OWNER"));
    const p = await makeProduct({ sku: "LJC-01" });
    const form = () => {
      const f = new FormData();
      f.set("file", new File(["SKU,Qty\nLJC-01,120\nNOPE,4\n"], "opening.csv"));
      f.set("importBatchId", "cutover-test");
      return f;
    };
    const preview = await previewOpeningStockAction(form());
    expect(preview).toMatchObject({ ok: true, data: { ready: [{ sku: "LJC-01" }], problems: [{ rowNumber: 3 }] } });
    expect(await importOpeningStockAction(form())).toMatchObject({ ok: false, code: "VALIDATION" });

    const clean = new FormData();
    clean.set("file", new File(["SKU,Qty\nLJC-01,120\n"], "opening.csv"));
    clean.set("importBatchId", "cutover-test");
    expect(await importOpeningStockAction(clean)).toMatchObject({ ok: true, data: { imported: 1 } });
    expect(await stock(p.id)).toBe("120.00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/inventory.test.ts`
Expected: FAIL, because `@/actions/inventory` doesn't exist yet.

- [ ] **Step 3: Write `src/actions/inventory.ts`**

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { parseSpreadsheet } from "@/lib/spreadsheet";
import { adjustStock, importOpeningStock, previewOpeningStock, recordProduction } from "@/domain/stock";
import { approveStockCount, discardStockCount, submitStockCount } from "@/domain/stock-counts";
import { mapOpeningStockRows } from "@/domain/imports";

const refresh = () => { for (const p of ["/inventory", "/inventory/counts", "/dashboard"]) revalidatePath(p); };

export async function recordProductionAction(input: unknown) {
  return runAction(async () => { const r = await recordProduction(await getSession(), input); refresh(); return r; });
}
export async function adjustStockAction(input: unknown) {
  return runAction(async () => { const r = await adjustStock(await getSession(), input); refresh(); return r; });
}
export async function submitStockCountAction(input: unknown) {
  return runAction(async () => { const r = await submitStockCount(await getSession(), input); refresh(); return r; });
}
export async function approveStockCountAction(input: unknown) {
  return runAction(async () => { const r = await approveStockCount(await getSession(), input); refresh(); return r; });
}
export async function discardStockCountAction(input: unknown) {
  return runAction(async () => { const r = await discardStockCount(await getSession(), input); refresh(); return r; });
}

async function openingInput(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose an Excel or CSV file.");
  const { rows } = await parseSpreadsheet(await file.arrayBuffer(), file.name);
  return { importBatchId: String(formData.get("importBatchId") ?? ""), rows: mapOpeningStockRows(rows) };
}

export async function previewOpeningStockAction(formData: FormData) {
  return runAction(async () => previewOpeningStock(await getSession(), await openingInput(formData)));
}
export async function importOpeningStockAction(formData: FormData) {
  return runAction(async () => { const r = await importOpeningStock(await getSession(), await openingInput(formData)); refresh(); return r; });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/actions/inventory.test.ts`
Expected: PASS

- [ ] **Step 5: Stock overview with production and correction dialogs**

`src/app/(app)/inventory/page.tsx`:
```tsx
import Link from "next/link";
import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { getStockOverview } from "@/domain/reports";
import { StockList } from "@/components/stock-list";

export default async function InventoryPage() {
  const session = await getSession();
  const rows = toPlain(await getStockOverview(session, {}));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Stock</h1>
        <Link href="/inventory/counts" className="underline">Count stock</Link>
        {session?.role === "OWNER" && <Link href="/inventory/opening-import" className="underline">Opening stock import</Link>}
      </div>
      <StockList rows={rows} canAdjust={session?.role === "OWNER"} />
    </div>
  );
}
```

`src/components/stock-list.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adjustStockAction, recordProductionAction } from "@/actions/inventory";
import { callAction } from "@/lib/client/call-action";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { formatQuantity } from "@/lib/money";

type Row = { id: string; sku: string; name: string; unit: string; stock: string; reorderLevel: string; status: "NEGATIVE" | "LOW" | "OK" };
type Mode = { kind: "produce" | "adjust"; row: Row } | null;

export function StockList({ rows, canAdjust }: { rows: Row[]; canAdjust: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [key, renewKey] = useIdempotencyKey();
  const visible = rows.filter((r) => `${r.name} ${r.sku}`.toLowerCase().includes(search.toLowerCase()));

  async function submit() {
    if (!mode) return;
    const pending = mode.kind === "produce"
      ? recordProductionAction({ productId: mode.row.id, quantity: qty, idempotencyKey: key })
      : adjustStockAction({ productId: mode.row.id, quantityDelta: qty, reason, idempotencyKey: key });
    if (await callAction(pending, { success: mode.kind === "produce" ? "Production added" : "Stock corrected" })) {
      renewKey(); setMode(null); setQty(""); setReason(""); router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <Input placeholder="Search item" className="h-11" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="divide-y rounded-md border bg-background">
        {visible.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 p-3">
            <div className="mr-auto">
              <p className="font-medium">{r.name}</p>
              <p className="text-sm text-muted-foreground">{r.sku}</p>
            </div>
            <span className="text-lg font-semibold">{formatQuantity(r.stock)} <span className="text-sm font-normal">{r.unit}</span></span>
            {r.status === "NEGATIVE" && <Badge variant="destructive">Oversold</Badge>}
            {r.status === "LOW" && <Badge className="bg-amber-500">Low</Badge>}
            <Button size="sm" onClick={() => setMode({ kind: "produce", row: r })}>+ Made</Button>
            {canAdjust && <Button size="sm" variant="outline" onClick={() => setMode({ kind: "adjust", row: r })}>Correct</Button>}
          </li>
        ))}
        {visible.length === 0 && <li className="p-6 text-center text-muted-foreground">No items.</li>}
      </ul>

      <Dialog open={mode !== null} onOpenChange={(open) => !open && setMode(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{mode?.kind === "produce" ? `Add production: ${mode.row.name}` : `Correct stock: ${mode?.row.name}`}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>{mode?.kind === "produce" ? "How many were made?" : "Change (use minus to reduce, e.g. -3)"}</Label>
              <Input className="h-14 text-2xl" inputMode={mode?.kind === "produce" ? "decimal" : "text"} autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            {mode?.kind === "adjust" && (
              <div className="space-y-1"><Label>Reason (required)</Label><Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. broken, miscounted" /></div>
            )}
            {mode?.kind === "produce" && <p className="text-xs text-muted-foreground">This adds finished candles to stock. It does not check raw materials.</p>}
            <Button size="lg" className="h-12" onClick={submit}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 6: Counts page (workers submit; owner approves)**

`src/app/(app)/inventory/counts/page.tsx`:
```tsx
import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { getStockOverview, listPendingStockCounts } from "@/domain/reports";
import { CountsManager } from "@/components/counts-manager";

export default async function CountsPage() {
  const session = await getSession();
  const items = toPlain(await getStockOverview(session, {})).map((r) => ({ id: r.id, name: r.name, sku: r.sku }));
  const pending = session?.role === "OWNER" ? toPlain(await listPendingStockCounts(session)) : [];
  return <CountsManager items={items} pending={pending} isOwner={session?.role === "OWNER"} />;
}
```

`src/components/counts-manager.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { approveStockCountAction, discardStockCountAction, submitStockCountAction } from "@/actions/inventory";
import { callAction } from "@/lib/client/call-action";
import { formatQuantity } from "@/lib/money";
import { formatDateIN } from "@/lib/time";

type Item = { id: string; name: string; sku: string };
type Pending = { id: string; productName: string; countedQuantity: string; expectedQuantity: string; delta: string; countedAt: Date; movementsSinceCount: number; note: string | null };

export function CountsManager({ items, pending, isOwner }: { items: Item[]; pending: Pending[]; isOwner: boolean }) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (await callAction(submitStockCountAction({ productId, countedQuantity: counted, note }), { success: isOwner ? "Count saved. Approve it below." : "Count sent to the owner" })) {
      setCounted(""); setNote(""); router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Count stock</h1>
      <Card>
        <CardHeader><CardTitle>Enter what you physically counted</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3">
            <div className="space-y-1">
              <Label htmlFor="item">Item</Label>
              <select id="item" className="h-12 w-full rounded-md border bg-background px-3" value={productId} onChange={(e) => setProductId(e.target.value)} required>
                <option value="">Choose item…</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label htmlFor="counted">Counted quantity</Label><Input id="counted" className="h-14 text-2xl" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} required /></div>
            <div className="space-y-1"><Label htmlFor="note">Note (optional)</Label><Input id="note" className="h-11" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button type="submit" size="lg" className="h-12">Save count</Button>
          </form>
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader><CardTitle>Waiting for your approval ({pending.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {pending.map((c) => (
              <div key={c.id} className="rounded-md border p-3">
                <p className="font-medium">{c.productName}</p>
                <p className="text-sm">Counted {formatQuantity(c.countedQuantity)}, system showed {formatQuantity(c.expectedQuantity)}: change <b>{Number(c.delta) > 0 ? "+" : ""}{formatQuantity(c.delta)}</b> · {formatDateIN(new Date(c.countedAt))}</p>
                {c.note && <p className="text-sm text-muted-foreground">“{c.note}”</p>}
                {c.movementsSinceCount > 0 && (
                  <p className="text-sm text-amber-700">{c.movementsSinceCount} stock change(s) were recorded after this count. Approving applies only the difference found when counting.</p>
                )}
                <div className="mt-2 flex gap-2">
                  <Button onClick={async () => { if (await callAction(approveStockCountAction({ stockCountId: c.id }), { success: "Stock updated" })) router.refresh(); }}>Approve</Button>
                  <Button variant="outline" onClick={async () => { if (await callAction(discardStockCountAction({ stockCountId: c.id }), { success: "Count discarded" })) router.refresh(); }}>Discard</Button>
                </div>
              </div>
            ))}
            {pending.length === 0 && <p className="text-muted-foreground">Nothing waiting.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Opening stock import page (owner)**

`src/app/(app)/inventory/opening-import/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { OpeningImport } from "@/components/opening-import";

export default async function OpeningImportPage() {
  const session = await getSession();
  if (session?.role !== "OWNER") redirect("/inventory");
  return <OpeningImport />;
}
```

`src/components/opening-import.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importOpeningStockAction, previewOpeningStockAction } from "@/actions/inventory";
import { callAction } from "@/lib/client/call-action";
import { newIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { formatQuantity } from "@/lib/money";

type Preview = { ready: { rowNumber: number; sku: string; name: string; quantity: string }[]; problems: { rowNumber: number; sku: string; message: string }[] };

export function OpeningImport() {
  const router = useRouter();
  const [batchId] = useState(() => `opening-${new Date().toISOString().slice(0, 10)}-${newIdempotencyKey().slice(0, 8)}`);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const form = () => { const f = new FormData(); f.set("file", file!); f.set("importBatchId", batchId); return f; };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Opening stock import</h1>
      <p className="text-sm text-muted-foreground">
        Use once, on the day you switch over: upload an Excel/CSV with columns <b>SKU</b> and <b>Quantity</b> counted that day.
        Products must already exist (import them on the Products page first). Re-uploading the same file is harmless.
      </p>
      <Input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
      <Button variant="outline" disabled={!file} onClick={async () => setPreview(await callAction(previewOpeningStockAction(form())))}>Check file</Button>
      {preview && (
        <div className="space-y-2">
          <p>{preview.ready.length} item(s) ready.</p>
          {preview.problems.length > 0 && (
            <ul className="rounded border border-destructive/40 p-2 text-sm text-destructive">
              {preview.problems.map((p) => <li key={p.rowNumber}>Row {p.rowNumber} ({p.sku || "no SKU"}): {p.message}</li>)}
            </ul>
          )}
          <ul className="max-h-64 overflow-auto rounded border p-2 text-sm">
            {preview.ready.map((r) => <li key={r.rowNumber}>{r.name} ({r.sku}): {formatQuantity(r.quantity)}</li>)}
          </ul>
          <Button disabled={preview.problems.length > 0 || preview.ready.length === 0}
            onClick={async () => { if (await callAction(importOpeningStockAction(form()), { success: "Opening stock imported" })) router.push("/inventory"); }}>
            Import {preview.ready.length} item(s)
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Manual check**

1. **As the worker, on a phone-sized screen:** on `/inventory`, tap **+ Made** and enter 50. Stock rises. There is no "Correct" button.
2. Count stock with a different number. The worker sees "Count sent to the owner".
3. **As the owner:** `/inventory/counts` shows the count with its difference. Approve it, and stock changes by exactly that difference.
4. Opening import: upload a 2-row CSV with one unknown SKU. **Check file** lists the problem row and **Import** is disabled. Fix the file, then import.

- [ ] **Step 9: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat: add stock screens for production, corrections, counts and opening import"
```

---

### Task 26: Dashboards — Owner "What Needs Attention" and Worker Home

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx` (replace the placeholder)
- Create: `src/components/owner-dashboard.tsx`, `src/components/worker-dashboard.tsx`
- Test: none new. The data comes from `getOwnerDashboard`/`getStockOverview`, already covered in Task 20. Rendering is checked manually and by the E2E test in Task 27.

**Interfaces:**
- Consumes: `getOwnerDashboard`, `getStockOverview` (Task 20).
- Produces: route `/dashboard`, role-aware.

- [ ] **Step 1: Replace `src/app/(app)/dashboard/page.tsx`**

```tsx
import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { getOwnerDashboard, getStockOverview } from "@/domain/reports";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { WorkerDashboard } from "@/components/worker-dashboard";

export default async function DashboardPage() {
  const session = await getSession();
  if (session?.role === "OWNER") return <OwnerDashboard data={toPlain(await getOwnerDashboard(session))} />;
  const stock = toPlain(await getStockOverview(session, {}));
  return <WorkerDashboard name={session?.name ?? ""} attention={stock.filter((s) => s.status !== "OK")} />;
}
```

- [ ] **Step 2: Write `src/components/owner-dashboard.tsx`**

```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Plain } from "@/lib/action-result";
import type { getOwnerDashboard } from "@/domain/reports";
import { formatINR, formatQuantity } from "@/lib/money";

type Data = Plain<Awaited<ReturnType<typeof getOwnerDashboard>>>;

export function OwnerDashboard({ data }: { data: Data }) {
  const attention = data.negativeStock.length + data.irpIssues.length + data.pendingCounts.length;
  return (
    <div className="space-y-4">
      <Button asChild size="lg" className="h-14 w-full text-lg"><Link href="/billing/new">+ New bill</Link></Button>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Today's sales" value={formatINR(data.today.salesTotal)} />
        <Stat label="Bills today" value={String(data.today.billCount)} />
        <Stat label="Money to collect" value={formatINR(data.totalDue)} href="/bills?status=UNPAID" />
      </div>

      {attention > 0 && (
        <Card className="border-destructive/50">
          <CardHeader><CardTitle>Needs attention</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.negativeStock.map((s) => (
              <p key={s.id}><Badge variant="destructive">Oversold</Badge> {s.name}: stock {formatQuantity(s.stock)}. Record production or count it.</p>
            ))}
            {data.irpIssues.map((j) => (
              <p key={j.id}><Badge variant="destructive">e-Invoice</Badge> {j.documentNumber}: {j.status.toLowerCase()} {j.lastError ? `(${j.lastError})` : ""}{" "}
                {j.billId && <Link className="underline" href={`/bills/${j.billId}`}>Open</Link>}</p>
            ))}
            {data.pendingCounts.length > 0 && (
              <p><Badge>Counts</Badge> {data.pendingCounts.length} stock count(s) waiting. <Link className="underline" href="/inventory/counts">Review</Link></p>
            )}
          </CardContent>
        </Card>
      )}

      {data.lowStock.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Running low: make more</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.lowStock.map((s) => <p key={s.id}>{s.name}: {formatQuantity(s.stock)} left (warn at {formatQuantity(s.reorderLevel)})</p>)}
          </CardContent>
        </Card>
      )}

      {data.topDues.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Who owes money</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.topDues.map((d) => <p key={d.customerId} className="flex justify-between"><span>{d.customerName}</span><span>{formatINR(d.amountDue)}</span></p>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></CardContent></Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
```

- [ ] **Step 3: Write `src/components/worker-dashboard.tsx`**

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatQuantity } from "@/lib/money";

type Item = { id: string; name: string; stock: string; status: "NEGATIVE" | "LOW" | "OK" };

export function WorkerDashboard({ name, attention }: { name: string; attention: Item[] }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Namaste, {name}</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button asChild size="lg" className="h-16 text-lg"><Link href="/inventory">Add production</Link></Button>
        <Button asChild size="lg" variant="outline" className="h-16 text-lg"><Link href="/inventory/counts">Count stock</Link></Button>
      </div>
      {attention.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Items to make soon</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {attention.map((i) => <p key={i.id}>{i.name}: {formatQuantity(i.stock)} {i.status === "NEGATIVE" ? "(oversold)" : "(low)"}</p>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Manual check**

As the owner, after creating a bill on credit and one oversold bill:
- The money-to-collect figure equals the sum of unpaid balances.
- "Needs attention" lists the oversold item.

As the worker:
- Only the two big buttons and the items-to-make list appear. No ₹ amounts appear anywhere.

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat: add owner and worker dashboards"
```

---

### Task 27: End-to-End Test of the Golden Path (Playwright, phone viewport)

Unit and action tests prove the rules. This proves a real person can do the job in a real browser on a phone-sized screen: log in, bill an item, and see stock drop. It also proves a worker can't reach billing.

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/global-setup.ts`, `tests/e2e/golden-path.spec.ts`
- Modify: `package.json` (script `test:e2e`)

**Interfaces:**
- Consumes: factories (Task 6), the whole UI (Tasks 21–26). It needs the quantity input to carry `aria-label="Quantity"` (Task 23's `bill-form.tsx`).

- [ ] **Step 1: Install the browser**

```bash
npx playwright install chromium
npm pkg set scripts.test:e2e="playwright test"
```

- [ ] **Step 2: Write `playwright.config.ts`**

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 1, // shares the test database with nothing else while running
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: {
    // .env.test values win over .env because dotenv-cli sets them first.
    command: "npx dotenv -e .env.test -- next dev -p 3100",
    url: "http://localhost:3100/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

- [ ] **Step 3: Write `tests/e2e/global-setup.ts`**

```typescript
import { execSync } from "node:child_process";
import { config } from "dotenv";

export const E2E_OWNER = { phone: "9811111111", password: "e2e-owner-pass" };
export const E2E_WORKER = { phone: "9822222222", password: "e2e-worker-pass" };

export default async function globalSetup() {
  const env = config({ path: ".env.test", override: true }).parsed ?? {};
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, ...env } });

  const { resetDb } = await import("../helpers/db");
  const f = await import("../helpers/factories");
  const { prisma } = await import("../../src/lib/db");

  await resetDb();
  await f.makeBusinessProfile();
  await f.makeSeries("INVOICE");
  await f.makeSeries("CREDIT_NOTE");
  await f.makeUser("OWNER", { name: "E2E Owner", ...E2E_OWNER });
  await f.makeUser("WORKER", { name: "E2E Worker", ...E2E_WORKER });
  await f.makeCustomer({ name: "E2E Traders" });
  const product = await f.makeProduct({ sku: "E2E-1", name: "E2E Lavender Candle" });
  await f.addStock(product.id, "20.00");
  await prisma.$disconnect();
}
```

- [ ] **Step 4: Confirm the accessible label the test relies on**

Run: `grep -n 'aria-label="Quantity"' src/components/bill-form.tsx`
Expected: one match (added in Task 23). If it is missing, add `aria-label="Quantity"` to the quantity `<Input>` in that file.

- [ ] **Step 5: Write `tests/e2e/golden-path.spec.ts`**

```typescript
import { test, expect, type Page } from "@playwright/test";
import { E2E_OWNER, E2E_WORKER } from "./global-setup";

async function login(page: Page, who: { phone: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(who.phone);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("owner bills 3 candles; stock drops from 20 to 17", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/billing/new");

  await page.getByRole("button", { name: "Choose customer…" }).click();
  await page.getByPlaceholder("Name, mobile or GSTIN…").fill("E2E");
  await page.getByRole("option", { name: /E2E Traders/ }).click();

  await page.getByRole("button", { name: "Choose item…" }).click();
  await page.getByRole("option", { name: /E2E Lavender Candle/ }).click();
  await page.getByLabel("Quantity").fill("3");
  await expect(page.getByText("Total", { exact: true })).toBeVisible(); // live preview arrived

  await page.getByRole("button", { name: /Save bill/ }).click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  await expect(page.getByRole("heading", { name: /TC\/\d{4}\/00001/ })).toBeVisible();

  await page.goto("/inventory");
  await expect(page.locator("li", { hasText: "E2E Lavender Candle" })).toContainText("17");
});

test("a worker cannot open billing and sees no money", async ({ page }) => {
  await login(page, E2E_WORKER);
  await expect(page).toHaveURL(/\/account\/password|\/dashboard/);
  await page.goto("/billing/new");
  await expect(page).toHaveURL(/\/dashboard|\/account\/password/);
  await expect(page.getByText("₹")).toHaveCount(0);
});
```

- [ ] **Step 6: Run it**

Stop any running `npm run dev` first, since two dev servers in one folder clash. Then:
```bash
npm run test:e2e
```
Expected: 2 passed. On failure, open the trace with `npx playwright show-trace test-results/**/trace.zip` to see a step-by-step replay.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts tests/e2e package.json src/components/bill-form.tsx
git commit -m "test: add phone-viewport end-to-end test of billing and worker restrictions"
```

---

### Task 28: Continuous Integration (GitHub Actions)

Every push runs the typecheck, lint, all Vitest tests against a real Postgres, and the E2E test. This is free for this repo's size, and it means Codex, Claude and humans all get the same safety net.

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: trinetra
          POSTGRES_PASSWORD: trinetra
          POSTGRES_DB: trinetra_test
        ports:
          - 5433:5432 # same port as local Docker, so the committed .env.test works unchanged
        options: >-
          --health-cmd "pg_isready -U trinetra"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://trinetra:trinetra@localhost:5433/trinetra_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: test-results
          retention-days: 7
```

- [ ] **Step 2: Push and check**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run typecheck, lint, unit and e2e tests on every push"
git push
```
Expected: on GitHub, the **Actions** tab shows "CI" passing. If `npm ci` fails on a lockfile mismatch, run `npm install` locally, commit `package-lock.json` and push again.

---

### Task 29: Backups, Restore Rehearsal, Runbook, Deployment

The spec makes these **launch prerequisites** (§10), not later polish.

**Files:**
- Create: `.github/workflows/backup.yml`, `scripts/restore-rehearsal.sh`, `docs/runbook.md`, `docs/deployment.md`, `vercel.json`
- Modify: `.gitignore` (add `.rehearsal.dump`)

- [ ] **Step 1: Nightly encrypted backup — `.github/workflows/backup.yml`**

```yaml
name: Nightly database backup

on:
  schedule:
    - cron: "30 20 * * *" # 02:00 IST
  workflow_dispatch:

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Dump with pg_dump 17 (matches the server version)
        env:
          DATABASE_URL: ${{ secrets.BACKUP_DATABASE_URL }}
        run: docker run --rm -e DATABASE_URL postgres:17 sh -c 'pg_dump "$DATABASE_URL" --format=custom --no-owner' > backup.dump
      - name: Encrypt (AES-256, passphrase from secrets)
        env:
          PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
        run: |
          gpg --batch --yes --pinentry-mode loopback --passphrase "$PASSPHRASE" --symmetric --cipher-algo AES256 \
            -o "backup-$(date -u +%Y%m%d).dump.gpg" backup.dump
          rm backup.dump
      - uses: actions/upload-artifact@v4
        with:
          name: db-backup-${{ github.run_id }}
          path: backup-*.dump.gpg
          retention-days: 30
```
In GitHub → Settings → Secrets and variables → Actions, add `BACKUP_DATABASE_URL` (the Neon **direct** URL) and `BACKUP_PASSPHRASE`, a long random phrase. Store a copy of the passphrase offline: without it the backups cannot be opened. Keep the repository **private**.

- [ ] **Step 2: Restore rehearsal — `scripts/restore-rehearsal.sh`**

```bash
#!/usr/bin/env bash
# Restores an encrypted nightly backup into a throwaway database in the local Docker
# Postgres and prints row counts to compare with the live app.
# Usage: BACKUP_PASSPHRASE='...' scripts/restore-rehearsal.sh path/to/backup-YYYYMMDD.dump.gpg
set -euo pipefail
export MSYS_NO_PATHCONV=1 # stop Git Bash on Windows from rewriting /tmp paths passed to docker

FILE="${1:?Usage: scripts/restore-rehearsal.sh <backup.dump.gpg>}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
DB="restore_rehearsal_$(date +%s)"

gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -o .rehearsal.dump -d "$FILE"
docker cp .rehearsal.dump trinetra-db:/tmp/rehearsal.dump
docker exec trinetra-db createdb -U trinetra "$DB"
docker exec trinetra-db pg_restore -U trinetra -d "$DB" --no-owner /tmp/rehearsal.dump
rm -f .rehearsal.dump

for table in users products customers bills bill_line_items stock_ledger payment_log credit_notes; do
  printf "%-18s %s\n" "$table" "$(docker exec trinetra-db psql -U trinetra -d "$DB" -tAc "SELECT count(*) FROM \"$table\"")"
done
echo "Compare with the live system. When done: docker exec trinetra-db dropdb -U trinetra $DB"
```

```bash
chmod +x scripts/restore-rehearsal.sh
echo ".rehearsal.dump" >> .gitignore
```

- [ ] **Step 3: Rehearse once (required before go-live)**

1. Trigger the backup workflow by hand: GitHub → Actions → "Nightly database backup" → **Run workflow**.
2. Download the artifact zip and unzip it.
3. Run `BACKUP_PASSPHRASE='…' scripts/restore-rehearsal.sh backup-YYYYMMDD.dump.gpg`.

Expected: the row counts printed match what the app shows (bills, products). Write the date and result in `docs/runbook.md` → *Restore rehearsal log*.

- [ ] **Step 4: `vercel.json` (region near India, IRP queue every 10 minutes)**

```json
{
  "regions": ["bom1"],
  "crons": [{ "path": "/api/cron/irp", "schedule": "*/10 * * * *" }]
}
```
Vercel calls the cron route with `Authorization: Bearer $CRON_SECRET` automatically when the `CRON_SECRET` env var is set. Sub-daily crons need the Pro plan. That plan is required anyway, because the Hobby plan forbids commercial use.

- [ ] **Step 5: Write `docs/deployment.md`**

````markdown
# Deployment

## Recommended: Vercel Pro + Neon Postgres (~US$20/month, near-zero upkeep)
Vercel's free Hobby plan is for **non-commercial use only**, so a business must use Pro. Neon's free tier is enough for this scale (check current limits on neon.tech).

1. **Neon:** create a project with Postgres 17 in the region closest to India. Copy two connection strings:
   - **Pooled** (host contains `-pooler`): this becomes `DATABASE_URL`.
   - **Direct**: this becomes `DIRECT_DATABASE_URL`, used by migrations, and also `BACKUP_DATABASE_URL` in GitHub secrets.
2. **Vercel:** "Add New Project", import the GitHub repo, and set the Framework to Next.js.
   - Build Command: `prisma migrate deploy && next build`
   - Environment variables (Production):
     - `DATABASE_URL`, `DIRECT_DATABASE_URL`
     - `SESSION_SECRET`: 64 random hex chars, different from local
     - `CRON_SECRET`: random
     - `BCRYPT_COST=12`
     - `IRP_PROVIDER=disabled`, until a real e-invoice provider is configured. Never use `mock` in production.
3. Deploy. Open `https://<app>/api/health` and confirm it shows `{"ok":true}`.
4. **Create the owner login (once),** from your laptop:
   ```bash
   DATABASE_URL="<neon direct url>" SEED_OWNER_NAME="…" SEED_OWNER_PHONE="…" SEED_OWNER_PASSWORD="…" npm run db:seed
   ```
5. Log in on the father's phone. Use Chrome menu → **Add to Home screen** to install the app icon.
6. **Monitoring (free):** create an UptimeRobot (or Better Stack) HTTP monitor on `/api/health` every 5 minutes that alerts your phone. Optionally add Sentry's free tier: `npx @sentry/wizard@latest -i nextjs`.

## Lowest cost alternative: small VPS (~₹500–800/month, more upkeep)
Run Postgres 17 and the app (`next build && next start`, or Next's standalone output) with Docker Compose behind Caddy for automatic HTTPS. You then own OS updates, disk space and backups. Point `BACKUP_DATABASE_URL` at it and keep the nightly workflow. Choose this only if someone will maintain the server.
````

- [ ] **Step 6: Write `docs/runbook.md`**

````markdown
# Trinetra Candles — Operations Runbook

## Every day (2 minutes, owner)
- Dashboard → "Needs attention": fix oversold items (record production or count), and open any e-invoice issues.
- Bills → filter "Unpaid" for follow-ups.

## Going live: parallel run with HDPOS (spec §9)
1. Pick a cut-over moment (a quiet day, **not** during Puja/Diwali).
2. Count physical stock. Products page → import products. Stock → **Opening stock import** with the counted quantities (once).
3. From that moment, **every new sale is billed in exactly one system**. Write down which (e.g. "new system for all bills; HDPOS only for reference").
4. Each evening, compare that day's bill count and total, and a few stock numbers, against HDPOS/Excel. Investigate any difference the same day.
5. Rollback trigger, agreed in advance: if more than ___ unexplained differences occur in a week, go back to HDPOS and fix before retrying.

## Internet down at the counter (spec §8)
Write bills in the pre-printed paper duplicate book, with date and time. When back online, enter each one as a normal bill and put the paper slip number in the notes. **Confirm with the CA** how late entries must be dated and reported, especially for e-invoicing.

## 1 April: new financial year
Billing stops with "No invoice number series is set up for 2027-28" until you open **Settings → Number series** and press **Set up** for both invoices and credit notes. Do this on 31 March evening.

## A worker lost their phone or left
Settings → Manage worker logins → **Disable**. They are logged out everywhere immediately.

## Someone forgot their password
- **Worker:** the owner presses **Reset password** and tells them the temporary one.
- **Owner:** the developer runs `DATABASE_URL="<neon direct url>" npm run user:reset-password -- <phone> "<temporary password>"`.

## E-invoice shows "failed" or "rejected"
- **Failed** means a network or portal problem. It retries automatically with growing gaps, so press **Retry e-invoice** on the bill only if it stays failed for more than a few hours.
- **Rejected** means the portal refused the data (e.g. a wrong customer GSTIN). Fix the customer's details, then issue a credit note and a fresh bill if your CA advises. A posted bill is never edited.

## Restore from backup
1. **Fastest:** use Neon's point-in-time restore (Neon console → Branches → Restore) to a moment before the problem.
2. **Otherwise:** download the latest nightly artifact from GitHub Actions and restore it with `pg_restore` into a new Neon branch. Point `DATABASE_URL` at it and redeploy.

## Restore rehearsal log
| Date | Backup file | Result | By |
|------|-------------|--------|----|
````

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/backup.yml scripts/restore-rehearsal.sh docs/runbook.md docs/deployment.md vercel.json .gitignore
git commit -m "docs: add nightly encrypted backups, restore rehearsal, runbook and deployment guide"
```

---

## Self-Review Record (plan author)

- **Spec coverage:** every v2 spec section maps to tasks:
  - §1–3 → Global Constraints and Tasks 11–15.
  - §4 principles → Tasks 3, 5, 7, 14–15.
  - §5 data model → Task 2.
  - §6 core flow → Tasks 14–15, 18.
  - §7 GST → Tasks 4, 9, 10, 15, 19, 24.
  - §8 outage → Task 29 runbook.
  - §9 cut-over → Tasks 13, 29.
  - §10 operational baseline → Tasks 12, 28, 29.
  - §11 screens → Tasks 21–26.
  - §12 CA items → *Open Items* section above.
  - §13 error handling → Tasks 3, 6, 15.
  - §14 testing → each task's tests plus Tasks 27–28.
  - §15 out of scope → respected; nothing from Phase 2+ is built.
- **Placeholders:** none. The runbook's blank rollback threshold and rehearsal-log table are deliberately for the owner to fill in.
- **Name consistency:** domain function names in each task's *Interfaces* match their later call sites (`computeBill`, `createBill`, `recordReturn`, `getPaymentSummary`, `getInvoiceView`, `allocateNumber`, `writeLedgerEntry`, …).
- **Review Focus** items are each pinned to a test (see the list at the top).
