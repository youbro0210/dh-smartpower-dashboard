import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 절연지 열화 — IEEE C57.91 (Clause 5) 의 노화 가속 계수.
 *
 *   F_AA = exp( 15000/383 − 15000/(θ_H + 273) )
 *
 * θ_H 는 권선 최고점(hot-spot) 온도로, 기준 110 ℃ 에서 F_AA = 1 (정상 수명 속도)입니다.
 * 이 시스템은 상부 절연유 온도만 재므로 θ_H = 유온 + 최고점 온도차(관리자가 정하는 값)로
 * 어림합니다. 부하 전류를 재지 않으므로 '부하에 따라 변하는 온도차'는 반영하지 못합니다.
 *
 * 기간 중 등가 노화(F_EQA)는 측정 간격으로 가중한 F_AA 의 평균이고,
 * 수명 소비 시간 = F_EQA × 경과 시간, 수명 손실률 = 소비 시간 / 정상 수명(180,000 h).
 */
const NORMAL_LIFE_HOURS = 180_000;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const days = Math.min(365, Math.max(1, parseInt(params.get("days") ?? "30", 10) || 30));
  const gradient = Math.min(40, Math.max(0, Number(params.get("gradient") ?? "20") || 0));

  // 측정값 사이 간격(시간)으로 가중합니다. 통신이 끊긴 구간(간격 30분 초과)은
  // 그 구간의 온도를 알 수 없으므로 계산에서 뺍니다.
  const rows = await query<{
    device_id: string;
    name: string;
    building: string;
    hours: number;
    faa_avg: number | null;
    faa_max: number | null;
    temp_avg: number | null;
    temp_max: number | null;
    hours_over_98: number;
    hours_over_110: number;
  }>(
    `WITH t AS (
       SELECT device_id, temperature, measured_at,
              EXTRACT(EPOCH FROM (lead(measured_at) OVER w - measured_at)) / 3600.0 AS dt
         FROM telemetry
        WHERE measured_at >= now() - ($1 || ' days')::interval
          AND temperature IS NOT NULL
       WINDOW w AS (PARTITION BY device_id ORDER BY measured_at)
     ), f AS (
       SELECT device_id, temperature, dt,
              exp(15000.0/383 - 15000.0/(temperature + $2 + 273)) AS faa
         FROM t
        WHERE dt IS NOT NULL AND dt > 0 AND dt <= 0.5
     )
     SELECT d.device_id, d.name, d.building,
            COALESCE(sum(f.dt), 0)::float                          AS hours,
            (sum(f.faa * f.dt) / NULLIF(sum(f.dt), 0))::float      AS faa_avg,
            max(f.faa)::float                                      AS faa_max,
            (sum(f.temperature * f.dt) / NULLIF(sum(f.dt), 0))::float AS temp_avg,
            max(f.temperature)::float                              AS temp_max,
            COALESCE(sum(f.dt) FILTER (WHERE f.temperature + $2 >= 98), 0)::float  AS hours_over_98,
            COALESCE(sum(f.dt) FILTER (WHERE f.temperature + $2 >= 110), 0)::float AS hours_over_110
       FROM devices d
       LEFT JOIN f ON f.device_id = d.device_id
      GROUP BY d.device_id, d.name, d.building, d.sort_order
      ORDER BY d.sort_order, d.device_id`,
    [String(days), gradient]
  );

  const devices = rows.map((r) => {
    const consumed = r.faa_avg !== null ? r.faa_avg * r.hours : null;
    return {
      ...r,
      consumed_hours: consumed,
      loss_pct: consumed !== null ? (consumed / NORMAL_LIFE_HOURS) * 100 : null,
      // 지금 속도가 계속되면 정상 수명 180,000 h 를 몇 년에 다 쓰는가
      years_at_rate: r.faa_avg ? NORMAL_LIFE_HOURS / r.faa_avg / 8760 : null,
    };
  });

  return NextResponse.json({ days, gradient, normalLifeHours: NORMAL_LIFE_HOURS, devices });
}
