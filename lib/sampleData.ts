import {
  AlarmEvent,
  DeviceEvaluated,
  DeviceStatus,
  DeviceTrend,
  SensorLevels,
  SeverityLevel,
  ThresholdConfig,
  DEFAULT_THRESHOLDS,
} from "./types";

/**
 * 샘플 대시보드용 고정 데이터.
 *
 * 실제 계측기가 붙기 전에 화면 구성과 판정 결과를 보여주기 위한 자료입니다.
 * DB 를 쓰지 않고, 값도 난수를 쓰지 않아 몇 번을 열어도 같은 화면이 나옵니다.
 * 시각만 화면을 여는 시점 기준으로 계산합니다.
 */

export const SAMPLE_THRESHOLDS: ThresholdConfig = DEFAULT_THRESHOLDS;

interface Seed {
  device_id: string;
  name: string;
  building: string;
  capacity: string;
  bridge_id: string;
  h2: number;
  ch4: number;
  temperature: number;
  oil_level: "정상" | "낮음";
  /** 통신단절로 보여줄 설비는 마지막 수신 후 경과 시간(분) */
  staleMinutes?: number;
  /** 24시간 추세의 시작값 비율. 1이면 변화 없음, 0.4면 크게 상승한 모양 */
  startRatio: number;
}

const SEEDS: Seed[] = [
  { device_id: "1", name: "1호기", building: "A동", capacity: "3상 300kVA", bridge_id: "BR-1", h2: 11.9, ch4: 3.4, temperature: 48.8, oil_level: "정상", startRatio: 0.95 },
  { device_id: "2", name: "2호기", building: "A동", capacity: "3상 300kVA", bridge_id: "BR-1", h2: 10.5, ch4: 4.9, temperature: 48.4, oil_level: "정상", startRatio: 1.02 },
  { device_id: "3", name: "3호기", building: "A동", capacity: "3상 500kVA", bridge_id: "BR-1", h2: 24.6, ch4: 8.1, temperature: 57.2, oil_level: "정상", startRatio: 0.72 },
  { device_id: "4", name: "4호기", building: "B동", capacity: "3상 500kVA", bridge_id: "BR-1", h2: 110.0, ch4: 35.0, temperature: 76.0, oil_level: "낮음", startRatio: 0.45 },
  { device_id: "5", name: "5호기", building: "B동", capacity: "3상 750kVA", bridge_id: "BR-1", h2: 8.5, ch4: 3.8, temperature: 48.5, oil_level: "정상", startRatio: 0.98 },
  { device_id: "6", name: "6호기", building: "C동", capacity: "3상 750kVA", bridge_id: "BR-2", h2: 10.0, ch4: 5.6, temperature: 50.8, oil_level: "정상", startRatio: 1.05 },
  { device_id: "7", name: "7호기", building: "C동", capacity: "3상 500kVA", bridge_id: "BR-2", h2: 58.0, ch4: 2.2, temperature: 61.5, oil_level: "정상", startRatio: 0.55 },
  { device_id: "8", name: "8호기", building: "D동", capacity: "3상 1000kVA", bridge_id: "BR-2", h2: 12.2, ch4: 2.0, temperature: 54.3, oil_level: "정상", startRatio: 0.93 },
  { device_id: "9", name: "9호기", building: "D동", capacity: "3상 500kVA", bridge_id: "BR-2", h2: 17.9, ch4: 7.9, temperature: 50.8, oil_level: "정상", startRatio: 1.18 },
  { device_id: "10", name: "10호기", building: "E동", capacity: "3상 300kVA", bridge_id: "BR-3", h2: 8.0, ch4: 2.0, temperature: 52.5, oil_level: "정상", staleMinutes: 185, startRatio: 1.0 },
];

/** 0~23 시간 버킷에 고르게 퍼진, 결정적인 흔들림. 난수를 쓰지 않습니다. */
function wobble(index: number, offset: number): number {
  return Math.sin((index + offset) * 1.37) * 0.35 + Math.sin((index + offset) * 0.61) * 0.2;
}

function buildTrend(seed: Seed, now: Date): DeviceTrend {
  const labels: string[] = [];
  const temperature: (number | null)[] = [];
  const h2: (number | null)[] = [];
  const ch4: (number | null)[] = [];

  for (let i = 0; i < 24; i += 1) {
    const hoursAgo = 23 - i;
    const at = new Date(now.getTime() - hoursAgo * 3600_000);
    labels.push(`${at.getHours()}시`);

    // 통신단절 설비는 마지막 수신 이후 구간을 비워 선이 끊기게 합니다.
    if (seed.staleMinutes && hoursAgo * 60 < seed.staleMinutes) {
      temperature.push(null);
      h2.push(null);
      ch4.push(null);
      continue;
    }

    const progress = i / 23;
    const ramp = seed.startRatio + (1 - seed.startRatio) * progress;
    h2.push(Number((seed.h2 * ramp + wobble(i, 0) * seed.h2 * 0.03).toFixed(1)));
    ch4.push(Number((seed.ch4 * (0.75 + 0.25 * progress) + wobble(i, 3) * seed.ch4 * 0.04).toFixed(1)));
    temperature.push(
      Number((seed.temperature - 6 * (1 - progress) + wobble(i, 7) * 1.6).toFixed(1))
    );
  }

  return { labels, temperature, h2, ch4 };
}

function levelOf(value: number, rule: { caution: number; warning: number; danger: number }): SeverityLevel {
  if (value >= rule.danger) return "danger";
  if (value >= rule.warning) return "warning";
  if (value >= rule.caution) return "caution";
  return "normal";
}

