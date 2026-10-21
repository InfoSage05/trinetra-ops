# Trinetra Candles — Agent Guide

This file is the entry point for any AI agent (Claude, Codex, or otherwise) working in this
repository. If you are a coding agent and this is your first time in this repo, read this file
fully before touching code or docs.

## What this project is

Software for a candle manufacturing business (Trinetra Candles), replacing a manual
Excel+HDPOS billing/inventory workflow that breaks down under festival-season order volume. It
is built in phases. Phase 1 (inventory + billing core) is merged; Phases 2-4 (AI-assisted entry, orders and
reminders, reports) and the carton-based invoice are on branch `feature/carton-invoice-and-phases-2-4`.

**Canonical spec:** `docs/superpowers/specs/2026-10-20-phase1-inventory-billing-design.md` (v2).
Read this before implementing anything. It is the single source of truth for Phase 1 scope,
data model, and architecture.

**Implementation plan:** `docs/superpowers/plans/2026-10-20-phase1-inventory-billing.md` (v2,
29 tasks). Execute tasks in order; each task's *Interfaces* block names exactly what it consumes
and produces. Read the plan's "Global Constraints" and "Conventions" sections first.

**Phases 2-4 and the carton invoice:** `docs/superpowers/specs/2026-10-21-carton-invoice-and-phases-2-4-design.md`.
Owner-facing key/account setup is in `docs/keys.md`.

**Never bypass safety guards.** Prisma 7 refuses destructive commands (`migrate reset`,
`db push --accept-data-loss`) when run by an AI agent unless `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`
is set. Never set it yourself. Stop and ask the human. The same applies to `--no-verify`, force
pushes, and dropping databases.

**Historical context:** `docs/superpowers/specs/2026-10-20-trinetra-candles-full-context-and-phase1-plan.md`
holds the full business background and the record of three review passes plus an external audit
that corrected several early mistakes (invoice numbering mechanics, GST e-invoicing specifics,
IRP's async/external nature, lifecycle completeness). Read it for *why* a decision was made; the
v2 spec above is authoritative for *what* to build.

## Non-negotiable architectural principles

These exist to keep the backend usable by future LLM-driven workflows (Phase 2/3: Excel
reconciliation, voice-order capture) without rework. Do not violate them for convenience:

1. **Append-only ledgers, never mutate-in-place.** Stock (`stock_ledger`), payments
   (`payment_log`), and anything else framed as a ledger in the spec are write-once. A
   correction is a new compensating entry, never an edit or delete of a posted row. Enforce this
   in both application code and database permissions.
2. **One implementation of each business operation, many callers.** `createBill()`,
   `recordProduction()`, `adjustStock()`, `recordReturn()`, etc. live in one place. The UI, and
   later any agentic workflow, call these functions — never reimplement the validation/ledger
   logic in a second code path.
3. **Server-side role enforcement, always.** Never rely on the UI hiding a control as the only
   access check. Every mutating server-side entry point re-checks role.
4. **Idempotency and attribution on every ledger write.** New ledger-style writes need a
   uniquely-indexed idempotency key scoped to operation+caller, plus `actor_type`
   (`human`/`agent`) and `source_metadata`. This is cheap now and expensive to retrofit later —
   don't skip it to save time on a Phase 1 task.
5. **Preview is a proposal, not a lock.** If you implement a dry-run/preview mode on a core
   function, always revalidate state at commit time. Never let a stale preview commit without
   re-checking stock/price/permissions.

## Working with GST/compliance content

This spec deals with real legal requirements (GST invoicing, e-invoicing/IRN, Rule 46 numbering).
Rules on this:
- Don't assert a compliance claim as fact without a cited source (a rule number, a government
  notification, official documentation). "I'm fairly sure this is how GST works" is not
  sufficient — the project's history includes a prior AI-authored spec draft that got multiple
  compliance details wrong by assuming instead of checking.
- Where applicability genuinely depends on facts only the business/its CA can confirm (e.g.
  exact e-invoicing applicability, exact serial format), say so explicitly and flag it as an open
  item — see Section 12 of the v2 spec for the current list. Don't quietly pick an assumption and
  present it as settled.
- The government e-invoice IRP is an external system. Never design it as part of a database
  transaction — it needs an async job + retry/reconciliation pattern (see v2 spec Section 6).

## AI features (Phases 2-3)

- The model never writes data. `src/domain/ai-stock.ts` and `src/domain/ai-orders.ts` only return
  *proposals* (validated, matched against the real catalogue). A person approves; only then the normal
  domain functions run, with `actorType = AGENT` and provenance in `sourceMetadata`.
- Every AI path has a no-key fallback (`src/lib/text-entry.ts`), so the app works without any key.
- Providers are OpenAI-compatible open-source hosts configured by `LLM_*` / `STT_*` env vars
  (`src/lib/llm.ts`, `src/lib/stt.ts`). Tests inject fakes with `setLlmClientForTests`; never call a real
  provider from tests.
- Order fulfilment is derived from bills raised against the order (`Bill.orderId`), never stored.

## Scope discipline

- Respect phase boundaries. Raw material/BOM tracking, multi-warehouse and a real e-invoice
  adapter are still out of scope (see section 8 of the 2026-10-21 spec). If a task seems to need
  something from a later phase, stop and flag it rather than quietly expanding scope.
- This is a small-scale system (dozens of SKUs, <50 bills/day peak, 1–3 concurrent users). Don't
  add infrastructure, caching, or abstraction layers sized for a bigger business than this one.
- When you do find a real gap in the spec (not just a style preference), write it into the spec
  document with reasoning, the same way prior review passes did — don't silently code around a
  gap without updating the doc that's supposed to describe the system.

## Collaboration conventions (multiple agents work in this repo)

- Both Claude Code and Codex are used on this project. When you change a spec doc, write a clear
  commit message explaining *why*, not just *what* — the next agent (of either kind) to open this
  repo relies on commit messages and doc content to understand prior decisions, not on a shared
  chat history.
- Prefer amending/consolidating a spec doc into a coherent single version over leaving stacked
  "addendum" sections that contradict earlier text — future readers (human or agent) should not
  have to reconstruct which section wins.
- Tests: for Phase 1, automated tests should focus on ledger math, transactional billing
  correctness, concurrent invoice-numbering safety, and GST split/rounding — not broad UI test
  coverage (see v2 spec Section 14 for the full rationale).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
