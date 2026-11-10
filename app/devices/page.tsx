"use client";

import { useMemo, useState } from "react";
import { useDashboard } from "@/lib/configStore";
import PageHeader from "@/components/PageHeader";
import DeviceTable from "@/components/DeviceTable";
import { DeviceEvaluated, DeviceStatus, STATUS_LABEL } from "@/lib/types";

export default function DevicesPage() {
  const { devices, bridges, alarms, thresholds, refresh, loading } = useDashboard();

  const [statusFilter, setStatusFilter] = useState<DeviceStatus | "all">("all");
  const [bridgeFilter, setBridgeFilter] = useState("all");
  const [keyword, setKeyword] = useState("");

  // 조회 버튼을 누른 시점의 조건을 저장합니다. 조회 전에는 표를 비워 둡니다.
  const [applied, setApplied] = useState<{ status: DeviceStatus | "all"; bridge: string; key: string } | null>(null);

  const filtered = useMemo<DeviceEvaluated[]>(() => {
    if (!applied) return [];
    const key = applied.key.trim();
    return devices.filter((d) => {
      if (applied.status !== "all" && d.status !== applied.status) return false;
      if (applied.bridge !== "all" && d.bridge_id !== applied.bridge) return false;
      if (key && !`${d.name}${d.building}${d.capacity}`.includes(key)) return false;
      return true;
    });
  }, [devices, applied]);

  const search = async () => {
    await refresh();
    setApplied({ status: statusFilter, bridge: bridgeFilter, key: keyword });
  };

  const online = filtered.filter((d) => d.status !== "offline");
  const temps = online.map((d) => d.temperature);
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const show = (v: number | null, unit: string) => (v === null ? "-" : `${v.toFixed(1)}${unit}`);
  const gasExceed = online.filter(
    (d) => d.h2 >= thresholds.h2.warning || d.ch4 >= thresholds.ch4.warning
  ).length;

  return (
    <>
      <PageHeader
        title="설비 현황"
        breadcrumb="홈 › 설비 현황"
        subtitle={`등록 설비 ${devices.length}대${applied ? ` · 조회 결과 ${filtered.length}대` : ""}`}
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
          <button className="btn primary" onClick={() => void search()} disabled={loading}>
            조회
          </button>
        </div>
      </div>

      <table className="grid compact summary-strip" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>조회 설비</th>
            <th>평균 온도</th>
            <th>평균 수소</th>
            <th>평균 메탄</th>
            <th>가스 기준 초과</th>
            <th>유면 낮음</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="num" data-label="조회 설비">{applied ? `${filtered.length}대` : "-"}</td>
            <td className="num" data-label="평균 온도">{show(avg(temps), "℃")}</td>
            <td className="num" data-label="평균 수소">{show(avg(online.map((d) => d.h2)), " ppm")}</td>
            <td className="num" data-label="평균 메탄">{show(avg(online.map((d) => d.ch4)), " ppm")}</td>
            <td className={`num${gasExceed ? " t-warning" : ""}`} data-label="가스 기준 초과">{applied ? `${gasExceed}대` : "-"}</td>
            <td className="num" data-label="유면 낮음">{applied ? `${online.filter((d) => d.oil_level === "낮음").length}대` : "-"}</td>
          </tr>
        </tbody>
      </table>

      <DeviceTable devices={filtered} alarms={alarms} total={devices.length} searched={applied !== null} />
    </>
  );
}
