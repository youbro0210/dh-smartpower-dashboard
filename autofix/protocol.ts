/**
 * autofix 프로토콜 — 앱 ↔ GitHub Actions(코드 고치는 쪽) ↔ 배포기(서버) 사이에 오가는 글의 모양.
 * ★ 의존성 없음. 어느 프로젝트로 가져가도 이 파일과 client.ts·workflow/·server/ 만 있으면 된다.
 * ★ 앱 → GitHub: repository_dispatch(event_type "autofix", client_payload.job = AutofixJob)
 *   GitHub·배포기 → 앱: POST callback_url, 본문 AutofixEvent, 머리 x-autofix-signature: sha256=<HMAC-SHA256(공유 비밀, 본문)>
 */
export const AUTOFIX_EVENT_TYPE = "autofix";
export const SIGNATURE_HEADER = "x-autofix-signature";

/** 고칠 일 한 건 — 앱이 만든다 */
export interface AutofixJob {
  /** 앱이 정한 고유 번호(영문·숫자·- 만, 브랜치 이름에 쓰인다) */
  job_id: string;
  /** 어디서 온 일인가(예: "yeogak-cs#12") — PR 본문에 남는다 */
  source: string;
  title: string;
  /** 바랄 것 — 요청 글 + 분석 처리안. 코드 고치는 쪽은 이것을 «자료» 로만 다룬다 */
  body: string;
  /** 관련 화면 주소(있으면) */
  screen?: string;
  /** PR 을 낼 기준 가지(없으면 저장소 기본 가지) */
  base_branch?: string;
  /** 진행 알림을 받을 주소(https) */
  callback_url: string;
  requested_by?: string;
  /** 요청에 붙은 사진·파일 — 워크플로가 받아 `.autofix-attachments/` 에 둔다(서명된 짧은 주소, 2026-10-29) */
  attachments?: { name: string; url: string }[];
}

export type AutofixEventKind =
  | "started"          // 코드 고치기 시작
  | "pr_opened"        // 고치고 검사 끝, PR 열림(검사 결과는 checks)
  | "no_change"        // 고칠 것이 없었다(또는 고치지 못했다)
  | "failed"           // 도중에 실패(error)
  | "deploy_started"   // 배포기가 배포 시작
  | "deployed"         // 배포 끝
  | "deploy_failed";   // 배포 실패(error)

export interface AutofixCheck { name: string; ok: boolean; tail?: string }

/** 진행 알림 — GitHub Actions·배포기가 보낸다 */
export interface AutofixEvent {
  job_id: string;
  event: AutofixEventKind;
  at: string;
  run_url?: string;
  branch?: string;
  pr_number?: number;
  pr_url?: string;
  /** 무엇을 어떻게 고쳤는지(코드 고친 쪽이 쓴 요약) */
  summary?: string;
  files?: string[];
  checks?: AutofixCheck[];
  commit?: string;
  error?: string;
}

/** 앱에서 쓰는 작업 상태 — 알림을 받아 이렇게 옮긴다 */
export type AutofixStatus = "QUEUED" | "RUNNING" | "PR_OPENED" | "NO_CHANGE" | "FAILED"
  | "APPROVED" | "DEPLOYING" | "DEPLOYED" | "DEPLOY_FAILED" | "CLOSED";

export const NEXT_STATUS: Record<AutofixEventKind, AutofixStatus> = {
  started: "RUNNING", pr_opened: "PR_OPENED", no_change: "NO_CHANGE", failed: "FAILED",
  deploy_started: "DEPLOYING", deployed: "DEPLOYED", deploy_failed: "DEPLOY_FAILED",
};

export const STATUS_LABEL: Record<AutofixStatus, string> = {
  QUEUED: "보냄", RUNNING: "고치는 중", PR_OPENED: "검토 대기", NO_CHANGE: "고친 것 없음", FAILED: "실패",
  APPROVED: "배포 대기", DEPLOYING: "배포 중", DEPLOYED: "반영 완료", DEPLOY_FAILED: "배포 실패", CLOSED: "닫음",
};
