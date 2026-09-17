import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession, sessionCookieOptions } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/cookieSign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await destroySession(cookies().get(SESSION_COOKIE)?.value);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
