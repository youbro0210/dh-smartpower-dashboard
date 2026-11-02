# autofix — 프로그램 자동 수정 엔진

앱이 «고칠 일» 을 보내면 GitHub Actions 에서 Claude Code 가 코드를 고치고, 검사하고, PR 을 연다.
사람이 앱에서 PR 을 합치면 운영 서버의 배포기가 1분 안에 받아 배포한다. 진행은 서명된 알림으로 앱에 돌아온다.

여각과 묶이지 않았다. 이 폴더를 그대로 다른 저장소로 가져가 어댑터만 새로 쓰면 된다.

```
앱(어댑터)                     GitHub                                  운영 서버
───────────                    ──────                                  ─────────
[자동 수정 보내기] ──dispatch──▶ workflow/autofix.yml
                                 ├ .autofix.yml 읽기
                                 ├ Claude Code 로 고치기(읽기·고치기·허락된 명령만)
                                 ├ 금지 경로 검사 · verify 명령
                                 └ 가지 autofix/<job_id> · PR
       ◀──── 알림(started·pr_opened·no_change·failed) ────┘
[PR 합치고 배포] ──merge(squash)─▶ main
                                                        ◀── 1분마다 «배포 대기?» ── server/autofix-deployer.sh
                                                             fetch · ff-merge · 빌드 · 재시작 · 응답 확인
       ◀──── 알림(deploy_started·deployed·deploy_failed) ───────────┘
```

## 파일

| 파일 | 하는 일 | 프로젝트마다 바꾸나 |
|---|---|---|
| `protocol.ts` | 일(AutofixJob)·알림(AutofixEvent)·상태 모양. 의존성 없음 | 아니오 |
| `client.ts` | 보내기(repository_dispatch)·서명 확인(HMAC-SHA256)·PR 보기·합치기·닫기. GitHub REST 만, 의존성 없음 | 아니오 |
| `workflow/autofix.yml` | GitHub Actions. 저장소 `.github/workflows/autofix.yml` 로 복사 | 아니오 |
| `autofix.config.example.yml` | 저장소 맨 위 `.autofix.yml` 견본(검사 명령·금지 경로·규칙·허락 명령) | **예** |
| `server/autofix-deployer.sh` | 운영 서버 배포기. `/usr/local/bin/` 로 복사 | 아니오 |
| `server/autofix-deployer.{service,timer}` | systemd 1분 타이머 | 아니오 |
| `server/autofix-deployer.env.example` | 배포기 설정(`/etc/autofix-deployer.env`, 빌드·재시작 명령) | **예** |

앱 쪽 어댑터가 할 일(여각 예: `lib/cs/autofix.ts`, `app/api/autofix/*`):

1. 작업 표: `job_id`·상태·PR·검사 결과를 담는다(여각 `logi_autofix_jobs`).
2. 보내기: `createAutofixClient(...).dispatch(job)`. `callback_url` 은 `https://<앱>/api/autofix/callback`.
3. 알림 받기(POST): 원문으로 `verify(raw, header["x-autofix-signature"])` 를 확인한 뒤 `parse`. `NEXT_STATUS` 로 옮기되, 늦게 온 알림이 상태를 뒤로 돌리지 않게 한다.
4. 합치기: 검사가 모두 통과한 PR 만 `mergePr` 하고 «배포 대기» 로 둔다.
5. 배포 대기 묻기(GET): 머리 `x-autofix-ts: <초>` 와 `x-autofix-signature: sha256=HMAC("queue:<초>")` 를 확인한다(5분 안). 답은 `{ job: { job_id, commit } | null }`.

## 설치

**GitHub(저장소 › Settings)**

- Secrets › Actions:
  - `CLAUDE_CODE_OAUTH_TOKEN`: 이 기계에서 `claude setup-token` 으로 만든 구독 토큰. API 로 쓰려면 대신 `ANTHROPIC_API_KEY`.
  - `AUTOFIX_SECRET`: 아무 긴 난수, 예: `openssl rand -hex 32`. 앱·배포기와 같은 값.
