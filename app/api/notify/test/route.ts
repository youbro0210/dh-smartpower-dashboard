import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sendTest } from "@/lib/notify/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 외부 발송사 응답을 기다려야 하므로 여유를 둡니다.
export const maxDuration = 30;

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "수신자 id 가 필요합니다." }, { status: 400 });
  }

  const result = await sendTest(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "발송에 실패했습니다." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
