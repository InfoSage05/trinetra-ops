# Trinetra Candles — Operations Runbook

## Every day (2 minutes, owner)
- Dashboard → "Needs attention": fix oversold items (record production or count it), and open any e-invoice issues.
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

## Restore rehearsal (required once before go-live)
1. GitHub → Actions → "Nightly database backup" → **Run workflow**; download the artifact.
2. On a machine with PostgreSQL client tools and `gpg`: `BACKUP_PASSPHRASE='…' RESTORE_PG_URL='postgresql://…/postgres' scripts/restore-rehearsal.sh backup-YYYYMMDD.dump.gpg`
3. The printed row counts must match what the app shows. Record the result below.

### Rehearsal log
| Date | Backup file | Result | By |
|------|-------------|--------|----|
