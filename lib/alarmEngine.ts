import {
  DeviceReading,
  DeviceRegistry,
  DeviceEvaluated,
  SensorLevels,
  SeverityLevel,
  SEVERITY_ORDER,
  ThresholdConfig,
} from "./types";
import { classifySensor, escalate } from "./thresholds";

const NORMAL_LEVELS: SensorLevels = {
  h2: "normal",
  ch4: "normal",
  temperature: "normal",
  oil_level: "normal",
};

const SENSOR_LABEL: Record<keyof SensorLevels, string> = {
  h2: "수소가스",
  ch4: "메탄가스",
  temperature: "온도",
  oil_level: "유면",
};

function maxLevel(levels: SeverityLevel[]): SeverityLevel {
  return levels.reduce<SeverityLevel>(
    (max, level) =>
      SEVERITY_ORDER.indexOf(level) > SEVERITY_ORDER.indexOf(max) ? level : max,
    "normal"
  );
}

/**
 * 설비 하나의 h2 / ch4 / temperature / oil_level 값을 개별 판정한 뒤,
 * "동시에 몇 개 센서가 이상 상태인지"를 조합해 최종 등급을 결정합니다.
 *
 * prev 에는 반드시 직전 호출이 돌려준 sensorLevels 를 그대로 넘겨야 합니다.
 * 설비의 종합 등급을 각 센서에 복사해 넣으면 한 센서의 이상이 다른 센서의
 * 히스테리시스 판정을 오염시켜 등급이 잘못 유지됩니다.
 */
export function evaluateDevice(
  registry: DeviceRegistry,
  reading: DeviceReading,
  prev: SensorLevels | undefined,
  config: ThresholdConfig
): DeviceEvaluated {
  const previous = prev ?? NORMAL_LEVELS;
  const offlineMinutes = config.offlineMinutes ?? 15;
  const minutesSinceUpdate =
    (Date.now() - new Date(reading.updated_at).getTime()) / 60000;

  if (!Number.isFinite(minutesSinceUpdate) || minutesSinceUpdate > offlineMinutes) {
    return {
      ...registry,
      ...reading,
      status: "offline",
      sensorLevels: NORMAL_LEVELS,
      causes: ["통신 두절"],
      since: reading.updated_at,
    };
  }

  const sensorLevels: SensorLevels = {
    h2: classifySensor(reading.h2, config.h2, previous.h2, config.hysteresisMarginPct),
    ch4: classifySensor(reading.ch4, config.ch4, previous.ch4, config.hysteresisMarginPct),
    temperature: classifySensor(
      reading.temperature,
      config.temperature,
      previous.temperature,
      config.hysteresisMarginPct
    ),
    oil_level: reading.oil_level === "낮음" ? "warning" : "normal",
  };

  const entries = Object.entries(sensorLevels) as [keyof SensorLevels, SeverityLevel][];
  const abnormal = entries.filter(([, level]) => level !== "normal");

  let overall = maxLevel(entries.map(([, level]) => level));

  // ---- 복합 판정: 동시에 이상인 센서가 기준 개수 이상이면 한 단계 격상 ----
  if (config.compositeEnabled && abnormal.length >= config.compositeMinSensors) {
    overall = escalate(overall);
  }

  const causes = abnormal.map(([key, level]) => {
    if (key === "oil_level") return "유면 낮음";
    return `${SENSOR_LABEL[key]} ${level === "danger" ? "급증/급상승" : "상승"}`;
  });

  return {
    ...registry,
    ...reading,
    status: overall,
    sensorLevels,
    causes,
    since: reading.updated_at,
  };
}
