# Backup Strategy

## Automated Daily Backup

The `BackupService` runs a `pg_dump` every day at **03:00 UTC** in production.

- Compressed with gzip (`.sql.gz`)
- Stored in `backups/` directory (gitignored)
- Retains last 7 backups, older files auto-deleted
- Status exposed via health endpoint

## Manual Backup

### Via API

```bash
# Requires JWT authentication
curl -X POST https://artcurve-be.onrender.com/api/v1/health/backup/run \
  -H "Authorization: Bearer <token>"
```

### Via Script

```bash
# Local database
./scripts/backup.sh

# Production database
DATABASE_URL="postgresql://user:pass@host:5432/db" ./scripts/backup.sh --production
```

### Via Cron (server-level)

```bash
# Add to crontab: daily at 3AM
0 3 * * * cd /path/to/Artcurve_Be && ./scripts/backup.sh >> logs/backup.log 2>&1
```

## Check Backup Status

```bash
curl https://artcurve-be.onrender.com/api/v1/health/backup

# Response:
# {
#   "lastBackupTime": "2026-06-29T03:00:00.000Z",
#   "lastBackupStatus": "success",
#   "lastBackupSize": "12.5 MB",
#   "nextScheduled": "Daily at 03:00 UTC"
# }
```

## Restore from Backup

```bash
# Decompress and restore
gunzip < backups/artcurve_20260629_030000.sql.gz | psql -h localhost -U postgres -d artcurve_db

# Or for production
gunzip < backup.sql.gz | psql "$DATABASE_URL"
```

## Disaster Recovery

1. Stop the application
2. Create a new database: `createdb artcurve_db_restored`
3. Restore: `gunzip < latest_backup.sql.gz | psql -d artcurve_db_restored`
4. Verify data integrity
5. Rename databases: swap old and restored
6. Restart the application — migrations will run automatically
