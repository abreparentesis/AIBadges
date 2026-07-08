#!/usr/bin/env bash
# Consistent SQLite backup for the aibadges-backend container, safe while the server is live.
# VACUUM INTO takes a transactional snapshot, so WAL state and in-flight writes can't corrupt it.
#
# Usage:  ./scripts/backup.sh [container-name] [host-data-dir]
# Cron:   17 4 * * *  /opt/aibadges-backend/scripts/backup.sh  >> /var/log/aibadges-backup.log 2>&1
set -euo pipefail

CONTAINER="${1:-aibadges-backend}"
DATA_DIR="${2:-$(cd "$(dirname "$0")/.." && pwd)/data}"
KEEP=14
STAMP="$(date +%Y%m%d-%H%M%S)"

docker exec "$CONTAINER" bun -e "
  const { Database } = require('bun:sqlite');
  const db = new Database(process.env.DB_PATH ?? '/data/aibadges.db');
  db.exec(\"VACUUM INTO '/data/backup-$STAMP.db'\");
  db.close();
"

# Prune: keep the newest $KEEP snapshots.
ls -1t "$DATA_DIR"/backup-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "backup ok: $DATA_DIR/backup-$STAMP.db"
