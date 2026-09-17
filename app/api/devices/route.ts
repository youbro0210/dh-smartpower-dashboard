import { NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { query, one, execute } from "@/lib/db";
import { DEFAULT_THRESHOLDS, ThresholdConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TrendRow {
  device_id: string;
  bucket: string;
  temperature: number | null;
  h2: number | null;
}

/** 대시보드 최초 로딩에 필요한 데이터를 한 번에 돌려줍니다. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const [devices, bridges, readings, config, alarms, trendRows, baselines] = await Promise.all([
    query(`SELECT device_id, name, building, capacity, bridge_id, slave_addr, sort_order
             FROM devices ORDER BY sort_order, device_id`),
    query(`SELECT bridge_id, name, online, last_seen_at FROM bridges ORDER BY bridge_id`),
    query(`SELECT device_id, h2, ch4, temperature, oil_level, updated_at FROM device_readings`),
    one<{ thresholds: ThresholdConfig; version: number }>(
      `SELECT thresholds, version FROM app_config WHERE id = 1`
    ),
    query(`SELECT id, device_id, unit, item, level, detail, created_at
             FROM alarm_events
            WHERE created_at > now() - interval '7 days'
            ORDER BY created_at DESC
            LIMIT 50`),
    query<TrendRow>(`
      SELECT device_id,
             date_trunc('hour', measured_at) AS bucket,
             avg(temperature) AS temperature,
             avg(h2)          AS h2
        FROM telemetry
       WHERE measured_at > now() - interval '24 hours'
       GROUP BY device_id, bucket
       ORDER BY device_id, bucket`),
    query(`
      SELECT DISTINCT ON (device_id) device_id, h2, ch4, temperature
        FROM telemetry
       WHERE measured_at <= now() - interval '24 hours'
       ORDER BY device_id, measured_at DESC`),
  ]);

  const trends: Record<string, { temperature: number[]; h2: number[] }> = {};
  for (const row of trendRows) {
    const bucket = (trends[row.device_id] ??= { temperature: [], h2: [] });
    if (row.temperature !== null) bucket.temperature.push(Number(row.temperature.toFixed(1)));
    if (row.h2 !== null) bucket.h2.push(Number(row.h2.toFixed(1)));
  }

  const alarms24h = await one<{ count: number }>(
    `SELECT count(*)::int AS count FROM alarm_events WHERE created_at > now() - interval '24 hours'`
  );

  return NextResponse.json({
    devices,
    bridges,
    readings,
    trends,
    baselines,
    alarms,
    alarms24h: alarms24h?.count ?? 0,
    thresholds: config?.thresholds ?? DEFAULT_THRESHOLDS,
    configVersion: config?.version ?? 1,
  });
}

/** 설비 등록 (관리자 전용) */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });

  const name = String(body.name ?? "").trim();
  const building = String(body.building ?? "").trim();
  if (!name || !building) {
    return NextResponse.json({ error: "이름과 위치는 필수입니다." }, { status: 400 });
  }

  // 숫자형 device_id 중 가장 큰 값 + 1
  const next = await one<{ next_id: number }>(
    `SELECT COALESCE(max(NULLIF(regexp_replace(device_id, '\\D', '', 'g'), '')::int), 0) + 1 AS next_id
       FROM devices`
  );
  const deviceId = String(next?.next_id ?? 1);

  await execute(
    `INSERT INTO devices (device_id, name, building, capacity, bridge_id, slave_addr, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      deviceId,
      name,
      building,
      String(body.capacity ?? "").trim() || "3상 500kVA",
      body.bridge_id ? String(body.bridge_id) : null,
      body.slave_addr != null ? Number(body.slave_addr) : null,
      Number(next?.next_id ?? 1),
    ]
  );

  return NextResponse.json({ device_id: deviceId }, { status: 201 });
}

/** 설비 삭제 (관리자 전용) */
export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const deviceId = new URL(request.url).searchParams.get("device_id");
  if (!deviceId) return NextResponse.json({ error: "device_id 가 필요합니다." }, { status: 400 });

  const removed = await execute(`DELETE FROM devices WHERE device_id = $1`, [deviceId]);
  if (!removed) return NextResponse.json({ error: "해당 설비를 찾을 수 없습니다." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
