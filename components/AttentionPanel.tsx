"use client";

import { useMemo, useState } from "react";
import {
  AlarmEvent,
  DeviceEvaluated,
  SensorKey,
  SeverityLevel,
  STATUS_LABEL,
  ThresholdConfig,
} from "@/lib/types";
import TrendChart, { MetricKey } from "./TrendChart";

const GUIDANCE: Record<string, string> = {
  danger: "즉시 현장 점검과 절연유 상태 확인이 필요합니다. 필요 시 부하를 낮추고 담당자에게 보고하세요.",
  warning: "현장 점검을 권장합니다. 30분 간격으로 추이를 재확인하세요.",
  caution: "아직 조치 단계는 아니며, 추이를 지속 관찰하세요.",
  offline: "계측값이 들어오지 않고 있습니다. 브릿지 전원과 통신 상태를 확인하세요.",
  normal: "",
};

const LEVEL_COLOR: Record<string, string> = {
  normal: "var(--normal)",
  caution: "var(--caution)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  offline: "var(--offline)",
};

interface SensorSpec {
  key: SensorKey;
  label: string;
  unit: string;
  metric?: MetricKey;
}

const SENSORS: SensorSpec[] = [
  { key: "h2", label: "수소가스 (H₂)", unit: "ppm", metric: "h2" },
  { key: "ch4", label: "메탄가스 (CH₄)", unit: "ppm", metric: "ch4" },
  { key: "temperature", label: "절연유 온도", unit: "℃", metric: "temperature" },
  { key: "oil_level", label: "절연유 유면", unit: "" },
];

function ratio(value: number, danger: number) {
  if (!Number.isFinite(danger) || danger <= 0) return 0;
  return Math.max(0, Math.min(1, value / danger));
}

function deltaText(current: number, baseline: number | undefined) {
  if (baseline === undefined || baseline === null || !Number.isFinite(baseline)) {
    return <span className="flat">24시간 전 기준 없음</span>;
  }
  const diff = Number((current - baseline).toFixed(1));
  if (Math.abs(diff) < 0.1) return <span className="flat">24시간 전과 동일</span>;
  return diff > 0 ? (
    <span className="up">▲ +{diff} (24시간)</span>
  ) : (
    <span className="down">▼ {diff} (24시간)</span>
  );
}

/**
 * 주의 이상으로 판정된 변압기만 모아 상세 상태·측정값·24시간 추세를
 * 클릭 없이 바로 보여줍니다. 운전원이 가장 먼저 봐야 할 화면입니다.
 */
