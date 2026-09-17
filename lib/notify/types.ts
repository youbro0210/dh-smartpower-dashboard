export type NotifyChannel = "telegram" | "sms" | "kakao" | "email" | "whatsapp";

export const NOTIFY_CHANNELS: NotifyChannel[] = [
  "telegram",
  "sms",
  "kakao",
  "email",
  "whatsapp",
];

export const CHANNEL_LABEL: Record<NotifyChannel, string> = {
  telegram: "텔레그램",
  sms: "문자메시지",
  kakao: "카카오 알림톡",
  email: "메일",
  whatsapp: "WhatsApp",
};

/** 수신자 입력 칸에 무엇을 적어야 하는지 화면에 안내하는 문구 */
export const TARGET_HINT: Record<NotifyChannel, string> = {
  telegram: "텔레그램 chat id (예: 123456789). 봇과 먼저 대화를 시작해야 합니다.",
  sms: "휴대폰 번호 (예: 010-1234-5678)",
  kakao: "휴대폰 번호 (예: 010-1234-5678). 카카오에 가입된 번호여야 합니다.",
  email: "메일 주소",
  whatsapp: "국가번호를 포함한 번호 (예: 821012345678)",
};

export type Severity = "caution" | "warning" | "danger";

export const SEVERITY_RANK: Record<Severity, number> = {
  caution: 1,
  warning: 2,
  danger: 3,
};

export interface Recipient {
  id: number;
  name: string;
  channel: NotifyChannel;
  target: string;
  min_level: Severity;
  quiet_from: number | null;
  quiet_to: number | null;
  enabled: boolean;
  memo: string | null;
}

export interface AlarmPayload {
  id?: number | null;
  device_id?: string | null;
  unit: string;
  item: string;
  level: Severity;
  detail?: string | null;
  created_at?: string;
}

export interface SendResult {
  ok: boolean;
  /** 발송사 쪽 식별자. 나중에 추적할 때 씁니다. */
  providerId?: string;
  error?: string;
}

/**
 * 채널별 연동 정보.
 * 어떤 값이 비밀값인지 표시해 두고, 화면으로 내려보낼 때 그 값만 가립니다.
 */
export interface ChannelField {
  key: string;
  label: string;
  hint?: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
}

export const CHANNEL_FIELDS: Record<NotifyChannel, ChannelField[]> = {
  telegram: [
    {
      key: "botToken",
      label: "봇 토큰",
      hint: "텔레그램 @BotFather 에서 봇을 만들면 받는 값입니다.",
      secret: true,
      required: true,
      placeholder: "123456789:AAE...",
    },
  ],
  sms: [
    {
      key: "apiKey",
      label: "SOLAPI API Key",
      hint: "solapi.com 콘솔 > API Key 관리에서 발급합니다.",
      required: true,
    },
    { key: "apiSecret", label: "SOLAPI API Secret", secret: true, required: true },
    {
      key: "from",
      label: "발신번호",
      hint: "통신사에 사전 등록된 번호만 쓸 수 있습니다(법정 의무).",
      required: true,
      placeholder: "0512345678",
    },
  ],
  kakao: [
    { key: "apiKey", label: "SOLAPI API Key", required: true },
    { key: "apiSecret", label: "SOLAPI API Secret", secret: true, required: true },
    {
      key: "pfId",
      label: "카카오 채널 ID (pfId)",
      hint: "SOLAPI 에 연동한 카카오톡 채널의 식별자입니다.",
      required: true,
    },
    {
      key: "templateId",
      label: "알림톡 템플릿 ID",
      hint: "카카오 심사를 통과한 템플릿만 발송됩니다. 템플릿 본문에 치환변수 #{내용} 을 넣어 두세요.",
      required: true,
    },
    {
      key: "variableKey",
      label: "치환변수 이름",
      hint: "기본값 #{내용}. 템플릿에 쓴 변수명과 똑같이 적습니다.",
      placeholder: "#{내용}",
    },
    {
      key: "from",
      label: "대체발송 발신번호",
      hint: "알림톡이 실패하면 문자로 대신 보냅니다. 비워 두면 대체발송을 하지 않습니다.",
    },
  ],
  email: [
    { key: "host", label: "SMTP 서버", required: true, placeholder: "smtp.gmail.com" },
    { key: "port", label: "포트", required: true, placeholder: "587" },
    {
      key: "secure",
      label: "SSL 사용 (465 포트)",
      hint: "465 포트면 사용, 587 포트면 미사용으로 둡니다.",
    },
    { key: "user", label: "계정", required: true },
    { key: "pass", label: "비밀번호 · 앱 비밀번호", secret: true, required: true },
    { key: "from", label: "보내는 사람", required: true, placeholder: "DH 모니터링 <no-reply@example.com>" },
  ],
  whatsapp: [
    {
      key: "phoneNumberId",
      label: "Phone Number ID",
      hint: "Meta 개발자 콘솔 > WhatsApp > API 설정에 있습니다.",
      required: true,
    },
    { key: "accessToken", label: "액세스 토큰", secret: true, required: true },
    {
      key: "templateName",
      label: "템플릿 이름",
      hint: "WhatsApp 은 업체가 먼저 보내는 메시지에 승인된 템플릿을 요구합니다. 본문에 변수 {{1}} 을 하나 둔 템플릿을 쓰세요.",
      required: true,
    },
    { key: "templateLang", label: "템플릿 언어코드", placeholder: "ko" },
    {
      key: "graphVersion",
      label: "Graph API 버전",
      hint: "비워 두면 v23.0 을 씁니다.",
      placeholder: "v23.0",
    },
  ],
};

export type ChannelConfig = Record<string, string | undefined>;

export interface ChannelRow {
  channel: NotifyChannel;
  enabled: boolean;
  config: ChannelConfig;
}
