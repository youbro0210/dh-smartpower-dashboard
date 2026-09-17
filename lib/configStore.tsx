"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  AlarmEvent,
  Bridge,
  DeviceBaseline,
  DeviceEvaluated,
  DeviceReading,
  DeviceRegistry,
  DeviceTrend,
  DEFAULT_THRESHOLDS,
  SensorLevels,
  ThresholdConfig,
} from "./types";
import { evaluateDevice } from "./alarmEngine";

interface DashboardState {
  devices: DeviceEvaluated[];
  bridges: Bridge[];
  thresholds: ThresholdConfig;
  alarms: AlarmEvent[];
  alarms24h: number;
  configVersion: number;
  loading: boolean;
  connected: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveThresholds: (next: ThresholdConfig) => Promise<{ ok: boolean; error?: string }>;
  addDevice: (input: {
    name: string;
    building: string;
    capacity: string;
    bridge_id: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  removeDevice: (deviceId: string) => Promise<{ ok: boolean; error?: string }>;
}

const DashboardContext = createContext<DashboardState | null>(null);

interface ApiPayload {
  devices: DeviceRegistry[];
  bridges: Bridge[];
  readings: DeviceReading[];
  trends: Record<string, DeviceTrend>;
  baselines: (DeviceBaseline & { device_id: string })[];
  alarms: {
    id: number;
    device_id: string | null;
    unit: string;
    item: string;
    level: AlarmEvent["level"];
    detail: string;
    created_at: string;
  }[];
  alarms24h: number;
  thresholds: ThresholdConfig;
  configVersion: number;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<DeviceRegistry[]>([]);
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [readings, setReadings] = useState<Record<string, DeviceReading>>({});
  const [trends, setTrends] = useState<Record<string, DeviceTrend>>({});
  const [baselines, setBaselines] = useState<Record<string, DeviceBaseline>>({});
  const [thresholds, setThresholds] = useState<ThresholdConfig>(DEFAULT_THRESHOLDS);
  const [alarms, setAlarms] = useState<AlarmEvent[]>([]);
  const [alarms24h, setAlarms24h] = useState(0);
  const [configVersion, setConfigVersion] = useState(1);
  const [devices, setDevices] = useState<DeviceEvaluated[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // 센서별 직전 등급. 히스테리시스 판정의 입력이며 렌더 중에는 건드리지 않습니다.
  const prevLevels = useRef<Record<string, SensorLevels>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "데이터를 불러오지 못했습니다.");
        return;
      }
      const data: ApiPayload = await res.json();

      setRegistry(data.devices ?? []);
      setBridges(data.bridges ?? []);
      setTrends(data.trends ?? {});
      setThresholds(data.thresholds ?? DEFAULT_THRESHOLDS);
      setConfigVersion(data.configVersion ?? 1);
      setAlarms24h(data.alarms24h ?? 0);

      setReadings(
        Object.fromEntries((data.readings ?? []).map((r) => [r.device_id, r]))
      );
      setBaselines(
        Object.fromEntries(
          (data.baselines ?? []).map((b) => [
            b.device_id,
            { h2: b.h2, ch4: b.ch4, temperature: b.temperature },
          ])
        )
      );
      setAlarms(
        (data.alarms ?? []).map((a) => ({
          id: a.id,
          time: formatTime(a.created_at),
          unit: a.unit,
          item: a.item,
          level: a.level,
          detail: a.detail,
          device_id: a.device_id,
        }))
      );
      setError(null);
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ---- 실시간 구독 (SSE) ----
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closedByUs = false;

    const connect = () => {
      source = new EventSource("/api/stream");

      source.addEventListener("ready", () => setConnected(true));

      source.addEventListener("device_reading", (event) => {
        try {
          const row = JSON.parse((event as MessageEvent).data) as DeviceReading;
          setReadings((prev) => ({ ...prev, [row.device_id]: row }));
        } catch {
          /* 무시 */
        }
      });

      source.addEventListener("alarm_event", (event) => {
        try {
          const row = JSON.parse((event as MessageEvent).data);
          setAlarms((prev) =>
            [
              {
                id: row.id,
                time: formatTime(row.created_at),
                unit: row.unit,
                item: row.item,
                level: row.level,
                detail: row.detail,
                device_id: row.device_id,
              },
              ...prev,
            ].slice(0, 50)
          );
          setAlarms24h((n) => n + 1);
        } catch {
          /* 무시 */
        }
      });

      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (!closedByUs) retry = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      closedByUs = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, []);

  // 통신단절은 시간이 지나야 판정되므로 주기적으로 재평가합니다.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // ---- 판정 ----
  // 렌더 중에 ref 를 수정하면 StrictMode 의 이중 렌더에서 상태가 어긋나므로
  // 평가는 반드시 이펙트 안에서 수행합니다.
  useEffect(() => {
    const evaluated = registry.map((device) => {
      const reading = readings[device.device_id];

      if (!reading) {
        return {
          ...device,
          device_id: device.device_id,
          h2: 0,
          ch4: 0,
          temperature: 0,
          oil_level: "정상" as const,
          updated_at: new Date(0).toISOString(),
          status: "offline" as const,
          sensorLevels: {
            h2: "normal",
            ch4: "normal",
            temperature: "normal",
            oil_level: "normal",
          } as SensorLevels,
          causes: ["데이터 없음"],
          since: "-",
          trend: trends[device.device_id],
          baseline: baselines[device.device_id],
        };
      }

      const result = evaluateDevice(
        device,
        reading,
        prevLevels.current[device.device_id],
        thresholds
      );

      return {
        ...result,
        trend: trends[device.device_id],
        baseline: baselines[device.device_id],
      };
    });

    // 다음 판정의 입력이 될 센서별 등급을 갱신합니다.
    const next: Record<string, SensorLevels> = {};
    for (const device of evaluated) next[device.device_id] = device.sensorLevels;
    prevLevels.current = next;

    setDevices(evaluated);
  }, [registry, readings, thresholds, trends, baselines, tick]);

  // ---- 변경 동작 ----
  const saveThresholds = useCallback(
    async (next: ThresholdConfig) => {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body.error ?? "저장에 실패했습니다." };

      setThresholds(body.thresholds);
      setConfigVersion(body.version);
      return { ok: true };
    },
    []
  );

  const addDevice = useCallback(
    async (input: { name: string; building: string; capacity: string; bridge_id: string | null }) => {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body.error ?? "설비 추가에 실패했습니다." };
      await refresh();
      return { ok: true };
    },
    [refresh]
  );

  const removeDevice = useCallback(
    async (deviceId: string) => {
      const res = await fetch(`/api/devices?device_id=${encodeURIComponent(deviceId)}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body.error ?? "설비 삭제에 실패했습니다." };
      await refresh();
      return { ok: true };
    },
    [refresh]
  );

  return (
    <DashboardContext.Provider
      value={{
        devices,
        bridges,
        thresholds,
        alarms,
        alarms24h,
        configVersion,
        loading,
        connected,
        error,
        refresh,
        saveThresholds,
        addDevice,
        removeDevice,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardState {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard 는 ConfigProvider 내부에서만 사용할 수 있습니다.");
  }
  return context;
}