export default function AttentionPanel({
  devices,
  alarms,
  thresholds,
}: {
  devices: DeviceEvaluated[];
  alarms: AlarmEvent[];
  thresholds: ThresholdConfig;
}) {
  const ranked = useMemo(() => {
    const order: Record<string, number> = { danger: 0, warning: 1, caution: 2, offline: 3 };
    return devices
      .filter((d) => d.status !== "normal")
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));
  }, [devices]);

  // 기본은 모두 펼침. 대상이 많으면 가장 심각한 2대만 펼쳐 화면이 길어지지 않게 합니다.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [touched, setTouched] = useState(false);
  const autoCollapsed = !touched && ranked.length > 3 ? new Set(ranked.slice(2).map((d) => d.device_id)) : collapsed;
  const isOpen = (id: string) => !autoCollapsed.has(id);

  function toggle(id: string) {
    const next = new Set(autoCollapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTouched(true);
    setCollapsed(next);
  }

  if (ranked.length === 0) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            주의 이상 변압기 상세
          </div>
        </div>
        <div className="all-clear">
          <span className="all-clear-mark">✓</span>
          <div>
            <b>전체 {devices.length}대 모두 정상 범위입니다.</b>
            <div className="hint" style={{ marginTop: 4 }}>
              주의·경고·위험으로 판정된 변압기가 나타나면 이 자리에 측정값과 24시간 추세가 함께
              표시됩니다.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <span className="accent-bar" />
          주의 이상 변압기 상세
        </div>
        <span className="card-note">
          {ranked.length}대 · 심각도 순 · 제목을 누르면 접거나 펼칩니다
        </span>
      </div>

      <div className="attn-list">
        {ranked.map((d) => {
          const open = isOpen(d.device_id);
          const related = alarms.filter((a) => a.device_id === d.device_id || a.unit === d.name);
          const worst = (Object.entries(d.sensorLevels) as [SensorKey, SeverityLevel][])
            .filter(([, lvl]) => lvl !== "normal")
            .map(([key]) => key);
          const chartMetric: MetricKey =
            worst.includes("h2")
              ? "h2"
              : worst.includes("ch4")
                ? "ch4"
                : worst.includes("temperature")
                  ? "temperature"
                  : "temperature";

          return (
            <section className={`attn ${d.status}`} key={d.device_id}>
              <button
                type="button"
                className="attn-head"
                onClick={() => toggle(d.device_id)}
              >
                <span className={`badge ${d.status}`}>{STATUS_LABEL[d.status]}</span>
                <span className="attn-name">{d.name}</span>
                <span className="attn-meta">
                  {d.building} · {d.capacity}
                  {d.bridge_id ? ` · ${d.bridge_id}` : ""}
                </span>
                <span className="attn-spacer" />
                <span className="attn-since">
                  {d.since === "-"
                    ? "판정 시각 없음"
                    : `${new Date(d.since).toLocaleString("ko-KR", { hour12: false })} 판정`}
                </span>
                <span className="attn-toggle">{open ? "접기 ▲" : "펼치기 ▼"}</span>
              </button>

              <div className={`attn-reason ${d.status}`}>
                <b>{d.causes.length ? d.causes.join(" · ") : "복합 판정에 의한 등급"}</b>
                <span>{GUIDANCE[d.status]}</span>
              </div>

              {open && (
                <div className="attn-body">
                  <div className="gauge-grid">
                    {SENSORS.map((s) => {
                      const level = d.sensorLevels[s.key];
                      const color = LEVEL_COLOR[level];

                      if (s.key === "oil_level") {
                        const low = d.oil_level === "낮음";
                        return (
                          <div className={`gauge ${low ? "danger" : "normal"}`} key={s.key}>
                            <div className="gauge-lbl">{s.label}</div>
                            <div className="gauge-val" style={{ color: low ? "var(--danger)" : undefined }}>
                              {d.oil_level}
                            </div>
                            <div className="gauge-bar">
                              <span
                                style={{
                                  width: low ? "35%" : "100%",
                                  background: low ? "var(--danger)" : "var(--normal)",
                                }}
                              />
                            </div>
                            <div className="gauge-foot">
                              {low ? "기준 유면 아래 — 누유 여부 확인" : "기준 유면 유지"}
                            </div>
                          </div>
                        );
                      }

                      const rule = thresholds[s.key as "h2" | "ch4" | "temperature"];
                      const value =
                        s.key === "h2" ? d.h2 : s.key === "ch4" ? d.ch4 : d.temperature;
                      const base =
                        s.key === "h2"
                          ? d.baseline?.h2
                          : s.key === "ch4"
                            ? d.baseline?.ch4
                            : d.baseline?.temperature;

                      return (
                        <div className={`gauge ${level}`} key={s.key}>
                          <div className="gauge-lbl">
                            {s.label}
                            <span className={`mini-badge ${level}`}>{STATUS_LABEL[level]}</span>
                          </div>
                          <div className="gauge-val" style={{ color: level === "normal" ? undefined : color }}>
                            {value.toFixed(1)}
                            <small>{s.unit}</small>
                          </div>
                          <div className="gauge-bar">
                            <span style={{ width: `${ratio(value, rule.danger) * 100}%`, background: color }} />
                            <i className="tick caution" style={{ left: `${ratio(rule.caution, rule.danger) * 100}%` }} />
                            <i className="tick warning" style={{ left: `${ratio(rule.warning, rule.danger) * 100}%` }} />
                          </div>
                          <div className="gauge-foot">
                            기준 주의 {rule.caution} · 경고 {rule.warning} · 위험 {rule.danger} {s.unit}
                          </div>
                          <div className="gauge-delta">{deltaText(value, base)}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="attn-split">
                    <div>
                      <div className="spark-title">최근 24시간 추세</div>
                      <TrendChart
                        trend={d.trend}
                        metrics={[chartMetric, ...(["temperature", "h2", "ch4"] as MetricKey[]).filter((m) => m !== chartMetric)]}
                        rule={{
                          metric: chartMetric,
                          caution: thresholds[chartMetric].caution,
                          warning: thresholds[chartMetric].warning,
                          danger: thresholds[chartMetric].danger,
                        }}
                      />
                    </div>
                    <div>
                      <div className="spark-title">이 변압기의 최근 알람</div>
                      {related.length === 0 ? (
                        <div className="empty" style={{ padding: "18px 0" }}>
                          기록된 알람이 없습니다.
                        </div>
                      ) : (
                        related.slice(0, 6).map((a, i) => (
                          <div className="alarm-item" key={a.id ?? i}>
                            <span className="time">{a.time}</span>
                            <span>
                              {a.item}
                              {a.detail && <span className="chip">{a.detail}</span>}
                            </span>
                            <span className="lvl" style={{ color: LEVEL_COLOR[a.level] }}>
                              {STATUS_LABEL[a.level]}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
