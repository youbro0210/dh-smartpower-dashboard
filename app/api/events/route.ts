import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { execute, query } from "@/lib/db";
import { allowedDeviceIds } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 사업장 관제 화면의 알림·이벤트.
 *
 * GET  ?site=<사업장 id | none | all>&filter=pending|open|all
 *      미처리(미확인·확인) 건은 같은 설비·같은 항목끼리 묶어 한 건으로 돌려줍니다(재발 횟수 포함).
 * GET  ?summary=1  사업장별 미처리 건수와 최근 이벤트 시각 (전국 관제용)
 * POST { action: "ack" | "done", ids: number[], note? }
 */

const LEVEL_RANK = `CASE a.level WHEN 'danger' THEN 3 WHEN 'warning' THEN 2 WHEN 'caution' THEN 1 ELSE 0 END`;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const allowed = await allowedDeviceIds(user);
  const params = new URL(request.url).searchParams;

  if (params.get("summary")) {
    const rows = await query(
      `SELECT d.site_id,
              count(DISTINCT (a.device_id, a.item)) FILTER (WHERE a.status IN ('open', 'acked'))::int AS open,
              max(a.created_at) AS latest_at
         FROM alarm_events a
         JOIN devices d ON d.device_id = a.device_id
        WHERE ($1::text[] IS NULL OR a.device_id = ANY($1))
          AND a.created_at > now() - interval '30 days'
        GROUP BY d.site_id`,
      [allowed]
    );
    return NextResponse.json({ sites: rows });
  }

  const site = params.get("site") ?? "all";
  const filter = params.get("filter") ?? "pending";

  const where: string[] = ["a.device_id IS NOT NULL"];
  const values: unknown[] = [];
  if (allowed !== null) {
    values.push(allowed);
    where.push(`a.device_id = ANY($${values.length})`);
  }
  if (site === "none") where.push("d.site_id IS NULL");
  else if (site !== "all") {
    values.push(Number(site));
    where.push(`d.site_id = $${values.length}`);
  }
  const base = `FROM alarm_events a
                JOIN devices d ON d.device_id = a.device_id
                LEFT JOIN sites s ON s.id = d.site_id
                LEFT JOIN users ua ON ua.id = a.acked_by
               WHERE ${where.join(" AND ")}`;

  const pendingStatus = filter === "open" ? `a.status = 'open'` : `a.status IN ('open', 'acked')`;
  const pending = await query(
    `SELECT array_agg(a.id ORDER BY a.id) AS ids,
            a.device_id, max(a.unit) AS unit, a.item,
            (array_agg(a.level ORDER BY ${LEVEL_RANK} DESC, a.id DESC))[1] AS level,
            (array_agg(a.kind ORDER BY a.id DESC))[1] AS kind,
            CASE WHEN bool_or(a.status = 'open') THEN 'open' ELSE 'acked' END AS status,
            (array_agg(a.detail ORDER BY a.id DESC))[1] AS detail,
            NULL::text AS note,
            min(a.created_at) AS created_at,
            max(a.created_at) AS latest_at,
            count(*)::int AS repeats,
            (array_agg(COALESCE(ua.full_name, ua.email) ORDER BY a.acked_at DESC NULLS LAST))[1] AS acked_name,
            max(a.acked_at) AS acked_at,
            NULL::timestamptz AS done_at,
            max(s.name) AS site_name
       ${base} AND ${pendingStatus}
      GROUP BY a.device_id, a.item
      ORDER BY max(a.created_at) DESC`,
    values
  );

  let rest: unknown[] = [];
  if (filter === "all") {
    rest = await query(
      `SELECT ARRAY[a.id] AS ids, a.device_id, a.unit, a.item, a.level, a.kind, a.status,
              a.detail, a.note, a.created_at, a.created_at AS latest_at, 1 AS repeats,
              COALESCE(ua.full_name, ua.email) AS acked_name, a.acked_at, a.done_at,
              s.name AS site_name
         ${base} AND a.status IN ('done', 'info') AND a.created_at > now() - interval '30 days'
        ORDER BY a.created_at DESC
        LIMIT 100`,
      values
    );
  }

  return NextResponse.json({ events: [...pending, ...rest] });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "");
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length || !["ack", "done"].includes(action)) {
    return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
  }

  // 고객사 담당자는 자기 회사 설비 건만 처리합니다.
  const allowed = await allowedDeviceIds(user);

  if (action === "ack") {
    const n = await execute(
      `UPDATE alarm_events SET status = 'acked', acked_by = $1, acked_at = now()
        WHERE id = ANY($2) AND status = 'open' AND ($3::text[] IS NULL OR device_id = ANY($3))`,
      [user.id, ids, allowed]
    );
    return NextResponse.json({ ok: true, changed: n });
  }

  const note = String(body?.note ?? "").trim().slice(0, 1000);
  if (!note) return NextResponse.json({ error: "점검·조치 내용을 입력하세요." }, { status: 400 });
  const n = await execute(
    `UPDATE alarm_events
        SET status = 'done', done_by = $1, done_at = now(), note = $4,
            acked_by = COALESCE(acked_by, $1), acked_at = COALESCE(acked_at, now())
      WHERE id = ANY($2) AND status IN ('open', 'acked') AND ($3::text[] IS NULL OR device_id = ANY($3))`,
    [user.id, ids, allowed, note]
  );
  return NextResponse.json({ ok: true, changed: n });
}
