"use client";

import { useMemo, useState } from "react";
import { useDashboard } from "@/lib/configStore";
import PageHeader from "@/components/PageHeader";
import DeviceTable from "@/components/DeviceTable";
import { DeviceStatus, STATUS_LABEL } from "@/lib/types";

export default function DevicesPage() {
  const { devices, bridges, alarms, thresholds, refresh, loading } = useDashboard();

  const [statusFilter, setStatusFilter] = useState<DeviceStatus | "all">("all");
  const [bridgeFilter, setBridgeFilter] = useState("all");
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const key = keyword.trim();
    return devices.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (bridgeFilter !== "all" && d.bridge_id !== bridgeFilter) return false;
      if (key && !`${d.name}${d.building}${d.capacity}`.includes(key)) return false;
      return true;
    });
  }, [devices, statusFilter, bridgeFilter, keyword]);

  const online = filtered.filter((d) => d.status !== "offline");
  const temps = online.map((d) => d.temperature);
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const gasExceed = online.filter(
    (d) => d.h2 >= thresholds.h2.warning || d.ch4 >= thresholds.ch4.warning
  ).length;

  return (
    <>
      <PageHeader
        title="설비 현황"
        breadcrumb="홈 › 설비 현황"
        subtitle={`등록 설비 ${devices.length}대 · 조회 결과 ${filtered.length}대`}
        actions={
          <button className="btn primary" onClick={() => void refresh()} disabled={loading}>
            새로고침
          </button>
        }
      />

      <div className="filterbar">
        <span className="filter-label">상태</span>
        <select
          className="field"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DeviceStatus | "all")}
        >
          <option value="all">전체</option>
          {(["normal", "caution", "warning", "danger", "offline"] as DeviceStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>

        <span className="filter-label">브릿지</span>
        <select
          className="field"
          value={bridgeFilter}
          onChange={(e) => setBridgeFilter(e.target.value)}
        >
          <option value="all">전체</option>
          {bridges.map((b) => (
            <option key={b.bridge_id} value={b.bridge_id}>
              {b.name}
            </option>
          ))}
        </select>

        <span className="filter-label">설비</span>
        <input
          className="field"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="이름, 위치, 용량"
        />

        <div className="filterbar-right">
          <button
            className="btn"
            onClick={() => {
              setStatusFilter("all");
              setBridgeFilter("all");
              setKeyword("");
            }}
          >
            초기화
          </button>
          <button className="btn primary" onClick={() => void refresh()}>
            조회
          </button>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-label">조회 설비</div>
          <div className="kpi-value">
            {filtered.length}
            <small>대</small>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">평균 온도</div>
          <div className="kpi-value">
            {avg(temps).toFixed(1)}
            <small>℃</small>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">평균 수소</div>
          <div className="kpi-value">
            {avg(online.map((d) => d.h2)).toFixed(1)}
            <small>ppm</small>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">평균 메탄</div>
          <div className="kpi-value">
            {avg(online.map((d) => d.ch4)).toFixed(1)}
            <small>ppm</small>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">가스 기준 초과</div>
          <div className="kpi-value warning">{gasExceed}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">유면 낮음</div>
          <div className="kpi-value warning">
            {online.filter((d) => d.oil_level === "낮음").length}
          </div>
        </div>
      </div>

      <DeviceTable devices={filtered} alarms={alarms} total={devices.length} />
    </>
  );
}
