"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/lib/configStore";
import { ThresholdConfig } from "@/lib/types";
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

  useEffect(() => {
    if (!newDevice.bridge_id && bridges.length) {
      setNewDevice((prev) => ({ ...prev, bridge_id: bridges[0].bridge_id }));
    }
  }, [bridges, newDevice.bridge_id]);

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
        ? { kind: "ok", text: "저장되었습니다. 모든 사용자 화면에 즉시 반영됩니다." }
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
      setNewDevice({ name: "", building: "", capacity: "", bridge_id: bridges[0]?.bridge_id ?? "" });
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

      <div className="card">
        <div className="form-section">
          <h3>센서 임계치 (진입값)</h3>
          <p className="hint">
            값이 이 기준 이상이 되면 해당 등급으로 진입합니다. 해제는 아래 히스테리시스 여유만큼
            낮은 지점에서 이뤄져 경계값 근처에서 알람이 반복되지 않습니다.
          </p>
          <table className="threshold-table">
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
                    <td key={tier}>
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

          <div className="form-row">
            <label>히스테리시스 여유</label>
            <input
              type="number"
              step="0.01"
              min={0}
              max={0.99}
              value={form.hysteresisMarginPct}
              onChange={(e) =>
                setForm((f) => ({ ...f, hysteresisMarginPct: Number(e.target.value) }))
              }
            />
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              비율 (0.1 = 진입값보다 10% 낮아지면 해제)
            </span>
          </div>

          <div className="form-row">
            <label>통신단절 판정</label>
            <input
              type="number"
              min={1}
              value={form.offlineMinutes}
              onChange={(e) => setForm((f) => ({ ...f, offlineMinutes: Number(e.target.value) }))}
            />
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              분 이상 데이터 미수신 시 통신단절 (전송 주기 5분 기준 15분 권장)
            </span>
          </div>
        </div>

        <div className="form-section">
          <h3>복합 판정 규칙</h3>
          <p className="hint">
            개별 센서는 각각 낮은 등급이어도, 여러 지표가 동시에 이상이면 실제로는 더 위험한
            상황일 수 있습니다. 이 규칙은 동시에 이상인 센서 개수를 보고 등급을 한 단계 올립니다.
          </p>
          <div className="form-row">
            <label>복합 판정 사용</label>
            <input
              type="checkbox"
              checked={form.compositeEnabled}
              onChange={(e) => setForm((f) => ({ ...f, compositeEnabled: e.target.checked }))}
            />
          </div>
          <div className="form-row">
            <label>격상 기준 센서 수</label>
            <input
              type="number"
              min={2}
              max={4}
              value={form.compositeMinSensors}
              onChange={(e) =>
                setForm((f) => ({ ...f, compositeMinSensors: Number(e.target.value) }))
              }
            />
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              개 이상 동시 이상 시 한 단계 격상 (수소·메탄·온도·유면 중)
            </span>
          </div>
        </div>

        <div className="save-bar">
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? "저장 중..." : "저장"}
          </button>
          {message && (
            <span
              className="save-msg"
              style={{ color: message.kind === "error" ? "var(--danger)" : undefined }}
            >
              {message.text}
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <div className="form-section" style={{ marginBottom: 0 }}>
          <h3>설비 등록</h3>
          <p className="hint">현장에 새 변압기를 추가하거나 기존 설비를 제거합니다.</p>

          <div className="device-row head">
            <span>이름</span>
            <span>위치</span>
            <span>용량</span>
            <span>브릿지</span>
            <span />
          </div>

          {devices.map((d) => (
            <div className="device-row" key={d.device_id}>
              <span>{d.name}</span>
              <span>{d.building}</span>
              <span>{d.capacity}</span>
              <span>
                {bridges.find((b) => b.bridge_id === d.bridge_id)?.name ?? d.bridge_id ?? "-"}
              </span>
              <button
                className="btn danger-outline"
                onClick={() => handleRemoveDevice(d.device_id, d.name)}
              >
                삭제
              </button>
            </div>
          ))}

          <div className="form-row" style={{ marginTop: 16 }}>
            <input
              type="text"
              placeholder="이름 (예: 11호기)"
              value={newDevice.name}
              onChange={(e) => setNewDevice((f) => ({ ...f, name: e.target.value }))}
            />
            <input
              type="text"
              placeholder="위치 (예: F동)"
              value={newDevice.building}
              onChange={(e) => setNewDevice((f) => ({ ...f, building: e.target.value }))}
            />
            <input
              type="text"
              placeholder="용량 (예: 3상 500kVA)"
              value={newDevice.capacity}
              onChange={(e) => setNewDevice((f) => ({ ...f, capacity: e.target.value }))}
            />
            <select
              value={newDevice.bridge_id}
              onChange={(e) => setNewDevice((f) => ({ ...f, bridge_id: e.target.value }))}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
            >
              {bridges.map((b) => (
                <option key={b.bridge_id} value={b.bridge_id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button className="btn primary" onClick={handleAddDevice}>
              설비 추가
            </button>
          </div>
        </div>
      </div>

      <footer className="note">
        설정 값은 서버 데이터베이스(app_config)에 저장되어 모든 관리자에게 동일하게 적용됩니다.
        설정 버전이 올라가면 수집 서버가 이를 감지해 각 브릿지로 MQTT command 를 전달합니다.
      </footer>
    </>
  );
}
