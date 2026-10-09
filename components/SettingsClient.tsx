"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/lib/configStore";
import {
  BRIDGE_KIND_LABEL,
  LINK_TYPE_LABEL,
  RS485_MAX_DEVICES,
  SeverityLevel,
  STATUS_LABEL,
  ThresholdConfig,
} from "@/lib/types";
import PageHeader from "./PageHeader";
import SettingsTabs from "./SettingsTabs";

export default function SettingsClient() {
  const { thresholds, bridges, devices, configVersion, saveThresholds, addDevice, removeDevice } =
    useDashboard();

  const [form, setForm] = useState<ThresholdConfig>(thresholds);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [newDevice, setNewDevice] = useState({
    name: "",
    building: "",
    capacity: "",
    bridge_id: "",
  });

  // 서버에서 설정을 받아오면 폼 초기값을 맞춥니다.
  useEffect(() => setForm(thresholds), [thresholds]);

  /** RS-485 한 가닥에 지금 몇 대가 걸려 있는지 셉니다. */
  const countOn = (bridgeId: string) =>
    devices.filter((d) => d.bridge_id === bridgeId).length;

  function setSensor(
    sensor: "h2" | "ch4" | "temperature",
    tier: "caution" | "warning" | "danger",
    value: number
  ) {
    setForm((f) => ({ ...f, [sensor]: { ...f[sensor], [tier]: value } }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const result = await saveThresholds(form);
    setSaving(false);
    setMessage(
      result.ok
        ? { kind: "ok", text: "저장되었습니다." }
        : { kind: "error", text: result.error ?? "저장에 실패했습니다." }
    );
    if (result.ok) setTimeout(() => setMessage(null), 4000);
  }

  async function handleAddDevice() {
    if (!newDevice.name.trim() || !newDevice.building.trim()) {
      setMessage({ kind: "error", text: "이름과 위치는 필수입니다." });
      return;
    }
    const result = await addDevice({
      name: newDevice.name.trim(),
      building: newDevice.building.trim(),
      capacity: newDevice.capacity.trim(),
      bridge_id: newDevice.bridge_id || null,
    });
    if (result.ok) {
      setNewDevice({ name: "", building: "", capacity: "", bridge_id: newDevice.bridge_id });
      setMessage({ kind: "ok", text: "설비가 등록되었습니다." });
    } else {
      setMessage({ kind: "error", text: result.error ?? "설비 추가에 실패했습니다." });
    }
  }

  async function handleRemoveDevice(deviceId: string, name: string) {
    const result = await removeDevice(deviceId);
    setMessage(
      result.ok
        ? { kind: "ok", text: `${name} 설비를 삭제했습니다.` }
        : { kind: "error", text: result.error ?? "삭제에 실패했습니다." }
    );
  }

  return (
    <>
      <PageHeader
        title="설정"
        breadcrumb="홈 › 설정"
        subtitle={`센서 임계치 · 복합 판정 규칙 · 설비 등록 · 설정 버전 ${configVersion}`}
      />

      <SettingsTabs active="threshold" />

      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            센서 임계치 (진입값)
          </div>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
        <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table className="grid threshold-table">
          <colgroup>
            <col style={{ width: 180 }} />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>센서</th>
              <th>주의</th>
              <th>경고</th>
              <th>위험</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["h2", "수소가스 (ppm)"],
                ["ch4", "메탄가스 (ppm)"],
                ["temperature", "온도 (℃)"],
              ] as const
            ).map(([key, label]) => (
              <tr key={key}>
                <td>{label}</td>
                {(["caution", "warning", "danger"] as const).map((tier) => (
                  <td key={tier} className="num">
                    <input
                      type="number"
                      value={form[key][tier]}
                      onChange={(e) => setSensor(key, tier, Number(e.target.value))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <table className="form-grid">
          <tbody>
            <tr>
              <th>히스테리시스 여유</th>
              <td>
                <input
                  className="input num"
                  type="number"
                  step="0.01"
                  min={0}
                  max={0.99}
                  style={{ width: 100 }}
                  value={form.hysteresisMarginPct}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, hysteresisMarginPct: Number(e.target.value) }))
                  }
                />
                <span className="t-muted" style={{ marginLeft: 6 }}>비율 (0.1 = 10%)</span>
              </td>
              <th>통신단절 판정</th>
              <td>
                <input
                  className="input num"
                  type="number"
                  min={1}
                  style={{ width: 100 }}
                  value={form.offlineMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, offlineMinutes: Number(e.target.value) }))}
                />
                <span style={{ marginLeft: 6 }}>분</span>
              </td>
            </tr>
            <tr>
              <th>복합 판정 사용</th>
              <td>
                <input
                  type="checkbox"
                  checked={form.compositeEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, compositeEnabled: e.target.checked }))}
                />
              </td>
              <th>격상 기준 센서 수</th>
              <td>
                <input
                  className="input num"
                  type="number"
                  min={2}
                  max={4}
                  style={{ width: 100 }}
                  value={form.compositeMinSensors}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, compositeMinSensors: Number(e.target.value) }))
                  }
                />
                <span style={{ marginLeft: 6 }}>개 이상 동시 이상 시 한 단계 격상</span>
              </td>
            </tr>
            <tr>
              <th>유면 저하 등급</th>
              <td>
                <select
                  className="select"
                  style={{ width: 120 }}
                  value={form.oilLowLevel ?? "warning"}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, oilLowLevel: e.target.value as SeverityLevel }))
                  }
                >
                  {(["caution", "warning", "danger"] as const).map((level) => (
                    <option key={level} value={level}>
                      {STATUS_LABEL[level]}
                    </option>
                  ))}
                </select>
                <span className="t-muted" style={{ marginLeft: 6 }}>
                  유면 낮음 감지 시 적용 (규격 협의 중)
                </span>
              </td>
              <th />
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            설비 등록
          </div>
          <span className="card-note">{devices.length}대</span>
        </div>

        <table className="form-grid" style={{ marginBottom: 12 }}>
          <tbody>
            <tr>
              <th className="req">이름</th>
              <td>
                <input
                  className="input"
                  type="text"
                  style={{ width: "100%" }}
                  value={newDevice.name}
                  onChange={(e) => setNewDevice((f) => ({ ...f, name: e.target.value }))}
                />
              </td>
              <th className="req">위치</th>
              <td>
                <input
                  className="input"
                  type="text"
                  style={{ width: "100%" }}
                  value={newDevice.building}
                  onChange={(e) => setNewDevice((f) => ({ ...f, building: e.target.value }))}
                />
              </td>
            </tr>
            <tr>
              <th>용량</th>
              <td>
                <input
                  className="input"
                  type="text"
                  style={{ width: "100%" }}
                  value={newDevice.capacity}
                  onChange={(e) => setNewDevice((f) => ({ ...f, capacity: e.target.value }))}
                />
              </td>
              <th>연결 경로</th>
              <td>
                <select
                  className="select"
                  style={{ width: 240 }}
                  value={newDevice.bridge_id}
                  onChange={(e) => setNewDevice((f) => ({ ...f, bridge_id: e.target.value }))}
                >
                  <option value="">모듈 직결 (MQTT 직접 전송)</option>
                  {bridges.map((b) => {
                    const used = countOn(b.bridge_id);
                    const limit = b.max_devices ?? RS485_MAX_DEVICES;
                    const kind = BRIDGE_KIND_LABEL[b.kind ?? "bridge"];
                    return (
                      <option key={b.bridge_id} value={b.bridge_id} disabled={used >= limit}>
                        {b.name} ({kind} · {used}/{limit})
                      </option>
                    );
                  })}
                </select>
                <button className="btn" style={{ marginLeft: 4 }} onClick={handleAddDevice}>
                  설비 추가
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 52 }}>No</th>
                <th>이름</th>
                <th>위치</th>
                <th>용량</th>
                <th style={{ width: 110 }}>연결 방식</th>
                <th>브릿지 / PC</th>
                <th style={{ width: 72 }}>삭제</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && (
                <tr>
                  <td className="empty" colSpan={7}>
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {devices.map((d, i) => (
                <tr key={d.device_id}>
                  <td className="center">{i + 1}</td>
                  <td>{d.name}</td>
                  <td>{d.building}</td>
                  <td>{d.capacity}</td>
                  <td className="center">
                    {LINK_TYPE_LABEL[d.link_type ?? (d.bridge_id ? "bridge" : "direct")]}
                  </td>
                  <td>
                    {bridges.find((b) => b.bridge_id === d.bridge_id)?.name ?? d.bridge_id ?? "-"}
                  </td>
                  <td className="center">
                    <button
                      className="btn danger-outline"
                      style={{ height: 24, padding: "0 8px" }}
                      onClick={() => handleRemoveDevice(d.device_id, d.name)}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 브릿지 · 게이트웨이 수용 현황 ──────────────────────── */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            브릿지 · 게이트웨이
          </div>
          <span className="card-note">
            RS-485 한 가닥 최대 {RS485_MAX_DEVICES}대 (㈜헤디 회신 기준)
          </span>
        </div>

        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 52 }}>No</th>
                <th>식별자</th>
                <th>이름</th>
                <th style={{ width: 110 }}>종류</th>
                <th style={{ width: 110 }}>접속</th>
                <th style={{ width: 130 }}>등록 대수</th>
                <th>마지막 수신</th>
              </tr>
            </thead>
            <tbody>
              {bridges.length === 0 && (
                <tr>
                  <td className="empty" colSpan={7}>
                    등록된 브릿지·게이트웨이가 없습니다. 장비가 값을 보내면 자동 등록됩니다.
                  </td>
                </tr>
              )}
              {bridges.map((b, i) => {
                const used = countOn(b.bridge_id);
                const limit = b.max_devices ?? RS485_MAX_DEVICES;
                return (
                  <tr key={b.bridge_id}>
                    <td className="center">{i + 1}</td>
                    <td>{b.bridge_id}</td>
                    <td>{b.name}</td>
                    <td className="center">{BRIDGE_KIND_LABEL[b.kind ?? "bridge"]}</td>
                    <td className="center">
                      <span className={`badge ${b.online ? "normal" : "offline"}`}>
                        {b.online ? "온라인" : "오프라인"}
                      </span>
                    </td>
                    <td className="num" style={{ color: used >= limit ? "var(--danger)" : undefined }}>
                      {used} / {limit}
                    </td>
                    <td>
                      {b.last_seen_at ? new Date(b.last_seen_at).toLocaleString("ko-KR") : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
