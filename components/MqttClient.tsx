"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "./PageHeader";
import SettingsTabs from "./SettingsTabs";

interface Config {
  host: string;
  port: number;
  username: string | null;
  password: string;
  tls: boolean;
  ca_path: string | null;
  client_id: string;
  topic_prefix: string;
  site: string;
  keep_log_days: number;
  version: number;
  updated_at: string;
}

interface Status {
  connected: boolean;
  broker: string | null;
  last_error: string | null;
  started_at: string | null;
  last_heartbeat: string | null;
  last_message_at: string | null;
  messages: number;
  rows_stored: number;
  alarms: number;
  errors: number;
  config_version: number | null;
}

function ago(iso: string | null): string {
  if (!iso) return "-";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 0) return "방금";
  if (seconds < 60) return `${seconds}초 전`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86400)}일 전`;
}

/**
 * 수집기가 살아 있는지 판단합니다.
 * 수집기는 30초마다 심장박동을 남기므로, 90초를 넘으면 멈춘 것으로 봅니다.
 */
function isAlive(status: Status | null): boolean {
  if (!status?.last_heartbeat) return false;
  return Date.now() - new Date(status.last_heartbeat).getTime() < 90_000;
}

export default function MqttClient() {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mqtt", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setConfig(body.config);
      setStatus(body.status);
    } catch {
      setMessage({ kind: "error", text: "설정을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 수집기 상태는 계속 바뀌므로 주기적으로 다시 봅니다.
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  async function save() {
    if (!config) return;
    setSaving(true);
    const res = await fetch("/api/mqtt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setMessage({ kind: "error", text: body.error ?? "저장에 실패했습니다." });
    setMessage({ kind: "ok", text: "저장했습니다. 수집기가 새 설정으로 다시 접속합니다." });
    setTimeout(() => setMessage(null), 5000);
    await load();
  }

  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig((c) => (c ? { ...c, [key]: value } : c));

  const alive = isAlive(status);
  const connected = alive && Boolean(status?.connected);

  return (
    <>
      <PageHeader
        title="데이터 연결"
        breadcrumb="홈 › 설정 › 데이터 연결"
        subtitle="현장 장비가 계측값을 올려 보내는 MQTT 브로커 접속 정보입니다"
        actions={
          <button className="btn" onClick={() => void load()} disabled={loading}>
            새로고침
          </button>
        }
      />

      <SettingsTabs active="mqtt" />

      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}

      {/* ── 수집기 상태 ─────────────────────────────────────── */}
      <div className="status-summary">
        <div className="st-tiles" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
          <div className={`st-tile ${connected ? "normal" : "danger"}`}>
            <span className="st-lbl">수집기</span>
            <span className="st-num" style={{ fontSize: 22 }}>
              {!alive ? "중지됨" : connected ? "연결됨" : "연결 끊김"}
            </span>
          </div>
          <div className="st-tile total">
            <span className="st-lbl">브로커</span>
            <span className="st-num" style={{ fontSize: 17 }}>{status?.broker ?? "-"}</span>
          </div>
          <div className="st-tile total">
            <span className="st-lbl">마지막 수신</span>
            <span className="st-num" style={{ fontSize: 19 }}>{ago(status?.last_message_at ?? null)}</span>
          </div>
          <div className="st-tile total">
            <span className="st-lbl">누적 수신</span>
            <span className="st-num">
              {status?.messages ?? 0}
              <small>건</small>
            </span>
          </div>
          <div className={`st-tile ${status?.errors ? "danger" : "total"}`}>
            <span className="st-lbl">오류</span>
            <span className="st-num">
              {status?.errors ?? 0}
              <small>건</small>
            </span>
          </div>
        </div>
      </div>

      {!alive && (
        <div className="banner error">
          수집기가 동작하지 않고 있습니다. 서버에서{" "}
          <code>pm2 start deploy/ecosystem.config.js --only dh-collector</code> 로 띄우세요.
        </div>
      )}
      {status?.last_error && alive && !connected && (
        <div className="banner error">브로커 연결 오류 — {status.last_error}</div>
      )}

      {/* ── 접속 정보 ───────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            브로커 접속 정보
          </div>
          <span className="card-note">
            저장하면 수집기가 곧바로 다시 접속합니다 · 설정 버전 {config?.version ?? "-"}
          </span>
        </div>

        {config && (
          <>
            <div className="form-grid">
              <label className="field-row">
                <span>브로커 주소</span>
                <input className="field" value={config.host}
                  onChange={(e) => set("host", e.target.value)} placeholder="127.0.0.1" />
                <small className="hint" style={{ margin: 0 }}>
                  같은 서버의 Mosquitto 를 쓰면 127.0.0.1 입니다.
                </small>
              </label>

              <label className="field-row">
                <span>포트</span>
                <input className="field" type="number" value={config.port}
                  onChange={(e) => set("port", Number(e.target.value))} />
                <small className="hint" style={{ margin: 0 }}>
                  평문 1883 · TLS 8883
                </small>
              </label>

              <label className="field-row">
                <span>계정</span>
                <input className="field" value={config.username ?? ""} autoComplete="off"
                  onChange={(e) => set("username", e.target.value)} placeholder="비워 두면 익명 접속" />
              </label>

              <label className="field-row">
                <span>비밀번호</span>
                <input className="field" type="password" value={config.password} autoComplete="off"
                  onChange={(e) => set("password", e.target.value)} />
                <small className="hint" style={{ margin: 0 }}>
                  저장하면 가려집니다. 그대로 두면 기존 값이 유지됩니다.
                </small>
              </label>

              <label className="field-row">
                <span>TLS 사용</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, height: 34 }}>
                  <input type="checkbox" checked={config.tls}
                    onChange={(e) => set("tls", e.target.checked)} />
                  <span style={{ color: "var(--muted)", fontSize: 13.5 }}>
                    외부에서 붙는 장비가 있으면 반드시 켜세요.
                  </span>
                </span>
              </label>

              <label className="field-row">
                <span>CA 인증서 경로</span>
                <input className="field" value={config.ca_path ?? ""}
                  onChange={(e) => set("ca_path", e.target.value)}
                  placeholder="/etc/mosquitto/certs/ca.crt" />
              </label>

              <label className="field-row">
                <span>클라이언트 ID</span>
                <input className="field" value={config.client_id}
                  onChange={(e) => set("client_id", e.target.value)} />
                <small className="hint" style={{ margin: 0 }}>
                  장비와 겹치면 서로 연결이 끊깁니다. 수집기 전용 값이어야 합니다.
                </small>
              </label>

              <label className="field-row">
                <span>수신 내역 보관</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input className="field" type="number" min={1} max={365} style={{ width: 90 }}
                    value={config.keep_log_days}
                    onChange={(e) => set("keep_log_days", Number(e.target.value))} />
                  <span style={{ color: "var(--muted)" }}>일</span>
                </span>
                <small className="hint" style={{ margin: 0 }}>
                  지난 것은 수집기가 스스로 지웁니다. 계측 이력(telemetry)과는 별개입니다.
                </small>
              </label>

              <label className="field-row">
                <span>토픽 접두사</span>
                <input className="field" value={config.topic_prefix}
                  onChange={(e) => set("topic_prefix", e.target.value)} placeholder="dh/v1" />
              </label>

              <label className="field-row">
                <span>현장 코드</span>
                <input className="field" value={config.site}
                  onChange={(e) => set("site", e.target.value)} placeholder="dh1" />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="btn primary" onClick={() => void save()} disabled={saving}>
                {saving ? "저장 중..." : "저장하고 다시 접속"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── 토픽 규격 안내 ──────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            장비에 전달할 토픽 규격
          </div>
          <span className="card-note">장비 업체와 협의 중인 규격입니다</span>
        </div>

        <p className="hint">
          토픽은 <b>누가 보냈는가</b>, 페이로드는 <b>어느 설비의 값인가</b>를 나타냅니다. 그래서
          브릿지 경유, 모듈 직결, PC 경유 중 어느 구성이든 서버가 같은 방식으로 받습니다.
        </p>

        <pre className="codeblock">
{`${config?.topic_prefix ?? "dh/v1"}/${config?.site ?? "dh1"}/{srcType}/{srcId}/tele      계측값
${config?.topic_prefix ?? "dh/v1"}/${config?.site ?? "dh1"}/{srcType}/{srcId}/stat      상태 (retain + LWT)
${config?.topic_prefix ?? "dh/v1"}/${config?.site ?? "dh1"}/{srcType}/{srcId}/cmd       서버 → 장치 명령
${config?.topic_prefix ?? "dh/v1"}/${config?.site ?? "dh1"}/{srcType}/{srcId}/cmd/ack   장치 → 서버 응답

