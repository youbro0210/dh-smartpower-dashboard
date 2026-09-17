import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query, one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const level = params.get("level");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50));

  const where: string[] = [];
  const values: unknown[] = [];

  if (from) {
    values.push(from);
    where.push(`created_at >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    where.push(`created_at < ($${values.length}::date + interval '1 day')`);
  }
  if (level && ["caution", "warning", "danger"].includes(level)) {
    values.push(level);
    where.push(`level = $${values.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await one<{ count: number }>(
    `SELECT count(*)::int AS count FROM alarm_events ${whereSql}`,
    values
  );

  const events = await query(
    `SELECT id, device_id, unit, item, level, detail, created_at
       FROM alarm_events ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize]
  );

  const byLevel = await query<{ level: string; count: number }>(
    `SELECT level, count(*)::int AS count FROM alarm_events ${whereSql} GROUP BY level`,
    values
  );

  return NextResponse.json({
    events,
    total: total?.count ?? 0,
    page,
    pageSize,
    byLevel: Object.fromEntries(byLevel.map((r) => [r.level, r.count])),
  });
}
