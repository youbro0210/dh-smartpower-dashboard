/**
 * 정정할 수 있는 칸 정의와 값 검사 — 프로젝트는 «무엇의 어느 칸을 고칠 수 있나» 만 적는다(EntitySpec). 그 밖의 칸은 정정안이 와도 막힌다.
 */
export type FieldKind = "date" | "num" | "text" | "formula";
export interface FieldSpec { label: string; kind: FieldKind; nullable?: boolean }
export interface EntitySpec { label: string; table: string; fields: Record<string, FieldSpec>; describe: string; extraWhere?: string }

export type UpdateOp = { type: "update"; entity: string; id: number | string; set: Record<string, unknown>; reason?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 값 하나 검사·정리 */
export function normalize(kind: FieldKind, v: unknown, nullable?: boolean): { ok: true; v: string | number | null } | { ok: false; err: string } {
  if (v === null || v === "") return nullable ? { ok: true, v: null } : { ok: false, err: "비울 수 없는 칸" };
  if (kind === "date") return typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? { ok: true, v } : { ok: false, err: `날짜 형식(YYYY-MM-DD) 아님: ${String(v)}` };
  if (kind === "num") { const n = Number(v); return Number.isFinite(n) && n >= 0 ? { ok: true, v: Math.round(n * 1000) / 1000 } : { ok: false, err: `0 이상 숫자 아님: ${String(v)}` }; }
  if (kind === "formula") return v === "divide" || v === "roundup" ? { ok: true, v } : { ok: false, err: "수식은 divide·roundup" };
  return { ok: true, v: String(v).trim().slice(0, 1000) };
}
export const showValue = (v: unknown) => (v === null || v === undefined || v === "" ? "(빈칸)" : String(v));

/** update 정정안의 칸·값 검사(대상 줄을 읽는 일은 프로젝트가) */
export function checkUpdateFields(entities: Record<string, EntitySpec>, op: UpdateOp):
  { ok: true; entity: EntitySpec; after: Record<string, unknown> } | { ok: false; err: string } {
  const e = entities[op.entity];
  if (!e) return { ok: false, err: `모르는 정정 대상: ${String(op.entity)}` };
  const keys = Object.keys(op.set ?? {});
  if (!keys.length) return { ok: false, err: "바꿀 칸이 없습니다." };
  const after: Record<string, unknown> = {};
  for (const k of keys) {
    const f = e.fields[k];
    if (!f) return { ok: false, err: `${e.label}에서 고칠 수 없는 칸: ${k}` };
    const n = normalize(f.kind, op.set[k], f.nullable);
    if (!n.ok) return { ok: false, err: `${f.label} — ${n.err}` };
    after[k] = n.v;
  }
  return { ok: true, entity: e, after };
}

/** AI 에게 줄 «고칠 수 있는 칸» 글 */
export const entitiesText = (entities: Record<string, EntitySpec>) =>
  Object.entries(entities).map(([k, e]) => `${k}(${e.label}): ${Object.keys(e.fields).join(", ")}`).join(" / ");
