"use client";

import { Fragment, useCallback, useState } from "react";
import PageHeader from "./PageHeader";
import SettingsTabs from "./SettingsTabs";
import Pager from "./Pager";
import { fmtValue } from "@/lib/format";

interface Row {
  id: number;
  topic: string;
  src_type: string | null;
  src_id: string | null;
  kind: string | null;
  device_ids: string[] | null;
  item_count: number;
  stored_count: number;
  replay: boolean;
  status: "ok" | "warn" | "error";
  message: string | null;
  payload: unknown;
  received_at: string;
}

interface Summary {
  total: number;
  ok: number;
  warn: number;
  error: number;
  last_at: string | null;
}

const STATUS_LABEL: Record<Row["status"], string> = {
  ok: "정상",
  warn: "주의",
  error: "오류",
};

const STATUS_BADGE: Record<Row["status"], string> = {
  ok: "normal",
  warn: "caution",
  error: "danger",
};

const KIND_LABEL: Record<string, string> = {
  tele: "계측값",
  stat: "상태",
  "cmd/ack": "명령 응답",
};

interface Item {
  device_id: string;
  measured_at: string;
  received_at: string;
  h2: number | null;
  ch4: number | null;
  temperature: number | null;
  oil_level: string | null;
}


function timeText(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 수집기가 실제로 받은 메시지를 원문 그대로 보여줍니다.
 * 규격이 어긋났을 때 장비 쪽 문제인지 서버 쪽 문제인지 여기서 바로 가려집니다.
 */
export default function IngestClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [keyword, setKeyword] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const toggle = async (row: Row) => {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    setOpenId(row.id);
    setShowRaw(false);
    setItems(null);
    if (row.kind !== "tele") return;
    const res = await fetch(`/api/ingest/items?id=${row.id}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setItems(res.ok ? body.items ?? [] : []);
  };

  const load = useCallback(async (targetPage = 1) => {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize) });
    if (status) params.set("status", status);
    if (kind) params.set("kind", kind);
    if (keyword.trim()) params.set("q", keyword.trim());

    setLoading(true);
    try {
      const res = await fetch(`/api/ingest?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (res.ok) {
        setRows(body.log ?? []);
        setTotal(body.total ?? 0);
        setSummary(body.summary ?? null);
        setPage(targetPage);
        setOpenId(null);
        setSearched(true);
      }
    } finally {
      setLoading(false);
    }
  }, [status, kind, keyword, pageSize]);

  return (
    <>
      <PageHeader
        title="수집 내역"
        breadcrumb="홈 › 설정 › 수집 내역"
        subtitle="수신 메시지 원문"
      />

      <SettingsTabs active="ingest" />

      <table className="grid compact fixed summary-strip" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>24시간 수신</th>
            <th>정상</th>
            <th>주의</th>
            <th>오류</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-label="24시간 수신" className="num">{(summary?.total ?? 0).toLocaleString()}건</td>
            <td data-label="정상" className="num">{(summary?.ok ?? 0).toLocaleString()}건</td>
            <td data-label="주의" className={`num${summary?.warn ? " t-caution" : ""}`}>
              {(summary?.warn ?? 0).toLocaleString()}건
            </td>
            <td data-label="오류" className={`num${summary?.error ? " t-danger" : ""}`}>
              {(summary?.error ?? 0).toLocaleString()}건
            </td>
          </tr>
        </tbody>
      </table>

      <div className="filterbar">
        <span className="filter-label">상태</span>
        <select className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">전체</option>
          <option value="ok">정상</option>
          <option value="warn">주의</option>
          <option value="error">오류</option>
        </select>

        <span className="filter-label">종류</span>
        <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">전체</option>
          <option value="tele">계측값</option>
          <option value="stat">상태</option>
          <option value="cmd/ack">명령 응답</option>
        </select>

        <span className="filter-label">검색</span>
        <input
          className="field"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="토픽 · 장치 · 설비 id"
        />

        <span className="filter-label">페이지당</span>
        <select className="field" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          {[50, 100, 200].map((n) => (
            <option key={n} value={n}>{n}건</option>
          ))}
        </select>

        <div className="filterbar-right">
          <button
            className="btn"
            onClick={() => {
              setStatus("");
              setKind("");
              setKeyword("");
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
            수신 내역
          </div>
          <span className="card-note">{searched ? `${total.toLocaleString()}건` : ""}</span>
        </div>

        <div className="table-wrap">
          <table className="fixed">
            <colgroup>
              <col style={{ width: 128 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 300 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 64 }} />
              <col style={{ width: 64 }} />
              <col style={{ width: 64 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>수신 시각</th>
                <th>종류</th>
                <th>토픽</th>
                <th>설비</th>
                <th className="num">건수</th>
                <th className="num">적재</th>
                <th>결과</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {searched && !loading && rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={8}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const open = openId === row.id;
                const devices = row.device_ids ?? [];
                return (
                  <Fragment key={row.id}>
                  <tr className={`clickable${open ? " selected" : ""}`} onClick={() => void toggle(row)}>
                    <td className="center">{timeText(row.received_at)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {KIND_LABEL[row.kind ?? ""] ?? row.kind ?? "-"}
                      {row.replay && <span className="chip">재전송</span>}
                    </td>
                    <td title={row.topic}>{row.topic}</td>
                    <td className="center">
                      {devices.length === 0
                        ? "-"
                        : devices.length <= 2
                          ? devices.join(", ")
                          : `${devices.slice(0, 2).join(", ")} 외 ${devices.length - 2}`}
                    </td>
                    <td className="num">{row.item_count}</td>
                    <td className="num">{row.stored_count}</td>
                    <td className="center">
                      <span className={`badge ${STATUS_BADGE[row.status]}`}>
                        {STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td
                      className={row.status === "error" ? "t-danger" : row.status === "warn" ? "t-caution" : "t-muted"}
                      title={row.message ?? undefined}
                    >
                      {row.message ?? "-"}
                    </td>
                  </tr>
                  {open && (
                    <tr className="detail-row">
                      <td colSpan={8}>
                        {row.kind === "tele" && (
                          <>
                            <div className="spark-title">
                              담긴 계측값 {items ? `${items.length.toLocaleString()}건` : ""}
                            </div>
                            <table className="fixed fit sub-table">
                              <colgroup>
                                <col style={{ width: 56 }} />
                                <col style={{ width: 150 }} />
                                <col style={{ width: 130 }} />
                                <col style={{ width: 120 }} />
                                <col style={{ width: 120 }} />
                                <col style={{ width: 110 }} />
                                <col style={{ width: 80 }} />
                              </colgroup>
                              <thead>
                                <tr>
                                  <th>No</th>
                                  <th>측정 시각</th>
                                  <th>설비</th>
                                  <th>H2(ppm)</th>
                                  <th>CH4(ppm)</th>
                                  <th>온도(℃)</th>
                                  <th>유면</th>
                                </tr>
                              </thead>
                              <tbody>
                                {items === null && (
                                  <tr><td className="empty" colSpan={7}>불러오는 중</td></tr>
                                )}
                                {items?.length === 0 && (
                                  <tr><td className="empty" colSpan={7}>조회된 데이터가 없습니다.</td></tr>
                                )}
                                {items?.map((it, i) => (
                                  <tr key={`${it.device_id}-${it.measured_at}`}>
                                    <td className="center">{i + 1}</td>
                                    <td className="center">{timeText(it.measured_at)}</td>
                                    <td className="center">{it.device_id}</td>
                                    <td className="num">{fmtValue(it.h2)}</td>
                                    <td className="num">{fmtValue(it.ch4)}</td>
                                    <td className="num">{fmtValue(it.temperature, 1)}</td>
                                    <td className="center">{it.oil_level ?? "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </>
                        )}
                        {row.kind === "tele" ? (
                          <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); setShowRaw(!showRaw); }}>
                            원문 {showRaw ? "닫기" : "보기"}
                          </button>
                        ) : null}
                        {(row.kind !== "tele" || showRaw) && (
                          <pre className="codeblock">
                            {JSON.stringify(row.payload ?? {}, null, 2)}
                          </pre>
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
        {searched && (
          <Pager page={page} total={total} pageSize={pageSize} loading={loading} onPage={(n) => void load(n)} />
        )}
      </div>
    </>
  );
}
