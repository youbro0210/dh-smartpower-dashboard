import crypto from "node:crypto";
import type { ChannelConfig, NotifyChannel, SendResult } from "./types";

/**
 * 채널별 실제 발송.
 *
 * 각 함수는 연동 정보(config)와 받는 곳(target), 본문(text)을 받아
 * 성공 여부를 돌려줍니다. 실패는 예외로 던지지 않고 결과에 담아
 * 한 사람이 실패해도 나머지 발송이 계속되게 합니다.
 */

const TIMEOUT_MS = 12_000;

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ ok: boolean; status: number; json: Record<string, unknown>; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* JSON 이 아니면 원문만 씁니다 */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function fail(error: string): SendResult {
  return { ok: false, error: error.slice(0, 500) };
}

/** 하이픈·공백을 없앤 숫자만 남깁니다. 국내 문자·알림톡은 숫자만 받습니다. */
export function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

// ---------------------------------------------------------------------------
// 텔레그램 (Bot API)
// ---------------------------------------------------------------------------

export async function sendTelegram(
  config: ChannelConfig,
  target: string,
  text: string
): Promise<SendResult> {
  const token = config.botToken?.trim();
  if (!token) return fail("봇 토큰이 설정되지 않았습니다.");

  try {
    const res = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: target.trim(),
      text,
      disable_web_page_preview: true,
    });
    if (!res.ok) {
      const desc = (res.json.description as string) ?? res.text;
      return fail(`텔레그램 응답 ${res.status}: ${desc}`);
    }
    const result = res.json.result as { message_id?: number } | undefined;
    return { ok: true, providerId: result?.message_id ? String(result.message_id) : undefined };
  } catch (err) {
    return fail(`텔레그램 발송 실패: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// SOLAPI — 문자메시지와 카카오 알림톡을 같은 API 로 보냅니다.
// 인증: Authorization: HMAC-SHA256 apiKey=..., date=..., salt=..., signature=...
//       signature = HMAC-SHA256(date + salt, apiSecret) 의 16진수 문자열
// ---------------------------------------------------------------------------

const SOLAPI_URL = "https://api.solapi.com/messages/v4/send-many/detail";

function solapiAuthHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString("hex");
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

interface SolapiMessage {
  to: string;
  from: string;
  text?: string;
  subject?: string;
  type?: string;
  kakaoOptions?: Record<string, unknown>;
}

async function solapiSend(
  apiKey: string,
  apiSecret: string,
  message: SolapiMessage
): Promise<SendResult> {
  try {
    const res = await postJson(
      SOLAPI_URL,
      { messages: [message] },
      { Authorization: solapiAuthHeader(apiKey, apiSecret) }
    );

    if (!res.ok) {
      const msg = (res.json.errorMessage as string) ?? res.text;
      return fail(`SOLAPI 응답 ${res.status}: ${msg}`);
    }

    // 요청 자체가 200 이어도 개별 건이 거절될 수 있어 실패 목록을 확인합니다.
    const list = res.json.failedMessageList as { statusMessage?: string }[] | undefined;
    if (list && list.length) {
      return fail(`SOLAPI 발송 거절: ${list[0].statusMessage ?? "사유 없음"}`);
    }

    return { ok: true, providerId: (res.json.groupId as string) ?? undefined };
  } catch (err) {
    return fail(`SOLAPI 발송 실패: ${(err as Error).message}`);
  }
}

export async function sendSms(
  config: ChannelConfig,
  target: string,
  text: string
): Promise<SendResult> {
  const apiKey = config.apiKey?.trim();
  const apiSecret = config.apiSecret?.trim();
  const from = digitsOnly(config.from ?? "");
  if (!apiKey || !apiSecret) return fail("SOLAPI API Key / Secret 이 설정되지 않았습니다.");
  if (!from) return fail("발신번호가 설정되지 않았습니다.");

  // 90바이트(한글 45자)를 넘으면 LMS 로 보내야 합니다. SOLAPI 는 type 을
  // 지정하지 않으면 길이에 맞춰 알아서 고르지만, 제목이 필요한 LMS 를 위해
  // 길이를 직접 보고 제목을 붙입니다.
  const bytes = Buffer.byteLength(text, "utf8");
  const long = bytes > 90;

  return solapiSend(apiKey, apiSecret, {
    to: digitsOnly(target),
    from,
    text,
    ...(long ? { type: "LMS", subject: "변압기 알람" } : { type: "SMS" }),
  });
}

export async function sendKakao(
  config: ChannelConfig,
  target: string,
  text: string
): Promise<SendResult> {
  const apiKey = config.apiKey?.trim();
  const apiSecret = config.apiSecret?.trim();
  const pfId = config.pfId?.trim();
  const templateId = config.templateId?.trim();
  if (!apiKey || !apiSecret) return fail("SOLAPI API Key / Secret 이 설정되지 않았습니다.");
  if (!pfId || !templateId) return fail("카카오 채널 ID 와 템플릿 ID 가 필요합니다.");

  const variableKey = config.variableKey?.trim() || "#{내용}";
  const from = digitsOnly(config.from ?? "");

  return solapiSend(apiKey, apiSecret, {
    to: digitsOnly(target),
    // 대체발송을 쓰지 않으면 발신번호가 없어도 되지만, SOLAPI 는 필드를 요구하므로
    // 비어 있으면 빈 문자열을 보냅니다.
    from,
    text,
    kakaoOptions: {
      pfId,
      templateId,
      variables: { [variableKey]: text },
      // 발신번호가 있을 때만 문자 대체발송을 켭니다.
      disableSms: from ? false : true,
    },
  });
}

// ---------------------------------------------------------------------------
// 메일 (SMTP)
// ---------------------------------------------------------------------------

export async function sendEmail(
  config: ChannelConfig,
  target: string,
  text: string,
  subject: string
): Promise<SendResult> {
  const host = config.host?.trim();
  const user = config.user?.trim();
  const pass = config.pass;
  const from = config.from?.trim() || user;
  if (!host || !user || !pass) return fail("SMTP 서버·계정·비밀번호가 필요합니다.");

  const port = Number(config.port ?? 587);
  if (!Number.isFinite(port) || port <= 0) return fail("SMTP 포트가 올바르지 않습니다.");

  try {
    // nodemailer 는 서버에서만 쓰므로 필요할 때 불러옵니다.
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: config.secure === "true" || port === 465,
      auth: { user, pass },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });

    const info = await transport.sendMail({
      from,
      to: target.trim(),
      subject,
      text,
    });
    return { ok: true, providerId: info.messageId };
  } catch (err) {
    return fail(`메일 발송 실패: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// WhatsApp (Meta Cloud API)
// 업체가 먼저 보내는 메시지는 승인된 템플릿만 허용됩니다.
// 본문에 변수 {{1}} 이 하나 있는 템플릿을 쓰는 것을 전제로 합니다.
// ---------------------------------------------------------------------------

export async function sendWhatsApp(
  config: ChannelConfig,
  target: string,
  text: string
): Promise<SendResult> {
  const phoneNumberId = config.phoneNumberId?.trim();
  const accessToken = config.accessToken?.trim();
  const templateName = config.templateName?.trim();
  if (!phoneNumberId || !accessToken) return fail("Phone Number ID 와 액세스 토큰이 필요합니다.");
  if (!templateName) return fail("승인된 템플릿 이름이 필요합니다.");

  const version = config.graphVersion?.trim() || "v23.0";
  const lang = config.templateLang?.trim() || "ko";

  try {
    const res = await postJson(
      `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: digitsOnly(target),
        type: "template",
        template: {
          name: templateName,
          language: { code: lang },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text }],
            },
          ],
        },
      },
      { Authorization: `Bearer ${accessToken}` }
    );

    if (!res.ok) {
      const error = res.json.error as { message?: string } | undefined;
      return fail(`WhatsApp 응답 ${res.status}: ${error?.message ?? res.text}`);
    }
    const messages = res.json.messages as { id?: string }[] | undefined;
    return { ok: true, providerId: messages?.[0]?.id };
  } catch (err) {
    return fail(`WhatsApp 발송 실패: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------

export async function sendVia(
  channel: NotifyChannel,
  config: ChannelConfig,
  target: string,
  text: string,
  subject: string
): Promise<SendResult> {
  switch (channel) {
    case "telegram":
      return sendTelegram(config, target, text);
    case "sms":
      return sendSms(config, target, text);
    case "kakao":
      return sendKakao(config, target, text);
    case "email":
      return sendEmail(config, target, text, subject);
    case "whatsapp":
      return sendWhatsApp(config, target, text);
    default:
      return fail("알 수 없는 발송 경로입니다.");
  }
}
