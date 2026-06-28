#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# ArtCurve Database Backup Script
# Usage:
#   ./scripts/backup.sh                  # backup local DB
#   ./scripts/backup.sh --production     # backup production DB (Render)
#
# Cron (daily 3AM):
#   0 3 * * * cd /path/to/Artcurve_Be && ./scripts/backup.sh >> logs/backup.log 2>&1
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETAIN_DAYS=7

mkdir -p "$BACKUP_DIR"

if [ "${1:-}" = "--production" ]; then
  # Production: read from .env or pass DATABASE_URL
  if [ -z "${DATABASE_URL:-}" ]; then
    source .env 2>/dev/null || true
  fi
  DB_URL="${DATABASE_URL:-}"
  if [ -z "$DB_URL" ]; then
    echo "ERROR: DATABASE_URL not set. Pass it as env var or configure .env"
    exit 1
  fi
  FILENAME="artcurve_prod_${TIMESTAMP}.sql.gz"
  echo "[$(date)] Starting production backup..."
  pg_dump "$DB_URL" --no-owner --no-privileges | gzip > "$BACKUP_DIR/$FILENAME"
else
  # Local dev
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5432}"
  DB_USER="${DB_USERNAME:-postgres}"
  DB_NAME="${DB_NAME:-artcurve_db}"
  FILENAME="artcurve_local_${TIMESTAMP}.sql.gz"
  echo "[$(date)] Starting local backup..."
  PGPASSWORD="${DB_PASSWORD:-postgres}" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" --no-owner --no-privileges | gzip > "$BACKUP_DIR/$FILENAME"
fi

SIZE=$(du -sh "$BACKUP_DIR/$FILENAME" | cut -f1)
echo "[$(date)] Backup complete: $FILENAME ($SIZE)"

# Cleanup old backups
DELETED=$(find "$BACKUP_DIR" -name "artcurve_*.sql.gz" -mtime +$RETAIN_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] Cleaned up $DELETED old backup(s) (older than ${RETAIN_DAYS} days)"
fi

echo "[$(date)] Current backups:"
ls -lh "$BACKUP_DIR"/artcurve_*.sql.gz 2>/dev/null || echo "  (none)"