const RANK: Record<SeverityLevel, number> = { normal: 0, caution: 1, warning: 2, danger: 3 };
const ORDER: SeverityLevel[] = ["normal", "caution", "warning", "danger"];

const CAUSE_LABEL: Record<string, string> = {
  h2: "수소가스",
  ch4: "메탄가스",
  temperature: "절연유 온도",
};

/** 홈 화면과 같은 규칙(임계치 + 복합 판정)으로 샘플 설비를 평가합니다. */
export function buildSampleDevices(now = new Date()): DeviceEvaluated[] {
  const t = SAMPLE_THRESHOLDS;

  return SEEDS.map((seed) => {
    const measuredAt = new Date(now.getTime() - (seed.staleMinutes ?? 1) * 60_000);
    const offline = Boolean(seed.staleMinutes && seed.staleMinutes > t.offlineMinutes);

    const sensorLevels: SensorLevels = {
      h2: levelOf(seed.h2, t.h2),
      ch4: levelOf(seed.ch4, t.ch4),
      temperature: levelOf(seed.temperature, t.temperature),
      oil_level: seed.oil_level === "낮음" ? "danger" : "normal",
    };

    const causes: string[] = [];
    for (const key of ["h2", "ch4", "temperature"] as const) {
      const level = sensorLevels[key];
      if (level === "normal") continue;
      const suffix = level === "danger" ? "급상승" : level === "warning" ? "상승" : "주의 범위";
      causes.push(`${CAUSE_LABEL[key]} ${suffix}`);
    }
    if (seed.oil_level === "낮음") causes.push("유면 낮음");

    // 두 개 이상의 센서가 동시에 이상이면 한 단계 격상합니다(홈 화면과 같은 규칙).
    const levels = Object.values(sensorLevels);
    const abnormal = levels.filter((l) => l !== "normal").length;
    let worst = levels.reduce<SeverityLevel>((a, b) => (RANK[b] > RANK[a] ? b : a), "normal");
    if (t.compositeEnabled && abnormal >= t.compositeMinSensors && worst !== "normal") {
      worst = ORDER[Math.min(RANK[worst] + 1, ORDER.length - 1)];
    }

    const status: DeviceStatus = offline ? "offline" : worst;

    return {
      device_id: seed.device_id,
      name: seed.name,
      building: seed.building,
      capacity: seed.capacity,
      bridge_id: seed.bridge_id,
      h2: seed.h2,
      ch4: seed.ch4,
      temperature: seed.temperature,
      oil_level: seed.oil_level,
      updated_at: measuredAt.toISOString(),
      status,
      sensorLevels,
      causes: offline ? ["통신 두절"] : causes,
      since: measuredAt.toISOString(),
      trend: buildTrend(seed, now),
      baseline: {
        h2: Number((seed.h2 * seed.startRatio).toFixed(1)),
        ch4: Number((seed.ch4 * 0.75).toFixed(1)),
        temperature: Number((seed.temperature - 6).toFixed(1)),
      },
    };
  });
}

interface AlarmSeed {
  minutesAgo: number;
  device_id: string;
  unit: string;
  item: string;
  level: SeverityLevel;
  detail: string;
}

const ALARM_SEEDS: AlarmSeed[] = [
  { minutesAgo: 18, device_id: "4", unit: "4호기", item: "수소가스 위험 임계치 초과", level: "danger", detail: "110.0 ppm / 기준 100" },
  { minutesAgo: 22, device_id: "4", unit: "4호기", item: "절연유 유면 저하", level: "danger", detail: "유면 낮음 감지" },
  { minutesAgo: 35, device_id: "4", unit: "4호기", item: "절연유 온도 위험", level: "danger", detail: "76.0 ℃ / 기준 75" },
  { minutesAgo: 52, device_id: "4", unit: "4호기", item: "메탄가스 경고 임계치 초과", level: "warning", detail: "35.0 ppm / 기준 30" },
  { minutesAgo: 70, device_id: "7", unit: "7호기", item: "수소가스 경고 임계치 초과", level: "warning", detail: "58.0 ppm / 기준 50" },
  { minutesAgo: 120, device_id: "3", unit: "3호기", item: "수소가스 주의 임계치 초과", level: "caution", detail: "24.6 ppm / 기준 20" },
  { minutesAgo: 185, device_id: "10", unit: "10호기", item: "통신 두절", level: "warning", detail: "브릿지 BR-3 응답 없음" },
  { minutesAgo: 300, device_id: "7", unit: "7호기", item: "절연유 온도 주의", level: "caution", detail: "61.5 ℃ / 기준 55" },
  { minutesAgo: 420, device_id: "3", unit: "3호기", item: "절연유 온도 주의", level: "caution", detail: "57.2 ℃ / 기준 55" },
  { minutesAgo: 540, device_id: "9", unit: "9호기", item: "수소가스 주의 해제", level: "caution", detail: "17.9 ppm 로 하락" },
];

function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function buildSampleAlarms(now = new Date()): AlarmEvent[] {
  return ALARM_SEEDS.map((a, i) => ({
    id: i + 1,
    time: formatTime(new Date(now.getTime() - a.minutesAgo * 60_000)),
    unit: a.unit,
    item: a.item,
    level: a.level,
    detail: a.detail,
    device_id: a.device_id,
  }));
}

export const SAMPLE_BRIDGES = [
  { bridge_id: "BR-1", name: "브릿지 1 (A/B동)", online: true },
  { bridge_id: "BR-2", name: "브릿지 2 (C/D동)", online: true },
  { bridge_id: "BR-3", name: "브릿지 3 (E동)", online: false },
];
