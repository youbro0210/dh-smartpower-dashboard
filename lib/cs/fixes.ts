import "server-only";
import { normalize, showValue } from "@/cs-engine/fields";
import { query, transaction } from "@/lib/db";
import { ENTITIES, type CsEntity } from "./entities";

/**
 * 데이터 정정입니다. AI 는 lib/cs/entities.ts 의 칸 안에서 정정안만 내고, 실행은 이 파일이 합니다.
 * 반영 전 값을 남기고, 정정안을 만든 뒤 값이 바뀌었으면 반영을 막습니다.
 * 되돌리기는 지금 값이 반영한 값 그대로일 때만 합니다.
 */
export type FixOp = {
  type: "update";
  entity: string;
  id: string | number;
  set: Record<string, string | number | null>;
  reason?: string;
};

type Run = (text: string, params?: unknown[]) => Promise<unknown[]>;
const runQuery: Run = (text, params) => query(text, params);
const first = async <T,>(run: Run, text: string, params: unknown[]) =>
  ((await run(text, params))[0] ?? null) as T | null;

/** 찾기 결과의 id 를 표의 키 형식으로 바꿉니다. int 칸에 글자를 넘기면 DB 오류가 나므로 여기서 막습니다. */
function targetId(e: CsEntity, id: unknown): string | number | null {
  if (e.idKind === "text") {
    const s = String(id ?? "").trim();
    return s || null;
  }
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const sameValues = (a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]) =>
  keys.every((k) => String(a[k] ?? "") === String(b[k] ?? ""));

/** 대상·칸·값을 검사합니다. 통과하면 사람이 읽을 이름과 지금 값을 돌려줍니다. */
export async function checkFix(
  run: Run,
  op: FixOp
): Promise<
  | { ok: true; label: string; before: Record<string, unknown>; after: Record<string, unknown> }
  | { ok: false; err: string }
> {
  if (op?.type !== "update") return { ok: false, err: "모르는 정정 종류" };
  const e = ENTITIES[op.entity];
  if (!e) return { ok: false, err: `모르는 정정 대상: ${String(op.entity)}` };
  const id = targetId(e, op.id);
  if (id === null) return { ok: false, err: `${e.label} 번호가 올바르지 않습니다.` };

  const keys = Object.keys(op.set ?? {});
  if (!keys.length) return { ok: false, err: "바꿀 칸이 없습니다." };
  const after: Record<string, unknown> = {};
  for (const k of keys) {
    // 칸 이름은 SQL 에 그대로 들어가므로 정의된 칸만 통과시킵니다.
    if (!Object.prototype.hasOwnProperty.call(e.fields, k)) {
      return { ok: false, err: `${e.label}에서 고칠 수 없는 칸: ${k}` };
    }
    const f = e.fields[k];
    const n = normalize(f.kind, op.set[k], f.nullable);
    if (!n.ok) return { ok: false, err: `${f.label} — ${n.err}` };
    after[k] = n.v;
  }

  const row = await first<Record<string, unknown>>(
    run,
    `SELECT ${keys.map((k) => `${k}::text AS "${k}"`).join(", ")} FROM ${e.table} WHERE ${e.idColumn} = $1`,
    [id]
  );
  if (!row) return { ok: false, err: `${e.label} #${id} 을(를) 찾지 못했습니다.` };

  const name = (await first<{ d: string }>(run, e.describe, [id]))?.d ?? `#${id}`;
  const changes = keys.map((k) => `${e.fields[k].label} ${showValue(row[k])} → ${showValue(after[k])}`).join(", ");
  return { ok: true, label: `${e.label} ${name} — ${changes}`, before: row, after };
}

const opLabel = (op: FixOp) => `${ENTITIES[op?.entity]?.label ?? op?.entity ?? "정정"} #${op?.id ?? ""}`;

