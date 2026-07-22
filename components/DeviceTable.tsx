"use client";

import { useState } from "react";
import { DeviceEvaluated, STATUS_LABEL, DeviceStatus, AlarmEvent } from "@/lib/types";
import Sparkline from "./Sparkline";

const FILTERS: { key: DeviceStatus | "all"; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "normal", label: "정상" },
  { key: "caution", label: "주의" },
  { key: "warning", label: "경고" },
  { key: "danger", label: "위험" },
  { key: "offline", label: "통신단절" },
];

function delta(current: number, base: number) {
  const diff = +(current - base).toFixed(1);
  if (Math.abs(diff) < 0.1) return <span className="flat">변화 없음</span>;
  return diff > 0 ? <span className="up">▲ +{diff}</span> : <span className="down">▼ {diff}</span>;
}

const actionClassMap: Record<string, string> = { danger: "", warning: "warning", caution: "caution", normal: "normal", offline: "offline" };

export default function DeviceTable({ devices, alarms }: { devices: DeviceEvaluated[]; alarms: AlarmEvent[] }) {
  const [filter, setFilter] = useState<DeviceStatus | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(
    devices.find((d) => d.status === "danger")?.device_id ?? null
  );

  const filtered = filter === "all" ? devices : devices.filter((d) => d.status === filter);

  function toggle(id: string) {
    setExpandedId((cur) => (cur === id ? null : id));
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: "18px 20px 0" }}>
        <div className="card-head" style={{ marginBottom: 12 }}>
          <div className="card-title"><span className="accent-bar" />전체 변압기 목록</div>
          <div className="card-note">행 클릭 시 상세 확장</div>
        </div>
        <div className="filter-tabs">
          {FILTERS.map((f) => {
            const n = f.key === "all" ? devices.length : devices.filter((d) => d.status === f.key).length;
            return (
              <button
                key={f.key}
                className={`filter-tab${filter === f.key ? " active" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}<span className="cnt">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 20 }}></th>
            <th>설비명</th><th>위치</th><th>용량</th><th>상태</th>
            <th>온도</th><th>수소</th><th>메탄</th><th>유면</th>
            <th>추세</th><th>주요 이상</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((u) => {
            const open = expandedId === u.device_id;
            const relatedAlarms = alarms.filter((a) => a.unit === u.name);
            const actionClass = actionClassMap[u.status] ?? "";
            const causeText = u.causes.length ? u.causes.join(", ") : "모든 지표가 기준 범위 내에 있습니다.";
            const guidance =
              u.status === "danger" ? "즉시 현장 점검 및 절연유 상태 확인이 필요합니다." :
              u.status === "warning" ? "현장 점검을 권장하며 추이를 30분 단위로 재확인하세요." :
              u.status === "caution" ? "추이를 지속 관찰하세요." :
              u.status === "offline" ? "통신 상태와 브릿지 연결을 확인하세요." : "";

            return (
              <>
                <tr key={u.device_id} className={`dev-row${open ? " expanded" : ""}`} onClick={() => toggle(u.device_id)}>
                  <td><span className={`chev${open ? " open" : ""}`}>▸</span></td>
                  <td><b>{u.name}</b></td>
                  <td>{u.building}</td>
                  <td className="num" style={{ color: "var(--muted)", fontSize: 11.5 }}>{u.capacity}</td>
                  <td><span className={`badge ${u.status}`}>{STATUS_LABEL[u.status]}</span></td>
                  <td className="num">{u.temperature.toFixed(1)}℃</td>
                  <td className="num">{u.h2.toFixed(1)}ppm</td>
                  <td className="num">{u.ch4.toFixed(1)}ppm</td>
                  <td className="num">{u.oil_level}</td>
                  <td><Sparkline deviceId={u.device_id} temp={u.temperature} h2={u.h2} isDanger={u.status === "danger" || u.status === "warning"} compact /></td>
                  <td className="cause">{u.causes.join(", ") || "-"}</td>
                </tr>
                {open && (
                  <tr className="expand-row" key={`${u.device_id}-detail`}>
                    <td colSpan={11}>
                      <div className="sensor-grid" style={{ marginBottom: 14 }}>
                        <div className="sensor">
                          <div className="s-lbl">수소가스 (H₂)</div>
                          <div className="s-val">{u.h2.toFixed(1)} <span style={{ fontSize: 11, color: "var(--muted)" }}>ppm</span></div>
                          <div className="s-delta">{delta(u.h2, u.base_h2)}</div>
                        </div>
                        <div className="sensor">
                          <div className="s-lbl">메탄가스 (CH₄)</div>
                          <div className="s-val">{u.ch4.toFixed(1)} <span style={{ fontSize: 11, color: "var(--muted)" }}>ppm</span></div>
                          <div className="s-delta">{delta(u.ch4, u.base_ch4)}</div>
                        </div>
                        <div className="sensor">
                          <div className="s-lbl">유면</div>
                          <div className="s-val">{u.oil_level}</div>
                          <div className="s-delta">{u.oil_level === "낮음" ? <span className="down">▼ 하락</span> : <span className="flat">변화 없음</span>}</div>
                        </div>
                        <div className="sensor">
                          <div className="s-lbl">온도</div>
                          <div className="s-val">{u.temperature.toFixed(1)} <span style={{ fontSize: 11, color: "var(--muted)" }}>℃</span></div>
                          <div className="s-delta">{delta(u.temperature, u.base_temperature)}</div>
                        </div>
                      </div>

                      <div className="spark-title">최근 추세 (온도 · 수소가스)</div>
                      <div className="spark-box" style={{ marginBottom: 14 }}>
                        <Sparkline deviceId={u.device_id} temp={u.temperature} h2={u.h2} isDanger={u.status === "danger" || u.status === "warning"} />
                      </div>

                      <div className={`action-box${actionClass ? " " + actionClass : ""}`} style={{ marginBottom: relatedAlarms.length ? 14 : 0 }}>
                        <b>{STATUS_LABEL[u.status]}{u.since !== "-" ? ` · ${u.since}` : ""}</b>
                        {causeText} {guidance}
                      </div>

                      {relatedAlarms.length > 0 && (
                        <div>
                          <div className="spark-title">이 설비의 최근 알람</div>
                          {relatedAlarms.map((a, i) => (
                            <div className="alarm-item" key={i}>
                              <span className="time">{a.time}</span>
                              <span className="desc">{a.item}</span>
                              <span className="lvl" style={{ color: a.level === "danger" ? "var(--danger)" : a.level === "warning" ? "var(--warning)" : "var(--caution)" }}>
                                {STATUS_LABEL[a.level]}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
