"use client";

import { Fragment, useState } from "react";
import { DeviceEvaluated, STATUS_LABEL, AlarmEvent } from "@/lib/types";
import Sparkline from "./Sparkline";

/** 표에서는 자리를 아끼기 위해 월-일 시:분 까지만 적습니다. */
function shortTime(iso: string): string {
  if (!iso || iso === "-") return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function delta(current: number, baseline: number | undefined) {
  if (baseline === undefined || baseline === null || !Number.isFinite(baseline)) {
    return <span className="flat">비교 기준 없음</span>;
  }
  const diff = Number((current - baseline).toFixed(1));
  if (Math.abs(diff) < 0.1) return <span className="flat">변화 없음</span>;
  return diff > 0 ? <span className="up">▲ +{diff}</span> : <span className="down">▼ {diff}</span>;
}

const GUIDANCE: Record<string, string> = {
  danger: "즉시 현장 점검 및 절연유 상태 확인이 필요합니다.",
  warning: "현장 점검을 권장하며 추이를 30분 단위로 재확인하세요.",
  caution: "추이를 지속 관찰하세요.",
  offline: "통신 상태와 브릿지 연결을 확인하세요.",
  normal: "",
};

const LEVEL_COLOR: Record<string, string> = {
  caution: "var(--caution)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

export default function DeviceTable({
  devices,
  alarms,
  total,
}: {
  devices: DeviceEvaluated[];
  alarms: AlarmEvent[];
  total?: number;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="card flush">
      <div className="card-head">
        <div className="card-title">
          <span className="accent-bar" />
          설비 목록
        </div>
        <span className="card-note">
          {total !== undefined && total !== devices.length
            ? `${devices.length}건 / 전체 ${total}건`
            : `${devices.length}건`}{" "}
          · 행 클릭 시 상세
        </span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 34 }}>No</th>
              <th style={{ minWidth: 96 }}>설비명</th>
              <th>위치</th>
              <th>용량</th>
              <th>상태</th>
              <th className="num">온도(℃)</th>
              <th className="num">수소(ppm)</th>
              <th className="num">메탄(ppm)</th>
              <th style={{ width: 62 }}>유면</th>
              <th style={{ width: 92 }}>추세</th>
              <th>주요 이상</th>
              <th style={{ width: 108 }}>측정 시각</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 && (
              <tr>
                <td colSpan={12}>
                  <div className="empty">
                    조회 조건에 맞는 설비가 없습니다. 설정 화면에서 설비를 등록하거나 조건을
                    변경해 주세요.
                  </div>
                </td>
              </tr>
            )}

            {devices.map((u, idx) => {
              const open = expandedId === u.device_id;
              const related = alarms.filter(
                (a) => a.device_id === u.device_id || a.unit === u.name
              );
              const causeText = u.causes.length
                ? u.causes.join(", ")
                : "모든 지표가 기준 범위 내에 있습니다.";

              return (
                <Fragment key={u.device_id}>
                  <tr
                    className={`clickable${open ? " expanded" : ""}`}
                    onClick={() => setExpandedId(open ? null : u.device_id)}
                  >
                    <td className="num" style={{ color: "var(--faint)" }}>
                      {idx + 1}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <b>{u.name}</b>
                      {u.bridge_id && <span className="cell-sub">{u.bridge_id}</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{u.building}</td>
                    <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{u.capacity}</td>
                    <td>
                      <span className={`badge ${u.status}`}>{STATUS_LABEL[u.status]}</span>
                    </td>
                    <td className="num">{u.temperature.toFixed(1)}</td>
                    <td className="num">{u.h2.toFixed(1)}</td>
                    <td className="num">{u.ch4.toFixed(1)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{u.oil_level}</td>
                    <td>
                      <Sparkline trend={u.trend} compact />
                    </td>
                    <td style={{ color: u.causes.length ? "var(--danger)" : "var(--faint)" }}>
                      {u.causes.join(", ") || "-"}
                    </td>
                    <td style={{ color: "var(--faint)", whiteSpace: "nowrap" }}>
                      {shortTime(u.since)}
                    </td>
                  </tr>

                  {open && (
                    <tr className="expand-row">
                      <td colSpan={12}>
                        <div className="sensor-grid" style={{ marginBottom: 12 }}>
                          <div className="sensor">
                            <div className="s-lbl">수소가스 (H₂)</div>
                            <div className="s-val">
                              {u.h2.toFixed(1)}
                              <span style={{ fontSize: 11, color: "var(--muted)" }}> ppm</span>
                            </div>
                            <div className="s-delta">{delta(u.h2, u.baseline?.h2)}</div>
                          </div>
                          <div className="sensor">
                            <div className="s-lbl">메탄가스 (CH₄)</div>
                            <div className="s-val">
                              {u.ch4.toFixed(1)}
                              <span style={{ fontSize: 11, color: "var(--muted)" }}> ppm</span>
                            </div>
                            <div className="s-delta">{delta(u.ch4, u.baseline?.ch4)}</div>
                          </div>
                          <div className="sensor">
                            <div className="s-lbl">절연유 온도</div>
                            <div className="s-val">
                              {u.temperature.toFixed(1)}
                              <span style={{ fontSize: 11, color: "var(--muted)" }}> ℃</span>
                            </div>
                            <div className="s-delta">
                              {delta(u.temperature, u.baseline?.temperature)}
                            </div>
                          </div>
                          <div className="sensor">
                            <div className="s-lbl">유면</div>
                            <div className="s-val">{u.oil_level}</div>
                            <div className="s-delta">
                              {u.oil_level === "낮음" ? (
                                <span className="up">▼ 하락</span>
                              ) : (
                                <span className="flat">정상 범위</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="spark-title">최근 24시간 추세 (온도 · 수소가스)</div>
                        <div className="spark-box" style={{ marginBottom: 12 }}>
                          <Sparkline trend={u.trend} />
                        </div>

                        <div className={`action-box ${u.status}`}>
                          <b>
                            {STATUS_LABEL[u.status]}
                            {u.since !== "-" &&
                              ` · ${new Date(u.since).toLocaleString("ko-KR", { hour12: false })}`}
                          </b>
                          {causeText} {GUIDANCE[u.status]}
                        </div>

                        {related.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div className="spark-title">이 설비의 최근 알람</div>
                            {related.slice(0, 5).map((a, i) => (
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
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
