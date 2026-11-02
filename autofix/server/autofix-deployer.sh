#!/usr/bin/env bash
# autofix 배포기 — 운영 서버에서 1분마다(systemd timer) 앱에 «배포 대기 작업» 을 묻고, 있으면 GitHub 에서 받아 빌드·재시작한다.
#  ★ GitHub Actions 가 서버에 SSH 로 들어오지 않는다(서버 SSH 는 닫아 둔다). 서버가 스스로 가져간다.
#  ★ 설정은 /etc/autofix-deployer.env (root 만 읽기) — 예시는 autofix-deployer.env.example
#  ★ 묻기·알리기 모두 HMAC 서명(AUTOFIX_SECRET). 한 번에 하나만(flock).
set -uo pipefail
CONF="${AUTOFIX_DEPLOYER_ENV:-/etc/autofix-deployer.env}"
# shellcheck disable=SC1090
. "$CONF"
exec 9>/run/autofix-deployer.lock; flock -n 9 || exit 0

sign() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$AUTOFIX_SECRET" -hex | sed 's/^.* //'; }
notify() { curl -fsS -m 20 -X POST -H 'content-type: application/json' -H "x-autofix-signature: sha256=$(sign "$1")" --data "$1" "$APP_URL/api/autofix/callback" >/dev/null || echo "알림 실패"; }
now() { date -u +%FT%TZ; }

ts=$(date +%s)
resp=$(curl -fsS -m 20 -H "x-autofix-ts: $ts" -H "x-autofix-signature: sha256=$(sign "queue:$ts")" "$APP_URL/api/autofix/queue") || exit 0
id=$(jq -r '.job.job_id // empty' <<<"$resp"); [ -z "$id" ] && exit 0
want=$(jq -r '.job.commit // empty' <<<"$resp")
notify "$(jq -nc --arg id "$id" --arg at "$(now)" '{job_id:$id,event:"deploy_started",at:$at}')"

log=$(mktemp); as() { sudo -u "$APP_USER" -H ${GIT_SSH_COMMAND:+env "GIT_SSH_COMMAND=$GIT_SSH_COMMAND"} "$@"; }
(
  set -e
  cd "$APP_DIR"
  as git -c credential.helper= fetch -q "$GIT_URL" "$BRANCH"
  as git merge -q --ff-only FETCH_HEAD
  if [ -n "$want" ]; then as git merge-base --is-ancestor "$want" HEAD; fi
  as bash -c "$BUILD_CMD"
  bash -c "$RESTART_CMD"
  sleep "${HEALTH_WAIT:-5}"
  curl -fsS -o /dev/null -m 20 "$HEALTH_URL"
) >"$log" 2>&1
rc=$?
head=$(cd "$APP_DIR" && as git rev-parse HEAD 2>/dev/null || echo "")
if [ $rc -eq 0 ]; then
  notify "$(jq -nc --arg id "$id" --arg c "$head" --arg at "$(now)" '{job_id:$id,event:"deployed",commit:$c,at:$at}')"
else
  notify "$(jq -nc --arg id "$id" --rawfile e <(tail -c 1500 "$log" | sed -E 's#https://[^@ ]+@#https://***@#g') --arg at "$(now)" '{job_id:$id,event:"deploy_failed",error:$e,at:$at}')"
fi
rm -f "$log"
