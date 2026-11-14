#!/usr/bin/env bash
# 백업·상태 점검 cron 을 등록합니다. 여러 번 실행해도 한 벌만 남습니다.
set -euo pipefail
APP_DIR="/var/www/dh-smartpower-dashboard"
LOG_DIR="$HOME/backups"
mkdir -p "$LOG_DIR"

{
  crontab -l 2>/dev/null | grep -v 'dh-smartpower-dashboard/deploy/\(backup\|healthcheck\).sh' || true
  echo "30 18 * * * $APP_DIR/deploy/backup.sh >> $LOG_DIR/backup.log 2>&1"
  echo "*/5 * * * * $APP_DIR/deploy/healthcheck.sh >> $LOG_DIR/healthcheck.log 2>&1"
} | crontab -
echo "    cron: 백업 매일 한국 03:30 / 상태 점검 5분마다"
