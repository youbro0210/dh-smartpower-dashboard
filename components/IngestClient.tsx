"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "./PageHeader";
import SettingsTabs from "./SettingsTabs";

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
  const [limit, setLimit] = useState(50);
  const [openId, setOpenId] = useState<number | null>(null);
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set("status", status);
    if (kind) params.set("kind", kind);
    if (keyword.trim()) params.set("q", keyword.trim());

    try {
      const res = await fetch(`/api/ingest?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (res.ok) {
        setRows(body.log ?? []);
        setSummary(body.summary ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [status, kind, keyword, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [auto, load]);

  return (
    <>
      <PageHeader
        title="수집 내역"
        breadcrumb="홈 › 설정 › 수집 내역"
        subtitle="장비가 실제로 보낸 메시지를 원문 그대로 보여줍니다"
        actions={
          <button className="btn" onClick={() => void load()} disabled={loading}>
            새로고침
          </button>
        }
      />

      <SettingsTabs active="ingest" />

      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-label">24시간 수신</div>
          <div className="kpi-value">
            {summary?.total ?? 0}
            <small>건</small>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">정상</div>
          <div className="kpi-value normal">{summary?.ok ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">주의</div>
          <div className="kpi-value caution">{summary?.warn ?? 0}</div>
          <div className="kpi-note">규격은 맞으나 확인이 필요한 건</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">오류</div>
          <div className="kpi-value danger">{summary?.error ?? 0}</div>
          <div className="kpi-note">읽지 못해 버린 건</div>
        </div>
      </div>

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

        <span className="filter-label">건수</span>
        <select className="field" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {[50, 100, 200].map((n) => (
            <option key={n} value={n}>{n}건</option>
          ))}
        </select>

        <div className="filterbar-right">
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            5초마다 갱신
          </label>
        </div>
      </div>

      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            수신 내역
          </div>
          <span className="card-note">{rows.length}건 · 행을 누르면 원문을 봅니다</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 120 }}>수신 시각</th>
                <th style={{ width: 80 }}>종류</th>
                <th style={{ minWidth: 230 }}>토픽</th>
                <th style={{ width: 130 }}>설비</th>
                <th className="num" style={{ width: 90 }}>건수</th>
                <th className="num" style={{ width: 80 }}>적재</th>
                <th style={{ width: 70 }}>결과</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">
                      아직 받은 메시지가 없습니다. 장비가 아직 붙지 않았거나, 브로커 설정을
                      확인해야 합니다.
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const open = openId === row.id;
                const devices = row.device_ids ?? [];
                return (
                  <tr key={row.id} className="clickable" onClick={() => setOpenId(open ? null : row.id)}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
                      {timeText(row.received_at)}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {KIND_LABEL[row.kind ?? ""] ?? row.kind ?? "-"}
                      {row.replay && <span className="chip">재전송</span>}
                    </td>
                    <td style={{ wordBreak: "break-all" }}>{row.topic}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {devices.length === 0
                        ? "-"
                        : devices.length <= 2
                          ? devices.join(", ")
                          : `${devices.slice(0, 2).join(", ")} 외 ${devices.length - 2}`}
                    </td>
                    <td className="num">{row.item_count}</td>
                    <td className="num">{row.stored_count}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[row.status]}`}>
                        {STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td style={{ color: row.status === "ok" ? "var(--faint)" : "var(--danger)" }}>
                      {row.message ?? "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {openId !== null && (
          <div style={{ padding: "0 14px 14px" }}>
            <div className="spark-title">받은 원문</div>
            <pre className="codeblock">
              {JSON.stringify(rows.find((r) => r.id === openId)?.payload ?? {}, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div className="note">
        적재 건수가 수신 건수보다 적은 것은 대개 정상입니다. 같은 시각의 값이 다시 들어오면
        서버가 중복으로 보고 한 번만 저장합니다. 보관 기간은 데이터 연결 화면에서 바꿉니다.
      </div>
    </>
  );
}
