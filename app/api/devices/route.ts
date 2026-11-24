import { NextResponse } from "next/server";
import { kstParts } from "@/lib/kst";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { query, one, execute } from "@/lib/db";
import { allowedDeviceIds, keepAllowed } from "@/lib/scope";
import {
  DEFAULT_THRESHOLDS,
  LinkType,
  RS485_MAX_DEVICES,
  ThresholdConfig,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TrendRow {
  device_id: string;
  bucket: string;
  temperature: number | null;
  h2: number | null;
  ch4: number | null;
}

function round1(value: number | null): number | null {
  return value === null ? null : Number(Number(value).toFixed(1));
}

/** 대시보드 최초 로딩에 필요한 데이터를 한 번에 돌려줍니다. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const allowed = await allowedDeviceIds(user);

  const [allDevices, allBridges, allReadings, config, allAlarms, allTrendRows, allBaselines] = await Promise.all([
    query<{ device_id: string; bridge_id: string | null }>(
      `SELECT d.device_id, d.name, d.building, d.capacity, d.bridge_id, d.slave_addr, d.sort_order,
              d.link_type, d.online, d.last_seen_at, d.fw_version, d.interval_sec,
              d.company_id, c.name AS company_name,
              d.site_id, s.name AS site_name, s.region, d.model, d.place, d.temp_limit,
              (SELECT max(k.acked_at) FROM device_commands k
                WHERE k.command = 'led_clear' AND k.status = 'acked'
                  AND (k.device_id = d.device_id OR (k.target_type = 'module' AND k.target_id = d.device_id))
              ) AS led_cleared_at,
              -- 실제로 값을 한 번이라도 보낸 장비인지 (수신 기록 기준)
              (d.last_seen_at IS NOT NULL
               OR EXISTS (SELECT 1 FROM device_readings r WHERE r.device_id = d.device_id)
               OR EXISTS (SELECT 1 FROM telemetry t WHERE t.device_id = d.device_id)) AS has_data
         FROM devices d
         LEFT JOIN companies c ON c.id = d.company_id
         LEFT JOIN sites s ON s.id = d.site_id
        ORDER BY d.sort_order, d.device_id`),
    query<{ bridge_id: string }>(`SELECT bridge_id, name, online, last_seen_at, kind, max_devices
             FROM bridges ORDER BY bridge_id`),
    query<{ device_id: string }>(`SELECT device_id, h2, ch4, temperature, oil_level, updated_at FROM device_readings`),
    one<{ thresholds: ThresholdConfig; version: number }>(
      `SELECT thresholds, version FROM app_config WHERE id = 1`
    ),
    query<{ device_id: string | null }>(`SELECT id, device_id, unit, item, level, detail, created_at
             FROM alarm_events
            WHERE created_at > now() - interval '7 days' AND level <> 'normal'
            ORDER BY created_at DESC
            LIMIT 50`),
    query<TrendRow>(`
      SELECT device_id,
             date_trunc('hour', measured_at) AS bucket,
             avg(temperature) AS temperature,
             avg(h2)          AS h2,
             avg(ch4)         AS ch4
        FROM telemetry
       WHERE measured_at > now() - interval '24 hours'
       GROUP BY device_id, bucket
       ORDER BY device_id, bucket`),
    query<{ device_id: string }>(`
      SELECT DISTINCT ON (device_id) device_id, h2, ch4, temperature
        FROM telemetry
       WHERE measured_at <= now() - interval '24 hours'
       ORDER BY device_id, measured_at DESC`),
  ]);

  // 고객사 담당자는 자기 회사 설비와 그 설비가 물린 브릿지만 봅니다.
  const devices = keepAllowed(allDevices, allowed);
  const usedBridges = new Set(devices.map((d) => d.bridge_id).filter(Boolean));
  const bridges = allowed === null ? allBridges : allBridges.filter((b) => usedBridges.has(b.bridge_id));
  const readings = keepAllowed(allReadings, allowed);
  // 설비가 없는 시스템 알람(수집 서버 중단 등)은 직원에게만 보입니다.
  const alarms = keepAllowed(allAlarms, allowed);
  const trendRows = keepAllowed(allTrendRows, allowed);
  const baselines = keepAllowed(allBaselines, allowed);

  // 세 계열의 길이를 항상 같게 맞춥니다. 값이 없는 시간대는 null 로 남겨
  // 그래프에서 선을 끊어 그리고, 있지도 않은 값을 이어 붙이지 않습니다.
  const trends: Record<
    string,
    { labels: string[]; temperature: (number | null)[]; h2: (number | null)[]; ch4: (number | null)[] }
  > = {};
  // 최근 24시간을 1시간 칸 24개로 고정합니다. 값이 없는 시간은 null 로 두어 선을 끊습니다.
  // 시각 표기는 한국 시각입니다 (서버 시계는 UTC).
  const HOUR = 3_600_000;
  const lastSlot = Math.floor(Date.now() / HOUR) * HOUR;
  const slots = Array.from({ length: 24 }, (_, i) => lastSlot - (23 - i) * HOUR);
  const slotLabels = slots.map((t) => `${kstParts(new Date(t)).hour}시`);
  const byDevice = new Map<string, Map<number, TrendRow>>();
  for (const row of trendRows) {
    const map = byDevice.get(row.device_id) ?? new Map<number, TrendRow>();
    map.set(new Date(row.bucket).getTime(), row);
    byDevice.set(row.device_id, map);
  }
  for (const [deviceId, map] of byDevice) {
    trends[deviceId] = {
      labels: slotLabels,
      temperature: slots.map((t) => round1(map.get(t)?.temperature ?? null)),
      h2: slots.map((t) => round1(map.get(t)?.h2 ?? null)),
      ch4: slots.map((t) => round1(map.get(t)?.ch4 ?? null)),
    };
  }

  const alarms24h = await one<{ count: number }>(
    allowed === null
      ? `SELECT count(*)::int AS count FROM alarm_events WHERE created_at > now() - interval '24 hours' AND level <> 'normal'`
      : `SELECT count(*)::int AS count FROM alarm_events
          WHERE created_at > now() - interval '24 hours' AND level <> 'normal' AND device_id = ANY($1)`,
    allowed === null ? [] : [allowed]
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

  const bridgeId = body.bridge_id ? String(body.bridge_id) : null;

  // 연결 방식. 앞단(브릿지·PC)을 고르지 않았으면 모듈 직결입니다.
  let linkType: LinkType = "direct";
  if (bridgeId) {
    const parent = await one<{ kind: string; max_devices: number; used: number }>(
      `SELECT kind, max_devices,
              (SELECT count(*)::int FROM devices d WHERE d.bridge_id = b.bridge_id) AS used
         FROM bridges b WHERE b.bridge_id = $1`,
      [bridgeId]
    );
    if (!parent) {
      return NextResponse.json({ error: "선택한 브릿지/게이트웨이를 찾을 수 없습니다." }, { status: 400 });
    }
    // RS-485 한 가닥의 수용 한도입니다 (헤디 회신 기준 32대).
    const limit = parent.max_devices || RS485_MAX_DEVICES;
    if (parent.used >= limit) {
      return NextResponse.json(
        { error: `${bridgeId} 에 이미 ${parent.used}대가 등록되어 수용 한도 ${limit}대를 채웠습니다.` },
        { status: 409 }
      );
    }
    linkType = parent.kind === "gateway" ? "gateway" : "bridge";
  }

  // 숫자형 device_id 중 가장 큰 값 + 1
  const next = await one<{ next_id: number }>(
    `SELECT COALESCE(max(NULLIF(regexp_replace(device_id, '\\D', '', 'g'), '')::int), 0) + 1 AS next_id
       FROM devices`
  );
  const deviceId = String(next?.next_id ?? 1);

  await execute(
    `INSERT INTO devices (device_id, name, building, capacity, bridge_id, slave_addr, sort_order, link_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      deviceId,
      name,
      building,
      String(body.capacity ?? "").trim() || "3상 500kVA",
      bridgeId,
      body.slave_addr != null ? Number(body.slave_addr) : null,
      Number(next?.next_id ?? 1),
      linkType,
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

/** 설비의 소속 고객사 지정 (관리자 전용). company_id 가 없으면 소속 해제. */
export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const deviceId = String(body?.device_id ?? "").trim();
  if (!deviceId) return NextResponse.json({ error: "설비를 지정하세요." }, { status: 400 });

  // 보낸 항목만 고칩니다.
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, v: unknown) => {
    values.push(v);
    sets.push(`${col} = $${values.length}`);
  };
  if (body && "company_id" in body) set("company_id", body.company_id ? Number(body.company_id) : null);
  if (body && "site_id" in body) set("site_id", body.site_id ? Number(body.site_id) : null);
  if (body && "model" in body) {
    if (!["3형", "4형"].includes(body.model)) {
      return NextResponse.json({ error: "형식은 3형 또는 4형입니다." }, { status: 400 });
    }
    set("model", body.model);
  }
  if (body && "place" in body) set("place", String(body.place ?? "").trim().slice(0, 100));
  let tempLimit: number | null | undefined;
  if (body && "temp_limit" in body) {
    tempLimit = body.temp_limit === null || body.temp_limit === "" ? null : Number(body.temp_limit);
    if (tempLimit !== null && (!Number.isFinite(tempLimit) || tempLimit <= 0 || tempLimit > 150)) {
      return NextResponse.json({ error: "온도 기준은 0 초과 150 이하로 입력하세요." }, { status: 400 });
    }
    set("temp_limit", tempLimit);
  }
  if (!sets.length) return NextResponse.json({ error: "변경할 항목이 없습니다." }, { status: 400 });

  const before = await one<{ name: string; temp_limit: number | null }>(
    `SELECT name, temp_limit FROM devices WHERE device_id = $1`,
    [deviceId]
  );
  if (!before) return NextResponse.json({ error: "설비를 찾을 수 없습니다." }, { status: 404 });

  values.push(deviceId);
  await execute(`UPDATE devices SET ${sets.join(", ")} WHERE device_id = $${values.length}`, values);

  // 온도 기준 변경은 이벤트 이력에 남깁니다.
  if (tempLimit !== undefined && tempLimit !== before.temp_limit) {
    const fmt = (v: number | null) => (v === null ? "공통 기준" : `${v} ℃`);
    await execute(
      `INSERT INTO alarm_events (device_id, unit, item, level, detail, status, kind, note)
       VALUES ($1, $2, '온도 기준 변경', 'normal', $3, 'info', 'admin', $4)`,
      [deviceId, before.name, `${fmt(before.temp_limit)} → ${fmt(tempLimit)}`, admin.full_name || admin.email]
    );
  }
  return NextResponse.json({ ok: true });
}
