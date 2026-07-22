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

// ---- 설비 등록 정보 (설정에서 입력) ----
export interface DeviceRegistry {
  device_id: string;
  name: string;
  building: string;
  capacity: string;
  bridge_id: string;
  // mock 데이터 생성을 위한 기준값 (실 데이터 모드에서는 사용하지 않음)
  base_h2: number;
  base_ch4: number;
  base_temperature: number;
  base_oil_level: "정상" | "낮음";
}

// ---- 실시간 센서 원본값 ----
export interface DeviceReading {
  device_id: string;
  h2: number;
  ch4: number;
  oil_level: "정상" | "낮음";
  temperature: number;
  updated_at: string;
}

// ---- 판정 결과가 합쳐진 화면 표시용 모델 ----
export interface DeviceEvaluated extends DeviceRegistry, DeviceReading {
  status: DeviceStatus;
  causes: string[];
  since: string;
}

export interface Bridge {
  bridge_id: string;
  name: string;
  online: boolean;
}

export interface AlarmEvent {
  time: string;
  unit: string;
  item: string;
  level: SeverityLevel;
  detail: string;
}

// ---- 임계치 설정 (설정 화면에서 편집) ----
export interface ThresholdRule {
  caution: number;
  warning: number;
  danger: number;
}

export interface ThresholdConfig {
  h2: ThresholdRule;
  ch4: ThresholdRule;
  temperature: ThresholdRule;
  hysteresisMarginPct: number; // 해제 판정 시 진입값 대비 낮춰줄 비율 (예: 0.1 = 10%)
  compositeEnabled: boolean;   // 여러 센서가 동시에 이상일 때 등급을 격상할지 여부
  compositeMinSensors: number; // 격상에 필요한 동시 이상 센서 최소 개수
}

export interface AppConfig {
  thresholds: ThresholdConfig;
  devices: DeviceRegistry[];
  bridges: Bridge[];
}
