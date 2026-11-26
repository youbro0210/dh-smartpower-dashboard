"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useDashboard } from "@/lib/configStore";
import { useSession } from "@/lib/useSession";
import { ruleFor } from "@/lib/thresholds";
import {
  DeviceEvaluated,
  EVENT_STATUS_LABEL,
  LINK_TYPE_LABEL,
  SeverityLevel,
  SiteEvent,
  STATUS_LABEL,
  ThresholdConfig,
} from "@/lib/types";
import { fmtDateTime, fmtDetail, fmtValue } from "@/lib/format";
import { DeviceDetailDialog, EventDialog, KIND_LABEL, TempDialog } from "./Dialogs";
import { fmtWhen, isPending, useEvents, useGrouped, useNow, useSites } from "./siteData";

type Filter = "pending" | "open" | "all";
const FILTER_LABEL: Record<Filter, string> = { pending: "미조치", open: "미확인", all: "전체" };
const SITE_KEY = "dh.site.selected";
const RANK: Record<string, number> = { danger: 5, warning: 4, caution: 3, offline: 2, normal: 1 };

const lv = (l: SeverityLevel) => (l === "normal" ? "ok" : l);

/**
 * 사업장 관제 — 한 사업장의 변압기를 한 표로 보고, 고른 설비를 오른쪽에서 자세히 봅니다.
 *   ① 요약  ② 변압기 상태표 + 선택 설비  ③ 알림·이벤트(확인 → 조치 완료)
 */
