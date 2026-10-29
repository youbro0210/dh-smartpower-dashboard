"use client";

import { Fragment, useMemo, useState } from "react";
import {
  DeviceEvaluated,
  DeviceStatus,
  LINK_TYPE_LABEL,
  STATUS_LABEL,
  AlarmEvent,
  SeverityLevel,
} from "@/lib/types";
import { downloadCsv, fmtDateTime, fmtShort } from "@/lib/format";
import Sparkline from "./Sparkline";

/** 상태 정렬 순서 — 손봐야 할 설비가 위로 옵니다. */
const STATUS_RANK: Record<DeviceStatus, number> = {
  danger: 0,
  warning: 1,
  caution: 2,
  offline: 3,
  normal: 4,
};

type SortKey = "no" | "name" | "status" | "temperature" | "h2" | "ch4" | "since";

// opt: 태블릿 폭에서는 접어 두는 칸 (측정값과 이상 내용이 잘리지 않게)
const COLUMNS: { key: SortKey | null; label: string; num?: boolean; width: number; opt?: boolean }[] = [
  { key: "no", label: "No", width: 48 },
  { key: "name", label: "설비명", width: 84 },
  { key: null, label: "연결", width: 128, opt: true },
  { key: null, label: "위치", width: 64 },
  { key: null, label: "용량", width: 104, opt: true },
  { key: "status", label: "상태", width: 76 },
  { key: "temperature", label: "온도(℃)", num: true, width: 84 },
  { key: "h2", label: "수소(ppm)", num: true, width: 90 },
  { key: "ch4", label: "메탄(ppm)", num: true, width: 90 },
  { key: null, label: "유면", width: 60 },
  { key: null, label: "추세", width: 92, opt: true },
  { key: null, label: "주요 이상", width: 0 },
  { key: "since", label: "측정 시각", width: 108 },
];

/** 기준을 넘은 측정값만 등급 색으로 씁니다. */
function levelClass(level: SeverityLevel | undefined) {
  return level && level !== "normal" ? ` lv-${level}` : "";
}

function linkText(u: DeviceEvaluated) {
  return `${LINK_TYPE_LABEL[u.link_type ?? (u.bridge_id ? "bridge" : "direct")]}${
    u.bridge_id ? ` · ${u.bridge_id}` : ""
  }`;
}

