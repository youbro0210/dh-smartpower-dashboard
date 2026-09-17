import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const limit = Math.min(200, Number(new URL(request.url).searchParams.get("limit") ?? 50));

  const rows = await query(
    `SELECT id, alarm_id, recipient, channel, target, level, status, error, created_at
       FROM notify_log
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  return NextResponse.json({ log: rows });
}