- Actions › General › Workflow permissions: «Read and write» 와 «Allow GitHub Actions to create and approve pull requests» 를 켠다.

**앱 환경변수**

- `AUTOFIX_REPO=owner/name`
- `AUTOFIX_GITHUB_TOKEN`: fine-grained PAT, 그 저장소만, Contents·Pull requests 쓰기.
- `AUTOFIX_SECRET`
- `PUBLIC_BASE_URL=https://…`

**운영 서버**

```bash
sudo install -m 755 autofix/server/autofix-deployer.sh /usr/local/bin/
sudo install -m 600 autofix/server/autofix-deployer.env.example /etc/autofix-deployer.env   # 열어서 채운다
sudo install -m 644 autofix/server/autofix-deployer.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now autofix-deployer.timer
```

배포기는 읽기 전용 배포 키(서버에서 만든 ssh 키, 저장소 › Deploy keys)로 받는다 — 키가 서버 밖으로 나가지 않는다. 토큰을 쓰려면 Contents read PAT. 서버 SSH 는 열지 않는다.

## 속도

- `.autofix.yml` 에서 다음을 정합니다.
  - `model`: 빠른 모델
  - `max_turns`
  - `cache.deps`: node_modules 등. 잠금파일이 같으면 설치를 건너뜁니다. Claude 가 고치기 전에 저장해서, 고친 코드가 캐시를 더럽히지 못합니다.
  - `cache.build`: 빌드 캐시. 실행마다 이어서 씁니다.
- 검사는 빌드 하나로 합니다. Next 빌드가 타입검사도 합니다.
- 배포기는 10초마다 묻습니다. 배포 스크립트가 받으면 `DEPLOY_SKIP_TYPECHECK=1` 로 서버 타입검사를 건너뜁니다(GitHub 에서 이미 통과).
- 여각 실측(위험 낮음 한 건, 접수에서 배포 완료까지): 개선 전 4분 21초.

## 스킬

- 저장소 `.claude/skills/` 에 둔 스킬을 Claude 가 불러 씁니다(`skills: true`, 기본값).
- 여각은 화면 디자인 스킬 `erp-ui-design` 을 둡니다.
- `.claude/*` 는 forbidden 에 넣어 자동 수정이 스킬을 고치지 못하게 합니다.

## 안전장치

- 요청 글은 자료로만 다룬다. 프롬프트에 그렇게 적고, Claude 에게는 Read·Glob·Grep·Edit·Write 와 `.autofix.yml` 의 `allowed_bash` 만 허락한다.
- 커밋·푸시·PR 은 Claude 가 아니라 워크플로가 한다.
  - 금지 경로를 바꾸면 PR 을 열지 않고 실패로 알린다.
  - `.autofix.yml` 은 고치기 전에 읽은 것을 쓴다.
- 비밀은 쓰는 단계에만 넘긴다. 검사 단계는 고친 코드를 실행하므로 비밀을 보지 못한다.
  - 체크아웃은 자격 증명을 남기지 않는다(`persist-credentials: false`).
  - 커밋은 git hook 을 끄고 한다.
- 합치기는 사람이 한다. 검사에 실패한 PR 은 어댑터가 합치지 않는다.
- 배포기는 받기만 한다: fast-forward 만 하고, 합친 커밋이 들어왔는지 확인하고, 한 번에 하나(flock)만 돌린다. 배포 뒤 응답을 확인한다.
- 모든 알림과 묻기에 HMAC 서명을 쓴다. 서명이 없거나 틀리면 401.

## 비용

- GitHub Actions: 비공개 저장소는 무료 분수(월 2,000분) 안에서 돈다. 한 건에 보통 5~15분.
- Claude: `CLAUDE_CODE_OAUTH_TOKEN` 이면 구독 사용량으로 돈다. API 키면 토큰만큼 과금된다.
