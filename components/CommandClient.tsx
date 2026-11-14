"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "./PageHeader";
import SettingsTabs from "./SettingsTabs";
import Pager from "./Pager";
import { usePaged } from "@/lib/usePaged";
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
  sensor_config: Record<string, unknown> | null;
  sensor_config_at: string | null;
}

const CONFIG_LABEL: [string, string][] = [
  ["h2_thres", "H2 경고 임계값"],
  ["ch4_thres", "CH4 경고 임계값"],
  ["temp_thres", "온도 경고 기준값(℃)"],
];

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

/** 응답의 result 를 한 줄로 */
function resultText(ack: unknown): string | null {
  if (!ack || typeof ack !== "object") return null;
  const result = (ack as Record<string, unknown>).result;
  if (result === undefined || result === null) return null;
  if (typeof result !== "object") return `응답 ${String(result)}`;
  const parts = Object.entries(result as Record<string, unknown>).map(
    ([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`
  );
  return parts.length ? `응답 ${parts.join(", ")}` : null;
}

/** 수집기가 실제로 내보내는 명령 본문과 같은 모양 */
function sentBody(row: CommandRow) {
  const deviceId = row.device_id ?? (row.target_type === "module" ? row.target_id : undefined);
  return {
    cmdId: row.id,
    command: row.command,
    ...(deviceId ? { deviceId } : {}),
    ...(row.params && Object.keys(row.params).length ? { params: row.params } : {}),
    ts: row.sent_at ?? row.requested_at,
  };
}

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
  const [ackTimeout, setAckTimeout] = useState(10);

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
      if (body.ackTimeoutSec) setAckTimeout(body.ackTimeoutSec);
    } catch {
      setMessage({ kind: "error", text: "목록을 불러오지 못했습니다." });
    }
  }, []);

  // 브릿지는 목록에서 고르므로 처음 한 번만 첫 항목을 골라 둡니다.
  // 측정모듈·PC 는 직접 입력하는 칸이라 비워도 다시 채우지 않습니다.
  useEffect(() => {
    if (targetType !== "bridge") return;
    if (bridges.length && !bridges.some((b) => b.id === targetId)) setTargetId(bridges[0].id);
  }, [bridges, targetType, targetId]);

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

  const pg = usePaged(commands, 20);

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
        device_id: spec?.perDevice && targetType === "bridge" && deviceId ? deviceId : null,
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
        actions={
          <button className="btn" onClick={() => void load()}>
            새로고침
          </button>
        }
      />

      <SettingsTabs active="commands" />

      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}


      {/* ── 명령 발행 ───────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            명령 보내기
          </div>
          <button className={`btn ${spec?.risky ? "danger-outline" : "primary"}`}
            onClick={() => void send()} disabled={busy || !targetId}>
            {busy ? "보내는 중..." : "명령 보내기"}
          </button>
        </div>

        <div className="form-grid">
          <label className="field-row">
            <span>대상 종류</span>
            <select className="field" value={targetType}
              onChange={(e) => { setTargetType(e.target.value); setTargetId(""); setDeviceId(""); }}>
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
              <>
                <input className="field" value={targetId} list="cmd-target-list"
                  onChange={(e) => setTargetId(e.target.value.trim())}
                  placeholder={targetType === "module" ? "모듈 식별자" : "PC 식별자"} />
                {targetType === "module" && (
                  <datalist id="cmd-target-list">
                    {devices.map((d) => (
                      <option key={d.device_id} value={d.device_id}>{d.name}</option>
                    ))}
                  </datalist>
                )}
              </>
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

          {spec?.perDevice && targetType === "bridge" && (
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

          {(spec?.fields ?? []).map((f) => f.type === "boolean" ? (
            <label className="field-row" key={f.key}>
              <span>{f.label}</span>
              <label style={{ display: "flex", alignItems: "center", gap: 6, height: 34 }}>
                <input type="checkbox" checked={params[f.key] === "true"}
                  onChange={(e) => setParams({ ...params, [f.key]: e.target.checked ? "true" : "" })} />
                요청
              </label>
            </label>
          ) : (
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
      </div>

      {devices.some((d) => d.sensor_config) && (
        <div className="card flush">
          <div className="card-head">
            <div className="card-title">
              <span className="accent-bar" />
              장비 구성값
            </div>
          </div>
          <div className="table-wrap">
            <table className="fixed">
              <thead>
                <tr>
                  <th>설비</th>
                  {CONFIG_LABEL.map(([, label]) => <th key={label}>{label}</th>)}
                  <th>기타</th>
                  <th>확인 시각</th>
                </tr>
              </thead>
              <tbody>
                {devices.filter((d) => d.sensor_config).map((d) => {
                  const cfg = d.sensor_config ?? {};
                  const known = new Set(CONFIG_LABEL.map(([k]) => k));
                  const extra = Object.entries(cfg).filter(([k]) => !known.has(k));
                  return (
                    <tr key={d.device_id}>
                      <td><b>{d.name}</b><span className="cell-sub">{d.device_id}</span></td>
                      {CONFIG_LABEL.map(([k]) => (
                        <td key={k} className="num">{cfg[k] === undefined ? "-" : String(cfg[k])}</td>
                      ))}
                      <td>{extra.length ? extra.map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ") : "-"}</td>
                      <td className="center">{timeText(d.sensor_config_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 발행 이력 ───────────────────────────────────────── */}
      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            명령 이력
          </div>
          <span className="card-note">{commands.length}건</span>
        </div>

        <div className="table-wrap">
          <table className="fixed">
            <colgroup>
              <col style={{ width: 56 }} />
              <col style={{ width: 128 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 84 }} />
              <col style={{ width: 128 }} />
              <col />
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="num">번호</th>
                <th>요청 시각</th>
                <th>대상</th>
                <th>명령</th>
                <th>상태</th>
                <th>응답 시각</th>
                <th>비고</th>
                <th>동작</th>
              </tr>
            </thead>
            <tbody>
              {commands.length === 0 && (
                <tr>
                  <td className="empty" colSpan={8}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {pg.slice.map((row) => (
                <Fragment key={row.id}>
                <tr className={`clickable${openId === row.id ? " selected" : ""}`}
                  onClick={() => setOpenId(openId === row.id ? null : row.id)}>
                  <td className="num">{row.id}</td>
                  <td className="center">{timeText(row.requested_at)}</td>
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
                  <td className="center">
                    <span className={`badge ${STATUS_BADGE[row.status] ?? "offline"}`}>
                      {COMMAND_STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="center">{timeText(row.acked_at)}</td>
                  <td style={{ color: row.error ? "var(--danger)" : resultText(row.ack) ? undefined : "var(--faint)" }}
                    title={resultText(row.ack) ?? undefined}>
                    {row.error ?? resultText(row.ack) ?? (row.requested_by ? `요청 ${row.requested_by.split("@")[0]}` : "-")}
                  </td>
                  <td className="center">
                    {row.status === "pending" && (
                      <button className="btn danger-outline" style={{ height: 24, padding: "0 8px" }}
                        onClick={(e) => { e.stopPropagation(); void cancel(row); }}>
                        취소
                      </button>
                    )}
                  </td>
                </tr>
                {openId === row.id && (
                  <tr>
                    <td colSpan={8} style={{ padding: 12, background: "#f7f8fa" }}>
                      <div className="spark-title">보낸 명령</div>
                      <pre className="codeblock">{JSON.stringify(sentBody(row), null, 2)}</pre>
                      <div className="spark-title" style={{ marginTop: 8 }}>장치 응답</div>
                      <pre className="codeblock">{row.ack ? JSON.stringify(row.ack, null, 2) : "-"}</pre>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {pg.total > 20 && <Pager page={pg.page} total={pg.total} pageSize={20} onPage={pg.setPage} />}
      </div>

      <div className="note">
        토픽 <code>{"{접두사}/{현장}/{대상종류}/{대상id}/cmd"}</code> · 응답{" "}
        <code>cmd/ack</code> (<code>cmdId</code>) · 응답 대기 {ackTimeout}초
      </div>
    </>
  );
}