function delta(current: number, baseline: number | undefined) {
  if (baseline === undefined || baseline === null || !Number.isFinite(baseline)) {
    return <span className="flat">비교 기준 없음</span>;
  }
  const diff = Number((current - baseline).toFixed(1));
  if (Math.abs(diff) < 0.1) return <span className="flat">변화 없음</span>;
  return diff > 0 ? <span className="up">▲ +{diff.toFixed(1)}</span> : <span className="down">▼ {diff.toFixed(1)}</span>;
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
  // 기본은 상태순 — 이상이 난 설비가 맨 위로 옵니다.
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "status", asc: true });

  // No 는 등록 순서를 그대로 유지해, 정렬을 바꿔도 같은 설비는 같은 번호입니다.
  const numbered = useMemo(() => devices.map((d, i) => ({ d, no: i + 1 })), [devices]);

  const rows = useMemo(() => {
    const dir = sort.asc ? 1 : -1;
    const value = ({ d, no }: { d: DeviceEvaluated; no: number }): number | string => {
      switch (sort.key) {
        case "no":
          return no;
        case "name":
          return d.name;
        case "status":
          return STATUS_RANK[d.status] * 1000 + no;
        case "since":
          return d.since && d.since !== "-" ? new Date(d.since).getTime() : 0;
        default:
          return d[sort.key];
      }
    };
    return [...numbered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb), "ko", { numeric: true }) * dir;
      }
      return (va - vb) * dir || a.no - b.no;
    });
  }, [numbered, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, asc: !s.asc }
        : // 숫자·시각은 큰 값부터 보는 경우가 많습니다.
          { key, asc: !["temperature", "h2", "ch4", "since"].includes(key) }
    );

  const exportCsv = () =>
    downloadCsv(
      `설비현황_${fmtDateTime(new Date()).replace(/[: ]/g, "")}.csv`,
      ["No", "설비명", "연결", "위치", "용량", "상태", "온도(℃)", "수소(ppm)", "메탄(ppm)", "유면", "주요 이상", "측정 시각"],
      rows.map(({ d, no }) => [
        no,
        d.name,
        linkText(d),
        d.building,
        d.capacity,
        STATUS_LABEL[d.status],
        d.temperature.toFixed(1),
        d.h2.toFixed(1),
        d.ch4.toFixed(1),
        d.oil_level,
        d.causes.join(", "),
        fmtDateTime(d.since),
      ])
    );

  return (
    <div className="card flush device-table">
      <div className="card-head">
        <div className="card-title">
          <span className="accent-bar" />
          설비 목록
        </div>
        <div className="card-tools">
          <span className="card-note">
            {total !== undefined && total !== devices.length
              ? `${devices.length}건 / 전체 ${total}건`
              : `${devices.length}건`}
          </span>
          <button className="btn sm" onClick={exportCsv} disabled={!devices.length}>
            엑셀
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="sortable">
          <colgroup>
            {COLUMNS.map((c) => (
              <col
                key={c.label}
                className={c.opt ? "opt" : undefined}
                style={c.width ? { width: c.width } : undefined}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = c.key !== null && sort.key === c.key;
                return (
                  <th
                    key={c.label}
                    className={[c.num && "num", c.opt && "opt"].filter(Boolean).join(" ") || undefined}
                    aria-sort={active ? (sort.asc ? "ascending" : "descending") : undefined}
                  >
                    {c.key ? (
                      <button type="button" className="th-sort" onClick={() => toggleSort(c.key!)}>
                        {c.label}
                        <span className={`sort-mark${active ? " on" : ""}`}>
                          {active ? (sort.asc ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 && (
              <tr>
                <td className="empty" colSpan={COLUMNS.length}>
                  조회된 데이터가 없습니다.
                </td>
              </tr>
            )}

            {rows.map(({ d: u, no }) => {
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
                    <td className="center c-no">{no}</td>
                    <td className="c-name" style={{ whiteSpace: "nowrap" }}>
                      <b>{u.name}</b>
                      {/* 좁은 화면에서는 연결 칸을 접고 이름 아래에 적습니다. */}
                      <span className="cell-sub">{linkText(u)}</span>
                    </td>
                    {/* 값이 서버까지 오는 길. 헤디 구성 1·2·3안을 여기서 구분합니다. */}
                    <td className="c-link opt">{linkText(u)}</td>
                    <td className="c-where" data-label="위치" style={{ whiteSpace: "nowrap" }}>{u.building}</td>
                    <td className="c-cap opt" data-label="용량" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{u.capacity}</td>
                    <td className="center c-status">
                      <span className={`badge ${u.status}`}>{STATUS_LABEL[u.status]}</span>
                    </td>
                    <td className={`num${levelClass(u.sensorLevels?.temperature)}`} data-label="온도(℃)">
                      {u.temperature.toFixed(1)}
                    </td>
                    <td className={`num${levelClass(u.sensorLevels?.h2)}`} data-label="수소(ppm)">
                      {u.h2.toFixed(1)}
                    </td>
                    <td className={`num${levelClass(u.sensorLevels?.ch4)}`} data-label="메탄(ppm)">
                      {u.ch4.toFixed(1)}
                    </td>
                    <td className={`center${levelClass(u.sensorLevels?.oil_level)}`} data-label="유면">
                      {u.oil_level}
                    </td>
                    <td className="c-spark opt">
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
                    <td
                      className={`center c-time${u.status === "offline" ? " t-stale" : ""}`}
                      data-label="측정 시각"
                      title={fmtDateTime(u.since, true)}
                    >
                      {fmtShort(u.since)}
                    </td>
                  </tr>

                  {open && (
                    <tr className="expand-row">
                      <td colSpan={COLUMNS.length}>
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
                              ` · ${fmtDateTime(u.since, true)}`}
                          </b>
                          {causeText} {GUIDANCE[u.status]}
                        </div>

                        {related.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div className="spark-title">이 설비의 최근 알람</div>
                            <table className="grid">
                              <thead>
                                <tr>
                                  <th style={{ width: 140 }}>발생 시각</th>
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
                                      {a.detail && <span className="t-muted" style={{ marginLeft: 8 }}>{a.detail}</span>}
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
