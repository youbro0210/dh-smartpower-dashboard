"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useDashboard } from "@/lib/configStore";
import { downloadCsv, fmtDateTime } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/types";

interface AlarmRow {
  id: number;
  device_id: string | null;
  unit: string;
  item: string;
  level: "caution" | "warning" | "danger";
  detail: string | null;
  created_at: string;
}

const PAGE_SIZE = 50;

const LEVELS = [
  { key: "", label: "전체", cls: "" },
  { key: "danger", label: "위험", cls: "t-danger" },
  { key: "warning", label: "경고", cls: "t-warning" },
  { key: "caution", label: "주의", cls: "t-caution" },
] as const;

export default function AlarmsPage() {
  const { devices } = useDashboard();
  const [rows, setRows] = useState<AlarmRow[]>([]);
  const [total, setTotal] = useState(0);
  const [byLevel, setByLevel] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [level, setLevel] = useState("");
  const [device, setDevice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (targetPage = 1, override?: { level?: string }) => {
      const lv = override?.level ?? level;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(PAGE_SIZE),
      });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (lv) params.set("level", lv);
      if (device) params.set("device", device);

      try {
        const res = await fetch(`/api/alarms?${params}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.error ?? "알람 이력을 불러오지 못했습니다.");
          setRows([]);
          setTotal(0);
          return;
        }
        setRows(json.events ?? []);
        setTotal(json.total ?? 0);
        setByLevel(json.byLevel ?? {});
        setPage(targetPage);
      } catch {
        setError("서버에 연결할 수 없습니다.");
      } finally {
        setLoading(false);
      }
    },
    [from, to, level, device]
  );

  useEffect(() => {
    void load(1);
    // 최초 1회만 조회합니다. 이후는 조회 버튼으로 실행합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allCount = Object.values(byLevel).reduce((a, b) => a + b, 0);

  // 요약 칸을 누르면 그 등급만 바로 조회합니다.
  const pickLevel = (key: string) => {
    setLevel(key);
    void load(1, { level: key });
  };

  const exportCsv = () =>
    downloadCsv(
      `알람이력_${fmtDateTime(new Date()).replace(/[: ]/g, "")}.csv`,
      ["No", "발생 시각", "설비", "항목", "등급", "내용"],
      rows.map((r, i) => [
        (page - 1) * PAGE_SIZE + i + 1,
        fmtDateTime(r.created_at, true),
        r.unit,
        r.item,
        STATUS_LABEL[r.level],
        r.detail ?? "",
      ])
    );

  return (
    <>
      <PageHeader
        title="알람 이력"
        breadcrumb="홈 › 알람 이력"
        subtitle={`총 ${total.toLocaleString()}건`}
      />

      <div className="filterbar">
        <span className="filter-label">발생일</span>
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

        <span className="filter-label">등급</span>
        <select className="field" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">전체</option>
          <option value="danger">위험</option>
          <option value="warning">경고</option>
          <option value="caution">주의</option>
        </select>

        <div className="filterbar-right">
          <button
            className="btn"
            onClick={() => {
              setFrom("");
              setTo("");
              setLevel("");
              setDevice("");
            }}
          >
            초기화
          </button>
          <button className="btn primary" onClick={() => void load(1)} disabled={loading}>
            조회
          </button>
        </div>
      </div>

      <table className="grid compact fixed" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            {LEVELS.map((l) => (
              <th key={l.key}>{l.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {LEVELS.map((l) => {
              const n = l.key ? byLevel[l.key] ?? 0 : allCount;
              return (
                <td key={l.key} className={`num ${l.cls}${level === l.key ? " picked" : ""}`}>
                  <button
                    type="button"
                    className="cell-link"
                    onClick={() => pickLevel(l.key)}
                    disabled={loading}
                    title={`${l.label} 알람만 보기`}
                  >
                    {n.toLocaleString()}건
                  </button>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>

      <div className="card flush alarm-table">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            알람 목록
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
              <col style={{ width: 56 }} />
              <col style={{ width: 168 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 128 }} />
              <col style={{ width: 72 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>No</th>
                <th>발생 시각</th>
                <th>설비</th>
                <th>항목</th>
                <th>등급</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td className="empty" colSpan={6}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="center a-no">{(page - 1) * PAGE_SIZE + i + 1}</td>
                  <td className="center a-time">
                    {fmtDateTime(r.created_at, true)}
                  </td>
                  <td className="a-unit">
                    <b>{r.unit}</b>
                  </td>
                  <td className="a-item">{r.item}</td>
                  <td className="center a-level">
                    <span className={`badge ${r.level}`}>{STATUS_LABEL[r.level]}</span>
                  </td>
                  <td
                    className="a-detail"
                    data-empty={r.detail ? undefined : "true"}
                    title={r.detail ?? undefined}
                  >
                    {r.detail ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="save-bar" style={{ justifyContent: "center" }}>
          <button className="btn" disabled={page <= 1 || loading} onClick={() => void load(page - 1)}>
            이전
          </button>
          <button
            className="btn"
            disabled={page >= lastPage || loading}
            onClick={() => void load(page + 1)}
          >
            다음
          </button>
          <span className="card-note">{loading ? "불러오는 중..." : `${total.toLocaleString()}건 중 ${rows.length.toLocaleString()}건 표시`}</span>
        </div>
      </div>
    </>
  );
}
