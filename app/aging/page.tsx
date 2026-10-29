"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { downloadCsv, fmtDate } from "@/lib/format";

interface AgingRow {
  device_id: string;
  name: string;
  building: string;
  hours: number;
  faa_avg: number | null;
  faa_max: number | null;
  temp_avg: number | null;
  temp_max: number | null;
  hours_over_98: number;
  hours_over_110: number;
  consumed_hours: number | null;
  loss_pct: number | null;
  years_at_rate: number | null;
}

const PERIODS = [7, 30, 90, 365];

/** 노화 속도 해석 — 1 이 정상 설계 수명 속도 */
function faaClass(f: number | null) {
  if (f === null) return " t-muted";
  if (f >= 2) return " lv-danger";
  if (f >= 1) return " lv-warning";
  if (f >= 0.5) return " lv-caution";
  return "";
}

const n1 = (v: number | null, d = 1) => (v === null || v === undefined ? "-" : v.toFixed(d));

/** 아주 작은 값은 지수 대신 읽을 수 있는 자릿수로 */
function small(v: number | null) {
  if (v === null || v === undefined) return "-";
  if (v === 0) return "0";
  if (v < 0.001) return "< 0.001";
  if (v < 1) return v.toFixed(3);
  return v.toFixed(2);
}

export default function AgingPage() {
  const [days, setDays] = useState(30);
  const [gradient, setGradient] = useState(20);
  const [rows, setRows] = useState<AgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number, g: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analysis/aging?days=${d}&gradient=${g}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "열화 계산을 하지 못했습니다.");
        setRows([]);
        return;
      }
      setRows(json.devices ?? []);
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days, gradient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const worst = rows.reduce<AgingRow | null>(
    (b, r) => (r.faa_avg !== null && (!b || (b.faa_avg ?? 0) < r.faa_avg) ? r : b),
    null
  );
  const over110 = rows.filter((r) => r.hours_over_110 > 0).length;

  const exportCsv = () =>
    downloadCsv(
      `열화수명_${days}일_${fmtDate(new Date())}.csv`,
      ["설비", "위치", "집계 시간(h)", "평균 유온(℃)", "최고 유온(℃)", "추정 최고점 최고(℃)",
       "등가 노화 계수", "최대 노화 계수", "수명 소비(h)", "수명 손실(%)", "98℃ 이상(h)", "110℃ 이상(h)"],
      rows.map((r) => [
        r.name, r.building, n1(r.hours), n1(r.temp_avg), n1(r.temp_max),
        r.temp_max === null ? "-" : (r.temp_max + gradient).toFixed(1),
        small(r.faa_avg), small(r.faa_max), small(r.consumed_hours), small(r.loss_pct),
        n1(r.hours_over_98), n1(r.hours_over_110),
      ])
    );

  return (
    <>
      <PageHeader
        title="열화·수명"
        breadcrumb="홈 › 열화·수명"
        subtitle="IEEE C57.91 노화 가속 계수 기준 · 절연지 정상 수명 180,000시간"
        actions={
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>
            엑셀
          </button>
        }
      />

      <div className="filterbar">
        <span className="filter-label">기간</span>
        <select
          className="field"
          value={days}
          onChange={(e) => {
            const d = Number(e.target.value);
            setDays(d);
            void load(d, gradient);
          }}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              최근 {p}일
            </option>
          ))}
        </select>

        <span className="filter-label">최고점 온도차</span>
        <input
          className="field num narrow"
          type="number"
          min={0}
          max={40}
          step={1}
          value={gradient}
          onChange={(e) => setGradient(Number(e.target.value))}
        />
        <span className="filter-unit">℃ (유온 + 이 값 = 권선 최고점 추정)</span>

        <div className="filterbar-right">
          <button className="btn primary" onClick={() => void load(days, gradient)} disabled={loading}>
            조회
          </button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      <table className="grid compact fixed summary-strip" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>대상 설비</th>
            <th>노화가 가장 빠른 설비</th>
            <th>그 설비의 등가 노화 계수</th>
            <th>최고점 110℃ 넘은 설비</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-label="대상 설비" className="num">{rows.length}대</td>
            <td data-label="노화가 가장 빠른 설비" className="num">{worst ? worst.name : "-"}</td>
            <td data-label="그 설비의 등가 노화 계수" className={`num${faaClass(worst?.faa_avg ?? null)}`}>{small(worst?.faa_avg ?? null)}</td>
            <td data-label="최고점 110℃ 넘은 설비" className={`num${over110 ? " t-danger" : ""}`}>{over110}대</td>
          </tr>
        </tbody>
      </table>

      <div className="card flush" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            설비별 절연 열화
          </div>
          <span className="card-note">{loading ? "계산 중..." : `최근 ${days}일`}</span>
        </div>
        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th rowSpan={2}>설비</th>
                <th rowSpan={2}>집계 시간</th>
                <th colSpan={3}>온도 (℃)</th>
                <th colSpan={2}>노화 가속 계수 F<sub>AA</sub></th>
                <th colSpan={2}>기간 중 수명 소비</th>
                <th rowSpan={2}>지금 속도의<br />정상 수명</th>
                <th colSpan={2}>최고점 고온 시간</th>
              </tr>
              <tr>
                <th>평균 유온</th>
                <th>최고 유온</th>
                <th>최고점 추정</th>
                <th>등가(평균)</th>
                <th>최대</th>
                <th>시간</th>
                <th>손실률</th>
                <th>98℃ 이상</th>
                <th>110℃ 이상</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={12}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.device_id}>
                  <td>
                    <b>{r.name}</b> <span className="t-muted">{r.building}</span>
                  </td>
                  <td className="num">{n1(r.hours)} h</td>
                  <td className="num">{n1(r.temp_avg)}</td>
                  <td className="num">{n1(r.temp_max)}</td>
                  <td className="num">{r.temp_max === null ? "-" : (r.temp_max + gradient).toFixed(1)}</td>
                  <td className={`num${faaClass(r.faa_avg)}`}>{small(r.faa_avg)}</td>
                  <td className={`num${faaClass(r.faa_max)}`}>{small(r.faa_max)}</td>
                  <td className="num">{r.consumed_hours === null ? "-" : `${small(r.consumed_hours)} h`}</td>
                  <td className="num">{r.loss_pct === null ? "-" : `${small(r.loss_pct)} %`}</td>
                  <td className="num">
                    {r.years_at_rate === null
                      ? "-"
                      : r.years_at_rate > 999
                        ? "999년 이상"
                        : `${r.years_at_rate.toFixed(0)}년`}
                  </td>
                  <td className={`num${r.hours_over_98 ? " t-warning" : " t-muted"}`}>{n1(r.hours_over_98)} h</td>
                  <td className={`num${r.hours_over_110 ? " t-danger" : " t-muted"}`}>{n1(r.hours_over_110)} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <table className="form-grid note-grid">
        <tbody>
          <tr>
            <th>노화 가속 계수</th>
            <td>
              F<sub>AA</sub> = exp(15000/383 − 15000/(θ<sub>H</sub>+273)). 권선 최고점 θ<sub>H</sub> 110℃ 에서 1,
              약 6℃ 오를 때마다 두 배가 됩니다. 1 보다 작으면 설계 수명보다 천천히, 크면 빨리 늙습니다.
            </td>
          </tr>
          <tr>
            <th>최고점 추정</th>
            <td>
              이 시스템은 상부 유온만 측정하므로 최고점 = 유온 + 최고점 온도차로 어림합니다. 온도차는 변압기
              시험성적서의 권선 온도 상승값에서 구하는 것이 정확하며, 부하가 크게 바뀌는 설비는 실제와 차이가
              납니다.
            </td>
          </tr>
          <tr>
            <th>정상 수명</th>
            <td>IEEE C57.91 의 절연지 정상 수명 180,000시간(약 20.6년)을 기준으로 수명 손실률을 냅니다.</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
