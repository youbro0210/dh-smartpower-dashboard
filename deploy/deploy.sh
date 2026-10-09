#!/usr/bin/env bash
# 배포 스크립트. EC2 에서 실행합니다.
#   cd /var/www/dh-smartpower-dashboard && ./deploy/deploy.sh
set -euo pipefail

APP_DIR="/var/www/dh-smartpower-dashboard"
cd "$APP_DIR"

echo "==> 최신 코드 받기"
git pull --ff-only origin main

echo "==> 의존성 설치"
# --omit=dev 를 쓰면 typescript 와 @types/* 가 빠져 바로 아래 빌드가 실패합니다.
# next build 는 개발 의존성을 필요로 하므로 전체를 설치합니다.
npm ci --no-audit --no-fund

echo "==> 스키마 반영 (반복 실행 안전)"
set -a; . ./.env.local; set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f db/schema.sql

echo "==> 빌드"
npm run build

echo "==> 재기동"
pm2 reload dh-dashboard --update-env

# 발송 워커와 수집 서버도 같은 코드를 쓰므로 함께 올립니다.
# 등록되어 있지 않으면 건너뜁니다.
for app in dh-notify dh-collector; do
  if pm2 describe "$app" > /dev/null 2>&1; then
    echo "    $app 재기동"
    pm2 restart "$app" --update-env
  else
    echo "    $app 등록되어 있지 않아 건너뜁니다."
  fi
done

echo "==> 상태 확인"
sleep 3
curl -fsS -o /dev/null -w "  로컬 응답: %{http_code}\n" http://127.0.0.1:3000/login

# 수집기가 브로커에 다시 붙었는지 확인합니다.
psql "$DATABASE_URL" -tA -c \
  "SELECT '  수집기: ' || CASE WHEN connected THEN '연결됨' ELSE '연결 끊김' END
          || ' / 마지막 심장박동 ' || COALESCE(to_char(last_heartbeat,'HH24:MI:SS'),'없음')
     FROM collector_status WHERE id = 1" 2>/dev/null || true

echo "배포 완료: $(date '+%Y-%m-%d %H:%M:%S')"
