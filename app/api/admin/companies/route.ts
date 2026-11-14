import { NextResponse } from "next/server";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { execute, one, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 고객사 목록 — DH 직원만. 설비·담당자 수를 함께 돌려줍니다. */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const companies = await query(
    `SELECT c.id, c.name, c.memo, c.created_at,
            (SELECT count(*)::int FROM devices d WHERE d.company_id = c.id) AS devices,
            (SELECT count(*)::int FROM users u WHERE u.company_id = c.id) AS users
       FROM companies c
      ORDER BY c.name`
  );
  return NextResponse.json({ companies });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim().slice(0, 100);
  const memo = String(body?.memo ?? "").trim().slice(0, 300) || null;
  if (!name) return NextResponse.json({ error: "고객사 이름을 입력하세요." }, { status: 400 });
  try {
    const row = await one<{ id: number }>(
      `INSERT INTO companies (name, memo) VALUES ($1, $2) RETURNING id`,
      [name, memo]
    );
    return NextResponse.json({ id: row?.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "같은 이름의 고객사가 있습니다." }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  const name = String(body?.name ?? "").trim().slice(0, 100);
  const memo = String(body?.memo ?? "").trim().slice(0, 300) || null;
  if (!Number.isInteger(id) || !name) {
    return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
  }
  try {
    const n = await execute(`UPDATE companies SET name = $1, memo = $2 WHERE id = $3`, [name, memo, id]);
    if (!n) return NextResponse.json({ error: "고객사를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "같은 이름의 고객사가 있습니다." }, { status: 409 });
  }
}

/** 설비나 담당자가 남아 있는 고객사는 지우지 않습니다. 실수로 지워 범위가 풀리는 것을 막습니다. */
export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
  const used = await one<{ devices: number; users: number }>(
    `SELECT (SELECT count(*)::int FROM devices WHERE company_id = $1) AS devices,
            (SELECT count(*)::int FROM users WHERE company_id = $1) AS users`,
    [id]
  );
  if ((used?.devices ?? 0) > 0 || (used?.users ?? 0) > 0) {
    return NextResponse.json(
      { error: `연결된 설비 ${used?.devices ?? 0}대, 담당자 ${used?.users ?? 0}명이 있어 삭제할 수 없습니다.` },
      { status: 409 }
    );
  }
  await execute(`DELETE FROM companies WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
