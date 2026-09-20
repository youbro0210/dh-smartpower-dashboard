"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "./PageHeader";
import SettingsTabs from "./SettingsTabs";
import { COMMANDS, COMMAND_KEYS, COMMAND_STATUS_LABEL } from "@/lib/commands";

interface CommandRow {
  id: number;
  site: string;
  target_type: string;
  target_id: string;
  device_id: string | null;
  command: string;
  params: Record<string, unknown>;
  status: keyof typeof COMMAND_STATUS_LABEL;
  requested_at: string;
  sent_at: string | null;
  acked_at: string | null;
  ack: unknown;
  error: string | null;
  requested_by: string | null;
}

interface Bridge {
  id: string;
  name: string;
  online: boolean;
  last_seen_at: string | null;
}

interface Device {
  device_id: string;
  name: string;
  bridge_id: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "caution",
  sent: "warning",
  acked: "normal",
  failed: "danger",
  timeout: "offline",
};

const TARGET_LABEL: Record<string, string> = {
  bridge: "브릿지",
  module: "측정모듈 직결",
  gateway: "게이트웨이 PC",
};

function timeText(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 서버에서 현장 장비로 명령을 내보내고 응답을 확인합니다. */
export default function CommandClient() {
  const [commands, setCommands] = useState<CommandRow[]>([]);
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const [targetType, setTargetType] = useState("bridge");
  const [targetId, setTargetId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [command, setCommand] = useState<string>(COMMAND_KEYS[0]);
  const [params, setParams] = useState<Record<string, string>>({});

  const spec = COMMANDS[command];

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/commands?limit=50", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setCommands(body.commands ?? []);
      setBridges(body.bridges ?? []);
      setDevices(body.devices ?? []);
      if (!targetId && body.bridges?.length) setTargetId(body.bridges[0].id);
    } catch {
      setMessage({ kind: "error", text: "목록을 불러오지 못했습니다." });
    }
  }, [targetId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 발행한 명령의 응답이 오는지 잠시 지켜봅니다.
  useEffect(() => {
    const waiting = commands.some((c) => c.status === "pending" || c.status === "sent");
    if (!waiting) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [commands, load]);

  const deviceChoices = useMemo(
    () =>
      targetType === "bridge"
        ? devices.filter((d) => !targetId || d.bridge_id === targetId)
        : devices,
    [devices, targetType, targetId]
  );

  async function send() {
    if (spec?.risky) {
      const ok = confirm(
        `${spec.label} 명령을 ${targetId} 로 보냅니다.\n${spec.description}\n\n계속할까요?`
      );
      if (!ok) return;
    }

    setBusy(true);
    const res = await fetch("/api/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_type: targetType,
        target_id: targetId,
        device_id: spec?.perDevice && deviceId ? deviceId : null,
        command,
        params,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ kind: "error", text: body.error ?? "발행에 실패했습니다." });
    setMessage({ kind: "ok", text: `명령 ${body.id} 을(를) 대기열에 넣었습니다.` });
    setTimeout(() => setMessage(null), 4000);
    setParams({});
    await load();
  }

  async function cancel(row: CommandRow) {
    const res = await fetch(`/api/commands?id=${row.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage({ kind: "error", text: body.error ?? "취소하지 못했습니다." });
    await load();
  }

  return (
    <>
      <PageHeader
        title="장비 제어"
        breadcrumb="홈 › 설정 › 장비 제어"
        subtitle="서버에서 현장 장비로 명령을 보내고 응답을 확인합니다"
        actions={
          <button className="btn" onClick={() => void load()}>
            새로고침
          </button>
        }
      />

      <SettingsTabs active="commands" />

      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}

      <div className="banner warn-soft">
        아래 명령 집합은 <b>장비 업체와 확정 전</b>입니다. 장치가 같은 규격으로 구현해야 실제로
        동작하며, 그 전까지는 발행 후 응답 없음으로 끝납니다.
      </div>

      {/* ── 명령 발행 ───────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            명령 보내기
          </div>
          <span className="card-note">관리자만 보낼 수 있습니다</span>
        </div>

        <div className="form-grid">
          <label className="field-row">
            <span>대상 종류</span>
            <select className="field" value={targetType}
              onChange={(e) => { setTargetType(e.target.value); setDeviceId(""); }}>
              {Object.entries(TARGET_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>

          <label className="field-row">
            <span>대상</span>
            {targetType === "bridge" ? (
              <select className="field" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                {bridges.length === 0 && <option value="">등록된 브릿지가 없습니다</option>}
                {bridges.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.id}) {b.online ? "· 온라인" : "· 오프라인"}
                  </option>
                ))}
              </select>
            ) : (
              <input className="field" value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder={targetType === "module" ? "모듈 식별자" : "PC 식별자"} />
            )}
          </label>

          <label className="field-row wide">
            <span>명령</span>
            <select className="field" value={command}
              onChange={(e) => { setCommand(e.target.value); setParams({}); }}>
              {COMMAND_KEYS.map((key) => (
                <option key={key} value={key}>{COMMANDS[key].label}</option>
              ))}
            </select>
            <small className="hint" style={{ margin: 0 }}>{spec?.description}</small>
          </label>

          {spec?.perDevice && (
            <label className="field-row wide">
              <span>설비 지정 (선택)</span>
              <select className="field" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">전체 설비</option>
                {deviceChoices.map((d) => (
                  <option key={d.device_id} value={d.device_id}>
                    {d.name} ({d.device_id})
                  </option>
                ))}
              </select>
            </label>
          )}

          {(spec?.fields ?? []).map((f) => (
            <label className="field-row" key={f.key}>
              <span>
                {f.label}
                {f.required && <i className="req">*</i>}
              </span>
              <input className="field" type={f.type === "number" ? "number" : "text"}
                min={f.min} max={f.max} placeholder={f.placeholder}
                value={params[f.key] ?? ""}
                onChange={(e) => setParams({ ...params, [f.key]: e.target.value })} />
              {f.hint && <small className="hint" style={{ margin: 0 }}>{f.hint}</small>}
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className={`btn ${spec?.risky ? "danger-outline" : "primary"}`}
            onClick={() => void send()} disabled={busy || !targetId}>
            {busy ? "보내는 중..." : "명령 보내기"}
          </button>
        </div>
      </div>

      {/* ── 발행 이력 ───────────────────────────────────────── */}
      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            명령 이력
          </div>
          <span className="card-note">{commands.length}건 · 행을 누르면 응답 원문을 봅니다</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num" style={{ width: 55 }}>번호</th>
                <th style={{ width: 120 }}>요청 시각</th>
                <th style={{ width: 150 }}>대상</th>
                <th style={{ minWidth: 150 }}>명령</th>
                <th style={{ width: 90 }}>상태</th>
                <th style={{ width: 120 }}>응답 시각</th>
                <th>비고</th>
                <th style={{ width: 80 }}>동작</th>
              </tr>
            </thead>
            <tbody>
              {commands.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">보낸 명령이 없습니다.</div>
                  </td>
                </tr>
              )}
              {commands.map((row) => (
                <tr key={row.id} className="clickable"
                  onClick={() => setOpenId(openId === row.id ? null : row.id)}>
                  <td className="num" style={{ color: "var(--faint)" }}>{row.id}</td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
                    {timeText(row.requested_at)}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <b>{row.target_id}</b>
                    <span className="cell-sub">
                      {TARGET_LABEL[row.target_type] ?? row.target_type}
                      {row.device_id ? ` · 설비 ${row.device_id}` : ""}
                    </span>
                  </td>
                  <td>
                    {COMMANDS[row.command]?.label ?? row.command}
                    {Object.keys(row.params ?? {}).length > 0 && (
                      <span className="cell-sub">{JSON.stringify(row.params)}</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[row.status] ?? "offline"}`}>
                      {COMMAND_STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
                    {timeText(row.acked_at)}
                  </td>
                  <td style={{ color: row.error ? "var(--danger)" : "var(--faint)" }}>
                    {row.error ?? (row.requested_by ? `요청 ${row.requested_by.split("@")[0]}` : "-")}
                  </td>
                  <td>
                    {row.status === "pending" && (
                      <button className="btn danger-outline"
                        onClick={(e) => { e.stopPropagation(); void cancel(row); }}>
                        취소
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {openId !== null && (
          <div style={{ padding: "0 14px 14px" }}>
            <div className="spark-title">장치 응답 원문</div>
            <pre className="codeblock">
              {JSON.stringify(commands.find((c) => c.id === openId)?.ack ?? { 응답: "아직 없음" }, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div className="note">
        명령은 <code>{"{접두사}/{현장}/{대상종류}/{대상id}/cmd"}</code> 토픽으로 나가며, 장치는
        같은 <code>cmdId</code> 를 담아 <code>cmd/ack</code> 로 답해야 응답 완료로 표시됩니다.
        60초 안에 응답이 없으면 응답 없음으로 정리합니다.
      </div>
    </>
  );
}
