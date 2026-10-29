"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { downloadCsv, fmtDate, fmtShort } from "@/lib/format";

type Row = {
  device_id: string;
  name: string;
  building: string;
  capacity: string;
  h2: number | null;
  ch4: number | null;
  updated_at: string | null;
  h2_avg7: number | null;
  ch4_avg7: number | null;
  span_days: number | null;
  h2_1d: number | null;
  ch4_1d: number | null;
  n_1d: number;
  h2_7d: number | null;
  ch4_7d: number | null;
  n_7d: number;
  h2_30d: number | null;
  ch4_30d: number | null;
  n_30d: number;
};

/**
 * 판정 기준 — IEEE C57.104-2019
 *   Table 1 (90번째 백분위수, O2/N2 ≤ 0.2, 연식 미상): H₂ 80, CH₄ 90 ppm
 *   Table 4 (증가율, O2/N2 ≤ 0.2, 4~9개월 구간):     H₂ 50, CH₄ 15 ppm/년
 * 표준은 실험실 시료 기준이며, 온라인 감시에는 더 긴 구간과 높은 기준을 쓰라고 권합니다.
 * 그래서 증가율은 30일 회귀 기울기를 연 단위로 바꿔 비교하고, 기준은 화면에서 바꿀 수 있게 둡니다.
 */
const DEFAULT_CRITERIA = { h2Level: 80, ch4Level: 90, h2Rate: 50, ch4Rate: 15 };

/** 30일 증가율을 믿을 수 있으려면 자료가 최소 이만큼 쌓여 있어야 합니다. */
const MIN_SPAN_DAYS = 7;

type Status = 1 | 2 | 3 | null;

const STATUS_TEXT: Record<1 | 2 | 3, string> = {
  1: "1 · 정상",
  2: "2 · 관찰",
  3: "3 · 조치 검토",
};

const STATUS_CLASS: Record<1 | 2 | 3, string> = {
  1: "",
  2: " lv-caution",
  3: " lv-danger",
};

