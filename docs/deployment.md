# Deployment

## Local development (no Docker needed)
```bash
npm install
npm run db:up        # starts a local PostgreSQL 17 on port 5433 (keep this window open)
npm run db:migrate   # in another window: applies migrations to the dev database
npm run db:seed      # creates the first owner login from SEED_OWNER_* in .env
npm run dev          # http://localhost:3000
npm test             # unit/integration tests (needs the database running)
npm run test:e2e     # browser tests on a phone-sized viewport
```

## Recommended production: Vercel Pro + Neon Postgres (~US$20/month, near-zero upkeep)
Vercel's free Hobby plan is for **non-commercial use only**, so a business must use Pro. Neon's free tier is enough for this scale (check current limits on neon.tech).

1. **Neon:** create a project with Postgres 18 (17 also works; the backup tool in `.github/workflows/backup.yml` is version 18, and a backup tool can read the same or an older server, never a newer one) in the region closest to India. Copy two connection strings:
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
6. **Monitoring (free):** create an UptimeRobot (or Better Stack) HTTP monitor on `/api/health` every 5 minutes that alerts your phone.
7. **Backups:** add GitHub secrets `BACKUP_DATABASE_URL` (Neon direct URL) and `BACKUP_PASSPHRASE` (long random phrase; keep a copy offline — without it backups cannot be opened). Keep the repository **private**. Then do the restore rehearsal in `docs/runbook.md`.

## Lowest cost alternative: small VPS (~₹500–800/month, more upkeep)
Run PostgreSQL 17 and the app (`next build && next start`) behind Caddy for automatic HTTPS. You then own OS updates, disk space and backups. Point `BACKUP_DATABASE_URL` at it and keep the nightly workflow. Choose this only if someone will maintain the server.

## Real e-invoicing (IRP)
Phase 1 ships the submission queue and a mock client only. Before turning on **E-invoicing applicable** in Settings, confirm applicability with the CA and add a real provider adapter implementing `IrpClient` (`src/domain/irp.ts`), tested against the IRP sandbox.
