import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 측정모듈 전송 주기(분). 통신 프로토콜 정의서 v2 기준 5분.
const SEND_INTERVAL_MIN = 5;

/**
 * 기간 보고서 — 설비별 계측 요약, 수신율, 알람 건수.
 * 날짜는 한국 시각 기준 하루(00:00~24:00)로 자릅니다.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
    return NextResponse.json({ error: "기간을 바르게 입력하세요." }, { status: 400 });
  }

  const range = [from, to];
  const start = `($1::date)::timestamp AT TIME ZONE 'Asia/Seoul'`;
  const end = `($2::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul'`;

  const devices = await query(
    `SELECT d.device_id, d.name, d.building, d.capacity,
            count(t.id)::int                         AS samples,
            round(min(t.h2)::numeric, 1)::float      AS h2_min,
            round(avg(t.h2)::numeric, 1)::float      AS h2_avg,
            round(max(t.h2)::numeric, 1)::float      AS h2_max,
            round(min(t.ch4)::numeric, 1)::float     AS ch4_min,
            round(avg(t.ch4)::numeric, 1)::float     AS ch4_avg,
            round(max(t.ch4)::numeric, 1)::float     AS ch4_max,
            round(min(t.temperature)::numeric, 1)::float AS temp_min,
            round(avg(t.temperature)::numeric, 1)::float AS temp_avg,
            round(max(t.temperature)::numeric, 1)::float AS temp_max,
            count(*) FILTER (WHERE t.oil_level = '낮음')::int AS oil_low
       FROM devices d
       LEFT JOIN telemetry t
              ON t.device_id = d.device_id
             AND t.measured_at >= ${start}
             AND t.measured_at <  ${end}
      GROUP BY d.device_id, d.name, d.building, d.capacity, d.sort_order
      ORDER BY d.sort_order, d.device_id`,
    range
  );

  const alarms = await query<{ device_id: string | null; unit: string; level: string; count: number }>(
    `SELECT device_id, unit, level, count(*)::int AS count
       FROM alarm_events
      WHERE created_at >= ${start} AND created_at < ${end}
      GROUP BY device_id, unit, level`,
    range
  );

  const maintenance = await query(
    `SELECT device_id, unit, to_char(work_date, 'YYYY-MM-DD') AS work_date, kind, title
       FROM maintenance_logs
      WHERE work_date BETWEEN $1::date AND $2::date
      ORDER BY work_date, id`,
    range
  );

  // 기대 수신 건수 — 기간이 오늘을 포함하면 지금까지만 셉니다.
  const expected = await query<{ minutes: number }>(
    `SELECT GREATEST(0, EXTRACT(EPOCH FROM (LEAST(${end}, now()) - ${start})) / 60)::float AS minutes`,
    range
  );
  const expectedSamples = Math.floor((expected[0]?.minutes ?? 0) / SEND_INTERVAL_MIN);

  return NextResponse.json({ from, to, expectedSamples, devices, alarms, maintenance });
}
