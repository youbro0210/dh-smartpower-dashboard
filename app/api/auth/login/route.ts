import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  findUserByEmail,
  verifyPassword,
  burnTime,
  createSession,
  pruneSessions,
  sessionCookieOptions,
} from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/cookieSign";
import { execute, one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAILURES = 10;
const WINDOW_MINUTES = 10;

const INVALID = "이메일 또는 비밀번호가 올바르지 않습니다.";

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "이메일과 비밀번호를 입력해 주세요." }, { status: 400 });
  }

  const h = headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = h.get("user-agent");

  async function recordAttempt(userId: string | null, success: boolean) {
    await execute(
      `INSERT INTO login_events (user_id, email, success, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, email, success, ip, userAgent]
    );
  }

  // 같은 계정에 대한 연속 실패를 제한합니다.
  const recent = await one<{ failures: number }>(
    `SELECT count(*)::int AS failures
       FROM login_events
      WHERE lower(email) = lower($1)
        AND success = false
        AND created_at > now() - ($2 || ' minutes')::interval`,
    [email, String(WINDOW_MINUTES)]
  );

  if ((recent?.failures ?? 0) >= MAX_FAILURES) {
    return NextResponse.json(
      { error: `로그인 시도가 너무 많습니다. ${WINDOW_MINUTES}분 후 다시 시도해 주세요.` },
      { status: 429 }
    );
  }

  const user = await findUserByEmail(email);

  // 계정이 없어도 동일한 시간을 소비해 가입 여부가 드러나지 않게 합니다.
  if (!user) {
    await burnTime(password);
    await recordAttempt(null, false);
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  if (!user.is_active) {
    await burnTime(password);
    await recordAttempt(user.id, false);
    return NextResponse.json(
      { error: "비활성화된 계정입니다. 관리자에게 문의해 주세요." },
      { status: 403 }
    );
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    await recordAttempt(user.id, false);
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  await pruneSessions();
  const token = await createSession(user.id, { ip, userAgent });
  await recordAttempt(user.id, true);

  const response = NextResponse.json({
    user: { id: user.id, email: user.email, full_name: user.full_name, tier: user.tier },
  });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}
