"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useDashboard } from "@/lib/configStore";
import { downloadCsv, fmtDate, fmtDateTime } from "@/lib/format";

interface DeviceRow {
  device_id: string;
  name: string;
  building: string;
  capacity: string;
  samples: number;
  h2_min: number | null;
  h2_avg: number | null;
  h2_max: number | null;
  ch4_min: number | null;
  ch4_avg: number | null;
  ch4_max: number | null;
  temp_min: number | null;
  temp_avg: number | null;
  temp_max: number | null;
  oil_low: number;
}

interface AlarmRow {
  device_id: string | null;
  unit: string;
  level: "caution" | "warning" | "danger";
  count: number;
}

interface MaintRow {
  device_id: string | null;
  unit: string;
  work_date: string;
  kind: string;
  title: string;
}

interface Report {
  from: string;
  to: string;
  expectedSamples: number;
  devices: DeviceRow[];
  alarms: AlarmRow[];
  maintenance: MaintRow[];
}

const KIND_LABEL: Record<string, string> = {
  inspection: "정기 점검",
  oil_sample: "절연유 시료 분석",
  oil_refill: "절연유 보충",
  repair: "수리·조치",
  replace: "부품 교체",
  other: "기타",
};

/** 빠른 기간 선택 */
function preset(kind: "yesterday" | "week" | "month" | "lastMonth"): [string, string] {
  const now = new Date();
  const day = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  switch (kind) {
    case "yesterday": {
      const y = day(now, -1);
      return [fmtDate(y), fmtDate(y)];
    }
    case "week":
      return [fmtDate(day(now, -6)), fmtDate(now)];
    case "month":
      return [fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), fmtDate(now)];
    case "lastMonth":
      return [
        fmtDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        fmtDate(new Date(now.getFullYear(), now.getMonth(), 0)),
      ];
  }
}

const v = (n: number | null) => (n === null || n === undefined ? "-" : n.toFixed(1));

