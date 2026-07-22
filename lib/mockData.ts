import { AlarmEvent, DeviceRegistry, DeviceReading } from "./types";

export const MOCK_ALARMS: AlarmEvent[] = [
  { time: "2026-06-30 13:15", unit: "4호기", item: "수소가스", level: "danger", detail: "110ppm 급격 상승" },
  { time: "2026-06-30 13:10", unit: "4호기", item: "온도", level: "danger", detail: "76.0℃ 급격 상승" },
  { time: "2026-06-30 11:40", unit: "2호기", item: "수소가스", level: "caution", detail: "25ppm 상승" },
  { time: "2026-06-30 10:40", unit: "6호기", item: "메탄가스", level: "warning", detail: "32ppm 상승" },
  { time: "2026-06-30 09:15", unit: "10호기", item: "수소가스", level: "caution", detail: "22ppm 상승" },
  { time: "2026-06-30 07:35", unit: "8호기", item: "유면", level: "warning", detail: "낮음" },
];

/** 등록된 설비의 기준값을 바탕으로 최초 센서 원본값을 만듭니다 */
export function buildInitialReadings(devices: DeviceRegistry[]): Record<string, DeviceReading> {
  const out: Record<string, DeviceReading> = {};
  for (const d of devices) {
    out[d.device_id] = {
      device_id: d.device_id,
      h2: d.base_h2,
      ch4: d.base_ch4,
      temperature: d.base_temperature,
      oil_level: d.base_oil_level,
      updated_at: new Date().toISOString(),
    };
  }
  return out;
}

/** 실제 센서가 없는 상태에서 값이 살아있는 것처럼 아주 조금씩 흔드는 함수 */
export function jitterReadings(readings: Record<string, DeviceReading>): Record<string, DeviceReading> {
  const out: Record<string, DeviceReading> = {};
  for (const [id, r] of Object.entries(readings)) {
    const wobble = (base: number, amount: number) => Math.max(0, +(base + (Math.random() - 0.5) * amount).toFixed(1));
    out[id] = {
      ...r,
      h2: wobble(r.h2, r.h2 > 50 ? 6 : 2),
      ch4: wobble(r.ch4, r.ch4 > 25 ? 4 : 1.5),
      temperature: wobble(r.temperature, r.temperature > 65 ? 1.5 : 0.4),
      updated_at: new Date().toISOString(),
    };
  }
  return out;
}
