#!/usr/bin/env bash
# 배포 스크립트. EC2 에서 실행합니다.
#   cd /var/www/dh-smartpower-dashboard && ./deploy/deploy.sh
set -euo pipefail

APP_DIR="/var/www/dh-smartpower-dashboard"
cd "$APP_DIR"

echo "==> 최신 코드 받기"
git pull --ff-only origin main

echo "==> 의존성 설치"
npm ci --omit=dev --no-audit --no-fund || npm ci --no-audit --no-fund

echo "==> 스키마 반영 (반복 실행 안전)"
set -a; . ./.env.local; set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f db/schema.sql

echo "==> 빌드"
npm run build

echo "==> 재기동"
pm2 reload dh-dashboard --update-env

echo "==> 상태 확인"
sleep 3
curl -fsS -o /dev/null -w "  로컬 응답: %{http_code}\n" http://127.0.0.1:3000/login

echo "배포 완료: $(date '+%Y-%m-%d %H:%M:%S')"
