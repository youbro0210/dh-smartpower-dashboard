import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query, one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 장치가 준 ts 를 수집기와 같은 규칙으로 읽습니다 (초·밀리초 숫자 또는 ISO 문자열). */
function parseTs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e11 ? value : value * 1000;
  if (typeof value === "string" && value.trim()) {
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * 수신 메시지 한 건에 담겼던 계측값을 telemetry 에서 꺼내 줍니다.
 * 원문은 길면 앞부분만 보관하므로, 실제로 적재된 값을 기준으로 보여 줍니다.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const row = await one<{
    kind: string | null;
    device_ids: string[] | null;
    item_count: number;
    payload: Record<string, unknown> | null;
    received_at: string;
  }>(`SELECT kind, device_ids, item_count, payload, received_at FROM ingest_log WHERE id = $1`, [id]);
  if (!row) return NextResponse.json({ error: "수신 내역을 찾을 수 없습니다." }, { status: 404 });
  if (row.kind !== "tele" || !row.device_ids?.length) return NextResponse.json({ items: [] });

  const payload = row.payload ?? {};
  const raw = Array.isArray(payload.items) ? (payload.items as Record<string, unknown>[]) : [payload];
  const stamps = raw
    .map((it) => parseTs(it?.ts ?? payload.ts))
    .filter((t): t is number => t !== null);
  if (!stamps.length) return NextResponse.json({ items: [] });

  const min = new Date(Math.min(...stamps)).toISOString();
  const max = new Date(Math.max(...stamps)).toISOString();
  const complete = raw.length >= row.item_count;
  const limit = Math.max(1, Math.min(5000, row.item_count || raw.length));

  // 원문이 다 남아 있으면 그 시각 범위를, 잘려 있으면 첫 시각부터 수신 시점 전후로 적재된 값을 씁니다.
  const items = complete
    ? await query(
        `SELECT device_id, measured_at, received_at, h2, ch4, temperature, oil_level
           FROM telemetry
          WHERE device_id = ANY($1) AND measured_at BETWEEN $2 AND $3
          ORDER BY measured_at, device_id
          LIMIT $4`,
        [row.device_ids, min, max, limit]
      )
    : await query(
        `SELECT device_id, measured_at, received_at, h2, ch4, temperature, oil_level
           FROM telemetry
          WHERE device_id = ANY($1) AND measured_at >= $2
            AND received_at BETWEEN $3::timestamptz - interval '10 seconds'
                                AND $3::timestamptz + interval '10 seconds'
          ORDER BY measured_at, device_id
          LIMIT $4`,
        [row.device_ids, min, row.received_at, limit]
      );

  return NextResponse.json({ items });
}
