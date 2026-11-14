/**
 * 장비로 보낼 수 있는 명령 목록.
 *
 * ㈜헤디 구현 기준 (2026-11-14 장비 제어 테스트 회신).
 * - resend: 모듈이 전송 완료분을 삭제하므로 불가 → 제외
 * - set_interval: 이번 개발은 고정 주기로 협의(11/12) → 제외
 * - sync_time: 모듈이 접속 시 NTP 동기 → 제외
 * 여기만 고치면 화면과 서버 검증이 함께 따라옵니다.
 */

export interface CommandField {
  key: string;
  label: string;
  type: "text" | "number" | "boolean";
  hint?: string;
  required?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface CommandSpec {
  label: string;
  description: string;
  /** 설비 하나를 지정해서 보낼 수 있는 명령인지 */
  perDevice?: boolean;
  /** 되돌릴 수 없거나 운전에 영향을 주는 명령 — 화면에서 한 번 더 확인합니다. */
  risky?: boolean;
  fields?: CommandField[];
  /** fields 중 하나 이상은 값이 있어야 하는 명령 */
  needsAnyField?: boolean;
}

export const COMMANDS: Record<string, CommandSpec> = {
  ping: {
    label: "응답 확인 (ping)",
    description: "장치가 살아 있는지 확인합니다. 응답 시간을 재는 용도로 씁니다.",
  },
  read_now: {
    label: "즉시 측정",
    description: "다음 주기를 기다리지 않고 지금 측정해 올리도록 요청합니다.",
    perDevice: true,
  },
  set_config: {
    label: "센서 구성값 변경·조회 (set_config)",
    description: "경고(LED) 임계값을 바꾸거나 현재 구성값 전체를 받아옵니다. 입력한 항목만 보냅니다.",
    perDevice: true,
    needsAnyField: true,
    fields: [
      { key: "h2_thres", label: "H2 경고 임계값", type: "number", min: 0, max: 4095, placeholder: "0~4095" },
      { key: "ch4_thres", label: "CH4 경고 임계값", type: "number", min: 0, max: 4095, placeholder: "0~4095" },
      { key: "temp_thres", label: "온도 경고 기준값(℃)", type: "number", max: 200, placeholder: "~200" },
      { key: "get", label: "현재 구성값 조회", type: "boolean" },
    ],
  },
  led_clear: {
    label: "경고(LED) 상태 클리어",
    description: "모듈의 경고(LED) 표시 상태를 해제합니다.",
    perDevice: true,
  },
  reboot: {
    label: "재부팅",
    description: "장치를 다시 시작합니다. 재시작 동안 계측이 중단됩니다.",
    risky: true,
  },
};

export type CommandKey = string;

export const COMMAND_KEYS = Object.keys(COMMANDS) as CommandKey[];

export const COMMAND_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  sent: "발행됨",
  acked: "응답 완료",
  failed: "실패",
  timeout: "응답 없음",
};
