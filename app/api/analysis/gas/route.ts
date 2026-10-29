import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 가스 증가율 — 기간별 선형회귀 기울기(ppm/일).
 *
 * IEEE C57.104-2019 는 증가율을 여러 시료의 선형회귀로 구하도록 하고, 온라인 감시기
 * (Vaisala OPT100, GE Hydran, Qualitrol TM1 등)도 24시간·7일·30일 기울기를 따로 봅니다.
 * 5분 간격 자료이므로 짧은 구간은 잡음이 크고, 긴 구간일수록 판정에 쓸 만합니다.
 */
const WINDOWS = [1, 7, 30] as const;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const parts = WINDOWS.map(
    (d) => `
      regr_slope(t.h2,  EXTRACT(EPOCH FROM t.measured_at) / 86400.0) FILTER (WHERE t.measured_at >= now() - interval '${d} days') AS h2_${d}d,
      regr_slope(t.ch4, EXTRACT(EPOCH FROM t.measured_at) / 86400.0) FILTER (WHERE t.measured_at >= now() - interval '${d} days') AS ch4_${d}d,
      count(*) FILTER (WHERE t.measured_at >= now() - interval '${d} days')::int AS n_${d}d`
  ).join(",");

  const rows = await query<Record<string, number | string | null>>(
    `SELECT d.device_id, d.name, d.building, d.capacity,
            r.h2, r.ch4, r.updated_at,
            avg(t.h2)  FILTER (WHERE t.measured_at >= now() - interval '7 days') AS h2_avg7,
            avg(t.ch4) FILTER (WHERE t.measured_at >= now() - interval '7 days') AS ch4_avg7,
            EXTRACT(EPOCH FROM (max(t.measured_at) - min(t.measured_at))) / 86400.0 AS span_days,
            ${parts}
       FROM devices d
       LEFT JOIN device_readings r ON r.device_id = d.device_id
       LEFT JOIN telemetry t
              ON t.device_id = d.device_id
             AND t.measured_at >= now() - interval '30 days'
      GROUP BY d.device_id, d.name, d.building, d.capacity, d.sort_order, r.h2, r.ch4, r.updated_at
      ORDER BY d.sort_order, d.device_id`
  );

  // pg 는 double precision 을 숫자로, numeric 을 문자열로 줍니다. 모두 숫자로 맞춥니다.
  const devices = rows.map((r) => {
    const out: Record<string, number | string | null> = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] =
        v === null || ["device_id", "name", "building", "capacity", "updated_at"].includes(k)
          ? v
          : Number(v);
    }
    return out;
  });

  return NextResponse.json({ windows: WINDOWS, devices });
}
