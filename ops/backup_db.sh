#!/usr/bin/env bash
set -euo pipefail
DB="/home/kairen7683/chemeng-studio/backend/data/chemeng_studio.db"
BDIR="/home/kairen7683/backups/chemeng-studio"
mkdir -p "$BDIR"
TS=$(date +%Y%m%d_%H%M%S)
OUT="$BDIR/chemeng_studio_${TS}.db"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".timeout 5000" ".backup '$OUT'"
else
  python3 -c "import sqlite3; src=sqlite3.connect('$DB'); dst=sqlite3.connect('$OUT'); src.backup(dst); dst.close(); src.close()"
fi
gzip -f "$OUT"
find "$BDIR" -name 'chemeng_studio_*.db.gz' -type f -mtime +30 -delete
echo "[$(date -Iseconds)] Backup OK: ${OUT}.gz ($(stat -c%s "${OUT}.gz") bytes)"
