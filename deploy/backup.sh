#!/usr/bin/env bash
# DB 일일 백업. cron 으로 매일 실행합니다 (deploy/install-cron.sh).
# 같은 서버 디스크에 14일치를 보관합니다.
set -euo pipefail

APP_DIR="/var/www/dh-smartpower-dashboard"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/dh-smartpower}"
KEEP_DAYS="${KEEP_DAYS:-14}"

set -a; . "$APP_DIR/.env.local"; set +a
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

file="$BACKUP_DIR/dh-$(date +%Y%m%d-%H%M).dump"
pg_dump --format=custom --no-owner --file="$file.part" "$DATABASE_URL"
mv "$file.part" "$file"
chmod 600 "$file"

find "$BACKUP_DIR" -name 'dh-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') 백업 완료: $file ($(du -h "$file" | cut -f1))"
