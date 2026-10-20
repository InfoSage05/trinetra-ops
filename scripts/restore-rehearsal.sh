#!/usr/bin/env bash
# Restores an encrypted nightly backup into a throwaway database and prints row counts to
# compare with the live app. Needs PostgreSQL client tools (pg_restore, psql, createdb, dropdb)
# and gpg on the PATH, plus a PostgreSQL server you can create databases on.
#
# Usage:
#   BACKUP_PASSPHRASE='...' RESTORE_PG_URL='postgresql://user:pass@localhost:5433/postgres' \
#     scripts/restore-rehearsal.sh path/to/backup-YYYYMMDD.dump.gpg
set -euo pipefail

FILE="${1:?Usage: scripts/restore-rehearsal.sh <backup.dump.gpg>}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
: "${RESTORE_PG_URL:?Set RESTORE_PG_URL to a server URL you may create databases on}"

DB="restore_rehearsal_$(date +%s)"
BASE="${RESTORE_PG_URL%/*}"

gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -o .rehearsal.dump -d "$FILE"
psql "$RESTORE_PG_URL" -c "CREATE DATABASE \"$DB\""
pg_restore --no-owner -d "$BASE/$DB" .rehearsal.dump
rm -f .rehearsal.dump

for table in users products customers bills bill_line_items stock_ledger payment_log credit_notes; do
  printf "%-18s %s\n" "$table" "$(psql "$BASE/$DB" -tAc "SELECT count(*) FROM \"$table\"")"
done
echo "Compare with the live system. When done: psql \"$RESTORE_PG_URL\" -c 'DROP DATABASE \"$DB\"'"
