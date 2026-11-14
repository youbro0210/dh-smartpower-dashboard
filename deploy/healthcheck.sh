#!/usr/bin/env bash
# 5분마다 cron 으로 실행합니다 (deploy/install-cron.sh).
# 수집 서버가 멈췄거나 디스크가 찰 때 '시스템' 알람을 넣습니다.
# 알람은 기존 발송 워커(dh-notify)가 등록된 수신자에게 보냅니다.
# 같은 알람은 1시간에 한 번만 넣습니다.
set -euo pipefail

APP_DIR="/var/www/dh-smartpower-dashboard"
set -a; . "$APP_DIR/.env.local"; set +a

raise() {  # $1 항목  $2 등급  $3 내용
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 \
    -v item="$1" -v level="$2" -v detail="$3" <<'SQL'
INSERT INTO alarm_events (device_id, unit, item, level, detail)
SELECT NULL, '시스템', :'item', :'level', :'detail'
 WHERE NOT EXISTS (
   SELECT 1 FROM alarm_events
    WHERE unit = '시스템' AND item = :'item' AND created_at > now() - interval '1 hour');
SQL
}

# 1) 수집 서버 심장박동 (5분 이상 끊기면)
stale=$(psql "$DATABASE_URL" -tA -c \
  "SELECT COALESCE(EXTRACT(EPOCH FROM now() - last_heartbeat)::int, 99999) FROM collector_status WHERE id = 1" || echo 99999)
if [ "${stale:-99999}" -gt 300 ]; then
  raise "수집 서버 응답 없음" "danger" "마지막 응답 후 ${stale}초 경과. 계측값이 적재되지 않습니다."
fi

# 2) 디스크 사용률 (90% 이상)
used=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ "${used:-0}" -ge 90 ]; then
  raise "서버 디스크 부족" "warning" "디스크 사용률 ${used}%."
fi
