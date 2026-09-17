import { DeviceTrend } from "@/lib/types";

function buildPath(raw: (number | null)[], width: number, height: number): string | null {
  const points = raw.filter((v): v is number => v !== null && Number.isFinite(v));
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const top = max + span * 0.15;
  const bottom = min - span * 0.15;
  const range = top - bottom || 1;

  return points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((value - bottom) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * 최근 24시간 추세. telemetry 테이블을 시간 단위로 집계한 실측값이며,
 * 데이터가 없으면 선을 그리지 않고 안내 문구를 표시합니다.
 */
export default function Sparkline({
  trend,
  compact,
}: {
  trend?: DeviceTrend;
  compact?: boolean;
}) {
  const height = compact ? 26 : 70;
  const width = 300;

  const temperaturePath = buildPath(trend?.temperature ?? [], width, height);
  const h2Path = buildPath(trend?.h2 ?? [], width, height);

  if (!temperaturePath && !h2Path) {
    return compact ? (
      <span style={{ fontSize: 11, color: "var(--muted)" }}>-</span>
    ) : (
      <div style={{ fontSize: 12, color: "var(--muted)", padding: "22px 0", textAlign: "center" }}>
        최근 24시간 누적된 계측 이력이 없습니다.
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={compact ? "mini-spark" : undefined}
      role="img"
      aria-label="최근 24시간 온도 및 수소가스 추세"
    >
      {temperaturePath && (
        <path d={temperaturePath} fill="none" stroke="#d93a3a" strokeWidth={compact ? 1.5 : 2} />
      )}
      {h2Path && (
        <path
          d={h2Path}
          fill="none"
          stroke="#0e8f9c"
          strokeWidth={compact ? 1.5 : 2}
          opacity="0.9"
        />
      )}
    </svg>
  );
}
