"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { AppConfig, DeviceRegistry, Bridge, ThresholdConfig } from "./types";

const STORAGE_KEY = "dh-smartpower-config-v1";

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  h2: { caution: 20, warning: 50, danger: 100 },
  ch4: { caution: 15, warning: 30, danger: 60 },
  temperature: { caution: 55, warning: 65, danger: 75 },
  hysteresisMarginPct: 0.1,
  compositeEnabled: true,
  compositeMinSensors: 2,
};

const DEFAULT_BRIDGES: Bridge[] = [
  { bridge_id: "BR-1", name: "브릿지 1 (A/B동)", online: true },
  { bridge_id: "BR-2", name: "브릿지 2 (C/D동)", online: true },
  { bridge_id: "BR-3", name: "브릿지 3 (E동)", online: true },
];

const DEFAULT_DEVICES: DeviceRegistry[] = [
  { device_id: "1", name: "1호기", building: "A동", capacity: "3상 300kVA", bridge_id: "BR-1", base_h2: 6, base_ch4: 2, base_temperature: 52, base_oil_level: "정상" },
  { device_id: "2", name: "2호기", building: "A동", capacity: "3상 300kVA", bridge_id: "BR-1", base_h2: 25, base_ch4: 6, base_temperature: 58, base_oil_level: "정상" },
  { device_id: "3", name: "3호기", building: "A동", capacity: "3상 500kVA", bridge_id: "BR-1", base_h2: 9, base_ch4: 3, base_temperature: 50, base_oil_level: "정상" },
  { device_id: "4", name: "4호기", building: "B동", capacity: "3상 500kVA", bridge_id: "BR-1", base_h2: 110, base_ch4: 35, base_temperature: 76, base_oil_level: "낮음" },
  { device_id: "5", name: "5호기", building: "B동", capacity: "3상 750kVA", bridge_id: "BR-1", base_h2: 5, base_ch4: 2, base_temperature: 48, base_oil_level: "정상" },
  { device_id: "6", name: "6호기", building: "C동", capacity: "3상 750kVA", bridge_id: "BR-2", base_h2: 11, base_ch4: 32, base_temperature: 56, base_oil_level: "정상" },
  { device_id: "7", name: "7호기", building: "C동", capacity: "3상 500kVA", bridge_id: "BR-2", base_h2: 7, base_ch4: 3, base_temperature: 50, base_oil_level: "정상" },
  { device_id: "8", name: "8호기", building: "D동", capacity: "3상 1000kVA", bridge_id: "BR-2", base_h2: 65, base_ch4: 55, base_temperature: 69, base_oil_level: "낮음" },
  { device_id: "9", name: "9호기", building: "D동", capacity: "3상 500kVA", bridge_id: "BR-2", base_h2: 8, base_ch4: 3, base_temperature: 49, base_oil_level: "정상" },
  { device_id: "10", name: "10호기", building: "E동", capacity: "3상 300kVA", bridge_id: "BR-3", base_h2: 22, base_ch4: 5, base_temperature: 55, base_oil_level: "정상" },
];

const DEFAULT_CONFIG: AppConfig = {
  thresholds: DEFAULT_THRESHOLDS,
  devices: DEFAULT_DEVICES,
  bridges: DEFAULT_BRIDGES,
};

interface ConfigContextValue {
  config: AppConfig;
  updateThresholds: (t: ThresholdConfig) => void;
  addDevice: (d: DeviceRegistry) => void;
  removeDevice: (device_id: string) => void;
  resetToDefault: () => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      try {
        setConfig(JSON.parse(raw));
      } catch {
        // 저장된 값이 손상된 경우 기본값 유지
      }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config, loaded]);

  function updateThresholds(t: ThresholdConfig) {
    setConfig((c) => ({ ...c, thresholds: t }));
  }
  function addDevice(d: DeviceRegistry) {
    setConfig((c) => ({ ...c, devices: [...c.devices, d] }));
  }
  function removeDevice(device_id: string) {
    setConfig((c) => ({ ...c, devices: c.devices.filter((d) => d.device_id !== device_id) }));
  }
  function resetToDefault() {
    setConfig(DEFAULT_CONFIG);
  }

  return (
    <ConfigContext.Provider value={{ config, updateThresholds, addDevice, removeDevice, resetToDefault }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig는 ConfigProvider 내부에서만 사용할 수 있습니다");
  return ctx;
}