/** 전에 낸 제안은 DROPPED 로 돌리고 새로 넣습니다. 검사에 걸린 것은 FAILED 로 까닭과 함께 남깁니다. */
export async function saveProposals(requestId: number, ops: FixOp[]) {
  await query(`UPDATE cs_fixes SET status = 'DROPPED' WHERE request_id = $1 AND status = 'PROPOSED'`, [requestId]);
  let okCount = 0;
  for (const op of ops.slice(0, 30)) {
    const ck = await checkFix(runQuery, op);
    await query(
      `INSERT INTO cs_fixes (request_id, op, label, reason, before, after, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        requestId,
        JSON.stringify(op),
        ck.ok ? ck.label : opLabel(op),
        op?.reason ?? null,
        ck.ok ? JSON.stringify(ck.before) : null,
        ck.ok ? JSON.stringify(ck.after) : null,
        ck.ok ? "PROPOSED" : "FAILED",
        ck.ok ? null : ck.err,
      ]
    );
    if (ck.ok) okCount += 1;
  }
  return okCount;
}

/** 고른 제안을 한 트랜잭션으로 반영합니다. 한 줄이라도 막히면 모두 되돌립니다. */
export async function applyFixes(
  requestId: number,
  fixIds: number[],
  userId: string | null
): Promise<{ applied: number } | { err: string }> {
  class Stop extends Error {}
  try {
    return await transaction(async (run) => {
      const fixes = (await run(
        `SELECT id, op, before FROM cs_fixes
          WHERE request_id = $1 AND id = ANY($2::bigint[]) AND status = 'PROPOSED' ORDER BY id FOR UPDATE`,
        [requestId, fixIds]
      )) as { id: number; op: FixOp; before: Record<string, unknown> }[];
      if (!fixes.length) throw new Stop("반영할 정정안이 없습니다.");

      for (const f of fixes) {
        const ck = await checkFix(run, f.op);
        if (!ck.ok) throw new Stop(`#${f.id} ${ck.err}`);
        const keys = Object.keys(ck.after);
        if (!sameValues(ck.before, f.before ?? {}, keys)) {
          throw new Stop(`#${f.id} 정정안을 만든 뒤 값이 바뀌었습니다. 정정안을 다시 만드세요.`);
        }
        const e = ENTITIES[f.op.entity];
        await run(
          `UPDATE ${e.table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE ${e.idColumn} = $1`,
          [targetId(e, f.op.id), ...keys.map((k) => ck.after[k])]
        );
        await run(`UPDATE cs_fixes SET status = 'APPLIED', applied_by = $2, applied_at = now(), after = $3 WHERE id = $1`, [
          f.id,
          userId,
          JSON.stringify(ck.after),
        ]);
      }
      return { applied: fixes.length };
    });
  } catch (err) {
    if (err instanceof Stop) return { err: err.message };
    throw err;
  }
}

export async function undoFix(requestId: number, fixId: number, userId: string): Promise<{ label: string } | { err: string }> {
  class Stop extends Error {}
  try {
    return await transaction(async (run) => {
      const f = await first<{
        label: string;
        op: FixOp;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
        status: string;
      }>(run, `SELECT label, op, before, after, status FROM cs_fixes WHERE id = $1 AND request_id = $2 FOR UPDATE`, [
        fixId,
        requestId,
      ]);
      if (!f || f.status !== "APPLIED") throw new Stop("되돌릴 수 있는 정정이 아닙니다.");

      const e = ENTITIES[f.op.entity];
      const id = targetId(e, f.op.id);
      const keys = Object.keys(f.after);
      const now = await first<Record<string, unknown>>(
        run,
        `SELECT ${keys.map((k) => `${k}::text AS "${k}"`).join(", ")} FROM ${e.table} WHERE ${e.idColumn} = $1`,
        [id]
      );
      if (!now || !sameValues(now, f.after, keys)) {
        throw new Stop("반영한 뒤 값이 또 바뀌어 되돌리지 않았습니다. 화면에서 확인하세요.");
      }
      await run(`UPDATE ${e.table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE ${e.idColumn} = $1`, [
        id,
        ...keys.map((k) => f.before[k] ?? null),
      ]);
      await run(`UPDATE cs_fixes SET status = 'UNDONE', undone_by = $2, undone_at = now() WHERE id = $1`, [fixId, userId]);
      return { label: f.label };
    });
  } catch (err) {
    if (err instanceof Stop) return { err: err.message };
    throw err;
  }
}
