import type { CsAnalysis } from "./analyze";
import type { UpdateOp } from "./fields";

/**
 * 위험 낮음 자동 처리 기준 — 프로젝트는 «안전한 칸» 목록과 설정만 준다.
 *  데이터: 위험 LOW · 정정안이 모두 안전한 칸의 update(정정안이 안 나오면 요청자에게 보완 요청)
 *  프로그램: 위험 LOW 면 자동 수정을 바로 보내고(고친 것 없음·실패면 요청자에게 보완 요청), 그 PR 이 검사 모두 통과·파일 maxFiles 이하면 합치고 배포
 */
export type SafeFields = Record<string, string[]>;
export interface AutoSettings { autoDataLow: boolean; autoProgramLow: boolean; autoDeployLow: boolean }
export const DEFAULT_AUTO: AutoSettings = { autoDataLow: true, autoProgramLow: true, autoDeployLow: true };

export const lowAndClear = (a: CsAnalysis | null | undefined) => !!a && a.risk === "LOW" && a.automatable && !a.questions.length;
/** 위험 낮음이면 되물을 것이 있어도 바로 진행(2026-10-29 «낮음은 반영 확인 안 누르고 바로 — 됐다 안됐다 그래»). 모호하면 진행 쪽(정정안·자동 수정)이 되묻는다 */
export const isLow = (a: CsAnalysis | null | undefined) => !!a && a.risk === "LOW";

export function isSafeOp(op: { type: string }, safe: SafeFields): boolean {
  if (op.type !== "update") return false;
  const u = op as UpdateOp;
  return !!safe[u.entity] && Object.keys(u.set ?? {}).every((k) => safe[u.entity].includes(k));
}

export function decideAuto(a: CsAnalysis | null | undefined, s: AutoSettings): "data" | "program" | null {
  if (!isLow(a)) return null;
  if (a!.kind === "DATA" && s.autoDataLow) return "data";
  if (a!.kind === "PROGRAM" && s.autoProgramLow) return "program";
  return null;
}

export function canAutoMerge(x: { auto: boolean; setting: boolean; checks?: { ok: boolean }[] | null; files?: string[] | null; maxFiles?: number }) {
  const files = x.files ?? [];
  return x.auto && x.setting && !!x.checks?.length && x.checks.every((c) => c.ok) && files.length > 0 && files.length <= (x.maxFiles ?? 5);
}
