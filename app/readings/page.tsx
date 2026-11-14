"use client";

import { useCallback, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Pager from "@/components/Pager";
import TrendChart from "@/components/TrendChart";
import { useDashboard } from "@/lib/configStore";
import { downloadCsv, fmtDate, fmtDateTime, fmtValue } from "@/lib/format";
import type { DeviceTrend } from "@/lib/types";

interface ReadingRow {
  id: number;
  device_id: string;
  name: string;
  h2: number | null;
  ch4: number | null;
  temperature: number | null;
  oil_level: string | null;
  measured_at: string;
  received_at: string;
  delay_sec: number;
  replay: boolean;
}

interface SeriesPoint {
  measured_at: string;
  h2: number | null;
  ch4: number | null;
  temperature: number | null;
}

const KINDS = [
  { key: "", label: "전체" },
  { key: "live", label: "실시간" },
  { key: "replay", label: "재전송" },
] as const;

const SIZES = [50, 100, 200, 500];

const pad = (n: number) => String(n).padStart(2, "0");

/** 화면에서 고른 날짜(한국 시각)의 시작 시각 */
const dayStart = (day: string) => `${day}T00:00:00+09:00`;
const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00+09:00`);
  d.setTime(d.getTime() + 24 * 3600 * 1000);
  return d.toISOString();
};

function fmtDelay(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분 ${pad(s % 60)}초`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 ${pad(Math.floor((s % 3600) / 60))}분`;
  return `${Math.floor(s / 86400)}일 ${Math.floor((s % 86400) / 3600)}시간`;
}


export default function ReadingsPage() {
  const { devices } = useDashboard();
  const today = fmtDate(new Date());

  const [rows, setRows] = useState<ReadingRow[]>([]);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [device, setDevice] = useState("");
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState({ total: 0, replay: 0 });

  const load = useCallback(
    async (targetPage = 1, override?: { kind?: string }) => {
      const k = override?.kind ?? kind;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize) });
      if (from) params.set("from", dayStart(from));
      if (to) params.set("to", nextDay(to));
      if (device) params.set("device", device);
      if (k) params.set("kind", k);

      try {
        const res = await fetch(`/api/telemetry?${params}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.error ?? "계측 이력을 불러오지 못했습니다.");
          setRows([]);
          setSeries([]);
          setTotal(0);
          return;
        }
        setRows(json.rows ?? []);
        setSeries(json.series ?? []);
        setTotal(json.total ?? 0);
        setSummary({ total: json.allCount ?? 0, replay: json.replayCount ?? 0 });
        setPage(targetPage);
        setSearched(true);
      } catch {
        setError("서버에 연결할 수 없습니다.");
      } finally {
        setLoading(false);
      }
    },
    [from, to, device, kind, pageSize]
  );

  const search = () => void load(1);

  const pickKind = (key: string) => {
    setKind(key);
    void load(1, { kind: key });
  };

  // 차트: 기간이 하루 안이면 시:분:초, 넘으면 월-일 시:분
  const trend: DeviceTrend | undefined = useMemo(() => {
    if (!series.length) return undefined;
    const sameDay = fmtDate(series[0].measured_at) === fmtDate(series[series.length - 1].measured_at);
    const label = (v: string) => {
      const d = new Date(v);
      const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return sameDay ? `${hm}:${pad(d.getSeconds())}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
    };
    return {
      labels: series.map((p) => label(p.measured_at)),
      temperature: series.map((p) => (p.temperature === null ? null : Number(p.temperature))),
      h2: series.map((p) => (p.h2 === null ? null : Number(p.h2))),
      ch4: series.map((p) => (p.ch4 === null ? null : Number(p.ch4))),
    };
  }, [series]);

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  const exportCsv = () =>
    downloadCsv(
      `계측이력_${fmtDateTime(new Date()).replace(/[-: ]/g, "")}.csv`,
      ["No", "설비", "측정 시각", "수신 시각", "지연", "구분", "H2(ppm)", "CH4(ppm)", "온도(℃)", "유면"],
      rows.map((r, i) => [
        (page - 1) * pageSize + i + 1,
        r.name,
        fmtDateTime(r.measured_at, true),
        fmtDateTime(r.received_at, true),
        fmtDelay(r.delay_sec),
        r.replay ? "재전송" : "실시간",
        r.h2 ?? "",
        r.ch4 ?? "",
        r.temperature ?? "",
        r.oil_level ?? "-",
      ])
    );

  const counts: Record<string, number> = {
    "": summary.total,
    live: summary.total - summary.replay,
    replay: summary.replay,
  };

  return (
    <>
      <PageHeader
        title="계측 이력"
        breadcrumb="분석 › 계측 이력"
        subtitle={searched ? `총 ${total.toLocaleString()}건` : undefined}
      />

      <div className="filterbar">
        <span className="filter-label">측정일</span>
        <input className="field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--muted)", fontSize: 12 }}>~</span>
        <input className="field" type="date" value={to} onChange={(e) => setTo(e.target.value)} />

        <span className="filter-label">설비</span>
        <select className="field" value={device} onChange={(e) => setDevice(e.target.value)}>
          <option value="">전체</option>
          {devices.map((d) => (
            <option key={d.device_id} value={d.device_id}>
              {d.name}
            </option>
          ))}
        </select>

        <span className="filter-label">구분</span>
        <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>

        <span className="filter-label">표시</span>
        <select className="field" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          {SIZES.map((n) => (
            <option key={n} value={n}>
              {n}건
            </option>
          ))}
        </select>

        <div className="filterbar-right">
          <button
            className="btn"
            onClick={() => {
              setFrom(today);
              setTo(today);
              setDevice("");
              setKind("");
            }}
          >
            초기화
          </button>
          <button className="btn primary" onClick={search} disabled={loading}>
            조회
          </button>
        </div>
      </div>

      {searched && (
        <table className="grid compact fixed" style={{ marginBottom: 16 }}>
          <thead>
            <tr>
              {KINDS.map((k) => (
                <th key={k.key}>{k.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {KINDS.map((k) => (
                <td key={k.key} className={`num${kind === k.key ? " picked" : ""}`}>
                  <button
                    type="button"
                    className="cell-link"
                    onClick={() => pickKind(k.key)}
                    disabled={loading}
                    title={`${k.label}만 보기`}
                  >
                    {(counts[k.key] ?? 0).toLocaleString()}건
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}

      {searched && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div className="card-title">
              <span className="accent-bar" />
              측정값 추이
            </div>
            <div className="card-tools">
              <span className="card-note">{series.length.toLocaleString()}개 지점</span>
            </div>
          </div>
          {trend ? (
            <TrendChart trend={trend} height={220} />
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "22px 0", textAlign: "center" }}>
              조회된 데이터가 없습니다.
            </div>
          )}
        </div>
      )}

      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            계측 목록
          </div>
          <div className="card-tools">
            <span className="card-note">
              {page} / {lastPage} 페이지
            </span>
            <button className="btn sm" onClick={exportCsv} disabled={!rows.length}>
              엑셀
            </button>
          </div>
        </div>

        {error && <div className="banner error">{error}</div>}

        <div className="table-wrap">
          <table className="fixed">
            <colgroup>
              <col style={{ width: 64 }} />
              <col />
              <col style={{ width: 168 }} />
              <col style={{ width: 168 }} />
              <col style={{ width: 104 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th>No</th>
                <th>설비</th>
                <th>측정 시각</th>
                <th>수신 시각</th>
                <th>지연</th>
                <th>구분</th>
                <th>H2(ppm)</th>
                <th>CH4(ppm)</th>
                <th>온도(℃)</th>
                <th>유면</th>
              </tr>
            </thead>
            <tbody>
              {searched && !loading && rows.length === 0 && !error && (
                <tr>
                  <td className="empty" colSpan={10}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="center">{(page - 1) * pageSize + i + 1}</td>
                  <td>
                    <b>{r.name}</b>
                  </td>
                  <td className="center">{fmtDateTime(r.measured_at, true)}</td>
                  <td className="center">{fmtDateTime(r.received_at, true)}</td>
                  <td className="num">{fmtDelay(r.delay_sec)}</td>
                  <td className="center">
                    <span className={`badge ${r.replay ? "caution" : "normal"}`}>
                      {r.replay ? "재전송" : "실시간"}
                    </span>
                  </td>
                  <td className="num">{fmtValue(r.h2)}</td>
                  <td className="num">{fmtValue(r.ch4)}</td>
                  <td className="num">{fmtValue(r.temperature, 1)}</td>
                  <td className="center">{r.oil_level ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {searched && (
          <Pager page={page} total={total} pageSize={pageSize} loading={loading} onPage={(n) => void load(n)} />
        )}
      </div>
    </>
  );
}
