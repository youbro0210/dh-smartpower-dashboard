import { NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { execute, one, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["inspection", "oil_sample", "oil_refill", "repair", "replace", "other"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 점검 이력 조회 — 로그인한 사람은 모두 볼 수 있습니다. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const device = params.get("device");
  const kind = params.get("kind");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50));

  const where: string[] = [];
  const values: unknown[] = [];
  if (from && DATE_PATTERN.test(from)) {
    values.push(from);
    where.push(`work_date >= $${values.length}::date`);
  }
  if (to && DATE_PATTERN.test(to)) {
    values.push(to);
    where.push(`work_date <= $${values.length}::date`);
  }
  if (device) {
    values.push(device);
    where.push(`device_id = $${values.length}`);
  }
  if (kind && KINDS.includes(kind)) {
    values.push(kind);
    where.push(`kind = $${values.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await one<{ count: number }>(
    `SELECT count(*)::int AS count FROM maintenance_logs ${whereSql}`,
    values
  );
  const logs = await query(
    `SELECT id, device_id, unit, to_char(work_date, 'YYYY-MM-DD') AS work_date, kind, title, detail,
            worker, to_char(next_due, 'YYYY-MM-DD') AS next_due, created_at
       FROM maintenance_logs ${whereSql}
      ORDER BY work_date DESC, id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize]
  );

  // 설비별 가장 가까운 다음 점검 예정일 — 지난 것도 포함해 늦어진 점검을 드러냅니다.
  const due = await query(
    `SELECT DISTINCT ON (device_id) device_id, unit, to_char(next_due, 'YYYY-MM-DD') AS next_due
       FROM maintenance_logs
      WHERE next_due IS NOT NULL AND device_id IS NOT NULL
      ORDER BY device_id, work_date DESC, id DESC`
  );

  return NextResponse.json({ logs, total: total?.count ?? 0, page, pageSize, due });
}

function readBody(body: Record<string, unknown> | null) {
  const s = (v: unknown) => String(v ?? "").trim();
  return {
    deviceId: s(body?.device_id),
    workDate: s(body?.work_date),
    kind: s(body?.kind),
    title: s(body?.title),
    detail: s(body?.detail) || null,
    worker: s(body?.worker) || null,
    nextDue: s(body?.next_due) || null,
  };
}

function validate(v: ReturnType<typeof readBody>): string | null {
  if (!v.deviceId) return "설비를 선택하세요.";
  if (!DATE_PATTERN.test(v.workDate)) return "작업일을 입력하세요.";
  if (!KINDS.includes(v.kind)) return "작업 구분이 올바르지 않습니다.";
  if (!v.title) return "작업 내용을 입력하세요.";
  if (v.nextDue && !DATE_PATTERN.test(v.nextDue)) return "다음 점검일 형식이 올바르지 않습니다.";
  return null;
}

/** 점검 이력 등록 — 관리자만 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const v = readBody(await request.json().catch(() => null));
  const err = validate(v);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const device = await one<{ name: string }>(`SELECT name FROM devices WHERE device_id = $1`, [
    v.deviceId,
  ]);
  if (!device) return NextResponse.json({ error: "설비를 찾을 수 없습니다." }, { status: 404 });

  const rows = await query<{ id: number }>(
    `INSERT INTO maintenance_logs (device_id, unit, work_date, kind, title, detail, worker, next_due, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [v.deviceId, device.name, v.workDate, v.kind, v.title, v.detail, v.worker, v.nextDue, admin.id]
  );
  return NextResponse.json({ id: rows[0]?.id }, { status: 201 });
}

/** 점검 이력 삭제 — 관리자만 */
export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const id = parseInt(new URL(request.url).searchParams.get("id") ?? "", 10);
  if (!id) return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });

  const deleted = await execute(`DELETE FROM maintenance_logs WHERE id = $1`, [id]);
  if (!deleted) return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
