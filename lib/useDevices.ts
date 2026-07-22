"use client";

import { useEffect, useRef, useState } from "react";
import { DeviceEvaluated, DeviceReading, SeverityLevel } from "./types";
import { useConfig } from "./configStore";
import { buildInitialReadings, jitterReadings } from "./mockData";
import { evaluateDevice } from "./alarmEngine";
import { supabase } from "./supabaseClient";

const DATA_SOURCE = process.env.NEXT_PUBLIC_DATA_SOURCE ?? "mock";

type PrevLevels = Record<string, { h2: SeverityLevel; ch4: SeverityLevel; temperature: SeverityLevel }>;

export function useDevices() {
  const { config } = useConfig();
  const [readings, setReadings] = useState<Record<string, DeviceReading>>({});
  const [connected, setConnected] = useState(DATA_SOURCE === "mock");
  const prevLevelsRef = useRef<PrevLevels>({});

  useEffect(() => {
    setReadings((prev) => {
      const base = buildInitialReadings(config.devices);
      return { ...base, ...prev, ...Object.fromEntries(Object.entries(base).filter(([id]) => !prev[id])) };
    });
  }, [config.devices]);

  useEffect(() => {
    if (DATA_SOURCE === "mock") {
      const id = setInterval(() => setReadings((prev) => jitterReadings(prev)), 4000);
      return () => clearInterval(id);
    }

    // ---------------- 실 데이터(live) 모드 ----------------
    // AWS 수집 서버가 Supabase의 device_readings(원본값) 테이블에 upsert 한다고 가정합니다.
    // 판정 로직(evaluateDevice)은 여기(클라이언트)에서 동일하게 돌려서
    // 설정 화면에서 바꾼 임계치가 즉시 반영되도록 합니다.
    let cancelled = false;

    // 채널은 여기서 "동기적으로" 바로 만듭니다 (await 뒤에서 만들면, 개발 모드
    // 이중 렌더링 시 cleanup이 실제 채널을 잡지 못해 같은 topic이 중복 구독되는
    // 레이스 컨디션이 생깁니다).
    const channel = supabase
      .channel(`device_readings_changes_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "device_readings" }, (payload) => {
        const row = payload.new as DeviceReading;
        setReadings((prev) => ({ ...prev, [row.device_id]: row }));
      })
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    (async () => {
      const { data, error } = await supabase.from("device_readings").select("*");
      if (!cancelled && !error && data) {
        const map: Record<string, DeviceReading> = {};
        for (const row of data as DeviceReading[]) map[row.device_id] = row;
        setReadings(map);
      }
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const devices: DeviceEvaluated[] = config.devices.map((reg) => {
    const reading = readings[reg.device_id];
    if (!reading) {
      return { ...reg, h2: 0, ch4: 0, temperature: 0, oil_level: "정상", updated_at: new Date().toISOString(), status: "offline", causes: ["데이터 없음"], since: "-" };
    }
    const prev = prevLevelsRef.current[reg.device_id];
    const evaluated = evaluateDevice(reg, reading, prev, config.thresholds);
    const lvl = evaluated.status === "offline" ? "normal" : (evaluated.status as SeverityLevel);
    prevLevelsRef.current[reg.device_id] = { h2: lvl, ch4: lvl, temperature: lvl };
    return evaluated;
  });

  return { devices, connected, isMock: DATA_SOURCE === "mock" };
}
