"use client";

import Pager from "@/components/Pager";
import { useCallback, useState } from "react";
import PageHeader from "./PageHeader";
import { fmtDateTime } from "@/lib/format";

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
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
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
        setSearched(true);
      } catch {
        setError("서버에 연결할 수 없습니다.");
      } finally {
        setLoading(false);
      }
    },
    [from, to]
  );


  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const failures = rows.filter((r) => !r.success).length;

  return (
    <>
      <PageHeader
        title="로그인 이력"
        breadcrumb="홈 › 로그인 이력"
        subtitle={`총 ${total.toLocaleString()}건`}
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

        {error && <div className="banner error">{error}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 56 }}>No</th>
                <th style={{ width: 170 }}>시각</th>
                <th>이메일</th>
                <th style={{ width: 72 }}>결과</th>
                <th style={{ width: 160 }}>IP</th>
              </tr>
            </thead>
            <tbody>
              {searched && !loading && rows.length === 0 && !error && (
                <tr>
                  <td className="empty" colSpan={5}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="center">{(page - 1) * PAGE_SIZE + i + 1}</td>
                  <td className="center">
                    {fmtDateTime(r.created_at, true)}
                  </td>
                  <td>{r.email ?? "-"}</td>
                  <td className="center">
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

        {searched && (
          <Pager page={page} total={total} pageSize={PAGE_SIZE} loading={loading} onPage={(n) => void load(n)} />
        )}
      </div>
    </>
  );
}