function rate(v: number | null, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

const n1 = (v: number | null) => (v === null || v === undefined ? "-" : v.toFixed(1));

/**
 * 가스 해석 — H₂·CH₄ 두 가지로 할 수 있는 범위만.
 * (Duval 삼각형·오각형은 C₂H₄·C₂H₂ 등이 필요해 이 센서로는 그릴 수 없습니다.)
 *   CH₄/H₂ < 0.2 이면서 H₂ 가 높거나 오름 → 부분방전(PD) 가능성
 *   CH₄/H₂ > 1   이면서 두 가스 모두 높거나 오름 → 300℃ 미만 저온 과열(T1) 가능성
 */
function interpret(r: Row, highH2: boolean, highCh4: boolean): { text: string; cls: string } {
  if (r.h2 === null || r.ch4 === null) return { text: "자료 없음", cls: " t-muted" };
  if (!highH2 && !highCh4) return { text: "특이 사항 없음", cls: " t-muted" };
  const ratio = r.h2 > 0 ? r.ch4 / r.h2 : Infinity;
  if (highH2 && ratio < 0.2) return { text: `부분방전(PD) 가능성 · CH₄/H₂ ${ratio.toFixed(2)}`, cls: " t-danger" };
  if (highCh4 && ratio > 1) return { text: `저온 과열(T1) 가능성 · CH₄/H₂ ${ratio.toFixed(2)}`, cls: " t-warning" };
  return { text: `유형 판단 불가 · CH₄/H₂ ${ratio.toFixed(2)} — 시료 분석 권장`, cls: " t-caution" };
}

export default function DiagnosisPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crit, setCrit] = useState(DEFAULT_CRITERIA);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis/gas", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "가스 진단 자료를 불러오지 못했습니다.");
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
    void load();
  }, [load]);

  const judged = useMemo(
    () =>
      rows.map((r) => {
        const enough = (r.span_days ?? 0) >= MIN_SPAN_DAYS && r.n_30d >= 3;
        const h2Year = enough && r.h2_30d !== null ? r.h2_30d * 365 : null;
        const ch4Year = enough && r.ch4_30d !== null ? r.ch4_30d * 365 : null;
        const h2Over = r.h2 !== null && r.h2 >= crit.h2Level;
        const ch4Over = r.ch4 !== null && r.ch4 >= crit.ch4Level;
        const h2Fast = h2Year !== null && h2Year >= crit.h2Rate;
        const ch4Fast = ch4Year !== null && ch4Year >= crit.ch4Rate;

        let status: Status = null;
        if (r.h2 !== null && r.ch4 !== null) {
          status = h2Fast || ch4Fast ? 3 : h2Over || ch4Over ? 2 : 1;
        }
        return {
          r,
          enough,
          h2Year,
          ch4Year,
          h2Over,
          ch4Over,
          h2Fast,
          ch4Fast,
          status,
          hint: interpret(r, h2Over || h2Fast, ch4Over || ch4Fast),
        };
      }),
    [rows, crit]
  );

  const count = (s: 1 | 2 | 3) => judged.filter((j) => j.status === s).length;
  const lacking = judged.filter((j) => !j.enough).length;

  const exportCsv = () =>
    downloadCsv(
      `가스진단_${fmtDate(new Date())}.csv`,
      [
        "설비", "위치", "H2 현재", "H2 7일평균", "H2 24시간(ppm/일)", "H2 7일(ppm/일)", "H2 30일(ppm/일)", "H2 연환산(ppm/년)",
        "CH4 현재", "CH4 7일평균", "CH4 24시간(ppm/일)", "CH4 7일(ppm/일)", "CH4 30일(ppm/일)", "CH4 연환산(ppm/년)",
        "C57.104 상태", "가스 해석",
      ],
      judged.map((j) => [
        j.r.name, j.r.building,
        n1(j.r.h2), n1(j.r.h2_avg7), rate(j.r.h2_1d), rate(j.r.h2_7d), rate(j.r.h2_30d), j.h2Year === null ? "-" : j.h2Year.toFixed(0),
        n1(j.r.ch4), n1(j.r.ch4_avg7), rate(j.r.ch4_1d), rate(j.r.ch4_7d), rate(j.r.ch4_30d), j.ch4Year === null ? "-" : j.ch4Year.toFixed(0),
        j.status ? STATUS_TEXT[j.status] : "-", j.hint.text,
      ])
    );

  const critInput = (key: keyof typeof DEFAULT_CRITERIA) => (
    <input
      className="field num narrow"
      type="number"
      min={0}
      value={crit[key]}
      onChange={(e) => setCrit({ ...crit, [key]: Number(e.target.value) || 0 })}
    />
  );

  return (
    <>
      <PageHeader
        title="가스 진단"
        breadcrumb="홈 › 가스 진단"
        subtitle="IEEE C57.104-2019 농도·증가율 판정 · IEC 60599 가스 해석 (참고용)"
        actions={
          <>
            <button className="btn" onClick={exportCsv} disabled={!rows.length}>
              엑셀
            </button>
            <button className="btn primary" onClick={() => void load()} disabled={loading}>
              새로고침
            </button>
          </>
        }
      />

      {error && <div className="banner error">{error}</div>}

      <table className="form-grid" style={{ marginBottom: 16 }}>
        <tbody>
          <tr>
            <th>농도 기준</th>
            <td>
              <span className="inline-fields">
                <span className="filter-unit">H₂</span>
                {critInput("h2Level")}
                <span className="filter-unit">CH₄</span>
                {critInput("ch4Level")}
                <span className="filter-unit">ppm</span>
              </span>
            </td>
            <th>증가율 기준</th>
            <td>
              <span className="inline-fields">
                <span className="filter-unit">H₂</span>
                {critInput("h2Rate")}
                <span className="filter-unit">CH₄</span>
                {critInput("ch4Rate")}
                <span className="filter-unit">ppm/년</span>
                <button className="btn sm" onClick={() => setCrit(DEFAULT_CRITERIA)}>
                  표준값
                </button>
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <table className="grid compact fixed summary-strip" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>대상 설비</th>
            <th>상태 1 · 정상</th>
            <th>상태 2 · 관찰</th>
            <th>상태 3 · 조치 검토</th>
            <th>30일 자료 부족</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-label="대상 설비" className="num">{rows.length}대</td>
            <td data-label="상태 1 · 정상" className="num">{count(1)}대</td>
            <td data-label="상태 2 · 관찰" className={`num${count(2) ? " t-caution" : ""}`}>{count(2)}대</td>
            <td data-label="상태 3 · 조치 검토" className={`num${count(3) ? " t-danger" : ""}`}>{count(3)}대</td>
            <td data-label="30일 자료 부족" className={`num${lacking ? " t-muted" : ""}`}>{lacking}대</td>
          </tr>
        </tbody>
      </table>

      <div className="card flush" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            설비별 가스 진단
          </div>
          <span className="card-note">증가율 = 구간 선형회귀 기울기 (ppm/일)</span>
        </div>
        <div className="table-wrap">
          <table className="report-table diag-table">
            <thead>
              <tr>
                <th rowSpan={2}>설비</th>
                <th colSpan={5}>수소 H₂</th>
                <th colSpan={5}>메탄 CH₄</th>
                <th rowSpan={2}>C57.104<br />상태</th>
                <th rowSpan={2}>가스 해석</th>
                <th rowSpan={2}>최근 수신</th>
              </tr>
              <tr>
                <th>현재</th>
                <th>24시간</th>
                <th>7일</th>
                <th>30일</th>
                <th>연환산</th>
                <th>현재</th>
                <th>24시간</th>
                <th>7일</th>
                <th>30일</th>
                <th>연환산</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={14}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {judged.map((j) => (
                <tr key={j.r.device_id}>
                  <td>
                    <b>{j.r.name}</b> <span className="t-muted">{j.r.building}</span>
                  </td>
                  <td className={`num${j.h2Over ? " lv-caution" : ""}`}>{n1(j.r.h2)}</td>
                  <td className="num">{rate(j.r.h2_1d)}</td>
                  <td className="num">{rate(j.r.h2_7d)}</td>
                  <td className="num">{j.enough ? rate(j.r.h2_30d) : <span className="t-muted">부족</span>}</td>
                  <td className={`num${j.h2Fast ? " lv-danger" : ""}`}>
                    {j.h2Year === null ? "-" : rate(j.h2Year, 0)}
                  </td>
                  <td className={`num${j.ch4Over ? " lv-caution" : ""}`}>{n1(j.r.ch4)}</td>
                  <td className="num">{rate(j.r.ch4_1d)}</td>
                  <td className="num">{rate(j.r.ch4_7d)}</td>
                  <td className="num">{j.enough ? rate(j.r.ch4_30d) : <span className="t-muted">부족</span>}</td>
                  <td className={`num${j.ch4Fast ? " lv-danger" : ""}`}>
                    {j.ch4Year === null ? "-" : rate(j.ch4Year, 0)}
                  </td>
                  <td className={`center${j.status ? STATUS_CLASS[j.status] : " t-muted"}`}>
                    {j.status ? STATUS_TEXT[j.status] : "-"}
                  </td>
                  <td className={`diag-hint${j.hint.cls}`}>{j.hint.text}</td>
                  <td className="center">{fmtShort(j.r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <table className="form-grid note-grid">
        <tbody>
          <tr>
            <th>상태 판정</th>
            <td>
              상태 3: 30일 증가율(연환산)이 증가율 기준 이상 · 상태 2: 현재 농도가 농도 기준 이상 · 상태 1: 둘 다 아님.
              기준값은 IEEE C57.104-2019 Table 1(90번째 백분위수)·Table 4 의 밀봉형(O₂/N₂ ≤ 0.2) 값입니다.
              개방형(콘서베이터 호흡형) 변압기는 기준이 더 낮다(H₂ 40 · CH₄ 20 ppm). 이 경우 위 기준값을 바꿔 적용한다.
            </td>
          </tr>
          <tr>
            <th>가스 해석</th>
            <td>
              CH₄/H₂ 비가 0.2 미만이면서 수소가 높거나 오르면 부분방전, 1 초과이면서 메탄이 높거나 오르면 300℃ 미만
              저온 과열 가능성으로 봅니다(IEC 60599). 고장이 아니어도 절연유 자체에서 수소·메탄이 생기는 경우(stray
              gassing)가 있어 오진할 수 있습니다.
            </td>
          </tr>
          <tr>
            <th>확인 방법</th>
            <td>
              이 화면은 온라인 센서(H₂·CH₄) 두 가지로 보는 참고 판정입니다. 상태 2 이상이면 절연유 시료를 채취해
              실험실 DGA(아세틸렌·에틸렌 포함)로 확인하고, 결과를 [점검 이력]에 기록한다.
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
