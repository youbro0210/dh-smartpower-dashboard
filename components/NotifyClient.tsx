"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "./PageHeader";
import SettingsTabs from "./SettingsTabs";
import {
  CHANNEL_FIELDS,
  CHANNEL_LABEL,
  ChannelConfig,
  NOTIFY_CHANNELS,
  NotifyChannel,
  Recipient,
  Severity,
  TARGET_HINT,
} from "@/lib/notify/types";

interface ChannelState {
  channel: NotifyChannel;
  enabled: boolean;
  config: ChannelConfig;
}

interface LogRow {
  id: number;
  alarm_id: number | null;
  recipient: string | null;
  channel: NotifyChannel;
  target: string;
  level: Severity | null;
  status: "sent" | "failed" | "skipped";
  error: string | null;
  created_at: string;
}

const LEVEL_LABEL: Record<Severity, string> = {
  caution: "주의 이상",
  warning: "경고 이상",
  danger: "위험만",
};

const STATUS_LABEL: Record<LogRow["status"], string> = {
  sent: "발송",
  failed: "실패",
  skipped: "건너뜀",
};

const EMPTY_FORM = {
  name: "",
  channel: "telegram" as NotifyChannel,
  target: "",
  min_level: "warning" as Severity,
  quiet_from: "",
  quiet_to: "",
  memo: "",
};

