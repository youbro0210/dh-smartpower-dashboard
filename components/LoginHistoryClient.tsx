"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "./PageHeader";

interface LoginEvent {
  id: number;
  user_id: string | null;
  email: string | null;
  success: boolean;
  ip: string | null;
  created_at: string;
}

const PAGE_SIZE = 50;

export default function LoginHistoryClient() {
  const [rows, setRows] = useState<LoginEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
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

      try {
        const res = await fetch(`/api/admin/logins?${params}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.error ?? "로그인 이력을 불러오지 못했습니다.");
          setRows([]);
          setTotal(0);
          return;
        }
        setRows(json.events ?? []);
        setTotal(json.total ?? 0);
        setPage(targetPage);
      } catch {
        setError("서버에 연결할 수 없습니다.");
      } finally {
        setLoading(false);
      }
    },
    [from, to]
  );

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const failures = rows.filter((r) => !r.success).length;

  return (
    <>
      <PageHeader
        title="로그인 이력"
        breadcrumb="홈 › 로그인 이력"
        subtitle={`총 ${total.toLocaleString()}건 · 성공과 실패를 모두 기록합니다`}
      />

      <div className="filterbar">
        <span className="filter-label">기간</span>
        <input className="field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--muted)", fontSize: 12 }}>~</span>
        <input className="field" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="filterbar-right">
          <button
            className="btn"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            초기화
          </button>
          <button className="btn primary" onClick={() => void load(1)} disabled={loading}>
            조회
          </button>
        </div>
      </div>

      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            접속 기록
          </div>
          <span className="card-note">
            현재 페이지 실패 {failures}건 · {page} / {lastPage} 페이지
          </span>
        </div>

        {error && <div className="empty" style={{ color: "var(--danger)" }}>{error}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }}>No</th>
                <th>시각</th>
                <th>이메일</th>
                <th>결과</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">조회 조건에 해당하는 기록이 없습니다.</div>
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
                  <td>{r.email ?? "-"}</td>
                  <td>
                    <span className={`badge ${r.success ? "normal" : "danger"}`}>
                      {r.success ? "성공" : "실패"}
                    </span>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{r.ip ?? "-"}</td>
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
          <span className="card-note">{loading ? "불러오는 중..." : `${rows.length}건 표시`}</span>
        </div>
      </div>
    </>
  );
}
