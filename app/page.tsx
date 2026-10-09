"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/lib/configStore";
import PageHeader from "@/components/PageHeader";
import DeviceTable from "@/components/DeviceTable";
import AttentionPanel from "@/components/AttentionPanel";
import { DeviceStatus, STATUS_LABEL } from "@/lib/types";

const LEVEL_COLOR: Record<string, string> = {
  caution: "var(--caution)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

export default function DashboardPage() {
  const { devices, bridges, thresholds, alarms, alarms24h, connected, loading, error, refresh } =
    useDashboard();

  const [statusFilter, setStatusFilter] = useState<DeviceStatus | "all">("all");
  const [bridgeFilter, setBridgeFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [now, setNow] = useState("");

  useEffect(() => {
    const update = () => setNow(new Date().toLocaleString("ko-KR", { hour12: false }));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const key = keyword.trim();
    return devices.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (bridgeFilter !== "all" && d.bridge_id !== bridgeFilter) return false;
      if (key && !`${d.name}${d.building}${d.capacity}`.includes(key)) return false;
      return true;
    });
  }, [devices, statusFilter, bridgeFilter, keyword]);

  const online = devices.filter((d) => d.status !== "offline");
  const count = (s: DeviceStatus) => devices.filter((d) => d.status === s).length;
  const temps = online.map((d) => d.temperature);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
  const maxTemp = temps.length ? Math.max(...temps) : 0;
  const gasExceed = online.filter(
    (d) => d.h2 >= thresholds.h2.warning || d.ch4 >= thresholds.ch4.warning
  ).length;
  const bridgesOnline = bridges.filter((b) => b.online).length;

  const todos = useMemo(() => {
    const items: { count: number; title: string; desc: string; alert?: boolean }[] = [];
    const critical = devices.filter((d) => d.status === "danger" || d.status === "warning");
    if (critical.length) {
      items.push({
        count: critical.length,
        title: "즉시 확인이 필요한 설비",
        desc: critical.map((d) => `${d.name}(${STATUS_LABEL[d.status]})`).join(", "),
        alert: true,
      });
    }
    const offline = devices.filter((d) => d.status === "offline");
    if (offline.length) {
      items.push({
        count: offline.length,
        title: "통신이 끊긴 설비",
        desc: offline.map((d) => d.name).join(", "),
      });
    }
    const caution = devices.filter((d) => d.status === "caution");
    if (caution.length) {
      items.push({
        count: caution.length,
        title: "추이 관찰이 필요한 설비",
        desc: caution.map((d) => d.name).join(", "),
      });
    }
    const offlineBridges = bridges.filter((b) => !b.online);
    if (offlineBridges.length) {
      items.push({
        count: offlineBridges.length,
        title: "오프라인 브릿지",
        desc: offlineBridges.map((b) => b.name).join(", "),
        alert: true,
      });
    }
    return items;
  }, [devices, bridges]);

  function resetFilters() {
    setStatusFilter("all");
    setBridgeFilter("all");
    setKeyword("");
  }

  return (
    <>
      <PageHeader
        title="변압기 통합 모니터링"
        breadcrumb="홈"
        subtitle={`${loading ? "불러오는 중" : connected ? "실시간 연결됨" : "재연결 중"} · 최종 업데이트 ${now || "-"}`}
        actions={
          <>
            <Link href="/alarms" className="btn">
              알람 이력
            </Link>
            <button className="btn primary" onClick={() => void refresh()}>
              새로고침
            </button>
          </>
        }
      />

      {error && (
        <div className="banner error">
          <b>데이터를 불러오지 못했습니다</b> — {error}
        </div>
      )}

      {/* ① 전체 변압기 상태 — 한눈에 보는 요약. 누르면 아래 목록이 그 상태로 걸러집니다. */}
      <div className="status-summary">
        <div className="st-tiles">
          <button
            type="button"
            className={`st-tile total${statusFilter === "all" ? " on" : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            <span className="st-lbl">전체 변압기</span>
            <span className="st-num">
              {devices.length}
              <small>대</small>
            </span>
          </button>
          {(["normal", "caution", "warning", "danger", "offline"] as DeviceStatus[]).map((s) => (
            <button
              type="button"
              key={s}
              className={`st-tile ${s}${statusFilter === s ? " on" : ""}`}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
            >
              <span className="st-lbl">{STATUS_LABEL[s]}</span>
              <span className="st-num">
                {count(s)}
                <small>대</small>
              </span>
            </button>
          ))}
        </div>
        <div className="st-bar" role="img" aria-label="상태별 비율">
          {(["normal", "caution", "warning", "danger", "offline"] as DeviceStatus[]).map((s) =>
            count(s) ? (
              <span
                key={s}
                className={s}
                style={{ width: `${(count(s) / Math.max(1, devices.length)) * 100}%` }}
                title={`${STATUS_LABEL[s]} ${count(s)}대`}
              />
            ) : null
          )}
        </div>
      </div>

      {/* 보조 지표 — 좁은 화면에서는 두 칸씩 접힙니다. */}
      <table className="grid compact summary-strip" style={{ marginBottom: 20 }}>
        <thead>
          <tr>
            <th>24시간 알람</th>
            <th>평균 절연유 온도</th>
            <th>최고 절연유 온도</th>
            <th>가스 기준 초과</th>
            <th>브릿지 온라인</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="num" data-label="24시간 알람">{alarms24h.toLocaleString()}건</td>
            <td className="num" data-label="평균 절연유 온도">{avgTemp.toFixed(1)}℃</td>
            <td className="num" data-label="최고 절연유 온도">{maxTemp.toFixed(1)}℃</td>
            <td className={`num${gasExceed ? " t-warning" : ""}`} data-label="가스 기준 초과">
              {gasExceed}대
            </td>
            <td className="num" data-label="브릿지 온라인">
              {bridgesOnline} / {bridges.length}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ② 주의 이상 변압기의 자세한 상태 · 측정값 · 24시간 추세 */}
      <AttentionPanel devices={devices} alarms={alarms} thresholds={thresholds} />

      {/* ③ 전체 변압기 목록 */}
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
          <button className="btn" onClick={resetFilters}>
            초기화
          </button>
          <button className="btn primary" onClick={() => void refresh()}>
            조회
          </button>
        </div>
      </div>

      <DeviceTable devices={filtered} alarms={alarms} total={devices.length} />

      {/* ④ 알람 이력 */}
      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <span className="accent-bar" />
              확인이 필요한 일
            </div>
            <span className="card-note">{todos.length}건</span>
          </div>
          <table className="grid">
            <colgroup>
              <col style={{ width: 170 }} />
              <col style={{ width: 60 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>구분</th>
                <th>건수</th>
                <th>대상</th>
              </tr>
            </thead>
            <tbody>
              {todos.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={3}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                todos.map((t) => (
                  <tr key={t.title}>
                    <td className={t.alert ? "t-danger" : undefined}>{t.title}</td>
                    <td className={`num${t.alert ? " t-danger" : ""}`}>{t.count}</td>
                    <td style={{ whiteSpace: "normal" }}>{t.desc}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <span className="accent-bar" />
              최근 알람 이력
            </div>
            <Link href="/alarms" className="btn">
              전체 보기
            </Link>
          </div>
          <table className="grid">
            <colgroup>
              <col style={{ width: 120 }} />
              <col />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead>
              <tr>
                <th>발생 시각</th>
                <th>설비 · 항목</th>
                <th>등급</th>
              </tr>
            </thead>
            <tbody>
              {alarms.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={3}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                alarms.slice(0, 8).map((a, i) => (
                  <tr key={a.id ?? i}>
                    <td className="center">{a.time}</td>
                    <td>
                      {a.unit} · {a.item}
                      {a.detail && <span className="chip">{a.detail}</span>}
                    </td>
                    <td className="center" style={{ color: LEVEL_COLOR[a.level], fontWeight: 600 }}>
                      {STATUS_LABEL[a.level]}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
