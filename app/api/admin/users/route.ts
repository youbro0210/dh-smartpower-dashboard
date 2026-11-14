import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, unsignValue } from "@/lib/cookieSign";
import { createUser, findUserByEmail, hashPassword, requireAdmin, Tier } from "@/lib/auth";
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
  const companyId = body?.company_id ? Number(body.company_id) : null;

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
  if (!["viewer", "admin", "customer"].includes(tier)) {
    return NextResponse.json({ error: "등급이 올바르지 않습니다." }, { status: 400 });
  }
  if (tier === "customer" && !companyId) {
    return NextResponse.json({ error: "고객사 담당자는 소속 고객사를 지정해야 합니다." }, { status: 400 });
  }
  if (await findUserByEmail(email)) {
    return NextResponse.json({ error: "이미 등록된 이메일입니다." }, { status: 409 });
  }

  try {
    const user = await createUser({
      email,
      password,
      fullName,
      tier: tier as Tier,
      companyId: tier === "customer" ? companyId : null,
    });
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
    `SELECT u.id, u.email, u.full_name, u.tier, u.company_id, c.name AS company_name,
            u.is_active, u.approval, u.created_at, u.last_login_at
       FROM users u LEFT JOIN companies c ON c.id = u.company_id
       ${whereSql.replace(/created_at/g, "u.created_at")}
      ORDER BY (u.approval = 'pending') DESC, u.created_at DESC
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

  // 가입 승인
  if (body?.approve === true) {
    if (!userId) return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
    // 고객사 담당자로 승인하려면 소속 고객사가 정해져 있어야 합니다.
    const pending = await one<{ tier: string; company_id: number | null }>(
      `SELECT tier, company_id FROM users WHERE id = $1`,
      [userId]
    );
    if (pending?.tier === "customer" && !pending.company_id) {
      return NextResponse.json({ error: "소속 고객사를 먼저 지정하세요." }, { status: 400 });
    }
    const approved = await execute(
      `UPDATE users SET approval = 'approved' WHERE id = $1 AND approval = 'pending'`,
      [userId]
    );
    if (!approved) return NextResponse.json({ error: "승인 대기 중인 회원이 아닙니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (!userId || !["viewer", "admin", "customer"].includes(tier)) {
    return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
  }
  const companyId = body?.company_id ? Number(body.company_id) : null;
  if (tier === "customer" && !companyId) {
    return NextResponse.json({ error: "고객사 담당자는 소속 고객사를 지정해야 합니다." }, { status: 400 });
  }

  // 마지막 관리자를 다른 등급으로 내리면 아무도 설정을 못 바꾸게 되므로 막습니다.
  if (tier !== "admin") {
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

  const updated = await execute(`UPDATE users SET tier = $1, company_id = $2 WHERE id = $3`, [
    tier,
    tier === "customer" ? companyId : null,
    userId,
  ]);
  if (!updated) return NextResponse.json({ error: "대상 회원을 찾을 수 없습니다." }, { status: 404 });

  // 등급이 바뀌면 기존 세션의 권한 캐시가 남지 않도록 세션을 끊습니다.
  await execute(`DELETE FROM sessions WHERE user_id = $1`, [userId]);

  return NextResponse.json({ ok: true });
}

/** 가입 거절입니다. 승인 대기 계정만 지웁니다. 쓰던 계정이 이 경로로 지워지지 않게 조건을 겁니다. */
export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const userId = new URL(request.url).searchParams.get("user_id") ?? "";
  if (!userId) return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
  const removed = await execute(`DELETE FROM users WHERE id = $1 AND approval = 'pending'`, [userId]);
  if (!removed) return NextResponse.json({ error: "승인 대기 중인 회원이 아닙니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
