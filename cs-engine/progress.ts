/**
 * CS 요청 진행률(cs-engine)(2026-10-28 «상태 옆에 예상 완료 시간·진행률, 진행 상태가 올라가야») — 상태·데이터 정정·자동 수정 작업으로 단계를 정한다.
 * ★ 기계가 하는 단계(AI 분석·자동 수정·배포)는 걸리는 시간을 알아서 from → to 로 시간에 따라 올라간다(화면이 1초마다 다시 셈, 끝까지는 안 감).
 *   사람이 하는 단계(승인·답·PR 검토)는 멈춰 있고 누구를 기다리는지 쓴다.
 * ★ 걸리는 시간은 10/28 실제 흐름 시험에서 잰 값: AI 분석 6~17초, 정정안 8~13초, 자동 수정 PR 2분 안팎, 배포 3분 안팎.
 */
export interface CsProgress { from: number; to: number; label: string; wait: string | null; startedAt: number | null; expectSec: number; done?: boolean; bad?: boolean }

export function progressOf(x: { status: string; at: number; failed?: boolean; fixesProposed?: number; kind?: string | null; job?: { status: string; at: number } | null }): CsProgress {
  const j = x.job;
  switch (x.status) {
    case "RECEIVED":
      if (x.failed) return { from: 10, to: 10, label: "AI 분석 실패", wait: "관리자 [다시 분석] 기다림", startedAt: null, expectSec: 0, bad: true }; return { from: 5, to: 25, label: "AI 분석 중", wait: null, startedAt: x.at, expectSec: 20 };
    case "NEEDS_INFO": return { from: 30, to: 30, label: "보완 요청", wait: "요청자 답 기다림", startedAt: null, expectSec: 0 };
    case "ANALYZED":
      if (x.fixesProposed) return { from: 45, to: 45, label: "정정안 · 반영 대기", wait: "관리자 반영 기다림", startedAt: null, expectSec: 0 };
      return { from: 30, to: 30, label: "승인 대기", wait: "관리자 확인 기다림", startedAt: null, expectSec: 0 };
    case "APPROVED":
      if (j && (j.status === "QUEUED" || j.status === "RUNNING")) return { from: 55, to: 80, label: "자동 수정 중", wait: null, startedAt: j.at, expectSec: 180 };
      if (j?.status === "PR_OPENED") return { from: 80, to: 80, label: "PR 검토 대기", wait: "관리자 [PR 합치고 배포] 기다림", startedAt: null, expectSec: 0 };
      if (j && (j.status === "APPROVED" || j.status === "DEPLOYING")) return { from: 85, to: 98, label: "배포 중", wait: null, startedAt: j.at, expectSec: 240 };
      if (j && (j.status === "FAILED" || j.status === "DEPLOY_FAILED" || j.status === "NO_CHANGE")) return { from: 50, to: 50, label: j.status === "NO_CHANGE" ? "자동 수정 — 고친 것 없음" : "자동 수정 실패", wait: "관리자 확인 기다림", startedAt: null, expectSec: 0, bad: true };
      if (x.fixesProposed) return { from: 60, to: 60, label: "정정안 · 반영 대기", wait: "관리자 반영 기다림", startedAt: null, expectSec: 0 };
      // 승인했는데 정정안도 자동 수정 작업도 없으면 개발자가 손으로 고칠 일 — «반영 중» 이라고 하면 50% 에 멈춘 것처럼 보였다(2026-10-29 CS #9)
      if (x.kind === "PROGRAM") return { from: 50, to: 50, label: "개발 수정 대기", wait: "개발자 수정 기다림", startedAt: null, expectSec: 0 };
      return { from: 50, to: 50, label: "반영 중", wait: "담당자 반영 기다림", startedAt: null, expectSec: 0 };
    case "DONE": return { from: 100, to: 100, label: "반영 완료", wait: null, startedAt: null, expectSec: 0, done: true };
    case "REJECTED": return { from: 100, to: 100, label: "반려", wait: null, startedAt: null, expectSec: 0, bad: true, done: true };
    default: return { from: 0, to: 0, label: x.status, wait: null, startedAt: null, expectSec: 0 };
  }
}

/** 지금 % — 기계 단계는 시간에 따라 from → to 의 95% 까지 */
export function pctNow(p: CsProgress, now: number): number {
  if (!p.startedAt || !p.expectSec || p.to === p.from) return p.from;
  const r = Math.min(0.95, Math.max(0, (now - p.startedAt) / 1000 / p.expectSec));
  return Math.round(p.from + (p.to - p.from) * r);
}

/** 남은 시간 글 — 기계 단계만. 넘었으면 «곧» */
export function etaText(p: CsProgress, now: number): string | null {
  if (!p.startedAt || !p.expectSec) return null;
  const left = Math.round(p.expectSec - (now - p.startedAt) / 1000);
  if (left <= 5) return "곧 끝남";
  return left < 60 ? `약 ${left}초 남음` : `약 ${Math.ceil(left / 60)}분 남음`;
}
