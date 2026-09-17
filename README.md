# DH 스마트파워 변압기 통합 모니터링

유입변압기의 수소가스·메탄가스·절연유 유면·온도를 실시간으로 감시하고, 임계치와 복합 판정
규칙에 따라 이상 등급을 산출하는 웹 대시보드입니다.

외부 서비스 의존 없이 **EC2 한 대에서 전부 동작**합니다. (Next.js + PostgreSQL)

## 구성

```
현장 센서 ──RS-485(Modbus RTU)──> 브릿지 보드
         ──MQTT over TLS(8883)──> EC2
                                   ├─ MQTT 브로커 + 수집 서버
                                   ├─ PostgreSQL
                                   └─ nginx → Next.js (이 저장소)
```

| 계층 | 기술 |
|---|---|
| 프런트/서버 | Next.js 14 (App Router), React 18, TypeScript |
| 데이터베이스 | PostgreSQL 16 (`pg` 드라이버, ORM 미사용) |
| 인증 | 자체 구현 — scrypt 해시 + 서버 세션 + HMAC 서명 쿠키 |
| 실시간 | PostgreSQL LISTEN/NOTIFY → Server-Sent Events |
| 배포 | PM2 + nginx (EC2) |

## 로컬 실행

```bash
# PostgreSQL 준비
createdb dhsmartpower

cp .env.example .env.local
# DATABASE_URL 을 채우고, AUTH_SECRET 은 아래 명령으로 생성해 넣습니다.
#   openssl rand -base64 48
# 로컬(HTTP)에서는 COOKIE_SECURE=false 여야 쿠키가 저장됩니다.

npm install
npm run db:schema          # 스키마 반영 (반복 실행 안전)
psql "$DATABASE_URL" -f db/seed.sql   # (선택) 설비 10대 등록
npm run create-admin       # 관리자 계정 생성
npm run dev
```

## 화면

| 경로 | 설명 | 권한 |
|---|---|---|
| `/` | 대시보드 — 설비 현황, 상태 필터, 상세 확장, 알람 이력 | 로그인 |
| `/settings` | 센서 임계치, 복합 판정 규칙, 설비 등록 | 관리자 |
| `/admin` | 회원 등급 관리, 로그인 이력 | 관리자 |
| `/login`, `/signup` | 로그인 / 회원가입 | 공개 |

최초 가입자는 자동으로 관리자가 되며, 이후 가입자는 모두 뷰어입니다.

## 판정 구조

`lib/thresholds.ts` 가 센서 하나의 값을 히스테리시스로 판정하고,
`lib/alarmEngine.ts` 가 그 결과를 모아 설비의 최종 등급을 냅니다.

1. 수소·메탄·온도는 임계치로, 유면은 정상/낮음 범주로 **각각 개별 등급**을 매깁니다.
2. 그중 가장 높은 등급을 기본 등급으로 삼습니다.
3. **복합 판정** — 동시에 이상인 센서 수가 기준(기본 2개) 이상이면 한 단계 격상합니다.
   온도와 수소가 각각 "주의" 수준이어도 동시에 발생하면 "경고"가 됩니다.
4. 마지막 수신 후 설정된 시간(기본 15분, 전송 주기 5분 × 3회)이 지나면 통신단절입니다.

**히스테리시스의 이전 상태는 반드시 센서별로 보관해야 합니다.** 설비의 종합 등급을
각 센서에 복사해 넣으면 한 센서의 이상이 다른 센서의 판정을 오염시킵니다.
`evaluateDevice()` 가 돌려주는 `sensorLevels` 를 그대로 다음 호출에 넘기세요.

## 데이터 흐름

수집 서버(MQTT)는 다음 두 테이블에만 씁니다.

| 테이블 | 용도 |
|---|---|
| `telemetry` | 원본 계측 이력. `(device_id, measured_at)` 유일 제약이 QoS 1 중복 수신을 걸러냅니다. |
| `device_readings` | 설비별 최신값. `upsert` 하면 트리거가 `NOTIFY` 를 발생시킵니다. |

`NOTIFY` → `/api/stream`(SSE) → 브라우저 순으로 전달되며, 판정은 클라이언트에서
수행되므로 설정 화면에서 임계치를 바꾸면 즉시 반영됩니다.

설정을 저장하면 `app_config.version` 이 올라갑니다. 수집 서버가 이 값을 감지해
각 브릿지로 MQTT `set_config` 명령을 내려보내는 구조입니다.

## EC2 배포

```bash
# Ubuntu 24.04 인스턴스에서 (t3.small 이상 권장)
curl -fsSL https://raw.githubusercontent.com/youbro0210/dh-smartpower-dashboard/main/deploy/provision.sh -o provision.sh
sudo bash provision.sh monitor.회사도메인.com
```

스왑 구성, Node 20 · PostgreSQL 16 · nginx · PM2 설치, DB 생성, 스키마 반영,
빌드, 기동, 방화벽 설정까지 한 번에 수행합니다.

이후 재배포는 `./deploy/deploy.sh` 입니다.

### HTTPS

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d monitor.회사도메인.com
```

발급 후 `.env.local` 의 `COOKIE_SECURE=true` 로 바꾸고 `npm run build && pm2 reload dh-dashboard`.

### 주의사항

- **SSE 는 nginx 버퍼링이 꺼져 있어야 동작합니다.** `deploy/nginx.conf` 의
  `/api/stream` 블록에 `proxy_buffering off` 가 있습니다.
- 빌드가 순간적으로 1GB 이상 쓰므로 1GB 인스턴스에서는 스왑이 필수입니다.
- `AUTH_SECRET` 을 바꾸면 기존 로그인 세션이 전부 무효화됩니다.

## 보안

- 비밀번호는 scrypt(N=16384)로 해시하며 평문은 저장하지 않습니다.
- 세션은 서버 테이블에 보관하므로 즉시 폐기할 수 있습니다. 등급 변경 시 해당 사용자의
  세션은 자동으로 끊깁니다.
- 미들웨어는 쿠키 서명만 검증하고, **실제 권한 판정은 각 서버 컴포넌트와 API 라우트가
  DB를 조회해 직접 수행합니다.** 미들웨어 우회 취약점이 있더라도 권한이 뚫리지 않습니다.
- 로그인 실패는 계정당 10분 내 10회로 제한되며, 존재하지 않는 계정도 동일한 시간을
  소비해 가입 여부가 드러나지 않습니다.
