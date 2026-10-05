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
        <table className="grid threshold-table" style={{ marginBottom: 12 }}>
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
              <th>브릿지</th>
              <td>
                <select
                  className="select"
                  style={{ width: 200 }}
                  value={newDevice.bridge_id}
                  onChange={(e) => setNewDevice((f) => ({ ...f, bridge_id: e.target.value }))}
                >
                  {bridges.map((b) => (
                    <option key={b.bridge_id} value={b.bridge_id}>
                      {b.name}
                    </option>
                  ))}
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
                <th>브릿지</th>
                <th style={{ width: 72 }}>삭제</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && (
                <tr>
                  <td className="empty" colSpan={6}>
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
    </>
  );
}