export default function ReportPage() {
  const { thresholds } = useDashboard();
  const [[from, to], setRange] = useState<[string, string]>(() => preset("week"));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/report?from=${f}&to=${t}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "보고서를 만들지 못했습니다.");
        setReport(null);
        return;
      }
      setReport(json);
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(from, to);
    // 최초 1회만 조회합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (kind: Parameters<typeof preset>[0]) => {
    const [f, t] = preset(kind);
    setRange([f, t]);
    void load(f, t);
  };

  const alarmBy = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const a of report?.alarms ?? []) {
      const key = a.device_id ?? a.unit;
      const cur = map.get(key) ?? { caution: 0, warning: 0, danger: 0 };
      cur[a.level] += a.count;
      map.set(key, cur);
    }
    return map;
  }, [report]);

  const rows = report?.devices ?? [];
  const exp = report?.expectedSamples ?? 0;
  const rate = (n: number) => (exp ? Math.min(100, (n / exp) * 100) : 0);

  const totals = useMemo(() => {
    const t = { caution: 0, warning: 0, danger: 0 };
    for (const a of report?.alarms ?? []) t[a.level] += a.count;
    return t;
  }, [report]);

  const avgRate = rows.length ? rows.reduce((s, r) => s + rate(r.samples), 0) / rows.length : 0;
  const peak = rows.reduce<DeviceRow | null>(
    (best, r) => (r.temp_max !== null && (!best || (best.temp_max ?? -1) < r.temp_max) ? r : best),
    null
  );

  const exportCsv = () =>
    downloadCsv(
      `운영보고서_${from}_${to}.csv`,
      [
        "설비", "위치", "용량", "수신율(%)",
        "수소 최소", "수소 평균", "수소 최대",
        "메탄 최소", "메탄 평균", "메탄 최대",
        "온도 최소", "온도 평균", "온도 최대",
        "유면 낮음(회)", "알람 위험", "알람 경고", "알람 주의",
      ],
      rows.map((r) => {
        const a = alarmBy.get(r.device_id) ?? { caution: 0, warning: 0, danger: 0 };
        return [
          r.name, r.building, r.capacity, rate(r.samples).toFixed(1),
          v(r.h2_min), v(r.h2_avg), v(r.h2_max),
          v(r.ch4_min), v(r.ch4_avg), v(r.ch4_max),
          v(r.temp_min), v(r.temp_avg), v(r.temp_max),
          r.oil_low, a.danger, a.warning, a.caution,
        ];
      })
    );

  /** 최대값이 경고 기준을 넘었으면 등급 색 */
  const over = (val: number | null, rule: { caution: number; warning: number; danger: number }) =>
    val === null
      ? ""
      : val >= rule.danger
        ? " lv-danger"
        : val >= rule.warning
          ? " lv-warning"
          : val >= rule.caution
            ? " lv-caution"
            : "";

  return (
    <>
      <PageHeader
        title="운영 보고서"
        breadcrumb="홈 › 운영 보고서"
        subtitle={report ? `${report.from} ~ ${report.to}` : undefined}
        actions={
          <>
            <button className="btn" onClick={exportCsv} disabled={!rows.length}>
              엑셀
            </button>
            <button className="btn primary" onClick={() => window.print()} disabled={!report}>
              인쇄
            </button>
          </>
        }
      />

      <div className="filterbar no-print">
        <span className="filter-label">기간</span>
        <input className="field" type="date" value={from} onChange={(e) => setRange([e.target.value, to])} />
        <span style={{ color: "var(--muted)", fontSize: 12 }}>~</span>
        <input className="field" type="date" value={to} onChange={(e) => setRange([from, e.target.value])} />
        <div className="btn-group">
          <button className="btn sm" onClick={() => pick("yesterday")}>어제</button>
          <button className="btn sm" onClick={() => pick("week")}>최근 7일</button>
          <button className="btn sm" onClick={() => pick("month")}>이번 달</button>
          <button className="btn sm" onClick={() => pick("lastMonth")}>지난 달</button>
        </div>
        <div className="filterbar-right">
          <button className="btn primary" onClick={() => void load(from, to)} disabled={loading}>
            조회
          </button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {/* 인쇄했을 때 맨 위에 나오는 머리 */}
      <div className="print-only report-title">
        <b>DH 스마트파워 변압기 운영 보고서</b>
        <span>
          기간 {from} ~ {to} · 출력 {fmtDateTime(new Date())}
        </span>
      </div>

      <table className="grid compact fixed summary-strip" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>대상 설비</th>
            <th>평균 수신율</th>
            <th>최고 온도</th>
            <th>위험 알람</th>
            <th>경고 알람</th>
            <th>주의 알람</th>
            <th>점검 작업</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-label="대상 설비" className="num">{rows.length}대</td>
            <td data-label="평균 수신율" className={`num${avgRate < 95 && rows.length ? " t-warning" : ""}`}>{avgRate.toFixed(1)}%</td>
            <td data-label="최고 온도" className="num">
              {peak ? `${v(peak.temp_max)}℃ (${peak.name})` : "-"}
            </td>
            <td data-label="위험 알람" className="num t-danger">{totals.danger.toLocaleString()}건</td>
            <td data-label="경고 알람" className="num t-warning">{totals.warning.toLocaleString()}건</td>
            <td data-label="주의 알람" className="num t-caution">{totals.caution.toLocaleString()}건</td>
            <td data-label="점검 작업" className="num">{(report?.maintenance.length ?? 0).toLocaleString()}건</td>
          </tr>
        </tbody>
      </table>

      <div className="card flush" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            설비별 요약
          </div>
          <span className="card-note">
            {loading ? "불러오는 중..." : `수신 기준 ${exp.toLocaleString()}회 (5분 주기)`}
          </span>
        </div>
        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th rowSpan={2}>설비</th>
                <th rowSpan={2}>수신율</th>
                <th colSpan={3}>수소 H₂ (ppm)</th>
                <th colSpan={3}>메탄 CH₄ (ppm)</th>
                <th colSpan={3}>절연유 온도 (℃)</th>
                <th rowSpan={2}>유면 낮음</th>
                <th colSpan={3}>알람</th>
              </tr>
              <tr>
                <th>최소</th>
                <th>평균</th>
                <th>최대</th>
                <th>최소</th>
                <th>평균</th>
                <th>최대</th>
                <th>최소</th>
                <th>평균</th>
                <th>최대</th>
                <th>위험</th>
                <th>경고</th>
                <th>주의</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={16}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const a = alarmBy.get(r.device_id) ?? { caution: 0, warning: 0, danger: 0 };
                const rr = rate(r.samples);
                return (
                  <tr key={r.device_id}>
                    <td>
                      <b>{r.name}</b> <span className="t-muted">{r.building}</span>
                    </td>
                    <td className={`num${rr < 95 ? " t-warning" : ""}${rr < 50 ? " t-danger" : ""}`}>
                      {rr.toFixed(1)}%
                    </td>
                    <td className="num">{v(r.h2_min)}</td>
                    <td className="num">{v(r.h2_avg)}</td>
                    <td className={`num${over(r.h2_max, thresholds.h2)}`}>{v(r.h2_max)}</td>
                    <td className="num">{v(r.ch4_min)}</td>
                    <td className="num">{v(r.ch4_avg)}</td>
                    <td className={`num${over(r.ch4_max, thresholds.ch4)}`}>{v(r.ch4_max)}</td>
                    <td className="num">{v(r.temp_min)}</td>
                    <td className="num">{v(r.temp_avg)}</td>
                    <td className={`num${over(r.temp_max, thresholds.temperature)}`}>{v(r.temp_max)}</td>
                    <td className={`num${r.oil_low ? " t-warning" : ""}`}>{r.oil_low ? `${r.oil_low}회` : "-"}</td>
                    <td className={`num${a.danger ? " t-danger" : " t-muted"}`}>{a.danger || "-"}</td>
                    <td className={`num${a.warning ? " t-warning" : " t-muted"}`}>{a.warning || "-"}</td>
                    <td className={`num${a.caution ? " t-caution" : " t-muted"}`}>{a.caution || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            기간 중 점검 작업
          </div>
          <span className="card-note">{report?.maintenance.length ?? 0}건</span>
        </div>
        <div className="table-wrap">
          <table className="fixed">
            <colgroup>
              <col style={{ width: 110 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 140 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>작업일</th>
                <th>설비</th>
                <th>구분</th>
                <th>작업 내용</th>
              </tr>
            </thead>
            <tbody>
              {(report?.maintenance.length ?? 0) === 0 && (
                <tr>
                  <td className="empty" colSpan={4}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {report?.maintenance.map((m, i) => (
                <tr key={i}>
                  <td className="center">{m.work_date}</td>
                  <td>
                    <b>{m.unit}</b>
                  </td>
                  <td className="center">{KIND_LABEL[m.kind] ?? m.kind}</td>
                  <td>{m.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
