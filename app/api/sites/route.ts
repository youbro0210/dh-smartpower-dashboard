import { NextResponse } from "next/server";
import { companyScope, getSessionUser, requireAdmin } from "@/lib/auth";
import { execute, one, query } from "@/lib/db";
import { REGIONS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 사업장 목록. 고객사 담당자는 자기 회사 사업장만 봅니다. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const scope = companyScope(user);
  const sites = await query(
    `SELECT s.id, s.name, s.region, s.company_id, c.name AS company_name,
            (SELECT count(*)::int FROM devices d WHERE d.site_id = s.id) AS devices
       FROM sites s LEFT JOIN companies c ON c.id = s.company_id
      WHERE ($1::int IS NULL OR s.company_id = $1)
      ORDER BY c.name NULLS LAST, s.name`,
    [scope]
  );
  return NextResponse.json({ sites });
}

function readBody(body: Record<string, unknown> | null) {
  const name = String(body?.name ?? "").trim().slice(0, 100);
  const region = String(body?.region ?? "").trim();
  const companyId = body?.company_id ? Number(body.company_id) : null;
  return { name, region, companyId };
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const { name, region, companyId } = readBody(await request.json().catch(() => null));
  if (!name) return NextResponse.json({ error: "사업장 이름을 입력하세요." }, { status: 400 });
  if (region && !(REGIONS as readonly string[]).includes(region)) {
    return NextResponse.json({ error: "권역을 목록에서 선택하세요." }, { status: 400 });
  }
  try {
    const row = await one<{ id: number }>(
      `INSERT INTO sites (company_id, name, region) VALUES ($1, $2, $3) RETURNING id`,
      [companyId, name, region]
    );
    return NextResponse.json({ id: row?.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "같은 이름의 사업장이 있습니다." }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  const { name, region } = readBody(body);
  if (!Number.isInteger(id) || !name) {
    return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
  }
  if (region && !(REGIONS as readonly string[]).includes(region)) {
    return NextResponse.json({ error: "권역을 목록에서 선택하세요." }, { status: 400 });
  }
  try {
    const n = await execute(`UPDATE sites SET name = $1, region = $2 WHERE id = $3`, [name, region, id]);
    if (!n) return NextResponse.json({ error: "사업장을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "같은 이름의 사업장이 있습니다." }, { status: 409 });
  }
}

/** 설비가 배정된 사업장은 지우지 않습니다. */
export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
  const used = await one<{ n: number }>(`SELECT count(*)::int AS n FROM devices WHERE site_id = $1`, [id]);
  if ((used?.n ?? 0) > 0) {
    return NextResponse.json({ error: `배정된 설비 ${used?.n}대가 있어 삭제할 수 없습니다.` }, { status: 409 });
  }
  await execute(`DELETE FROM sites WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
