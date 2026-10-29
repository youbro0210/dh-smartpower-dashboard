import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, unsignValue } from "@/lib/cookieSign";
import { createUser, findUserByEmail, hashPassword, requireAdmin } from "@/lib/auth";
import { query, one, execute } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 관리자가 직접 정해 주는 비밀번호의 최소 길이.
// 현장 시험용 계정을 짧은 숫자 비밀번호로 나눠 주는 경우가 있어 회원가입(8자)보다 낮춥니다.
const ADMIN_PASSWORD_MIN = 6;

/** 관리자가 회원을 직접 등록합니다. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim();
  const fullName = String(body?.fullName ?? "").trim();
  const password = String(body?.password ?? "");
  const tier = String(body?.tier ?? "viewer");

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "이메일 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: "이름을 입력해 주세요." }, { status: 400 });
  }
  if (password.length < ADMIN_PASSWORD_MIN) {
    return NextResponse.json(
      { error: `비밀번호는 ${ADMIN_PASSWORD_MIN}자 이상이어야 합니다.` },
      { status: 400 }
    );
  }
  if (!["viewer", "admin"].includes(tier)) {
    return NextResponse.json({ error: "등급이 올바르지 않습니다." }, { status: 400 });
  }
  if (await findUserByEmail(email)) {
    return NextResponse.json({ error: "이미 등록된 이메일입니다." }, { status: 409 });
  }

  try {
    const user = await createUser({ email, password, fullName, tier: tier as "viewer" | "admin" });
    return NextResponse.json({ user }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "이미 등록된 이메일입니다." }, { status: 409 });
  }
}

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

  // 비밀번호 변경
  if (body && typeof body.password === "string") {
    const password: string = body.password;
    if (!userId) return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
    if (password.length < ADMIN_PASSWORD_MIN) {
      return NextResponse.json(
        { error: `비밀번호는 ${ADMIN_PASSWORD_MIN}자 이상이어야 합니다.` },
        { status: 400 }
      );
    }
    const changed = await execute(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      await hashPassword(password),
      userId,
    ]);
    if (!changed) return NextResponse.json({ error: "대상 회원을 찾을 수 없습니다." }, { status: 404 });

    // 바뀌기 전 비밀번호로 열린 세션은 끊습니다. 본인이 바꾼 경우 자기 세션은 남깁니다.
    if (userId === admin.id) {
      const current = (await unsignValue(cookies().get(SESSION_COOKIE)?.value)) ?? "";
      await execute(`DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, [userId, current]);
    } else {
      await execute(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    }
    return NextResponse.json({ ok: true });
  }

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
