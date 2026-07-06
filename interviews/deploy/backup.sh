#!/bin/sh
# Nightly backup of the interviews data. Cron: 15 3 * * * /opt/aibadges/interviews/deploy/backup.sh
set -eu

DATA_DIR="${DATA_DIR:-/opt/aibadges/interviews-data}"
BACKUP_DIR="${BACKUP_DIR:-/opt/aibadges/backups/interviews}"
STAMP=$(date +%Y%m%d)

mkdir -p "$BACKUP_DIR"
sqlite3 "$DATA_DIR/interviews.db" ".backup '$BACKUP_DIR/interviews-$STAMP.db'"
rsync -a "$DATA_DIR/uploads/" "$BACKUP_DIR/uploads/"

# keep 30 days of db snapshots
find "$BACKUP_DIR" -name 'interviews-*.db' -mtime +30 -delete
