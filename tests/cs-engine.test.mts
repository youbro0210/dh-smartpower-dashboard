import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAuto, isSafeOp, canAutoMerge, DEFAULT_AUTO } from "../cs-engine/policy.ts";
import { normalize, checkUpdateFields, type EntitySpec } from "../cs-engine/fields.ts";
import { progressOf, pctNow, etaText } from "../cs-engine/progress.ts";
import { analyzeSystem, analyzeText } from "../cs-engine/analyze.ts";
import { TRANSITIONS, EVENT_LABEL } from "../cs-engine/types.ts";

/** cs-engine — 프로젝트를 모르는 부분(정책·칸 검사·진행률·프롬프트). DB·AI 없이 */
const A = (o: Record<string, unknown>) => ({ kind: "DATA", title: "", summary: "", screen: "", target: "", plan: [], risk: "LOW", risk_reason: "",
  questions: [], automatable: true, answer: "", ...o }) as Parameters<typeof decideAuto>[0];

test("decideAuto — 위험 낮음이면 되물을 것이 있어도 진행(2026-10-29), 보통·높음·문의는 아님", () => {
  assert.equal(decideAuto(A({}), DEFAULT_AUTO), "data");
  assert.equal(decideAuto(A({ kind: "PROGRAM" }), DEFAULT_AUTO), "program");
  assert.equal(decideAuto(A({ risk: "MEDIUM" }), DEFAULT_AUTO), null);
  assert.equal(decideAuto(A({ questions: ["?"] }), DEFAULT_AUTO), "data");
  assert.equal(decideAuto(A({ kind: "PROGRAM", automatable: false, questions: ["?"] }), DEFAULT_AUTO), "program");
  assert.equal(decideAuto(A({ risk: "HIGH" }), DEFAULT_AUTO), null);
  assert.equal(decideAuto(A({ kind: "QUESTION" }), DEFAULT_AUTO), null);
  assert.equal(decideAuto(A({}), { ...DEFAULT_AUTO, autoDataLow: false }), null);
});
test("isSafeOp — 안전한 칸의 update 만", () => {
  const safe = { storage: ["phone", "fax"] };
  assert.equal(isSafeOp({ type: "update", entity: "storage", id: 1, set: { phone: "1" } } as never, safe), true);
  assert.equal(isSafeOp({ type: "update", entity: "storage", id: 1, set: { phone: "1", account_no: "2" } } as never, safe), false);
  assert.equal(isSafeOp({ type: "update", entity: "lot", id: 1, set: { remark: "x" } } as never, safe), false);
  assert.equal(isSafeOp({ type: "cancel_request", id: 1 } as never, safe), false);
});
test("canAutoMerge — 자동으로 보낸 것·검사 통과·파일 5개 이하·설정 켬", () => {
  const ok = [{ ok: true }, { ok: true }];
  assert.equal(canAutoMerge({ auto: true, setting: true, checks: ok, files: ["a"] }), true);
  assert.equal(canAutoMerge({ auto: false, setting: true, checks: ok, files: ["a"] }), false);
  assert.equal(canAutoMerge({ auto: true, setting: false, checks: ok, files: ["a"] }), false);
  assert.equal(canAutoMerge({ auto: true, setting: true, checks: [{ ok: true }, { ok: false }], files: ["a"] }), false);
  assert.equal(canAutoMerge({ auto: true, setting: true, checks: [], files: ["a"] }), false);
  assert.equal(canAutoMerge({ auto: true, setting: true, checks: ok, files: ["1", "2", "3", "4", "5", "6"] }), false);
  assert.equal(canAutoMerge({ auto: true, setting: true, checks: ok, files: [] }), false);
});
test("fields — 정해진 칸·형식만", () => {
  const E: Record<string, EntitySpec> = { s: { label: "창고", table: "t", describe: "", fields: { phone: { label: "TEL", kind: "text", nullable: true }, d: { label: "날", kind: "date" } } } };
  assert.equal(checkUpdateFields(E, { type: "update", entity: "s", id: 1, set: { name: "x" } }).ok, false);
  assert.equal(checkUpdateFields(E, { type: "update", entity: "s", id: 1, set: { d: "10/28" } }).ok, false);
  assert.equal(checkUpdateFields(E, { type: "update", entity: "x", id: 1, set: { phone: "1" } }).ok, false);
  assert.equal(checkUpdateFields(E, { type: "update", entity: "s", id: 1, set: { phone: null } }).ok, true);
  assert.deepEqual(normalize("num", "1.23456"), { ok: true, v: 1.235 });
  assert.equal(normalize("num", -1).ok, false);
});
test("progress — 기계 단계는 시간에 따라 오르고 끝까지는 안 감, 사람 단계는 멈춤", () => {
  const t = 1_000_000;
  const p = progressOf({ status: "APPROVED", at: t, job: { status: "RUNNING", at: t } });
  assert.equal(pctNow(p, t), 55);
  assert.ok(pctNow(p, t + 90_000) > 60 && pctNow(p, t + 90_000) < 80);
  assert.ok(pctNow(p, t + 10_000_000) < 80);
  assert.match(etaText(p, t + 60_000) ?? "", /분 남음/);
  const w = progressOf({ status: "APPROVED", at: t, job: { status: "PR_OPENED", at: t } });
  assert.equal(pctNow(w, t + 999_999), 80); assert.match(w.wait ?? "", /PR 합치고 배포/);
  assert.equal(progressOf({ status: "DONE", at: t }).from, 100);
  assert.equal(progressOf({ status: "RECEIVED", at: t, failed: true }).label, "AI 분석 실패");
});
test("analyze 프롬프트 — 주입 막는 규칙·프로젝트 규칙·화면·자주 하는 일", () => {
  const ctx = { appName: "시험", screens: [["/a", "가"]] as [string, string][], howto: "- 할 일", rules: ["업무 용어 그대로"] };
  const sys = analyzeSystem(ctx), txt = analyzeText(ctx, { title: "t", body: "b", kindHint: "DATA" }, (k) => `«${k}»`);
  assert.match(sys, /분석할 자료/); assert.match(sys, /업무 용어 그대로/); assert.match(sys, /지어내지 않는다/);
  assert.match(txt, /\/a · 가/); assert.match(txt, /- 할 일/); assert.match(txt, /«DATA»/);
});
test("types — 처리 전이·진행 기록 이름", () => {
  assert.deepEqual(TRANSITIONS.done.from, ["ANALYZED", "APPROVED"]);
  assert.equal(EVENT_LABEL.AUTO_MERGE, "자동 합치고 배포(위험 낮음)");
});
