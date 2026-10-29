"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useDashboard } from "@/lib/configStore";
import { useSession } from "@/lib/useSession";
import { downloadCsv, fmtDate } from "@/lib/format";

interface LogRow {
  id: number;
  device_id: string | null;
  unit: string;
  work_date: string;
  kind: string;
  title: string;
  detail: string | null;
  worker: string | null;
  next_due: string | null;
}

interface DueRow {
  device_id: string;
  unit: string;
  next_due: string;
}

/** 작업 구분. 절연유 시료 분석은 온라인 센서(H₂·CH₄)가 못 보는 가스를 확인하는 유일한 길입니다. */
const KIND_LABEL: Record<string, string> = {
  inspection: "정기 점검",
  oil_sample: "절연유 시료 분석",
  oil_refill: "절연유 보충",
  repair: "수리·조치",
  replace: "부품 교체",
  other: "기타",
};

const PAGE_SIZE = 50;

const EMPTY_FORM = {
  device_id: "",
  work_date: "",
  kind: "inspection",
  title: "",
  detail: "",
  worker: "",
  next_due: "",
};

export default function MaintenancePage() {
  const { devices } = useDashboard();
  const { tier } = useSession();
  const isAdmin = tier === "admin";

  const [rows, setRows] = useState<LogRow[]>([]);
  const [due, setDue] = useState<DueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [device, setDevice] = useState("");
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (targetPage = 1) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (device) params.set("device", device);
      if (kind) params.set("kind", kind);
      try {
        const res = await fetch(`/api/maintenance?${params}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.error ?? "점검 이력을 불러오지 못했습니다.");
          setRows([]);
          setTotal(0);
          return;
        }
        setRows(json.logs ?? []);
        setDue(json.due ?? []);
        setTotal(json.total ?? 0);
        setPage(targetPage);
      } catch {
        setError("서버에 연결할 수 없습니다.");
      } finally {
        setLoading(false);
      }
    },
    [from, to, device, kind]
  );

  useEffect(() => {
    void load(1);
    // 최초 1회만 조회합니다. 이후는 조회 버튼으로 실행합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNotice({ ok: false, text: json.error ?? "등록하지 못했습니다." });
      return;
    }
    setNotice({ ok: true, text: "점검 이력을 등록했습니다." });
    setForm({ ...EMPTY_FORM, work_date: form.work_date });
    setAdding(false);
    await load(1);
  }

  async function remove(r: LogRow) {
    if (!confirm(`${r.work_date} ${r.unit} "${r.title}" 이력을 삭제할까요?`)) return;
    setNotice(null);
    const res = await fetch(`/api/maintenance?id=${r.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ ok: false, text: json.error ?? "삭제하지 못했습니다." });
      return;
    }
    setNotice({ ok: true, text: `${r.work_date} ${r.unit} 이력을 삭제했습니다.` });
    await load(page);
  }

  const today = fmtDate(new Date());
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 점검 예정 — 지난 것(지연)과 30일 안에 닥치는 것만 위에 보여 줍니다.
  const soon = fmtDate(new Date(Date.now() + 30 * 86_400_000));
  const upcoming = due.filter((d) => d.next_due <= soon).sort((a, b) => a.next_due.localeCompare(b.next_due));

  const exportCsv = () =>
    downloadCsv(
      `점검이력_${today}.csv`,
      ["작업일", "설비", "구분", "작업 내용", "상세", "작업자", "다음 점검일"],
      rows.map((r) => [
        r.work_date,
        r.unit,
        KIND_LABEL[r.kind] ?? r.kind,
        r.title,
        r.detail ?? "",
        r.worker ?? "",
        r.next_due ?? "",
      ])
    );

  return (
    <>
      <PageHeader
        title="점검 이력"
        breadcrumb="홈 › 점검 이력"
        subtitle={`총 ${total.toLocaleString()}건`}
        actions={
          isAdmin ? (
            <button
              className="btn primary"
              onClick={() => {
                setAdding((v) => !v);
                setForm((f) => ({ ...f, work_date: f.work_date || today }));
              }}
            >
              {adding ? "닫기" : "이력 등록"}
            </button>
          ) : undefined
        }
      />

      {adding && isAdmin && (
        <form className="card" onSubmit={submit} style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div className="card-title">
              <span className="accent-bar" />
              이력 등록
            </div>
          </div>
          <table className="form-grid">
            <tbody>
              <tr>
                <th className="req">설비</th>
                <td>
                  <select
                    className="field"
                    value={form.device_id}
                    onChange={(e) => setForm({ ...form, device_id: e.target.value })}
                  >
                    <option value="">선택</option>
                    {devices.map((d) => (
                      <option key={d.device_id} value={d.device_id}>
                        {d.name} ({d.building})
                      </option>
                    ))}
                  </select>
                </td>
                <th className="req">작업일</th>
                <td>
                  <input
                    className="field"
                    type="date"
                    value={form.work_date}
                    onChange={(e) => setForm({ ...form, work_date: e.target.value })}
                  />
                </td>
              </tr>
              <tr>
                <th className="req">구분</th>
                <td>
                  <select
                    className="field"
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  >
                    {Object.entries(KIND_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </td>
                <th>작업자</th>
                <td>
                  <input
                    className="field"
                    value={form.worker}
                    onChange={(e) => setForm({ ...form, worker: e.target.value })}
                  />
                </td>
              </tr>
              <tr>
                <th className="req">작업 내용</th>
                <td colSpan={3}>
                  <input
                    className="field"
                    style={{ width: "100%" }}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </td>
              </tr>
              <tr>
                <th>상세</th>
                <td colSpan={3}>
                  <textarea
                    className="field"
                    rows={3}
                    style={{ width: "100%", height: "auto", padding: "6px 8px" }}
                    value={form.detail}
                    onChange={(e) => setForm({ ...form, detail: e.target.value })}
                  />
                </td>
              </tr>
              <tr>
                <th>다음 점검일</th>
                <td colSpan={3}>
                  <input
                    className="field"
                    type="date"
                    value={form.next_due}
                    onChange={(e) => setForm({ ...form, next_due: e.target.value })}
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <div className="save-bar">
            <button className="btn primary" type="submit" disabled={busy}>
              등록
            </button>
          </div>
        </form>
      )}

      {notice && <div className={`banner ${notice.ok ? "ok" : "error"}`}>{notice.text}</div>}

      <div className="filterbar">
        <span className="filter-label">작업일</span>
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
          <option value="">전체</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        <div className="filterbar-right">
          <button
            className="btn"
            onClick={() => {
              setFrom("");
              setTo("");
              setDevice("");
              setKind("");
            }}
          >
            초기화
          </button>
          <button className="btn primary" onClick={() => void load(1)} disabled={loading}>
            조회
          </button>
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="card flush" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div className="card-title">
              <span className="accent-bar" />
              점검 예정 (30일 이내·지연)
            </div>
            <span className="card-note">{upcoming.length}대</span>
          </div>
          <div className="table-wrap">
            <table className="fixed">
              <colgroup>
                <col style={{ width: 140 }} />
                <col style={{ width: 130 }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>설비</th>
                  <th>예정일</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((d) => {
                  const days = Math.round(
                    (new Date(d.next_due).getTime() - new Date(today).getTime()) / 86_400_000
                  );
                  return (
                    <tr key={d.device_id}>
                      <td>
                        <b>{d.unit}</b>
                      </td>
                      <td className="center">{d.next_due}</td>
                      <td className={days < 0 ? "t-danger" : days <= 7 ? "t-warning" : undefined}>
                        {days < 0 ? `${-days}일 지남` : days === 0 ? "오늘" : `${days}일 남음`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            이력 목록
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
          <table className="fixed maint-table">
            <colgroup>
              <col style={{ width: 108 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 128 }} />
              <col />
              <col style={{ width: 96 }} />
              <col style={{ width: 108 }} />
              {isAdmin && <col style={{ width: 64 }} />}
            </colgroup>
            <thead>
              <tr>
                <th>작업일</th>
                <th>설비</th>
                <th>구분</th>
                <th>작업 내용</th>
                <th>작업자</th>
                <th>다음 점검일</th>
                {isAdmin && <th>삭제</th>}
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td className="empty" colSpan={isAdmin ? 7 : 6}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="center">{r.work_date}</td>
                  <td>
                    <b>{r.unit}</b>
                  </td>
                  <td className="center">{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td title={r.detail ? `${r.title}\n${r.detail}` : r.title}>
                    {r.title}
                    {r.detail && <span className="cell-sub">{r.detail}</span>}
                  </td>
                  <td className="center">{r.worker ?? "-"}</td>
                  <td className="center">{r.next_due ?? "-"}</td>
                  {isAdmin && (
                    <td className="center">
                      <button className="btn sm danger-outline" onClick={() => void remove(r)}>
                        삭제
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="save-bar" style={{ justifyContent: "center" }}>
          <button className="btn" disabled={page <= 1 || loading} onClick={() => void load(page - 1)}>
            이전
          </button>
          <button className="btn" disabled={page >= lastPage || loading} onClick={() => void load(page + 1)}>
            다음
          </button>
        </div>
      </div>
    </>
  );
}
