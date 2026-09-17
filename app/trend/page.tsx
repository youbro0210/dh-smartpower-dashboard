"use client";

import { useState } from "react";
import { useDashboard } from "@/lib/configStore";
import PageHeader from "@/components/PageHeader";
import Sparkline from "@/components/Sparkline";
import { STATUS_LABEL } from "@/lib/types";

function stats(series: number[] | undefined) {
  if (!series || series.length === 0) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const avg = series.reduce((a, b) => a + b, 0) / series.length;
  return { min, max, avg, first: series[0], last: series[series.length - 1] };
}

export default function TrendPage() {
  const { devices, refresh, loading } = useDashboard();
  const [metric, setMetric] = useState<"temperature" | "h2">("temperature");

  const unit = metric === "temperature" ? "℃" : "ppm";
  const label = metric === "temperature" ? "절연유 온도" : "수소가스";

  return (
    <>
      <PageHeader
        title="추세 분석"
        breadcrumb="홈 › 추세 분석"
        subtitle="최근 24시간 계측 이력을 시간 단위로 집계한 실측값입니다"
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
          onChange={(e) => setMetric(e.target.value as "temperature" | "h2")}
        >
          <option value="temperature">절연유 온도 (℃)</option>
          <option value="h2">수소가스 (ppm)</option>
        </select>
        <span className="filter-label" style={{ marginLeft: 8 }}>
          빨강 = 온도, 청록 = 수소가스
        </span>
      </div>

      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            설비별 {label} 추세
          </div>
          <span className="card-note">{devices.length}대</span>
        </div>

        <div style={{ overflowX: "auto" }}>
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
                const current = metric === "temperature" ? d.temperature : d.h2;
                const change = s ? Number((s.last - s.first).toFixed(1)) : null;
                return (
                  <tr key={d.device_id}>
                    <td>
                      <b>{d.name}</b>
                    </td>
                    <td>{d.building}</td>
                    <td>
                      <span className={`badge ${d.status}`}>{STATUS_LABEL[d.status]}</span>
                    </td>
                    <td>
                      <Sparkline trend={d.trend} />
                    </td>
                    <td className="num">
                      {current.toFixed(1)}
                      <span style={{ color: "var(--faint)", fontSize: 10.5 }}> {unit}</span>
                    </td>
                    <td className="num">{s ? s.min.toFixed(1) : "-"}</td>
                    <td className="num">{s ? s.avg.toFixed(1) : "-"}</td>
                    <td className="num">{s ? s.max.toFixed(1) : "-"}</td>
                    <td className="num">
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

      <div className="note">
        계측 이력이 쌓이기 전에는 추세가 표시되지 않습니다. 수집 서버가 telemetry 테이블에
        데이터를 적재하면 자동으로 채워집니다.
      </div>
    </>
  );
}