export default function NotifyClient() {
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [openChannel, setOpenChannel] = useState<NotifyChannel | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const notify = useCallback((kind: "ok" | "error", text: string) => {
    setMessage({ kind, text });
    if (kind === "ok") setTimeout(() => setMessage(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r, l] = await Promise.all([
        fetch("/api/notify/channels", { cache: "no-store" }).then((x) => x.json()),
        fetch("/api/notify/recipients", { cache: "no-store" }).then((x) => x.json()),
        fetch("/api/notify/log?limit=50", { cache: "no-store" }).then((x) => x.json()),
      ]);
      if (c.channels) setChannels(c.channels);
      if (r.recipients) setRecipients(r.recipients);
      if (l.log) setLog(l.log);
    } catch {
      notify("error", "설정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  function setChannelField(channel: NotifyChannel, key: string, value: string) {
    setChannels((list) =>
      list.map((c) => (c.channel === channel ? { ...c, config: { ...c.config, [key]: value } } : c))
    );
  }

  async function saveChannel(channel: NotifyChannel, enabled: boolean) {
    const state = channels.find((c) => c.channel === channel);
    if (!state) return;
    setBusy(`channel-${channel}`);
    const res = await fetch("/api/notify/channels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, enabled, config: state.config }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return notify("error", body.error ?? "저장에 실패했습니다.");
    setChannels((list) => list.map((c) => (c.channel === channel ? { ...c, enabled, config: body.config } : c)));
    notify("ok", `${CHANNEL_LABEL[channel]} 설정을 저장했습니다.`);
  }

  async function submitRecipient() {
    setBusy("recipient");
    const payload = {
      ...(editingId ? { id: editingId } : {}),
      name: form.name,
      channel: form.channel,
      target: form.target,
      min_level: form.min_level,
      quiet_from: form.quiet_from === "" ? null : Number(form.quiet_from),
      quiet_to: form.quiet_to === "" ? null : Number(form.quiet_to),
      memo: form.memo,
      enabled: true,
    };
    const res = await fetch("/api/notify/recipients", {
      method: editingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return notify("error", body.error ?? "저장에 실패했습니다.");
    setForm(EMPTY_FORM);
    setEditingId(null);
    notify("ok", editingId ? "수신자를 수정했습니다." : "수신자를 추가했습니다.");
    await load();
  }

  async function toggleRecipient(r: Recipient) {
    await fetch("/api/notify/recipients", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, enabled: !r.enabled }),
    });
    await load();
  }

  async function removeRecipient(r: Recipient) {
    if (!confirm(`${r.name} (${r.target}) 수신자를 삭제할까요?`)) return;
    const res = await fetch(`/api/notify/recipients?id=${r.id}`, { method: "DELETE" });
    if (!res.ok) return notify("error", "삭제에 실패했습니다.");
    notify("ok", "수신자를 삭제했습니다.");
    await load();
  }

  async function testSend(r: Recipient) {
    setBusy(`test-${r.id}`);
    const res = await fetch("/api/notify/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) notify("error", `테스트 발송 실패 — ${body.error ?? "사유 없음"}`);
    else notify("ok", `${r.name} 님에게 테스트 메시지를 보냈습니다.`);
    await load();
  }

  function startEdit(r: Recipient) {
    setEditingId(r.id);
    setForm({
      name: r.name,
      channel: r.channel,
      target: r.target,
      min_level: r.min_level,
      quiet_from: r.quiet_from === null ? "" : String(r.quiet_from),
      quiet_to: r.quiet_to === null ? "" : String(r.quiet_to),
      memo: r.memo ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const enabledChannels = channels.filter((c) => c.enabled).map((c) => c.channel);

  return (
    <>
      <PageHeader
        title="알림 발송"
        breadcrumb="홈 › 설정 › 알림 발송"
        subtitle="알람이 발생하면 등록된 사람에게 각자 지정한 경로로 즉시 보냅니다"
        actions={
          <button className="btn" onClick={() => void load()} disabled={loading}>
            새로고침
          </button>
        }
      />

      <SettingsTabs active="notify" />

      {message && (
        <div className={`banner ${message.kind}`}>{message.text}</div>
      )}

      {/* ── 수신자 ─────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            {editingId ? "수신자 수정" : "수신자 추가"}
          </div>
          <span className="card-note">여러 명을 등록할 수 있습니다</span>
        </div>

        <div className="form-grid">
          <label className="field-row">
            <span>이름</span>
            <input
              className="field"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="홍길동 · 당직실"
            />
          </label>

          <label className="field-row">
            <span>발송 경로</span>
            <select
              className="field"
              value={form.channel}
              onChange={(e) => setForm({ ...form, channel: e.target.value as NotifyChannel })}
            >
              {NOTIFY_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                  {enabledChannels.includes(c) ? "" : " (연동 전)"}
                </option>
              ))}
            </select>
          </label>

          <label className="field-row wide">
            <span>받는 곳</span>
            <input
              className="field"
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              placeholder={TARGET_HINT[form.channel]}
            />
            <small className="hint" style={{ margin: 0 }}>
              {TARGET_HINT[form.channel]}
            </small>
          </label>

          <label className="field-row">
            <span>발송 기준</span>
            <select
              className="field"
              value={form.min_level}
              onChange={(e) => setForm({ ...form, min_level: e.target.value as Severity })}
            >
              {(["caution", "warning", "danger"] as Severity[]).map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABEL[l]}
                </option>
              ))}
            </select>
          </label>

          <label className="field-row">
            <span>야간 미발송</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="field"
                type="number"
                min={0}
                max={23}
                style={{ width: 70 }}
                value={form.quiet_from}
                onChange={(e) => setForm({ ...form, quiet_from: e.target.value })}
                placeholder="22"
              />
              <span style={{ color: "var(--muted)" }}>시 ~</span>
              <input
                className="field"
                type="number"
                min={0}
                max={23}
                style={{ width: 70 }}
                value={form.quiet_to}
                onChange={(e) => setForm({ ...form, quiet_to: e.target.value })}
                placeholder="7"
              />
              <span style={{ color: "var(--muted)" }}>시</span>
            </span>
            <small className="hint" style={{ margin: 0 }}>
              비워 두면 항상 보냅니다. 위험 등급은 이 구간에도 보냅니다.
            </small>
          </label>

          <label className="field-row wide">
            <span>메모</span>
            <input
              className="field"
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
              placeholder="선택 — 담당 구역, 근무조 등"
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn primary" onClick={() => void submitRecipient()} disabled={busy === "recipient"}>
            {editingId ? "수정 저장" : "수신자 추가"}
          </button>
          {editingId && (
            <button
              className="btn"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY_FORM);
              }}
            >
              취소
            </button>
          )}
        </div>
      </div>

      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            등록된 수신자
          </div>
          <span className="card-note">{recipients.length}명</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 110 }}>이름</th>
                <th style={{ width: 120 }}>발송 경로</th>
                <th style={{ minWidth: 160 }}>받는 곳</th>
                <th style={{ width: 100 }}>발송 기준</th>
                <th style={{ width: 110 }}>야간 미발송</th>
                <th style={{ width: 80 }}>사용</th>
                <th style={{ width: 190 }}>동작</th>
              </tr>
            </thead>
            <tbody>
              {recipients.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">
                      등록된 수신자가 없습니다. 위에서 추가하면 알람 발생 시 바로 발송됩니다.
                    </div>
                  </td>
                </tr>
              )}
              {recipients.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <b>{r.name}</b>
                    {r.memo && <span className="cell-sub">{r.memo}</span>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{CHANNEL_LABEL[r.channel]}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.target}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{LEVEL_LABEL[r.min_level]}</td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
                    {r.quiet_from === null ? "없음" : `${r.quiet_from}시 ~ ${r.quiet_to}시`}
                  </td>
                  <td>
                    <span className={`badge ${r.enabled ? "normal" : "offline"}`}>
                      {r.enabled ? "사용" : "중지"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        className="btn"
                        onClick={() => void testSend(r)}
                        disabled={busy === `test-${r.id}`}
                      >
                        {busy === `test-${r.id}` ? "발송 중" : "테스트"}
                      </button>
                      <button className="btn" onClick={() => startEdit(r)}>
                        수정
                      </button>
                      <button className="btn" onClick={() => void toggleRecipient(r)}>
                        {r.enabled ? "중지" : "사용"}
                      </button>
                      <button className="btn danger-outline" onClick={() => void removeRecipient(r)}>
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 채널 연동 ───────────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            발송 경로 연동
          </div>
          <span className="card-note">
            {enabledChannels.length}개 사용 중 · 비밀값은 저장 후 가려집니다
          </span>
        </div>

        {channels.map((c) => {
          const open = openChannel === c.channel;
          return (
            <div className={`channel${c.enabled ? " on" : ""}`} key={c.channel}>
              <button
                type="button"
                className="channel-head"
                onClick={() => setOpenChannel(open ? null : c.channel)}
              >
                <span className={`badge ${c.enabled ? "normal" : "offline"}`}>
                  {c.enabled ? "사용" : "미사용"}
                </span>
                <b>{CHANNEL_LABEL[c.channel]}</b>
                <span className="channel-count">
                  수신자 {recipients.filter((r) => r.channel === c.channel).length}명
                </span>
                <span className="channel-toggle">{open ? "접기 ▲" : "설정 ▼"}</span>
              </button>

              {open && (
                <div className="channel-body">
                  {CHANNEL_FIELDS[c.channel].map((f) => (
                    <label className="field-row wide" key={f.key}>
                      <span>
                        {f.label}
                        {f.required && <i className="req">*</i>}
                      </span>
                      <input
                        className="field"
                        type={f.secret ? "password" : "text"}
                        autoComplete="off"
                        value={c.config[f.key] ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) => setChannelField(c.channel, f.key, e.target.value)}
                      />
                      {f.hint && (
                        <small className="hint" style={{ margin: 0 }}>
                          {f.hint}
                        </small>
                      )}
                    </label>
                  ))}

                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      className="btn primary"
                      onClick={() => void saveChannel(c.channel, true)}
                      disabled={busy === `channel-${c.channel}`}
                    >
                      저장하고 사용
                    </button>
                    <button
                      className="btn"
                      onClick={() => void saveChannel(c.channel, false)}
                      disabled={busy === `channel-${c.channel}`}
                    >
                      저장하고 중지
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── 발송 이력 ───────────────────────────────────────────── */}
      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            발송 이력
          </div>
          <span className="card-note">최근 50건</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>시각</th>
                <th style={{ width: 110 }}>수신자</th>
                <th style={{ width: 110 }}>경로</th>
                <th style={{ minWidth: 150 }}>받는 곳</th>
                <th style={{ width: 80 }}>결과</th>
                <th>사유 · 오류</th>
              </tr>
            </thead>
            <tbody>
              {log.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">아직 발송 이력이 없습니다.</div>
                  </td>
                </tr>
              )}
              {log.map((row) => (
                <tr key={row.id}>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
                    {new Date(row.created_at).toLocaleString("ko-KR", { hour12: false })}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{row.recipient ?? "-"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{CHANNEL_LABEL[row.channel]}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{row.target}</td>
                  <td>
                    <span
                      className={`badge ${
                        row.status === "sent" ? "normal" : row.status === "failed" ? "danger" : "offline"
                      }`}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{row.error ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="note">
        알람이 생기면 발송 워커가 이 설정을 보고 즉시 보냅니다. 카카오 알림톡과 WhatsApp 은
        사업자가 먼저 보내는 메시지에 사전 승인된 템플릿을 요구하므로, 각 서비스에서 템플릿
        승인을 받은 뒤 그 ID 를 위에 넣어야 실제로 발송됩니다. 문자메시지는 발신번호 사전등록이
        필요합니다.
      </div>
    </>
  );
}
