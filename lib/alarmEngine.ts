import { DeviceReading, DeviceRegistry, DeviceEvaluated, SeverityLevel, ThresholdConfig } from "./types";
import { classifySensor, escalate } from "./thresholds";

const OFFLINE_MINUTES = 15; // 문서 6장: Heartbeat 3회 누락 시 OFFLINE 판정 (전송 주기 5분 가정)

/**
 * 설비 하나의 h2 / ch4 / temperature / oil_level 값을 개별 판정한 뒤,
 * "동시에 몇 개 센서가 이상 상태인지"를 조합해 최종 등급을 결정합니다.
 * - 개별 임계치만으로는 각각 '주의'인 두 지표가, 동시에 발생하면 실제로는
 *   더 위험한 상황일 수 있다는 문서의 취지를 반영한 구조입니다.
 */
export function evaluateDevice(
  registry: DeviceRegistry,
  reading: DeviceReading,
  prev: { h2: SeverityLevel; ch4: SeverityLevel; temperature: SeverityLevel } | undefined,
  config: ThresholdConfig
): DeviceEvaluated {
  const minutesSinceUpdate = (Date.now() - new Date(reading.updated_at).getTime()) / 60000;
  if (minutesSinceUpdate > OFFLINE_MINUTES) {
    return {
      ...registry,
      ...reading,
      status: "offline",
      causes: ["통신 두절"],
      since: reading.updated_at,
    };
  }

  const h2Level = classifySensor(reading.h2, config.h2, prev?.h2 ?? "normal", config.hysteresisMarginPct);
  const ch4Level = classifySensor(reading.ch4, config.ch4, prev?.ch4 ?? "normal", config.hysteresisMarginPct);
  const tempLevel = classifySensor(reading.temperature, config.temperature, prev?.temperature ?? "normal", config.hysteresisMarginPct);
  const oilLevel: SeverityLevel = reading.oil_level === "낮음" ? "warning" : "normal";

  const levels: { name: string; level: SeverityLevel }[] = [
    { name: "수소가스", level: h2Level },
    { name: "메탄가스", level: ch4Level },
    { name: "온도", level: tempLevel },
    { name: "유면", level: oilLevel },
  ];

  const abnormal = levels.filter((l) => l.level !== "normal");
  let overall: SeverityLevel = levels.reduce(
    (max, l) => (["normal", "caution", "warning", "danger"].indexOf(l.level) > ["normal", "caution", "warning", "danger"].indexOf(max) ? l.level : max),
    "normal" as SeverityLevel
  );

  // ---- 복합 판정: 동시에 이상인 센서가 기준 개수 이상이면 한 단계 격상 ----
  if (config.compositeEnabled && abnormal.length >= config.compositeMinSensors) {
    overall = escalate(overall);
  }

  const causes = abnormal.map((l) => `${l.name} ${l.level === "danger" ? "급증/급상승" : "상승"}`);

  return {
    ...registry,
    ...reading,
    status: overall,
    causes: causes.length ? causes : [],
    since: reading.updated_at,
  };
}
