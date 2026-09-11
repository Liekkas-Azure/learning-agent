#!/usr/bin/env bash
# 备份 Knotory 数据目录为带时间戳的 zip（含 wiki / raw / outputs / knotory.db）
set -euo pipefail

DATA_DIR="${KNOTORY_DATA_DIR:-$HOME/knotory-data}"
OUT_DIR="${KNOTORY_BACKUP_DIR:-$HOME/knotory-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$OUT_DIR/knotory-backup-$STAMP.zip"

if [[ ! -d "$DATA_DIR" ]]; then
  echo "数据目录不存在: $DATA_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
cd "$DATA_DIR"
zip -rq "$ARCHIVE" wiki raw outputs knotory.db 2>/dev/null || zip -rq "$ARCHIVE" . -x "*.zip"

echo "备份完成: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