export default function SiteControl() {
  const { devices, thresholds, loading, error, refresh, eventSeq, lastReceived } = useDashboard();
  const { user, tier } = useSession();
  const isAdmin = tier === "admin";
  const { sites, loaded } = useSites();
  const groups = useGrouped(sites, devices);
  const now = useNow();

  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [detail, setDetail] = useState<DeviceEvaluated | null>(null);
  const [tempFor, setTempFor] = useState<DeviceEvaluated | null>(null);
  const [eventOpen, setEventOpen] = useState<SiteEvent | null>(null);
  const [ledPending, setLedPending] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // 사업장 선택: 주소(?site=)가 있으면 그것을, 없으면 지난번 선택을 씁니다.
  useEffect(() => {
    if (!loaded || loading) return;
    if (siteKey && groups.some((g) => g.key === siteKey)) return;
    let wanted: string | null = null;
    try {
      wanted = new URLSearchParams(window.location.search).get("site") ?? localStorage.getItem(SITE_KEY);
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
    const pick = groups.find((g) => g.key === wanted) ?? groups[0];
    if (pick) setSiteKey(pick.key);
  }, [loaded, loading, groups, siteKey]);

  function chooseSite(key: string) {
    setSiteKey(key);
    setSelId(null);
    try {
      localStorage.setItem(SITE_KEY, key);
      const url = new URL(window.location.href);
      url.searchParams.set("site", key);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* 무시 */
    }
  }

  const group = groups.find((g) => g.key === siteKey) ?? null;
  // 이상이 큰 설비부터
  const units = useMemo(
    () =>
      [...(group?.devices ?? [])].sort(
        (a, b) => RANK[b.status] - RANK[a.status] || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "ko")
      ),
    [group]
  );
  const { events, error: eventsError, reload: reloadEvents } = useEvents(siteKey, eventSeq);

  const pending = events.filter(isPending);
  const pendingBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of pending) if (e.device_id) m.set(e.device_id, (m.get(e.device_id) ?? 0) + 1);
    return m;
  }, [pending]);
  const lastGasBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) {
      if (!e.device_id || e.kind !== "sensor" || e.level === "normal" || !/수소|메탄|복합/.test(e.item)) continue;
      const prev = m.get(e.device_id);
      if (!prev || prev < e.latest_at) m.set(e.device_id, e.latest_at);
    }
    return m;
  }, [events]);

  const visible = events.filter((e) => (filter === "all" ? true : filter === "open" ? e.status === "open" : isPending(e)));
  const sel = units.find((u) => u.device_id === selId) ?? units[0] ?? null;
  const online = units.filter((u) => u.status !== "offline").length;
  const unconfirmed = pending.filter((e) => e.status === "open").length;
  const fresh = (d: DeviceEvaluated) => lastReceived?.deviceId === d.device_id && now - lastReceived.at < 1500;

  async function clearLed(d: DeviceEvaluated) {
    setNotice(null);
    const target =
      d.link_type === "bridge" && d.bridge_id
        ? { target_type: "bridge", target_id: d.bridge_id }
        : d.link_type === "gateway" && d.bridge_id
          ? { target_type: "gateway", target_id: d.bridge_id }
          : { target_type: "module", target_id: d.device_id };
    const res = await fetch("/api/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...target, command: "led_clear", device_id: d.device_id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ ok: false, text: json.error ?? "LED 해제 명령을 보내지 못했습니다." });
      return;
    }
    setLedPending((p) => ({ ...p, [d.device_id]: Date.now() }));
    setNotice({ ok: true, text: `${d.name} LED 해제 명령을 보냈습니다.` });
    // 장치 응답은 수 초 뒤에 옵니다. 응답 시각을 다시 읽어 표시를 갱신합니다.
    for (const ms of [6000, 15000, 30000]) setTimeout(() => void refresh(), ms);
  }

  // 사업장을 아직 만들지 않았으면 화면 이름을 제목으로 두고 묶음 이름은 부제로 내립니다.
  const unassigned = group?.key === "none";
  const title = !group || unassigned ? "사업장 관제" : group.name;
  const subtitle = [unassigned ? group?.name : group?.companyName, unassigned ? null : group?.region, fmtDateTime(new Date(now), true)]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        title={title}
        breadcrumb="모니터링 › 사업장 관제"
        subtitle={subtitle}
        actions={
          groups.length > 1 ? (
            <select className="field sc-site-select" aria-label="사업장 선택" value={siteKey ?? ""} onChange={(e) => chooseSite(e.target.value)}>
              {groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.name}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      {error && <div className="banner error">{`데이터를 불러오지 못했습니다 — ${error}`}</div>}
      {notice && <div className={`banner ${notice.ok ? "ok" : "error"}`}>{notice.text}</div>}

      <div className="kpi-strip sc-kpi">
        <div className="kpi">
          <div className="kpi-label">설치 변압기</div>
          <div className="kpi-value">{`${units.length}대`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">연결</div>
          <div className="kpi-value">{`${online}대`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">통신 두절</div>
          <div className={`kpi-value${units.length - online ? " danger" : ""}`}>{`${units.length - online}대`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">미조치 알림</div>
          <div className={`kpi-value${pending.length ? " warning" : ""}`}>
            {`${pending.length}건`}
            <small>{`미확인 ${unconfirmed}`}</small>
          </div>
        </div>
      </div>

      <div className="sc-split">
        <div className="card flush sc-units">
          <div className="card-head">
            <div className="card-title">
              <span className="accent-bar" />
              변압기 상태
            </div>
            <span className="card-note">이상 등급 순</span>
          </div>
          <div className="table-wrap">
            <table className="fixed sc-unit-table">
              <colgroup>
                <col />
                <col style={{ width: "15%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "7%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>설비</th>
                  <th>수소 H₂</th>
                  <th>메탄 CH₄</th>
                  <th>절연유 온도</th>
                  <th>유면</th>
                  <th>상태</th>
                  <th>마지막 수신</th>
                  <th>미조치</th>
                </tr>
              </thead>
              <tbody>
                {!loading && units.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={8}>
                      이 사업장에 배정된 설비가 없습니다.
                    </td>
                  </tr>
                )}
                {units.map((d) => {
                  const off = d.status === "offline";
                  const is4 = d.model !== "3형";
                  const gas = (level: SeverityLevel, v: number) =>
                    off ? (
                      // 통신이 끊기면 마지막으로 받은 값을 흐리게 둡니다.
                      <span className="sc-last">{`${fmtValue(v)} ppm`}</span>
                    ) : (
                      <span className={`sq ${lv(level)}`}>
                        {level === "normal" ? "미발생" : "발생"}
                        <small>{fmtValue(v)}</small>
                      </span>
                    );
                  const n = pendingBy.get(d.device_id) ?? 0;
                  return (
                    <tr
                      key={d.device_id}
                      className={`clickable${sel?.device_id === d.device_id ? " selected" : ""}`}
                      onClick={() => setSelId(d.device_id)}
                    >
                      <td data-label="설비">
                        <div>
                          <b>{d.name}</b>
                          <span className="sc-cell-sub">{[d.place || d.building, d.model ?? "4형"].filter(Boolean).join(" · ")}</span>
                        </div>
                      </td>
                      <td className="num" data-label="수소 H₂">{gas(d.sensorLevels.h2, d.h2)}</td>
                      <td className="num" data-label="메탄 CH₄">{gas(d.sensorLevels.ch4, d.ch4)}</td>
                      <td className="num" data-label="절연유 온도">
                        {!is4 ? (
                          <span className="t-muted">-</span>
                        ) : off ? (
                          <span className="sc-last">{`${fmtValue(d.temperature, 1)} ℃`}</span>
                        ) : (
                          <span className={`v-${lv(d.sensorLevels.temperature)}`}>{`${fmtValue(d.temperature, 1)} ℃`}</span>
                        )}
                      </td>
                      <td className="center" data-label="유면">
                        {!is4 ? (
                          <span className="t-muted">-</span>
                        ) : off ? (
                          <span className="sc-last">{d.oil_level}</span>
                        ) : (
                          <span className={`v-${lv(d.sensorLevels.oil_level)}`}>{d.oil_level}</span>
                        )}
                      </td>
                      <td className="center" data-label="상태">
                        <span className={`sq ${d.status === "normal" ? "ok" : d.status}`}>{STATUS_LABEL[d.status]}</span>
                      </td>
                      <td className={`center${fresh(d) ? " sc-fresh" : ""}${off ? " t-danger" : ""}`} data-label="마지막 수신">
                        {new Date(d.updated_at).getTime() > 0 ? fmtWhen(d.updated_at) : "-"}
                      </td>
                      <td className={`num${n ? " t-warning" : ""}`} data-label="미조치">
                        {n}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {sel && (
          <SelectedPanel
            d={sel}
            thresholds={thresholds}
            isAdmin={isAdmin}
            lastGasAt={lastGasBy.get(sel.device_id) ?? null}
            ledRequestedAt={ledPending[sel.device_id] ?? 0}
            now={now}
            receiving={fresh(sel)}
            onDetail={() => setDetail(sel)}
            onTemp={() => setTempFor(sel)}
            onLed={() => void clearLed(sel)}
          />
        )}
      </div>

      <div className="card flush sc-events">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            알림 및 이벤트
          </div>
          <div className="card-tools">
            <span className="card-note">{`${visible.length}건`}</span>
            <select className="field" aria-label="이벤트 필터" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                <option key={f} value={f}>
                  {FILTER_LABEL[f]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {eventsError && <div className="banner error">{eventsError}</div>}
        <div className="table-wrap">
          <table className="fixed sc-event-table">
            <colgroup>
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col />
              <col style={{ width: 92 }} />
              <col style={{ width: 84 }} />
              <col style={{ width: 84 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 104 }} />
            </colgroup>
            <thead>
              <tr>
                <th>발생 시각</th>
                <th>설비</th>
                <th>내용</th>
                <th>구분</th>
                <th>등급</th>
                <th>상태</th>
                <th>확인 시각</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td className="empty" colSpan={8}>
                    해당하는 이벤트가 없습니다.
                  </td>
                </tr>
              )}
              {visible.map((e) => (
                <tr key={`${e.status}-${e.ids.join(",")}`}>
                  <td className="center" data-label="발생 시각">
                    {fmtWhen(e.latest_at)}
                  </td>
                  <td data-label="설비">
                    <b>{e.unit}</b>
                  </td>
                  <td data-label="내용" className="sc-event-text">
                    <div>
                      <span className="sc-event-item">{e.item}</span>
                      {e.repeats > 1 && <span className="sc-event-sub">{`재발 ${e.repeats}회 · 최초 ${fmtWhen(e.created_at)}`}</span>}
                      {(e.note || e.detail) && <span className="sc-event-sub">{e.note ?? fmtDetail(e.detail)}</span>}
                    </div>
                  </td>
                  <td className="center" data-label="구분">
                    {KIND_LABEL[e.kind] ?? e.kind}
                  </td>
                  <td className="center" data-label="등급">
                    {e.level === "normal" ? "-" : <span className={`badge ${e.level}`}>{STATUS_LABEL[e.level]}</span>}
                  </td>
                  <td className="center" data-label="상태">
                    <span className={e.status === "open" ? "t-danger" : e.status === "acked" ? "t-warning" : "t-muted"}>
                      {EVENT_STATUS_LABEL[e.status]}
                    </span>
                  </td>
                  <td className="center" data-label="확인 시각">
                    {e.acked_at ? fmtWhen(e.acked_at) : "-"}
                  </td>
                  <td className="center" data-label="처리">
                    <button className={`btn sm${isPending(e) ? " primary" : ""}`} onClick={() => setEventOpen(e)}>
                      {e.status === "open" ? "확인" : e.status === "acked" ? "조치 완료" : "기록 보기"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <DeviceDetailDialog
          device={devices.find((x) => x.device_id === detail.device_id) ?? detail}
          events={events}
          thresholds={thresholds}
          staff={tier !== "customer"}
          onClose={() => setDetail(null)}
        />
      )}
      {tempFor && (
        <TempDialog
          device={tempFor}
          thresholds={thresholds}
          onClose={() => setTempFor(null)}
          onSaved={() => {
            setTempFor(null);
            void refresh();
            void reloadEvents();
          }}
        />
      )}
      {eventOpen && (
        <EventDialog
          key={eventOpen.ids.join(",") + eventOpen.status}
          event={eventOpen}
          onClose={() => setEventOpen(null)}
          onChanged={async (action) => {
            await reloadEvents();
            // 확인 후에는 같은 창에서 조치 기록을 이어서 적습니다.
            setEventOpen(
              action === "ack"
                ? { ...eventOpen, status: "acked", acked_at: new Date().toISOString(), acked_name: user?.full_name || user?.email || null }
                : null
            );
          }}
        />
      )}
    </>
  );
}

/** 고른 설비 한 대: 측정 항목별 판정과 기준, 전송 경로, 제품 LED */
function SelectedPanel({
  d,
  thresholds,
  isAdmin,
  lastGasAt,
  ledRequestedAt,
  now,
  receiving,
  onDetail,
  onTemp,
  onLed,
}: {
  d: DeviceEvaluated;
  thresholds: ThresholdConfig;
  isAdmin: boolean;
  lastGasAt: string | null;
  ledRequestedAt: number;
  now: number;
  receiving: boolean;
  onDetail: () => void;
  onTemp: () => void;
  onLed: () => void;
}) {
  const off = d.status === "offline";
  const is4 = d.model !== "3형";
  const t = ruleFor(thresholds.temperature, d.temp_limit);
  const rules = (r: { caution: number; warning: number; danger: number }) =>
    `${fmtValue(r.caution)} / ${fmtValue(r.warning)} / ${fmtValue(r.danger)}`;
  const judge = (level: SeverityLevel, gas: boolean) =>
    off ? "마지막 값" : gas ? (level === "normal" ? "미발생" : `발생 · ${STATUS_LABEL[level]}`) : STATUS_LABEL[level];

  const rows: { name: string; value: string; level: SeverityLevel; judge: string; basis: string }[] = [
    { name: "수소 H₂", value: `${fmtValue(d.h2)} ppm`, level: d.sensorLevels.h2, judge: judge(d.sensorLevels.h2, true), basis: rules(thresholds.h2) },
    { name: "메탄 CH₄", value: `${fmtValue(d.ch4)} ppm`, level: d.sensorLevels.ch4, judge: judge(d.sensorLevels.ch4, true), basis: rules(thresholds.ch4) },
  ];
  if (is4) {
    rows.push({
      name: "절연유 온도",
      value: `${fmtValue(d.temperature, 1)} ℃`,
      level: d.sensorLevels.temperature,
      judge: judge(d.sensorLevels.temperature, false),
      basis: d.temp_limit != null ? `${rules(t)} · 설비별` : rules(t),
    });
    rows.push({ name: "유면", value: d.oil_level, level: d.sensorLevels.oil_level, judge: judge(d.sensorLevels.oil_level, false), basis: "낮음·높음 감지" });
  }

  const gasDetected = !off && (d.sensorLevels.h2 !== "normal" || d.sensorLevels.ch4 !== "normal");
  const cleared = !!d.led_cleared_at && (!lastGasAt || new Date(d.led_cleared_at).getTime() >= new Date(lastGasAt).getTime());
  const ledOn = gasDetected && !cleared;
  const waiting = ledOn && ledRequestedAt > 0 && now - ledRequestedAt < 40_000;

  const hop = d.link_type === "bridge" ? `브릿지 ${d.bridge_id ?? ""}`.trim() : d.link_type === "gateway" ? `사용자 PC ${d.bridge_id ?? ""}`.trim() : null;
  const route = hop ? `측정모듈 ─ RS-485 ─ ${hop} ─ Wi-Fi ─ 관제 서버` : "측정모듈 ─ Wi-Fi ─ 관제 서버";
  const seen = new Date(d.updated_at).getTime() > 0 ? fmtDateTime(d.updated_at, true) : "-";

  return (
    <div className="card flush sc-selected">
      <div className="card-head">
        <div className="card-title">
          <span className="accent-bar" />
          {d.name}
          <span className="sc-head-sub">{[d.place || d.building, d.model ?? "4형"].filter(Boolean).join(" · ")}</span>
        </div>
        <span className={`sq ${d.status === "normal" ? "ok" : d.status}`}>{STATUS_LABEL[d.status]}</span>
      </div>

      <div className="sc-detail-grid">
      <table className="fixed sc-measure">
        <colgroup>
          <col style={{ width: "24%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "22%" }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>항목</th>
            <th>측정값</th>
            <th>판정</th>
            <th>주의 / 경고 / 위험</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <th>{r.name}</th>
              <td className="num">{off ? <span className="sc-last">{r.value}</span> : <span className={`v-${lv(r.level)}`}>{r.value}</span>}</td>
              <td className="center">
                <span className={off ? "t-muted" : `v-${lv(r.level)}`}>{r.judge}</span>
              </td>
              <td className="sc-basis">{r.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="fixed sc-measure sc-facts">
        <colgroup>
          <col style={{ width: "26%" }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2}>연결 정보</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>전송 경로</th>
            <td className={off ? "t-muted" : receiving ? "sc-fresh" : undefined}>{route}</td>
          </tr>
          <tr>
            <th>통신</th>
            <td>
              <span className={off ? "t-danger" : "t-success"}>{off ? "끊김" : receiving ? "수신 중" : "연결"}</span>
              {` · ${LINK_TYPE_LABEL[d.link_type ?? "direct"]}`}
            </td>
          </tr>
          <tr>
            <th>마지막 수신</th>
            <td>{seen}</td>
          </tr>
          <tr>
            <th>제품 LED</th>
            <td>
              <div className="sc-led-cell">
              <span className={ledOn ? "t-warning" : undefined}>
                {!gasDetected ? "경고 없음" : ledOn ? (waiting ? "경고 중 · 해제 응답 대기" : "경고 중") : "해제됨"}
              </span>
              {ledOn && isAdmin && (
                <button className="btn sm" disabled={waiting} onClick={onLed}>
                  LED 해제
                </button>
              )}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      </div>

      <div className="sc-selected-actions">
        <button className="btn sm" onClick={onDetail}>
          24시간 추이·이력
        </button>
        {is4 && isAdmin && (
          <button className="btn sm" onClick={onTemp}>
            온도 기준 설정
          </button>
        )}
      </div>
    </div>
  );
}
