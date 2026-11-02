import { NextResponse } from "next/server";
import { SIGNATURE_HEADER } from "@/autofix/protocol";
import { nextDeploy, verifyQueue } from "@/lib/cs/autofix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 서버 배포기가 묻는 곳입니다. 로그인 대신 HMAC 서명으로 확인합니다. */
export async function GET(req: Request) {
  if (!verifyQueue(req.headers.get("x-autofix-ts"), req.headers.get(SIGNATURE_HEADER))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, job: (await nextDeploy()) ?? null });
}
