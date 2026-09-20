/**
 * 장비로 보낼 수 있는 명령 목록.
 *
 * 주의: 이 명령 집합은 아직 장비 업체(㈜헤디)와 확정 전입니다.
 * 규격이 정해지면 여기만 고치면 화면과 검증이 함께 따라옵니다.
 */

export interface CommandField {
  key: string;
  label: string;
  type: "text" | "number";
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
  resend: {
    label: "구간 재전송",
    description:
      "지정한 구간의 계측값을 다시 보내도록 요청합니다. 중복은 서버가 걸러내므로 안전합니다.",
    fields: [
      { key: "from", label: "시작 시각", type: "text", required: true,
        placeholder: "2026-09-20T00:00:00Z", hint: "UTC ISO8601" },
      { key: "to", label: "종료 시각", type: "text", required: true,
        placeholder: "2026-09-20T06:00:00Z" },
    ],
  },
  set_interval: {
    label: "측정 주기 변경",
    description: "장치의 측정·전송 주기를 바꿉니다. 통신단절 판정 시간보다 짧아야 합니다.",
    fields: [
      { key: "seconds", label: "주기(초)", type: "number", required: true,
        min: 10, max: 3600, placeholder: "60" },
    ],
  },
  sync_time: {
    label: "시각 동기",
    description: "장치 시계를 서버 기준으로 맞추도록 요청합니다.",
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
