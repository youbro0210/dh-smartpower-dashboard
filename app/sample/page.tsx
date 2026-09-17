"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import DeviceTable from "@/components/DeviceTable";
import AttentionPanel from "@/components/AttentionPanel";
import {
  buildSampleAlarms,
  buildSampleDevices,
  SAMPLE_BRIDGES,
  SAMPLE_THRESHOLDS,
} from "@/lib/sampleData";
import { DeviceStatus, STATUS_LABEL } from "@/lib/types";

const LEVEL_COLOR: Record<string, string> = {
  caution: "var(--caution)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

/**
 * 샘플 대시보드.
 * 계측기가 붙기 전에도 화면 구성을 그대로 확인할 수 있도록,
 * 고정된 예시 자료로 홈 화면과 같은 구성을 보여줍니다.
 */
export default function SamplePage() {
  // 시각이 서버·브라우저에서 달라지면 하이드레이션이 어긋나므로,
  // 마운트된 뒤 한 번만 만듭니다.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const devices = useMemo(() => (now ? buildSampleDevices(now) : []), [now]);
  const alarms = useMemo(() => (now ? buildSampleAlarms(now) : []), [now]);

  const [statusFilter, setStatusFilter] = useState<DeviceStatus | "all">("all");

  const count = (s: DeviceStatus) => devices.filter((d) => d.status === s).length;
  const filtered = devices.filter((d) => statusFilter === "all" || d.status === statusFilter);

  const online = devices.filter((d) => d.status !== "offline");
  const temps = online.map((d) => d.temperature);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
  const maxTemp = temps.length ? Math.max(...temps) : 0;
  const gasExceed = online.filter(
    (d) => d.h2 >= SAMPLE_THRESHOLDS.h2.warning || d.ch4 >= SAMPLE_THRESHOLDS.ch4.warning
  ).length;
  const bridgesOnline = SAMPLE_BRIDGES.filter((b) => b.online).length;

  if (!now) {
    return (
      <>
        <PageHeader title="샘플 대시보드" breadcrumb="홈 › 샘플 대시보드" />
        <div className="card">
          <div className="empty">샘플 자료를 준비하는 중입니다.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="샘플 대시보드"
        breadcrumb="홈 › 샘플 대시보드"
        subtitle="계측기 연결 전, 모니터링 화면에 어떤 내용이 어떻게 표시되는지 보여주는 예시입니다"
      />

      <div className="sample-notice">
        <b>예시 자료입니다.</b>
        실제 계측값이 아니라 화면 확인용으로 고정해 둔 값이며, 현장 데이터가 들어오면 홈 화면에
        같은 형식으로 표시됩니다.
      </div>

      {/* ① 전체 변압기 상태 요약 */}
      <div className="section-label">① 전체 변압기 상태</div>
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

      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-label">24시간 알람</div>
          <div className="kpi-value">
            {alarms.length}
            <small>건</small>
          </div>
          <div className="kpi-note">최근 하루 누적</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">평균 절연유 온도</div>
          <div className="kpi-value">
            {avgTemp.toFixed(1)}
            <small>℃</small>
          </div>
          <div className="kpi-note">최고 {maxTemp.toFixed(1)}℃</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">가스 기준 초과</div>
          <div className="kpi-value warning">
            {gasExceed}
            <small>대</small>
          </div>
          <div className="kpi-note">수소·메탄 경고 임계치 이상</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">브릿지 온라인</div>
          <div className="kpi-value">
            {bridgesOnline}
            <small>/{SAMPLE_BRIDGES.length}</small>
          </div>
          <div className="kpi-note">수집 장치 연결 상태</div>
        </div>
      </div>

      {/* ②③④ 주의·위험 변압기의 상세 상태 · 측정값 · 24시간 추세 */}
      <div className="section-label">② 주의·위험 변압기 상세 — 측정값과 24시간 추세</div>
      <AttentionPanel devices={devices} alarms={alarms} thresholds={SAMPLE_THRESHOLDS} />

      {/* ⑤ 전체 변압기 목록 */}
      <div className="section-label">③ 전체 변압기 목록</div>
      <DeviceTable devices={filtered} alarms={alarms} total={devices.length} />

      {/* ⑥ 알람 이력 */}
      <div className="section-label">④ 알람 이력</div>
      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            알람 이력
          </div>
          <span className="card-note">{alarms.length}건 · 최근순</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>발생 시각</th>
                <th style={{ width: 90 }}>설비</th>
                <th>내용</th>
                <th style={{ width: 150 }}>측정값</th>
                <th style={{ width: 80 }}>등급</th>
              </tr>
            </thead>
            <tbody>
              {alarms.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>{a.time}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <b>{a.unit}</b>
                  </td>
                  <td>{a.item}</td>
                  <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{a.detail}</td>
                  <td>
                    <span className={`badge ${a.level}`} style={{ color: LEVEL_COLOR[a.level] }}>
                      {STATUS_LABEL[a.level]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="note">
        판정 규칙은 홈 화면과 같습니다. 센서별 임계치(주의·경고·위험)로 등급을 매기고, 두 개
        이상의 센서가 동시에 이상이면 한 단계 올립니다. 임계치는 설정 화면에서 바꿉니다.
      </div>
    </>
  );
}
