// 문서(설계 회의 자료) 기준 상태 체계: 정상 · 주의 · 경고 · 위험 (+통신단절)
export type SeverityLevel = "normal" | "caution" | "warning" | "danger";
export type DeviceStatus = SeverityLevel | "offline";

export const SEVERITY_ORDER: SeverityLevel[] = ["normal", "caution", "warning", "danger"];

export const STATUS_LABEL: Record<DeviceStatus, string> = {
  normal: "정상",
  caution: "주의",
  warning: "경고",
  danger: "위험",
  offline: "통신단절",
};

export type SensorKey = "h2" | "ch4" | "temperature" | "oil_level";

export type SensorLevels = Record<SensorKey, SeverityLevel>;

/**
 * 설비가 서버까지 오는 길. ㈜헤디와 협의된 세 가지 구성에 대응합니다.
 *   direct  - 측정모듈이 MQTT 로 서버에 직접 전송 (구성 1안)
 *   gateway - 측정모듈 → RS-485 → 사용자 PC → MQTT (구성 2안)
 *   bridge  - 측정모듈 → RS-485 → 브릿지 → MQTT (구성 3안)
 */
export type LinkType = "direct" | "gateway" | "bridge";

export const LINK_TYPE_LABEL: Record<LinkType, string> = {
  direct: "모듈 직결",
  gateway: "PC 경유",
  bridge: "브릿지 경유",
};

// ---- 설비 등록 정보 (설정 화면에서 관리, DB의 devices 테이블) ----
export interface DeviceRegistry {
  device_id: string;
  name: string;
  building: string;
  capacity: string;
  bridge_id: string | null;
  slave_addr?: number | null;
  sort_order?: number;
  link_type?: LinkType;
  /** 모듈 직결(1안)에서 모듈 자신의 접속 상태 */
  online?: boolean;
  last_seen_at?: string | null;
  fw_version?: string | null;
  /** 장치에 설정된 측정 주기(초) */
  interval_sec?: number | null;
}

// ---- 실시간 센서 원본값 (DB의 device_readings 테이블) ----
export interface DeviceReading {
  device_id: string;
  h2: number;
  ch4: number;
  oil_level: "정상" | "낮음";
  temperature: number;
  updated_at: string;
}

/**
 * 최근 24시간 추세. telemetry 테이블을 1시간 단위로 집계한 실측값입니다.
 * 네 배열의 길이는 항상 같으며, 그 시간대에 값이 없으면 null 이 들어갑니다.
 */
export interface DeviceTrend {
  /** 시간 버킷 라벨. 예: "14시" */
  labels: string[];
  temperature: (number | null)[];
  h2: (number | null)[];
  ch4: (number | null)[];
}

/** 24시간 전 기준값. 증감 표시에 사용합니다. */
export interface DeviceBaseline {
  h2: number;
  ch4: number;
  temperature: number;
}

// ---- 판정 결과가 합쳐진 화면 표시용 모델 ----
export interface DeviceEvaluated extends DeviceRegistry, DeviceReading {
  status: DeviceStatus;
  /** 센서별 개별 등급. 히스테리시스 판정의 이전 상태로 사용됩니다. */
  sensorLevels: SensorLevels;
  causes: string[];
  since: string;
  trend?: DeviceTrend;
  baseline?: DeviceBaseline;
}

export interface Bridge {
  bridge_id: string;
  name: string;
  online: boolean;
  last_seen_at?: string | null;
  /** bridge = 브릿지 보드(3안), gateway = 사용자 PC(2안) */
  kind?: "bridge" | "gateway";
  /** RS-485 한 가닥에 붙일 수 있는 최대 대수. 헤디 회신 기준 32대 */
  max_devices?: number;
}

export const BRIDGE_KIND_LABEL: Record<"bridge" | "gateway", string> = {
  bridge: "브릿지 보드",
  gateway: "사용자 PC",
};

/** RS-485 한 가닥 기본 수용 대수 (㈜헤디 회신 기준) */
export const RS485_MAX_DEVICES = 32;

export interface AlarmEvent {
  id?: number;
  time: string;
  unit: string;
  item: string;
  level: SeverityLevel;
  detail: string;
  device_id?: string | null;
}

// ---- 임계치 설정 (DB의 app_config 테이블) ----
export interface ThresholdRule {
  caution: number;
  warning: number;
  danger: number;
}

export interface ThresholdConfig {
  h2: ThresholdRule;
  ch4: ThresholdRule;
  temperature: ThresholdRule;
  /** 해제 판정 시 진입값 대비 낮춰줄 비율 (예: 0.1 = 10%) */
  hysteresisMarginPct: number;
  /** 여러 센서가 동시에 이상일 때 등급을 격상할지 여부 */
  compositeEnabled: boolean;
  /** 격상에 필요한 동시 이상 센서 최소 개수 */
  compositeMinSensors: number;
  /** 이 시간(분) 이상 데이터가 없으면 통신단절로 판정 */
  offlineMinutes: number;
  /**
   * 유면 저하를 몇 등급으로 볼지. 웹 화면과 수집 서버가 같은 값을 씁니다.
   * 유면 규격(접점/아날로그)이 확정되면 임계치 방식으로 바뀝니다.
   */
  oilLowLevel?: SeverityLevel;
}

export interface AppConfig {
  thresholds: ThresholdConfig;
  devices: DeviceRegistry[];
  bridges: Bridge[];
  version: number;
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  h2: { caution: 20, warning: 50, danger: 100 },
  ch4: { caution: 15, warning: 30, danger: 60 },
  temperature: { caution: 55, warning: 65, danger: 75 },
  hysteresisMarginPct: 0.1,
  compositeEnabled: true,
  compositeMinSensors: 2,
  offlineMinutes: 15,
  oilLowLevel: "warning",
};
