/**
 * cs-engine 공통 모양 — 상태·종류·위험·처리·진행 기록 이름. 프로젝트를 모른다(의존성 없음).
 * 흐름: RECEIVED(접수) → ANALYZED(AI 분석) ⇄ NEEDS_INFO(보완 요청) → APPROVED(승인·반영 중) → DONE(반영 완료) / REJECTED(반려)
 */
export type CsStatus = "RECEIVED" | "ANALYZED" | "NEEDS_INFO" | "APPROVED" | "DONE" | "REJECTED";
export type CsKind = "DATA" | "PROGRAM" | "QUESTION" | "OTHER";
export type CsRisk = "LOW" | "MEDIUM" | "HIGH";

export const OPEN_STATUSES: CsStatus[] = ["RECEIVED", "ANALYZED", "NEEDS_INFO", "APPROVED"];
export const STATUS_LABEL: Record<CsStatus, string> = {
  RECEIVED: "접수", ANALYZED: "승인 대기", NEEDS_INFO: "보완 요청", APPROVED: "반영 중", DONE: "반영 완료", REJECTED: "반려" };
export const KIND_LABEL: Record<CsKind, string> = { DATA: "데이터 정정", PROGRAM: "프로그램 수정", QUESTION: "사용 문의", OTHER: "기타" };
export const RISK_LABEL: Record<CsRisk, string> = { LOW: "낮음", MEDIUM: "보통", HIGH: "높음" };

/** 관리자 처리 — 어느 상태에서 어디로 */
export const TRANSITIONS: Record<"approve" | "reject" | "needs_info" | "done", { from: CsStatus[]; to: CsStatus; label: string; needNote?: boolean }> = {
  approve:    { from: ["RECEIVED", "ANALYZED", "NEEDS_INFO"], to: "APPROVED", label: "승인" },
  reject:     { from: ["RECEIVED", "ANALYZED", "NEEDS_INFO", "APPROVED"], to: "REJECTED", label: "반려", needNote: true },
  needs_info: { from: ["RECEIVED", "ANALYZED", "APPROVED"], to: "NEEDS_INFO", label: "보완 요청", needNote: true },
  done:       { from: ["ANALYZED", "APPROVED"], to: "DONE", label: "반영 완료" },
};

/** 진행 기록(event) 이름 → 화면 글 */
export const EVENT_LABEL: Record<string, string> = {
  RECEIVED: "접수", ANALYZED: "AI 분석", ANALYZE_FAIL: "AI 분석 실패", APPROVED: "승인", REJECTED: "반려", NEEDS_INFO: "보완 요청", DONE: "반영 완료",
  COMMENT: "댓글", FIX_PROPOSED: "정정안", FIX_UNDONE: "정정 되돌림",
  AUTOFIX_SENT: "자동 수정 보냄", AUTOFIX_STARTED: "자동 수정 시작", AUTOFIX_PR: "자동 수정 PR", AUTOFIX_NOCHANGE: "자동 수정 — 고친 것 없음",
  AUTOFIX_FAIL: "자동 수정 실패", AUTOFIX_MERGED: "PR 합침", AUTOFIX_DEPLOYING: "배포 시작", AUTOFIX_DEPLOYED: "배포 완료",
  AUTOFIX_DEPLOY_FAIL: "배포 실패", AUTOFIX_CLOSED: "자동 수정 닫음",
  AUTO_APPLIED: "자동 반영(위험 낮음)", AUTO_AUTOFIX: "자동 수정 바로 보냄(위험 낮음)", AUTO_SKIP: "자동 반영 안 함", AUTO_MERGE: "자동 합치고 배포(위험 낮음)",
  NOTIFIED: "요청자 알림", NOTIFY_NONE: "요청자 메일 미발송",
  TO_PROGRAM: "프로그램 수정으로 바꿈", DEV_WAIT: "개발자 직접 수정",
};
