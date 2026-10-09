"use client";

import { Fragment, useState } from "react";
import { DeviceEvaluated, LINK_TYPE_LABEL, STATUS_LABEL, AlarmEvent } from "@/lib/types";
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
    <div className="card flush device-table">
      <div className="card-head">
        <div className="card-title">
          <span className="accent-bar" />
          설비 목록
        </div>
        <span className="card-note">
          {total !== undefined && total !== devices.length
            ? `${devices.length}건 / 전체 ${total}건`
            : `${devices.length}건`}
        </span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 44 }}>No</th>
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
                <td className="empty" colSpan={12}>
                  조회된 데이터가 없습니다.
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
                    <td className="center c-no">{idx + 1}</td>
                    <td className="c-name" style={{ whiteSpace: "nowrap" }}>
                      <b>{u.name}</b>
                      {/* 값이 서버까지 오는 길. 헤디 구성 1·2·3안을 여기서 구분합니다. */}
                      <span className="cell-sub">
                        {LINK_TYPE_LABEL[u.link_type ?? (u.bridge_id ? "bridge" : "direct")]}
                        {u.bridge_id ? ` · ${u.bridge_id}` : ""}
                      </span>
                    </td>
                    <td className="c-where" data-label="위치" style={{ whiteSpace: "nowrap" }}>{u.building}</td>
                    <td className="c-cap" data-label="용량" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{u.capacity}</td>
                    <td className="center c-status">
                      <span className={`badge ${u.status}`}>{STATUS_LABEL[u.status]}</span>
                    </td>
                    <td className="num" data-label="온도(℃)">{u.temperature.toFixed(1)}</td>
                    <td className="num" data-label="수소(ppm)">{u.h2.toFixed(1)}</td>
                    <td className="num" data-label="메탄(ppm)">{u.ch4.toFixed(1)}</td>
                    <td className="center" data-label="유면">{u.oil_level}</td>
                    <td className="c-spark">
                      <Sparkline trend={u.trend} compact />
                    </td>
                    {/* 등급과 무관하게 전부 빨갛게 쓰면 정작 위험한 설비가 묻힙니다. */}
                    <td
                      style={{
                        color: u.causes.length ? `var(--${u.status})` : "var(--faint)",
                        fontWeight: u.status === "danger" ? 600 : 400,
                      }}
                      className="c-cause"
                      data-label="주요 이상"
                      data-empty={u.causes.length ? undefined : "true"}
                    >
                      {u.causes.join(", ") || "-"}
                    </td>
                    <td className="center c-time" data-label="측정 시각">{shortTime(u.since)}</td>
                  </tr>

                  {open && (
                    <tr className="expand-row">
                      <td colSpan={12}>
                        <div className="sensor-grid" style={{ marginBottom: 12 }}>
                          <div className="sensor">
                            <div className="s-lbl">수소가스 (H₂)</div>
                            <div className="s-val">
                              {u.h2.toFixed(1)}
                              <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}> ppm</span>
                            </div>
                            <div className="s-delta">{delta(u.h2, u.baseline?.h2)}</div>
                          </div>
                          <div className="sensor">
                            <div className="s-lbl">메탄가스 (CH₄)</div>
                            <div className="s-val">
                              {u.ch4.toFixed(1)}
                              <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}> ppm</span>
                            </div>
                            <div className="s-delta">{delta(u.ch4, u.baseline?.ch4)}</div>
                          </div>
                          <div className="sensor">
                            <div className="s-lbl">절연유 온도</div>
                            <div className="s-val">
                              {u.temperature.toFixed(1)}
                              <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}> ℃</span>
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
                            <table className="grid">
                              <thead>
                                <tr>
                                  <th style={{ width: 120 }}>발생 시각</th>
                                  <th>항목</th>
                                  <th style={{ width: 60 }}>등급</th>
                                </tr>
                              </thead>
                              <tbody>
                                {related.slice(0, 5).map((a, i) => (
                                  <tr key={a.id ?? i}>
                                    <td className="center">{a.time}</td>
                                    <td>
                                      {a.item}
                                      {a.detail && <span className="chip">{a.detail}</span>}
                                    </td>
                                    <td
                                      className="center"
                                      style={{ color: LEVEL_COLOR[a.level], fontWeight: 600 }}
                                    >
                                      {STATUS_LABEL[a.level]}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
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
