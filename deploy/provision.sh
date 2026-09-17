#!/usr/bin/env bash
# ============================================================================
#  EC2 최초 프로비저닝 (Ubuntu 24.04 LTS)
#
#  사용:
#    sudo bash provision.sh <도메인 또는 퍼블릭IP>
#
#  수행 내용: 스왑 · Node 20 · PostgreSQL 16 · nginx · PM2 설치,
#             DB/계정 생성, 코드 배포, 스키마 반영, 빌드, 기동, 방화벽 설정
# ============================================================================
set -euo pipefail

SERVER_NAME="${1:-_}"
APP_DIR="/var/www/dh-smartpower-dashboard"
REPO="https://github.com/youbro0210/dh-smartpower-dashboard.git"
DB_NAME="dhsmartpower"
DB_USER="dh"
RUN_USER="${SUDO_USER:-ubuntu}"

log() { echo -e "\n\033[1m==> $*\033[0m"; }

# 실패 시 어느 줄에서 멈췄는지 로그에 남깁니다.
trap 'echo "[PROVISION FAILED] line ${LINENO}: ${BASH_COMMAND}" >&2' ERR

export DEBIAN_FRONTEND=noninteractive
# 우분투 24.04 의 needrestart 가 서비스 재시작 여부를 대화형으로 묻는 것을 막습니다.
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

# 우분투는 부팅 직후 unattended-upgrades / apt-daily 가 자동 실행되어
# dpkg 잠금을 점유합니다. 그 상태에서 apt 를 호출하면 즉시 실패하고,
# set -e 때문에 프로비저닝 전체가 중단됩니다.
# DPkg::Lock::Timeout 으로 잠금이 풀릴 때까지 기다리고, 그래도 실패하면 재시도합니다.
apt_get() {
  local tries=0
  until apt-get -o DPkg::Lock::Timeout=600 "$@"; do
    tries=$((tries + 1))
    if [ "$tries" -ge 5 ]; then
      echo "apt-get $* : ${tries}회 재시도 후에도 실패"
      return 1
    fi
    echo "  apt-get $* 실패 - ${tries}회차 재시도 (20초 대기)"
    sleep 20
  done
}

# ---------------------------------------------------------------------------
log "1/9  시스템 패키지 갱신"

# 프로비저닝 중에는 자동 업데이트 타이머를 멈춰 잠금 경합을 없앱니다.
systemctl stop unattended-upgrades.service apt-daily.service apt-daily-upgrade.service 2>/dev/null || true
systemctl disable --now apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true

apt_get update -qq
# 업그레이드는 시간이 오래 걸리고 실패해도 배포에 지장이 없으므로 중단하지 않습니다.
apt_get upgrade -y -qq || echo "  일부 패키지 업그레이드 실패 - 계속 진행합니다"

# ---------------------------------------------------------------------------
log "2/9  스왑 2GB 구성 (빌드 중 메모리 부족 방지)"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "  스왑 생성 완료"
else
  echo "  스왑이 이미 있습니다 - 건너뜀"
fi
free -h | sed 's/^/  /'

# ---------------------------------------------------------------------------
log "3/9  Node.js 20 · PostgreSQL 16 · nginx 설치"
curl -fsSL --retry 5 --retry-delay 5 https://deb.nodesource.com/setup_20.x -o /tmp/nodesource.sh
bash /tmp/nodesource.sh >/dev/null
apt_get install -y -qq nodejs postgresql postgresql-contrib nginx git ufw
npm install -g pm2 >/dev/null
node -v | sed 's/^/  node /'
psql --version | sed 's/^/  /'

# ---------------------------------------------------------------------------
log "4/9  데이터베이스 및 계정 생성"
DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)"

sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  && sudo -u postgres psql -q -c "ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}'" \
  || sudo -u postgres psql -q -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}'"

sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
echo "  ${DB_NAME} 준비 완료"

# ---------------------------------------------------------------------------
log "5/9  코드 배포"
mkdir -p /var/www /var/log/dh-dashboard
chown -R "${RUN_USER}:${RUN_USER}" /var/www /var/log/dh-dashboard

if [ -d "${APP_DIR}/.git" ]; then
  sudo -u "${RUN_USER}" -H git -C "${APP_DIR}" pull --ff-only origin main
else
  sudo -u "${RUN_USER}" -H git clone --quiet "${REPO}" "${APP_DIR}"
fi

# ---------------------------------------------------------------------------
log "6/9  환경변수 생성"
if [ ! -f "${APP_DIR}/.env.local" ]; then
  AUTH_SECRET="$(openssl rand -base64 48)"
  cat > "${APP_DIR}/.env.local" <<EOF
DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
AUTH_SECRET=${AUTH_SECRET}
COOKIE_SECURE=false
EOF
  chown "${RUN_USER}:${RUN_USER}" "${APP_DIR}/.env.local"
  chmod 600 "${APP_DIR}/.env.local"
  echo "  .env.local 생성 완료 (AUTH_SECRET 자동 생성)"
  echo "  HTTPS 적용 후에는 COOKIE_SECURE=true 로 바꾸고 재빌드하세요."
else
  echo "  .env.local 이 이미 있습니다 - 보존"
fi

# ---------------------------------------------------------------------------
log "7/9  스키마 반영 및 빌드"
cd "${APP_DIR}"
set -a; . ./.env.local; set +a

sudo -u "${RUN_USER}" -H psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q -f db/schema.sql
echo "  스키마 반영 완료"

sudo -u "${RUN_USER}" -H npm ci --no-audit --no-fund
sudo -u "${RUN_USER}" -H env NEXT_TELEMETRY_DISABLED=1 npm run build
echo "  빌드 완료"

# ---------------------------------------------------------------------------
log "8/9  nginx 및 PM2 설정"
sed "s/server_name _;/server_name ${SERVER_NAME};/" deploy/nginx.conf > /etc/nginx/sites-available/dh-dashboard
ln -sf /etc/nginx/sites-available/dh-dashboard /etc/nginx/sites-enabled/dh-dashboard
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "  nginx 설정 완료"

sudo -u "${RUN_USER}" -H pm2 delete dh-dashboard >/dev/null 2>&1 || true
sudo -u "${RUN_USER}" -H pm2 start deploy/ecosystem.config.js
sudo -u "${RUN_USER}" -H pm2 save
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "${RUN_USER}" --hp "/home/${RUN_USER}" >/dev/null
systemctl enable "pm2-${RUN_USER}" >/dev/null 2>&1 || true
echo "  PM2 등록 완료 (재부팅 시 자동 기동)"

# ---------------------------------------------------------------------------
log "9/9  방화벽 및 동작 확인"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
echo "  ufw: SSH / HTTP / HTTPS 만 허용"

sleep 4
echo -n "  로컬 응답: "
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login || echo "실패"

cat <<EOF

============================================================
  프로비저닝 완료

  다음 단계
    1) 관리자 계정 생성
       cd ${APP_DIR} && node scripts/create-admin.mjs

    2) (선택) 초기 설비 등록
       psql "\$DATABASE_URL" -f db/seed.sql

    3) HTTPS 적용 (도메인 연결 후)
       sudo apt-get install -y certbot python3-certbot-nginx
       sudo certbot --nginx -d ${SERVER_NAME}
       # 발급 후 .env.local 의 COOKIE_SECURE=true 로 변경하고
       # npm run build && pm2 reload dh-dashboard

  접속 주소: http://${SERVER_NAME}
============================================================
EOF

echo "PROVISION_DONE $(date -Is)"
