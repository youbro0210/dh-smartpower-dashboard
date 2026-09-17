import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query, one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.get("pageSize") ?? "20", 10) || 20));

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
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await one<{ count: number }>(
    `SELECT count(*)::int AS count FROM login_events ${whereSql}`,
    values
  );

  const events = await query(
    `SELECT id, user_id, email, success, ip, created_at
       FROM login_events ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize]
  );

  return NextResponse.json({ events, total: total?.count ?? 0, page, pageSize });
}
