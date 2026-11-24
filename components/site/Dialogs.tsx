"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import TrendChart from "@/components/TrendChart";
import {
  DeviceEvaluated,
  EVENT_STATUS_LABEL,
  LINK_TYPE_LABEL,
  SiteEvent,
  STATUS_LABEL,
  ThresholdConfig,
} from "@/lib/types";
import { ruleFor } from "@/lib/thresholds";
import { fmtDateTime, fmtDetail, fmtValue } from "@/lib/format";
import { fmtWhen } from "./siteData";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog ref={ref} className={`sc-dialog${wide ? " wide" : ""}`} onClose={onClose} onCancel={onClose}>
      <div className="sc-dialog-head">
        <h2>{title}</h2>
        <button className="btn sm" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="sc-dialog-body">{children}</div>
    </dialog>
  );
}

export const KIND_LABEL: Record<string, string> = {
  sensor: "센서",
  link: "통신",
  admin: "관리자 조치",
};

export function DeviceDetailDialog({
  device: d,
  events,
  thresholds,
  onClose,
}: {
  device: DeviceEvaluated;
  events: SiteEvent[];
  thresholds: ThresholdConfig;
  onClose: () => void;
}) {
  const is4 = d.model !== "3형";
  const mine = events.filter((e) => e.device_id === d.device_id);
  const tRule = ruleFor(thresholds.temperature, d.temp_limit);
  const rows: [string, string][] = [
    ["설비 ID", d.device_id],
    ["사업장", d.site_name ?? "-"],
    ["설치 장소", d.place || d.building || "-"],
    ["형식", `${d.model ?? "4형"} · ${is4 ? "수소·메탄·온도·유면" : "수소·메탄"}`],
    ["연결", `${LINK_TYPE_LABEL[d.link_type ?? "direct"]}${d.bridge_id ? ` · ${d.bridge_id}` : ""}`],
    ["상태", STATUS_LABEL[d.status]],
    ["마지막 수신", new Date(d.updated_at).getTime() > 0 ? fmtDateTime(d.updated_at, true) : "-"],
    ["펌웨어", d.fw_version ?? "-"],
  ];
  return (
    <Modal title={`${d.name} 장치 상세`} onClose={onClose} wide>
      <table className="fixed sc-info">
        <colgroup>
          <col style={{ width: 120 }} />
          <col />
          <col style={{ width: 120 }} />
          <col />
        </colgroup>
        <tbody>
          {Array.from({ length: rows.length / 2 }, (_, i) => (
            <tr key={i}>
              <th>{rows[i * 2][0]}</th>
              <td>{rows[i * 2][1]}</td>
              <th>{rows[i * 2 + 1][0]}</th>
              <td>{rows[i * 2 + 1][1]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {is4 && (
        <>
          <h3 className="sc-sub">절연유 온도 추이 (최근 24시간)</h3>
          <TrendChart trend={d.trend} metrics={["temperature"]} rule={{ metric: "temperature", ...tRule }} height={180} />
        </>
      )}
      <h3 className="sc-sub">가스 추이 (최근 24시간)</h3>
      <TrendChart trend={d.trend} metrics={["h2", "ch4"]} height={180} />

      <h3 className="sc-sub">상태 변화 이력</h3>
      <div className="table-wrap">
        <table className="fixed">
          <colgroup>
            <col style={{ width: 130 }} />
            <col />
            <col style={{ width: 84 }} />
            <col style={{ width: 84 }} />
          </colgroup>
          <thead>
            <tr>
              <th>시각</th>
              <th>내용</th>
              <th>구분</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {mine.length === 0 && (
              <tr>
                <td className="empty" colSpan={4}>
                  기록된 상태 변화가 없습니다.
                </td>
              </tr>
            )}
            {mine.map((e) => (
              <tr key={e.ids[0]}>
                <td className="center">{fmtWhen(e.latest_at)}</td>
                <td className="ellipsis" title={e.note ?? e.detail ?? undefined}>
                  {e.item}
                  {e.note ? ` · ${e.note}` : ""}
                </td>
                <td className="center">{KIND_LABEL[e.kind] ?? e.kind}</td>
                <td className="center">{EVENT_STATUS_LABEL[e.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function TempDialog({
  device: d,
  thresholds,
  onClose,
  onSaved,
}: {
  device: DeviceEvaluated;
  thresholds: ThresholdConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const common = thresholds.temperature.warning;
  const [value, setValue] = useState(d.temp_limit != null ? String(d.temp_limit) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: number | null) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/devices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: d.device_id, temp_limit: next }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "저장하지 못했습니다.");
      return;
    }
    onSaved();
  }

  return (
    <Modal title={`${d.name} 온도 기준`} onClose={onClose}>
      <table className="fixed sc-info">
        <colgroup>
          <col style={{ width: 150 }} />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <th>현재 절연유 온도</th>
            <td>{d.status === "offline" ? "확인 불가" : `${fmtValue(d.temperature, 1)} ℃`}</td>
          </tr>
          <tr>
            <th>공통 경고 기준</th>
            <td>{`${fmtValue(common, 1)} ℃`}</td>
          </tr>
          <tr>
            <th>이 설비 경고 기준</th>
            <td>
              <form
                className="sc-temp-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number(value);
                  if (!value.trim()) return void save(null);
                  if (!Number.isFinite(n) || n <= 0 || n > 150) {
                    setError("0 초과 150 이하로 입력하세요.");
                    return;
                  }
                  void save(n);
                }}
              >
                <input
                  className="field num"
                  type="number"
                  min={0.1}
                  max={150}
                  step={0.1}
                  value={value}
                  placeholder={fmtValue(common, 1)}
                  aria-label="이 설비 경고 기준 (℃)"
                  onChange={(e) => setValue(e.target.value)}
                />
                <span>℃</span>
                {[60, 65, 70].map((p) => (
                  <button key={p} type="button" className="btn sm" onClick={() => setValue(String(p))}>
                    {`${p} ℃`}
                  </button>
                ))}
                <button type="button" className="btn sm" onClick={() => setValue("")}>
                  공통 기준
                </button>
                <button className="btn sm primary" type="submit" disabled={busy}>
                  저장
                </button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="sc-dialog-note">서버 판정에만 적용되며 장비의 LED 경고 기준은 바뀌지 않습니다.</p>
      {error && <div className="banner error">{error}</div>}
    </Modal>
  );
}

export function EventDialog({
  event: e,
  onClose,
  onChanged,
}: {
  event: SiteEvent;
  onClose: () => void;
  onChanged: (action: "ack" | "done") => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: "ack" | "done") {
    if (action === "done" && !note.trim()) {
      setError("점검·조치 내용을 입력하세요.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids: e.ids, note }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "처리하지 못했습니다.");
      return;
    }
    onChanged(action);
  }

  const rows: [string, string][] = [
    ["사업장", e.site_name ?? "-"],
    ["설비", e.unit],
    ["구분", KIND_LABEL[e.kind] ?? e.kind],
    ["등급", e.level === "normal" ? "-" : STATUS_LABEL[e.level]],
    ["최초 발생", fmtDateTime(e.created_at, true)],
    ["최근 발생", e.repeats > 1 ? `${fmtDateTime(e.latest_at, true)} · 총 ${e.repeats}회` : "-"],
    ["내용", fmtDetail(e.detail)],
    ["처리 상태", EVENT_STATUS_LABEL[e.status]],
    ["확인", e.acked_at ? `${e.acked_name ?? "-"} · ${fmtDateTime(e.acked_at)}` : "-"],
    ["완료", e.done_at ? fmtDateTime(e.done_at) : "-"],
  ];

  return (
    <Modal title={e.item} onClose={onClose}>
      <table className="fixed sc-info">
        <colgroup>
          <col style={{ width: 110 }} />
          <col />
        </colgroup>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
          {e.note && (
            <tr>
              <th>조치 기록</th>
              <td className="sc-pre">{e.note}</td>
            </tr>
          )}
        </tbody>
      </table>

      {e.status === "open" && (
        <div className="sc-dialog-actions">
          <button className="btn primary" disabled={busy} onClick={() => void act("ack")}>
            알림 확인
          </button>
        </div>
      )}
      {e.status === "acked" && (
        <div className="sc-dialog-form">
          <label htmlFor="sc-note">점검·조치 기록</label>
          <textarea id="sc-note" className="field" rows={4} value={note} onChange={(ev) => setNote(ev.target.value)} />
          <div className="sc-dialog-actions">
            <button className="btn primary" disabled={busy} onClick={() => void act("done")}>
              조치 완료
            </button>
          </div>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
    </Modal>
  );
}
