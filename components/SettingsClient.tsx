"use client";

import { useState } from "react";
import { useConfig } from "@/lib/configStore";
import { ThresholdConfig, DeviceRegistry } from "@/lib/types";
import AppShell from "./AppShell";

export default function SettingsClient() {
  const { config, updateThresholds, addDevice, removeDevice, resetToDefault } = useConfig();
  const [form, setForm] = useState<ThresholdConfig>(config.thresholds);
  const [saved, setSaved] = useState(false);

  const [newDevice, setNewDevice] = useState({ name: "", building: "", capacity: "", bridge_id: config.bridges[0]?.bridge_id ?? "" });

  function setSensor(sensor: "h2" | "ch4" | "temperature", tier: "caution" | "warning" | "danger", value: number) {
    setForm((f) => ({ ...f, [sensor]: { ...f[sensor], [tier]: value } }));
  }

  function handleSave() {
    updateThresholds(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleAddDevice() {
    if (!newDevice.name || !newDevice.building) return;
    const nextId = String(Math.max(0, ...config.devices.map((d) => parseInt(d.device_id, 10))) + 1);
    const device: DeviceRegistry = {
      device_id: nextId,
      name: newDevice.name,
      building: newDevice.building,
      capacity: newDevice.capacity || "3상 500kVA",
      bridge_id: newDevice.bridge_id,
      base_h2: 6,
      base_ch4: 2,
      base_temperature: 50,
      base_oil_level: "정상",
    };
    addDevice(device);
    setNewDevice({ name: "", building: "", capacity: "", bridge_id: config.bridges[0]?.bridge_id ?? "" });
  }

  return (
    <AppShell active="settings">
      <div className="page-header">
        <div>
          <div className="page-title">설정</div>
          <div className="page-meta">센서 임계치 · 복합 판정 규칙 · 설비 등록</div>
        </div>
      </div>

      <div className="card">
        <div className="form-section">
          <h3>센서 임계치 (진입값)</h3>
          <p className="hint">
            값이 이 기준 이상이 되면 해당 등급으로 진입합니다. 해제는 아래 히스테리시스 여유만큼
            낮은 지점에서 이뤄져 경계값 근처에서 알람이 반복되지 않습니다.
          </p>
          <table className="threshold-table">
            <thead>
              <tr><th>센서</th><th>주의</th><th>경고</th><th>위험</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>수소가스 (ppm)</td>
                <td><input type="number" value={form.h2.caution} onChange={(e) => setSensor("h2", "caution", +e.target.value)} /></td>
                <td><input type="number" value={form.h2.warning} onChange={(e) => setSensor("h2", "warning", +e.target.value)} /></td>
                <td><input type="number" value={form.h2.danger} onChange={(e) => setSensor("h2", "danger", +e.target.value)} /></td>
              </tr>
              <tr>
                <td>메탄가스 (ppm)</td>
                <td><input type="number" value={form.ch4.caution} onChange={(e) => setSensor("ch4", "caution", +e.target.value)} /></td>
                <td><input type="number" value={form.ch4.warning} onChange={(e) => setSensor("ch4", "warning", +e.target.value)} /></td>
                <td><input type="number" value={form.ch4.danger} onChange={(e) => setSensor("ch4", "danger", +e.target.value)} /></td>
              </tr>
              <tr>
                <td>온도 (℃)</td>
                <td><input type="number" value={form.temperature.caution} onChange={(e) => setSensor("temperature", "caution", +e.target.value)} /></td>
                <td><input type="number" value={form.temperature.warning} onChange={(e) => setSensor("temperature", "warning", +e.target.value)} /></td>
                <td><input type="number" value={form.temperature.danger} onChange={(e) => setSensor("temperature", "danger", +e.target.value)} /></td>
              </tr>
            </tbody>
          </table>
          <div className="form-row">
            <label>히스테리시스 여유</label>
            <input type="number" step="0.01" value={form.hysteresisMarginPct} onChange={(e) => setForm((f) => ({ ...f, hysteresisMarginPct: +e.target.value }))} />
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>비율 (0.1 = 진입값보다 10% 낮아지면 해제)</span>
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
            <input type="checkbox" checked={form.compositeEnabled} onChange={(e) => setForm((f) => ({ ...f, compositeEnabled: e.target.checked }))} />
          </div>
          <div className="form-row">
            <label>격상 기준 센서 수</label>
            <input type="number" min={2} max={4} value={form.compositeMinSensors} onChange={(e) => setForm((f) => ({ ...f, compositeMinSensors: +e.target.value }))} />
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>개 이상 동시 이상 시 한 단계 격상 (수소·메탄·온도·유면 중)</span>
          </div>
        </div>

        <div className="save-bar">
          <button className="btn primary" onClick={handleSave}>저장</button>
          <button className="btn ghost" onClick={resetToDefault}>기본값으로 초기화</button>
          {saved && <span className="save-msg">저장되었습니다 · 실제 운영에서는 이 변경이 MQTT command로 각 장비에 전달됩니다</span>}
        </div>
      </div>

      <div className="card">
        <div className="form-section" style={{ marginBottom: 0 }}>
          <h3>설비 등록</h3>
          <p className="hint">현장에 새 변압기를 추가하거나 기존 설비를 제거합니다.</p>

          <div className="device-row head">
            <span>이름</span><span>위치</span><span>용량</span><span>브릿지</span><span></span>
          </div>
          {config.devices.map((d) => (
            <div className="device-row" key={d.device_id}>
              <span>{d.name}</span>
              <span>{d.building}</span>
              <span>{d.capacity}</span>
              <span>{config.bridges.find((b) => b.bridge_id === d.bridge_id)?.name ?? d.bridge_id}</span>
              <button className="btn danger-outline" onClick={() => removeDevice(d.device_id)}>삭제</button>
            </div>
          ))}

          <div className="form-row" style={{ marginTop: 16 }}>
            <input type="text" placeholder="이름 (예: 11호기)" value={newDevice.name} onChange={(e) => setNewDevice((f) => ({ ...f, name: e.target.value }))} />
            <input type="text" placeholder="위치 (예: F동)" value={newDevice.building} onChange={(e) => setNewDevice((f) => ({ ...f, building: e.target.value }))} />
            <input type="text" placeholder="용량 (예: 3상 500kVA)" value={newDevice.capacity} onChange={(e) => setNewDevice((f) => ({ ...f, capacity: e.target.value }))} />
            <select value={newDevice.bridge_id} onChange={(e) => setNewDevice((f) => ({ ...f, bridge_id: e.target.value }))} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}>
              {config.bridges.map((b) => (
                <option key={b.bridge_id} value={b.bridge_id}>{b.name}</option>
              ))}
            </select>
            <button className="btn primary" onClick={handleAddDevice}>설비 추가</button>
          </div>
        </div>
      </div>

      <footer className="note">
        설정 값은 이 브라우저에 저장됩니다 · 실 서비스에서는 Supabase의 설정 테이블에 저장해
        모든 관리자에게 동일하게 반영해야 합니다
      </footer>
    </AppShell>
  );
}
