import { NextResponse } from "next/server";
import { SIGNATURE_HEADER } from "@/autofix/protocol";
import { onAutofixEvent, verifyCallback } from "@/lib/cs/autofix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GitHub Actions·서버 배포기가 보내는 진행 알림입니다. 로그인 대신 HMAC 서명으로 확인합니다. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 200_000 || !verifyCallback(raw, req.headers.get(SIGNATURE_HEADER))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const e = JSON.parse(raw);
    if (typeof e?.job_id !== "string" || typeof e?.event !== "string") {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const r = await onAutofixEvent(e);
    return NextResponse.json({ ok: !r.err }, { status: r.err ? 404 : 200 });
  } catch (err) {
    console.error("[autofix 알림]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
