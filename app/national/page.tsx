"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import Pager from "@/components/Pager";
import { useDashboard } from "@/lib/configStore";
import { REGIONS, SiteEvent, STATUS_LABEL, EVENT_STATUS_LABEL } from "@/lib/types";
import { fmtDateTime, fmtDetail } from "@/lib/format";
import { usePaged } from "@/lib/usePaged";
import { fmtWhen, isPending, useEvents, useGrouped, useNow, useSites } from "@/components/site/siteData";
import { EventDialog, KIND_LABEL } from "@/components/site/Dialogs";

const PAGE_SIZE = 20;

/**
 * 전국 통합 관제 — 사업장별 대응 현황.
 * 미조치가 많은 곳, 통신 두절이 많은 곳이 위로 옵니다.
 */
export default function NationalPage() {
  const { devices, eventSeq } = useDashboard();
  const { sites } = useSites();
  const groups = useGrouped(sites, devices);
  const now = useNow(1000);
  const { events, reload } = useEvents("all", eventSeq);
  const [summary, setSummary] = useState<Record<string, { open: number; latest_at: string | null }>>({});
  const [query, setQuery] = useState({ text: "", region: "" });
  const [form, setForm] = useState({ text: "", region: "" });
  const [eventOpen, setEventOpen] = useState<SiteEvent | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/events?summary=1", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const map: Record<string, { open: number; latest_at: string | null }> = {};
      for (const r of json.sites ?? []) map[r.site_id === null ? "none" : String(r.site_id)] = r;
      setSummary(map);
    })();
  }, [eventSeq]);

  const rows = useMemo(() => {
    const text = query.text.trim().toLowerCase();
    return groups
      .map((g, i) => {
        const off = g.devices.filter((d) => d.status === "offline").length;
        return {
          ...g,
          i,
          off,
          online: g.devices.length - off,
          open: summary[g.key]?.open ?? 0,
          latest: summary[g.key]?.latest_at ?? null,
          worst: g.devices.reduce<string>((w, d) => {
            const order = ["normal", "caution", "warning", "danger"];
            return d.status !== "offline" && order.indexOf(d.status) > order.indexOf(w) ? d.status : w;
          }, "normal"),
        };
      })
      .filter((g) => (!query.region || g.region === query.region) && `${g.name} ${g.companyName ?? ""}`.toLowerCase().includes(text))
      .sort((a, b) => b.open - a.open || b.off - a.off || a.name.localeCompare(b.name, "ko"));
  }, [groups, summary, query]);

  const { page, setPage, slice, total, offset } = usePaged(rows, PAGE_SIZE);
  const pending = events.filter(isPending);
  const live = devices.filter((d) => d.has_data !== false);
  const installed = live.length;
  const off = live.filter((d) => d.status === "offline").length;

  return (
    <>
      <PageHeader title="전국 통합 관제" breadcrumb="모니터링 › 전국 통합 관제" subtitle={fmtDateTime(new Date(now), true)} />

      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-label">운영 사업장</div>
          <div className="kpi-value">{`${groups.length.toLocaleString("ko-KR")}곳`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">설치 변압기</div>
          <div className="kpi-value">{`${installed.toLocaleString("ko-KR")}대`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">연결 장치</div>
          <div className="kpi-value normal">{`${(installed - off).toLocaleString("ko-KR")}대`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">미조치 알림</div>
          <div className={`kpi-value${pending.length ? " warning" : ""}`}>{`${pending.length}건`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">통신 두절</div>
          <div className={`kpi-value${off ? " danger" : ""}`}>{`${off}대`}</div>
        </div>
      </div>

      <form
        className="filterbar"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(form);
          setPage(1);
        }}
      >
        <span className="filter-label">사업장</span>
        <input
          className="field"
          aria-label="사업장명 검색"
          placeholder="사업장명 또는 고객사"
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
        />
        <span className="filter-label">권역</span>
        <select className="field" aria-label="권역" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
          <option value="">전체 권역</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div className="filterbar-right">
          <span className="card-note">{`검색 결과 ${total.toLocaleString("ko-KR")}곳`}</span>
          <button className="btn primary" type="submit">
            검색
          </button>
        </div>
      </form>

      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            사업장별 대응 현황
          </div>
          <span className="card-note">미조치·통신 두절이 많은 순</span>
        </div>
        <div className="table-wrap">
          <table className="fixed sc-site-table">
            <colgroup>
              <col style={{ width: 56 }} />
              <col />
              <col style={{ width: 150 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 84 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 70 }} />
            </colgroup>
            <thead>
              <tr>
                <th>No</th>
                <th>사업장</th>
                <th>고객사</th>
                <th>권역</th>
                <th>설치</th>
                <th>연결</th>
                <th>통신 두절</th>
                <th>미조치</th>
                <th>상태</th>
                <th>최근 이벤트</th>
                <th>열기</th>
              </tr>
            </thead>
            <tbody>
              {slice.length === 0 && (
                <tr>
                  <td className="empty" colSpan={11}>
                    검색 조건에 맞는 사업장이 없습니다.
                  </td>
                </tr>
              )}
              {slice.map((g, i) => (
                <tr key={g.key}>
                  <td className="center" data-label="No">{offset + i + 1}</td>
                  <td data-label="사업장">
                    <b>{g.name}</b>
                  </td>
                  <td data-label="고객사">{g.companyName ?? "-"}</td>
                  <td className="center" data-label="권역">{g.region || "-"}</td>
                  <td className="num" data-label="설치">{`${g.devices.length}대`}</td>
                  <td className="num" data-label="연결">{`${g.online}대`}</td>
                  <td className={`num${g.off ? " t-danger" : ""}`} data-label="통신 두절">{`${g.off}대`}</td>
                  <td className={`num${g.open ? " t-warning" : ""}`} data-label="미조치">{`${g.open}건`}</td>
                  <td className="center" data-label="상태">
                    <span className={`badge ${g.worst}`}>{STATUS_LABEL[g.worst as keyof typeof STATUS_LABEL]}</span>
                  </td>
                  <td className="center" data-label="최근 이벤트">{g.latest ? fmtWhen(g.latest) : "-"}</td>
                  <td className="center" data-label="열기">
                    <Link className="btn sm" href={`/?site=${g.key}`}>
                      열기
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>

      <div className="card flush sc-events">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            미조치 알림
          </div>
          <span className="card-note">{`${pending.length}건`}</span>
        </div>
        <div className="table-wrap">
          <table className="fixed sc-event-table">
            <colgroup>
              <col style={{ width: 132 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 150 }} />
              <col />
              <col style={{ width: 92 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 104 }} />
            </colgroup>
            <thead>
              <tr>
                <th>발생 시각</th>
                <th>사업장</th>
                <th>설비</th>
                <th>내용</th>
                <th>구분</th>
                <th>등급</th>
                <th>상태</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 && (
                <tr>
                  <td className="empty" colSpan={8}>
                    해당하는 이벤트가 없습니다.
                  </td>
                </tr>
              )}
              {pending.map((e) => (
                <tr key={e.ids.join(",")}>
                  <td className="center" data-label="발생 시각">{fmtWhen(e.latest_at)}</td>
                  <td data-label="사업장">{e.site_name ?? "-"}</td>
                  <td data-label="설비">
                    <b>{e.unit}</b>
                  </td>
                  <td data-label="내용" className="sc-event-text">
                    <div>
                    <span className="sc-event-item">{e.item}</span>
                    {e.repeats > 1 && <span className="sc-event-sub">{`재발 ${e.repeats}회 · 최초 ${fmtWhen(e.created_at)}`}</span>}
                    {e.detail && <span className="sc-event-sub">{fmtDetail(e.detail)}</span>}
                    </div>
                  </td>
                  <td className="center" data-label="구분">{KIND_LABEL[e.kind] ?? e.kind}</td>
                  <td className="center" data-label="등급">
                    {e.level === "normal" ? "-" : <span className={`badge ${e.level}`}>{STATUS_LABEL[e.level]}</span>}
                  </td>
                  <td className="center" data-label="상태">
                    <span className={e.status === "open" ? "t-danger" : "t-warning"}>{EVENT_STATUS_LABEL[e.status]}</span>
                  </td>
                  <td className="center" data-label="처리">
                    <button className="btn sm primary" onClick={() => setEventOpen(e)}>
                      확인·조치
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {eventOpen && (
        <EventDialog
          key={eventOpen.ids.join(",") + eventOpen.status}
          event={eventOpen}
          onClose={() => setEventOpen(null)}
          onChanged={async (action) => {
            await reload();
            setEventOpen(action === "ack" ? { ...eventOpen, status: "acked", acked_at: new Date().toISOString() } : null);
          }}
        />
      )}
    </>
  );
}
