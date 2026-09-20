import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query, one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 수집기가 실제로 받은 메시지 원문입니다. 규격이 어긋날 때 어느 쪽 문제인지 바로 봅니다. */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const status = url.searchParams.get("status");
  const kind = url.searchParams.get("kind");
  const keyword = (url.searchParams.get("q") ?? "").trim();

  const where: string[] = [];
  const args: unknown[] = [];

  if (status && ["ok", "warn", "error"].includes(status)) {
    args.push(status);
    where.push(`status = $${args.length}`);
  }
  if (kind) {
    args.push(kind);
    where.push(`kind = $${args.length}`);
  }
  if (keyword) {
    args.push(`%${keyword}%`);
    where.push(`(topic ILIKE $${args.length} OR src_id ILIKE $${args.length}
                 OR array_to_string(device_ids, ',') ILIKE $${args.length})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  args.push(limit);

  const [rows, summary] = await Promise.all([
    query(
      `SELECT id, topic, src_type, src_id, kind, device_ids, item_count,
              stored_count, replay, status, message, payload, received_at
         FROM ingest_log ${whereSql}
        ORDER BY received_at DESC
        LIMIT $${args.length}`,
      args
    ),
    one(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'ok')::int    AS ok,
              count(*) FILTER (WHERE status = 'warn')::int  AS warn,
              count(*) FILTER (WHERE status = 'error')::int AS error,
              max(received_at) AS last_at
         FROM ingest_log
        WHERE received_at > now() - interval '24 hours'`
    ),
  ]);

  return NextResponse.json({ log: rows, summary });
}
