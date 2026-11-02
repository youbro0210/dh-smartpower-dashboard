# CS 요청 운영 설정

여각(logistics-web)의 CS 처리 절차를 DH 스마트파워에 적용한 기능의 설정 기록이다. 엔진 설명은 `cs-engine/README.md`, 자동 수정 설치 절차는 `autofix/README.md` 를 따른다.

## 처리 기준

| AI 판단 | 데이터 정정 | 프로그램 수정 |
|---|---|---|
| 위험 낮음 | 안전한 칸이면 즉시 반영, 아니면 관리자 반영 | 자동 수정 후 검사 통과·파일 5개 이하이면 합치고 배포 |
| 위험 보통·높음 | 관리자 승인·반영 | 관리자 승인 후 자동 수정, PR 합치기는 관리자 |
| 대상 불명확 | 요청자에게 보완 요청 | 요청자에게 보완 요청 |

- 안전한 칸은 `lib/cs/entities.ts` 의 `AUTO_FIELDS` 로 정한다. 점검 이력의 작업 내용·상세·작업자, 알림 수신자 메모이다.
- 정정 가능한 칸은 같은 파일의 `ENTITIES` 로 제한한다. 임계치·계측값·알람 이력·장비 명령·수집 설정·계정·알림 받는 곳은 제외한다.
- 자동 수정 금지 경로는 `.autofix.yml` 의 `forbidden` 으로 정한다. 판정·수집·장비 제어·권한·관리 메뉴·DB 구조가 포함된다.
- 자동 처리 3종은 반영 확인 화면에서 관리자가 끄고 켠다.

## 여각과 다른 점

| 항목 | 여각 | DH |
|---|---|---|
| 알림 | 계정별 텔레그램 | 계정 메일(설정 › 알림 발송의 메일 경로), 메뉴 건수 |
| 회사 구분 | company_id | 없음 |
| 감사 기록 | 별도 감사로그 | `cs_events`, 발송은 `notify_log` |
| AI 비용 기록 | 메뉴 있음 | 없음 |
| 접수 제한 | 없음 | 계정당 시간 10건(AI 호출 비용 제한) |

## 운영 적용 순서

1. `./deploy/deploy.sh` 로 코드와 스키마를 반영한다. 이 스크립트는 수집기(dh-collector)와 발송 워커(dh-notify)를 재시작한다.
2. 서버 `.env.local` 에 `ANTHROPIC_API_KEY`, `PUBLIC_BASE_URL=https://dhsp.co.kr` 를 넣고 `pm2 reload dh-dashboard --update-env` 를 실행한다. 여기까지 접수·분석·데이터 정정이 동작한다.
3. 프로그램 자동 수정은 다음을 추가로 설정한다.
   - GitHub Secrets: `CLAUDE_CODE_OAUTH_TOKEN`, `AUTOFIX_SECRET`
   - GitHub Actions 권한: Read and write, PR 생성 허용
   - 서버 `.env.local`: `AUTOFIX_REPO`, `AUTOFIX_GITHUB_TOKEN`, `AUTOFIX_SECRET`
   - 서버 배포기: `autofix/README.md` 의 운영 서버 절차. 설정 견본은 `autofix/server/autofix-deployer.env.example`. `jq` 설치와 읽기 전용 배포 키가 필요하다.
4. 메일 알림은 설정 › 알림 발송에서 메일 경로를 켠다. 꺼져 있으면 메뉴 건수와 반영 확인 화면으로만 확인한다.

스스로 가입한 계정은 회원관리에서 승인해야 로그인할 수 있다(`users.approval`). 기존 계정과 관리자가 직접 등록한 계정은 승인 상태이다.

자동 수정 환경변수가 없으면 프로그램 수정 요청은 자동 처리되지 않고 승인 대기로 남는다.
