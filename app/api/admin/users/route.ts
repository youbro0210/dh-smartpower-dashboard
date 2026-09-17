import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query, one, execute } from "@/lib/db";

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
    `SELECT count(*)::int AS count FROM users ${whereSql}`,
    values
  );

  const users = await query(
    `SELECT id, email, full_name, tier, is_active, created_at, last_login_at
       FROM users ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize]
  );

  return NextResponse.json({ users, total: total?.count ?? 0, page, pageSize });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const userId = String(body?.user_id ?? "");
  const tier = String(body?.tier ?? "");

  if (!userId || !["viewer", "admin"].includes(tier)) {
    return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
  }

  // 마지막 관리자를 뷰어로 내리면 아무도 설정을 못 바꾸게 되므로 막습니다.
  if (tier === "viewer") {
    const admins = await one<{ count: number }>(
      `SELECT count(*)::int AS count FROM users WHERE tier = 'admin' AND is_active`
    );
    const target = await one<{ tier: string }>(`SELECT tier FROM users WHERE id = $1`, [userId]);
    if (target?.tier === "admin" && (admins?.count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "마지막 관리자의 등급은 변경할 수 없습니다." },
        { status: 409 }
      );
    }
  }

  const updated = await execute(`UPDATE users SET tier = $1 WHERE id = $2`, [tier, userId]);
  if (!updated) return NextResponse.json({ error: "대상 회원을 찾을 수 없습니다." }, { status: 404 });

  // 등급이 바뀌면 기존 세션의 권한 캐시가 남지 않도록 세션을 끊습니다.
  await execute(`DELETE FROM sessions WHERE user_id = $1`, [userId]);

  return NextResponse.json({ ok: true });
}
