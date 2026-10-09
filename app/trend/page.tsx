"use client";

import { useState } from "react";
import { useDashboard } from "@/lib/configStore";
import PageHeader from "@/components/PageHeader";
import Sparkline from "@/components/Sparkline";
import { METRIC_META, MetricKey } from "@/components/TrendChart";
import { STATUS_LABEL } from "@/lib/types";

function stats(raw: (number | null)[] | undefined) {
  const series = (raw ?? []).filter((v): v is number => v !== null && Number.isFinite(v));
  if (series.length === 0) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const avg = series.reduce((a, b) => a + b, 0) / series.length;
  return { min, max, avg, first: series[0], last: series[series.length - 1] };
}

export default function TrendPage() {
  const { devices, refresh, loading } = useDashboard();
  const [metric, setMetric] = useState<MetricKey>("temperature");

  const unit = METRIC_META[metric].unit;
  const label = METRIC_META[metric].label;

  return (
    <>
      <PageHeader
        title="추세 분석"
        breadcrumb="홈 › 추세 분석"
        subtitle="최근 24시간 · 1시간 단위"
        actions={
          <button className="btn primary" onClick={() => void refresh()} disabled={loading}>
            새로고침
          </button>
        }
      />

      <div className="filterbar">
        <span className="filter-label">지표</span>
        <select
          className="field"
          value={metric}
          onChange={(e) => setMetric(e.target.value as MetricKey)}
        >
          <option value="temperature">절연유 온도 (℃)</option>
          <option value="h2">수소가스 (ppm)</option>
          <option value="ch4">메탄가스 (ppm)</option>
        </select>
      </div>

      <div className="card flush trend-table">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            설비별 {label} 추세
          </div>
          <span className="chart-legend">
            <span>
              <i className="legend-swatch" style={{ background: "#1f3a5f" }} />
              온도
            </span>
            <span>
              <i className="legend-swatch" style={{ background: "#8aa4c8" }} />
              수소가스
            </span>
            <span className="card-note">{devices.length}대</span>
          </span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>설비명</th>
                <th>위치</th>
                <th>상태</th>
                <th style={{ width: 240 }}>최근 24시간</th>
                <th className="num">현재</th>
                <th className="num">최저</th>
                <th className="num">평균</th>
                <th className="num">최고</th>
                <th className="num">변화</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty">등록된 설비가 없습니다.</div>
                  </td>
                </tr>
              )}
              {devices.map((d) => {
                const s = stats(d.trend?.[metric]);
                const current =
                  metric === "temperature" ? d.temperature : metric === "h2" ? d.h2 : d.ch4;
                const change = s ? Number((s.last - s.first).toFixed(1)) : null;
                return (
                  <tr key={d.device_id}>
                    <td className="t-name">
                      <b>{d.name}</b>
                    </td>
                    <td className="t-where">{d.building}</td>
                    <td className="center t-status">
                      <span className={`badge ${d.status}`}>{STATUS_LABEL[d.status]}</span>
                    </td>
                    <td className="t-spark">
                      <Sparkline trend={d.trend} />
                    </td>
                    <td className="num t-stat" data-label="현재">
                      {current.toFixed(1)}
                      <span style={{ color: "var(--faint)", fontSize: 12 }}> {unit}</span>
                    </td>
                    <td className="num t-stat" data-label="최저">{s ? s.min.toFixed(1) : "-"}</td>
                    <td className="num t-stat" data-label="평균">{s ? s.avg.toFixed(1) : "-"}</td>
                    <td className="num t-stat" data-label="최고">{s ? s.max.toFixed(1) : "-"}</td>
                    <td className="num t-stat t-change" data-label="변화">
                      {change === null ? (
                        <span className="flat">-</span>
                      ) : change > 0.1 ? (
                        <span className="up">▲ +{change}</span>
                      ) : change < -0.1 ? (
                        <span className="down">▼ {change}</span>
                      ) : (
                        <span className="flat">변화 없음</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </>
  );
}
