import "server-only";
import { decideAuto, DEFAULT_AUTO, isSafeOp } from "@/cs-engine/policy";
import { execute, one, query } from "@/lib/db";
import { autofixEnabled, startAutofix } from "./autofix";
import { addEvent, notifyCs, type CsAnalysis } from "./engine";
import { AUTO_FIELDS } from "./entities";
import { applyFixes, type FixOp } from "./fixes";
import { proposeFixes } from "./propose";

/**
 * 위험 낮음 자동 처리입니다. 여각과 같은 흐름입니다.
 *  데이터 정정: 위험 낮음이고 정정안이 모두 안전한 칸이면 바로 반영합니다(되돌리기 가능).
 *  프로그램 수정: 위험 낮음이면 자동 수정을 바로 보내고, 검사를 통과하면 합치고 배포까지 합니다.
 *  보통·높음은 관리자가 반영 확인에서 처리합니다.
 */
export async function csSettings() {
  const r = await one<{ auto_data_low: boolean; auto_program_low: boolean; auto_deploy_low: boolean }>(
    `SELECT auto_data_low, auto_program_low, auto_deploy_low FROM cs_settings WHERE id = 1`
  );
  return {
    autoDataLow: r?.auto_data_low ?? DEFAULT_AUTO.autoDataLow,
    autoProgramLow: r?.auto_program_low ?? DEFAULT_AUTO.autoProgramLow,
    autoDeployLow: r?.auto_deploy_low ?? DEFAULT_AUTO.autoDeployLow,
  };
}

/** 자동 진행이 막히면 관리자를 기다리지 않고 요청자에게 바로 묻습니다. 답하면 다시 분석합니다. */
export async function askRequester(id: number, title: string, note: string) {
  await execute(
    `UPDATE cs_requests SET status = 'NEEDS_INFO', updated_at = now() WHERE id = $1 AND status IN ('ANALYZED', 'APPROVED')`,
    [id]
  );
  await addEvent(id, null, "NEEDS_INFO", note);
  await notifyCs(id, "requester", `[DH CS] #${id} 보완 요청 · ${title}\n${note}\n반영 확인에서 [답하기] 로 알려 주시면 이어서 진행합니다.`);
}

/** 분석 뒤에 부릅니다. 처리했으면 무엇을 했는지 돌려줍니다. */
export async function autoHandle(id: number): Promise<"applied" | "autofix" | "asked" | null> {
  const r = await one<{ status: string; analysis: CsAnalysis | null; created_by: string | null; title: string }>(
    `SELECT status, analysis, created_by, COALESCE(analysis->>'title', title) AS title FROM cs_requests WHERE id = $1`,
    [id]
  );
  const a = r?.analysis;
  if (!r || !a || r.status !== "ANALYZED") return null;
  const settings = await csSettings();
  const go = decideAuto(a, settings);

  if (go === "data") {
    const p = await proposeFixes(id);
    if (!p.ok) {
      await addEvent(id, null, "AUTO_SKIP", p.error ?? null);
      return null;
    }
    if (!p.count) {
      const ask =
        [p.note, ...a.questions.map((x) => `- ${x}`)].filter(Boolean).join("\n") ||
        "대상을 정할 수 없습니다. 무엇을 어떻게 고칠지 조금 더 적어 주세요.";
      await askRequester(id, r.title, ask);
      return "asked";
    }
    const fixes = await query<{ id: number; op: FixOp; label: string }>(
      `SELECT id, op, label FROM cs_fixes WHERE request_id = $1 AND status = 'PROPOSED' ORDER BY id`,
      [id]
    );
    if (!fixes.every((f) => isSafeOp(f.op, AUTO_FIELDS))) {
      await addEvent(id, null, "AUTO_SKIP", "안전한 칸이 아닌 정정이 있어 관리자 반영");
      return null;
    }
    const applied = await applyFixes(id, fixes.map((f) => f.id), r.created_by);
    if ("err" in applied) {
      await addEvent(id, null, "AUTO_SKIP", applied.err);
      return null;
    }
    const note = `자동 반영(위험 낮음) ${fixes.length}건\n${fixes.map((f) => `· ${f.label}`).join("\n")}`;
    await execute(`UPDATE cs_requests SET status = 'DONE', decided_at = now(), done_note = $2, updated_at = now() WHERE id = $1`, [
      id,
      note,
    ]);
    await addEvent(id, null, "AUTO_APPLIED", note);
    await notifyCs(id, "requester", `[DH CS] #${id} 반영 완료 · ${r.title}\n${note}`);
    await notifyCs(id, "admins", `[DH CS] #${id} 자동 반영(위험 낮음) · ${r.title}\n${note}\n되돌리려면 반영 확인 › 데이터 정정 [되돌리기]`);
    return "applied";
  }

  if (go === "program" && autofixEnabled()) {
    const s = await startAutofix(id, r.created_by, { auto: true });
    if (s.err) {
      await addEvent(id, null, "AUTO_SKIP", s.err);
      return null;
    }
    await addEvent(
      id,
      null,
      "AUTO_AUTOFIX",
      settings.autoDeployLow
        ? "위험 낮음 — 자동 수정을 바로 보냄(검사 통과하면 합치고 배포까지)"
        : "위험 낮음 — 자동 수정을 바로 보냄(PR 합치기·배포는 관리자)"
    );
    return "autofix";
  }
  return null;
}

/**
 * 승인 뒤에 멈춰 두지 않습니다.
 *  데이터 정정인데 정정안이 없으면 프로그램 수정으로 바꾸고, 프로그램 수정은 자동 수정을 바로 보냅니다.
 *  보낼 수 없으면 개발 수정 대기로 두고 관리자에게 알립니다.
 */
export async function afterApprove(id: number, userId: string): Promise<"autofix" | "dev" | null> {
  const r = await one<{ kind: string | null; title: string; fx: number }>(
    `SELECT kind, title,
            (SELECT count(*)::int FROM cs_fixes f WHERE f.request_id = c.id AND f.status IN ('PROPOSED', 'APPLIED')) AS fx
       FROM cs_requests c WHERE id = $1 AND status = 'APPROVED'`,
    [id]
  );
  if (!r?.kind || (r.kind === "DATA" && r.fx > 0)) return null;
  if (r.kind !== "DATA" && r.kind !== "PROGRAM") return null;
  if (r.kind === "DATA") {
    await execute(`UPDATE cs_requests SET kind = 'PROGRAM', updated_at = now() WHERE id = $1`, [id]);
    await addEvent(id, null, "TO_PROGRAM", "정정안이 없어 데이터로는 고칠 수 없음 — 프로그램 수정으로");
  }
  const s = await startAutofix(id, userId);
  if (!s.err) return "autofix";
  await addEvent(id, null, "DEV_WAIT", s.err);
  await notifyCs(id, "admins", `[DH CS] #${id} 개발자 직접 수정 필요 · ${r.title}\n${s.err}`);
  return "dev";
}
