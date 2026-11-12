import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { query, one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 계측 이력 — telemetry 를 한 건씩 돌려줍니다.
 * 재전송 여부는 측정 시각과 서버 수신 시각의 차이로 가립니다.
 * (설비 전송 주기의 3배, 최소 30초 넘게 늦게 들어온 값 = 재전송)
 */
const REPLAY_SQL = `(t.received_at - t.measured_at) > make_interval(secs => GREATEST(30, COALESCE(d.interval_sec, 60) * 3))`;
const SERIES_MAX = 2000;

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const url = new URL(request.url);
  const device = (url.searchParams.get("device") ?? "").trim();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const kind = url.searchParams.get("kind"); // live | replay
  const pageSize = Math.min(500, Math.max(10, Number(url.searchParams.get("pageSize") ?? 100)));
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));

  const where: string[] = [];
  const args: unknown[] = [];
  if (device) {
    args.push(device);
    where.push(`t.device_id = $${args.length}`);
  }
  if (from) {
    args.push(from);
    where.push(`t.measured_at >= $${args.length}::timestamptz`);
  }
  if (to) {
    args.push(to);
    where.push(`t.measured_at < $${args.length}::timestamptz`);
  }
  // 건수 요약과 차트는 구분과 상관없이 기간 전체 기준입니다.
  const join = `FROM telemetry t LEFT JOIN devices d ON d.device_id = t.device_id`;
  const all = `${join} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;
  if (kind === "replay") where.push(REPLAY_SQL);
  if (kind === "live") where.push(`NOT ${REPLAY_SQL}`);
  const base = `${join} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;

  const pageArgs = [...args, pageSize, (page - 1) * pageSize];
  const [rows, counted, series] = await Promise.all([
    query(
      `SELECT t.id, t.device_id, COALESCE(d.name, t.device_id) AS name,
              t.h2, t.ch4, t.temperature, t.oil_level, t.measured_at, t.received_at,
              EXTRACT(EPOCH FROM (t.received_at - t.measured_at))::float8 AS delay_sec,
              ${REPLAY_SQL} AS replay
         ${base}
        ORDER BY t.measured_at DESC
        LIMIT $${pageArgs.length - 1} OFFSET $${pageArgs.length}`,
      pageArgs
    ),
    one<{ total: number; all_count: number; replay: number }>(
      `SELECT count(*) FILTER (WHERE ${kind === "replay" ? REPLAY_SQL : kind === "live" ? `NOT ${REPLAY_SQL}` : "true"})::int AS total,
              count(*)::int AS all_count,
              count(*) FILTER (WHERE ${REPLAY_SQL})::int AS replay ${all}`,
      args
    ),
    // 차트용: 기간 전체를 시간 순으로. 많으면 고르게 솎아 냅니다.
    query<{ measured_at: string; h2: number | null; ch4: number | null; temperature: number | null }>(
      `SELECT measured_at, h2, ch4, temperature FROM (
         SELECT t.measured_at, t.h2, t.ch4, t.temperature,
                row_number() OVER (ORDER BY t.measured_at) AS rn,
                count(*) OVER () AS n
           ${all}
       ) x
       WHERE n <= ${SERIES_MAX} OR rn % CEIL(n::float8 / ${SERIES_MAX})::int = 0
       ORDER BY measured_at`,
      args
    ),
  ]);

  return NextResponse.json({
    rows,
    total: counted?.total ?? 0,
    allCount: counted?.all_count ?? 0,
    replayCount: counted?.replay ?? 0,
    page,
    pageSize,
    series,
  });
}
