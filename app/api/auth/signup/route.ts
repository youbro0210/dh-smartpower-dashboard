import { NextResponse } from "next/server";
import { createUser, findUserByEmail } from "@/lib/auth";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; fullName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const fullName = String(body.fullName ?? "").trim();

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "이메일 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: "이름을 입력해 주세요." }, { status: 400 });
  }

  if (await findUserByEmail(email)) {
    return NextResponse.json({ error: "이미 가입된 이메일입니다." }, { status: 409 });
  }

  // 사용자가 한 명도 없으면 최초 가입자를 관리자로 지정합니다.
  // 이후 가입자는 고객사 담당자(소속 미지정)로 넣고, 관리자가 회원관리에서
  // 등급·소속을 정해 승인해야 로그인할 수 있습니다. 승인 전에 전체 설비가 보이지 않게 하려는 것입니다.
  const existing = await one<{ count: number }>(`SELECT count(*)::int AS count FROM users`);
  const tier = (existing?.count ?? 0) === 0 ? "admin" : "customer";

  try {
    const approval = tier === "admin" ? "approved" : "pending";
    const user = await createUser({ email, password, fullName, tier, approval });
    return NextResponse.json({ user, tier, approval }, { status: 201 });
  } catch (err) {
    // 동시 가입으로 유니크 제약에 걸린 경우
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "이미 가입된 이메일입니다." }, { status: 409 });
    }
    throw err;
  }
}