srcType = bridge | module | gateway`}
        </pre>

        <div className="spark-title" style={{ marginTop: 14 }}>계측값 페이로드</div>
        <pre className="codeblock">
{`{
  "ts": "2026-09-20T01:23:45Z",
  "seq": 10421,
  "replay": false,
  "items": [
    { "deviceId": "1", "ts": "2026-09-20T01:23:40Z",
      "h2": 11.9, "ch4": 3.4, "temp": 48.8, "oil": 1, "q": 0 }
  ]
}`}
        </pre>

        <ul className="spec-list">
          <li>
            <b>deviceId</b> — 설비 식별자. 브릿지·모듈을 교체해도 바뀌지 않아야 합니다.
            등록되지 않은 값이 오면 임시로 설비를 만들고 수신 내역에 경고를 남깁니다.
          </li>
          <li>
            <b>ts</b> — 장치가 측정한 시각. 없으면 서버 수신 시각으로 대체하지만, 재전송분의
            시각이 전부 틀어지므로 장치 시각 동기가 사실상 필수입니다.
          </li>
          <li>
            <b>replay</b> — 버퍼에 쌓였다가 뒤늦게 보내는 과거분. true 면 이력만 적재하고
            알람을 울리지 않으며 현재값도 덮어쓰지 않습니다.
          </li>
          <li>
            <b>oil</b> — 유면. 현재 2치(정상/낮음)로 저장합니다. 접점(0/1)·문자열·숫자를
            모두 받습니다. 아날로그(%/mm)로 확정되면 서버 수정이 필요합니다.
          </li>
          <li>QoS 1 을 권장합니다. 중복 수신은 서버가 걸러냅니다.</li>
        </ul>
      </div>

      <div className="note">
        설비 하나만 담은 납작한 형태(items 없이 최상위에 deviceId)도 받습니다. 장비 업체가 어느
        쪽으로 보내든 동작하게 하기 위한 것입니다.
      </div>
    </>
  );
}
