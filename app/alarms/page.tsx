"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
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

const LEVEL_COLOR: Record<string, string> = {
  caution: "var(--caution)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

export default function AlarmsPage() {
  const [rows, setRows] = useState<AlarmRow[]>([]);
  const [total, setTotal] = useState(0);
  const [byLevel, setByLevel] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [level, setLevel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (targetPage = 1) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(PAGE_SIZE),
      });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (level) params.set("level", level);

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
    [from, to, level]
  );

  useEffect(() => {
    void load(1);
    // 최초 1회만 조회합니다. 이후는 조회 버튼으로 실행합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
            }}
          >
            초기화
          </button>
          <button className="btn primary" onClick={() => void load(1)} disabled={loading}>
            조회
          </button>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-label">전체</div>
          <div className="kpi-value">
            {total}
            <small>건</small>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">위험</div>
          <div className="kpi-value danger">{byLevel.danger ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">경고</div>
          <div className="kpi-value warning">{byLevel.warning ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">주의</div>
          <div className="kpi-value caution">{byLevel.caution ?? 0}</div>
        </div>
      </div>

      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            알람 목록
          </div>
          <span className="card-note">
            {page} / {lastPage} 페이지
          </span>
        </div>

        {error && <div className="empty" style={{ color: "var(--danger)" }}>{error}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }}>No</th>
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
                  <td colSpan={6}>
                    <div className="empty">조회 조건에 해당하는 알람이 없습니다.</div>
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="num" style={{ color: "var(--faint)" }}>
                    {(page - 1) * PAGE_SIZE + i + 1}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {new Date(r.created_at).toLocaleString("ko-KR", { hour12: false })}
                  </td>
                  <td>
                    <b>{r.unit}</b>
                  </td>
                  <td>{r.item}</td>
                  <td>
                    <span className={`badge ${r.level}`}>{STATUS_LABEL[r.level]}</span>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{r.detail ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="save-bar" style={{ padding: "12px 16px", marginTop: 0 }}>
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
          <span className="card-note">{loading ? "불러오는 중..." : `${total}건 중 ${rows.length}건 표시`}</span>
        </div>
      </div>
    </>
  );
}
