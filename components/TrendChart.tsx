"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DeviceTrend, ThresholdRule } from "@/lib/types";

export type MetricKey = "temperature" | "h2" | "ch4";

export const METRIC_META: Record<
  MetricKey,
  { label: string; short: string; unit: string; color: string }
> = {
  temperature: { label: "절연유 온도", short: "온도", unit: "℃", color: "#c0392b" },
  h2: { label: "수소가스 (H₂)", short: "수소", unit: "ppm", color: "#2e5aac" },
  ch4: { label: "메탄가스 (CH₄)", short: "메탄", unit: "ppm", color: "#1c7c54" },
};

interface Props {
  trend?: DeviceTrend;
  /** 그릴 계열. 생략하면 세 계열을 모두 그립니다. */
  metrics?: MetricKey[];
  /** 임계선을 함께 그릴 계열과 기준값 */
  rule?: { metric: MetricKey; caution: number; warning: number; danger: number } | null;
  height?: number;
}

const PAD = { top: 14, right: 16, bottom: 28, left: 44 };
const DEFAULT_WIDTH = 720;
const MIN_WIDTH = 280;

/** null 을 건너뛰며 연속 구간별로 path 를 만듭니다. 값이 끊긴 곳은 선도 끊깁니다. */
function segments(series: (number | null)[]): { i: number; v: number }[][] {
  const out: { i: number; v: number }[][] = [];
  let current: { i: number; v: number }[] = [];
  series.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (current.length) out.push(current);
      current = [];
    } else {
      current.push({ i, v });
    }
  });
  if (current.length) out.push(current);
  return out;
}

function niceScale(min: number, max: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const mult = [1, 2, 2.5, 5, 10].find((m) => span / (step * m) <= 5) ?? 10;
  const unit = step * mult;
  const lo = Math.floor(min / unit) * unit;
  const hi = Math.ceil(max / unit) * unit;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + unit / 2; t += unit) ticks.push(Number(t.toFixed(6)));
  return { lo, hi, ticks };
}

/**
 * 최근 24시간 추세 그래프.
 * 계열마다 단위가 달라 같은 축에 겹치면 읽을 수 없으므로,
 * 한 번에 한 계열만 그리고 버튼으로 전환합니다.
 */
export default function TrendChart({ trend, metrics, rule, height = 190 }: Props) {
  const available = useMemo(() => {
    const keys: MetricKey[] = metrics ?? ["temperature", "h2", "ch4"];
    return keys.filter((k) => (trend?.[k] ?? []).some((v) => v !== null && Number.isFinite(v)));
  }, [trend, metrics]);

  const [active, setActive] = useState<MetricKey | null>(null);
  const metric = active && available.includes(active) ? active : available[0];
  const clipId = useId().replace(/:/g, "");

  // viewBox 폭을 실제 그려지는 폭과 같게 맞춥니다.
  // 그래야 축 글자가 화면 크기에 따라 줄어들지 않고 지정한 크기 그대로 보입니다.
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const apply = () => {
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setWidth(Math.max(MIN_WIDTH, Math.round(inner)));
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!trend || available.length === 0) {
    return <div className="chart-empty">최근 24시간 누적된 계측 이력이 없습니다.</div>;
  }

  const series = trend[metric];
  const labels = trend.labels ?? [];
  const meta = METRIC_META[metric];
  const showRule = rule && rule.metric === metric ? rule : null;

  const values = series.filter((v): v is number => v !== null && Number.isFinite(v));
  const marks = showRule ? [showRule.caution, showRule.warning, showRule.danger] : [];
  const { lo, hi, ticks } = niceScale(
    Math.min(...values, ...(marks.length ? [marks[0]] : [])),
    Math.max(...values, ...(marks.length ? [marks[2]] : []))
  );

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (series.length <= 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  const baseY = (PAD.top + plotH).toFixed(1);
  const paths = segments(series).map((seg) => {
    const line = seg
      .map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join(" ");
    const x0 = x(seg[0].i).toFixed(1);
    const x1 = x(seg[seg.length - 1].i).toFixed(1);
    return { line, fill: `${line} L${x1},${baseY} L${x0},${baseY} Z` };
  });

  // 라벨이 겹치지 않도록 일정 간격으로만 표시합니다.
  const maxLabels = Math.max(3, Math.floor(plotW / 58));
  const labelStep = Math.max(1, Math.ceil(series.length / maxLabels));
  const last = [...series].reverse().find((v) => v !== null && Number.isFinite(v)) as number | undefined;

  return (
    <div className="chart" ref={boxRef}>
      <div className="chart-bar">
        <div className="chart-tabs">
          {available.map((k) => (
            <button
              key={k}
              type="button"
              className={`chart-tab${k === metric ? " active" : ""}`}
              onClick={() => setActive(k)}
            >
              <span className="chart-swatch" style={{ background: METRIC_META[k].color }} />
              {METRIC_META[k].short}
            </button>
          ))}
        </div>
        {last !== undefined && (
          <span className="chart-last">
            최근 1시간 평균 <b style={{ color: meta.color }}>{last.toFixed(1)}</b> {meta.unit}
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`최근 24시간 ${meta.label} 추세`}
      >
        <defs>
          <clipPath id={`clip-${clipId}`}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
          <linearGradient id={`fill-${clipId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={meta.color} stopOpacity="0.16" />
            <stop offset="100%" stopColor={meta.color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--line-soft)"
              strokeWidth="1"
            />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="chart-axis">
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}

        {showRule &&
          (
            [
              ["caution", showRule.caution, "var(--caution)"],
              ["warning", showRule.warning, "var(--warning)"],
              ["danger", showRule.danger, "var(--danger)"],
            ] as const
          ).map(([name, value, color]) =>
            value >= lo && value <= hi ? (
              <g key={name}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke={color}
                  strokeWidth="1"
                  strokeDasharray="5 4"
                  opacity="0.75"
                />
                <text x={width - PAD.right} y={y(value) - 4} textAnchor="end" className="chart-rule" fill={color}>
                  {name === "caution" ? "주의" : name === "warning" ? "경고" : "위험"} {value}
                </text>
              </g>
            ) : null
          )}

        {labels.map((label, i) =>
          i % labelStep === 0 || i === labels.length - 1 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="chart-axis">
              {label}
            </text>
          ) : null
        )}

        <g clipPath={`url(#clip-${clipId})`}>
          {paths.map((p, i) => (
            <path key={`fill-${i}`} d={p.fill} fill={`url(#fill-${clipId})`} stroke="none" />
          ))}
          {paths.map((p, i) => (
            <path
              key={`line-${i}`}
              d={p.line}
              fill="none"
              stroke={meta.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </g>

        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="var(--line)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}
