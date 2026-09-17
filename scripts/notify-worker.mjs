#!/usr/bin/env node
/**
 * 알람 발송 워커.
 *
 * alarm_events 에 행이 들어가면 트리거가 pg_notify('alarm_event', ...) 를 쏩니다.
 * 이 프로세스는 그것을 듣고 있다가 등록된 수신자에게 메시지를 보냅니다.
 *
 * 웹 서버와 따로 도는 이유:
 *   - 웹 서버는 배포할 때마다 재시작되고 여러 벌로 뜰 수 있어, 그 안에서 들으면
 *     같은 알람을 여러 번 보낼 위험이 있습니다.
 *   - 알람을 누가 넣든(수집 서버든 사람이든) 동작해야 합니다.
 *
 * 실행:  node scripts/notify-worker.mjs
 * 환경변수: DATABASE_URL (필수), PGSSL=require (외부 DB일 때)
 */

import pg from "pg";
import crypto from "node:crypto";
import nodemailer from "nodemailer";

const { Client, Pool, types } = pg;

types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => parseFloat(v));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 이 없습니다.");
  process.exit(1);
}

const ssl = process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, ssl });

const TIMEOUT_MS = 12_000;
const LEVEL_LABEL = { caution: "주의", warning: "경고", danger: "위험" };
const SEVERITY_RANK = { caution: 1, warning: 2, danger: 3 };

const log = (...args) => console.log(new Date().toISOString(), ...args);

// ---------------------------------------------------------------------------
// 발송 드라이버 — lib/notify/providers.ts 와 같은 동작입니다.
// 워커는 Next.js 빌드를 거치지 않으므로 여기에 따로 둡니다.
// ---------------------------------------------------------------------------

const digitsOnly = (v) => String(v ?? "").replace(/[^0-9]/g, "");
const fail = (error) => ({ ok: false, error: String(error).slice(0, 500) });

async function postJson(url, body, headers = {}) {
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
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* JSON 이 아니면 원문만 씁니다 */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegram(config, target, text) {
  const token = (config.botToken ?? "").trim();
  if (!token) return fail("봇 토큰이 설정되지 않았습니다.");
  try {
    const res = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: target.trim(),
      text,
      disable_web_page_preview: true,
    });
    if (!res.ok) return fail(`텔레그램 응답 ${res.status}: ${res.json.description ?? res.text}`);
    return { ok: true, providerId: res.json.result?.message_id ? String(res.json.result.message_id) : undefined };
  } catch (err) {
    return fail(`텔레그램 발송 실패: ${err.message}`);
  }
}

const SOLAPI_URL = "https://api.solapi.com/messages/v4/send-many/detail";

function solapiAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString("hex");
  const signature = crypto.createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function solapiSend(apiKey, apiSecret, message) {
  try {
    const res = await postJson(SOLAPI_URL, { messages: [message] }, {
      Authorization: solapiAuthHeader(apiKey, apiSecret),
    });
    if (!res.ok) return fail(`SOLAPI 응답 ${res.status}: ${res.json.errorMessage ?? res.text}`);
    const list = res.json.failedMessageList;
    if (Array.isArray(list) && list.length) {
      return fail(`SOLAPI 발송 거절: ${list[0].statusMessage ?? "사유 없음"}`);
    }
    return { ok: true, providerId: res.json.groupId };
  } catch (err) {
    return fail(`SOLAPI 발송 실패: ${err.message}`);
  }
}

async function sendSms(config, target, text) {
  const apiKey = (config.apiKey ?? "").trim();
  const apiSecret = (config.apiSecret ?? "").trim();
  const from = digitsOnly(config.from);
  if (!apiKey || !apiSecret) return fail("SOLAPI API Key / Secret 이 설정되지 않았습니다.");
  if (!from) return fail("발신번호가 설정되지 않았습니다.");

  const long = Buffer.byteLength(text, "utf8") > 90;
  return solapiSend(apiKey, apiSecret, {
    to: digitsOnly(target),
    from,
    text,
    ...(long ? { type: "LMS", subject: "변압기 알람" } : { type: "SMS" }),
  });
}

async function sendKakao(config, target, text) {
  const apiKey = (config.apiKey ?? "").trim();
  const apiSecret = (config.apiSecret ?? "").trim();
  const pfId = (config.pfId ?? "").trim();
  const templateId = (config.templateId ?? "").trim();
  if (!apiKey || !apiSecret) return fail("SOLAPI API Key / Secret 이 설정되지 않았습니다.");
  if (!pfId || !templateId) return fail("카카오 채널 ID 와 템플릿 ID 가 필요합니다.");

  const variableKey = (config.variableKey ?? "").trim() || "#{내용}";
  const from = digitsOnly(config.from);

  return solapiSend(apiKey, apiSecret, {
    to: digitsOnly(target),
    from,
    text,
    kakaoOptions: {
      pfId,
      templateId,
      variables: { [variableKey]: text },
      disableSms: !from,
    },
  });
}

async function sendEmail(config, target, text, subject) {
  const host = (config.host ?? "").trim();
  const user = (config.user ?? "").trim();
  const pass = config.pass;
  const from = (config.from ?? "").trim() || user;
  if (!host || !user || !pass) return fail("SMTP 서버·계정·비밀번호가 필요합니다.");

  const port = Number(config.port ?? 587);
  if (!Number.isFinite(port) || port <= 0) return fail("SMTP 포트가 올바르지 않습니다.");

  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: config.secure === "true" || port === 465,
      auth: { user, pass },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    const info = await transport.sendMail({ from, to: target.trim(), subject, text });
    return { ok: true, providerId: info.messageId };
  } catch (err) {
    return fail(`메일 발송 실패: ${err.message}`);
  }
}

async function sendWhatsApp(config, target, text) {
  const phoneNumberId = (config.phoneNumberId ?? "").trim();
  const accessToken = (config.accessToken ?? "").trim();
  const templateName = (config.templateName ?? "").trim();
  if (!phoneNumberId || !accessToken) return fail("Phone Number ID 와 액세스 토큰이 필요합니다.");
  if (!templateName) return fail("승인된 템플릿 이름이 필요합니다.");

  const version = (config.graphVersion ?? "").trim() || "v23.0";
  const lang = (config.templateLang ?? "").trim() || "ko";

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
          components: [{ type: "body", parameters: [{ type: "text", text }] }],
        },
      },
      { Authorization: `Bearer ${accessToken}` }
    );
    if (!res.ok) return fail(`WhatsApp 응답 ${res.status}: ${res.json.error?.message ?? res.text}`);
    return { ok: true, providerId: res.json.messages?.[0]?.id };
  } catch (err) {
    return fail(`WhatsApp 발송 실패: ${err.message}`);
  }
}

function sendVia(channel, config, target, text, subject) {
  switch (channel) {
    case "telegram": return sendTelegram(config, target, text);
    case "sms":      return sendSms(config, target, text);
    case "kakao":    return sendKakao(config, target, text);
    case "email":    return sendEmail(config, target, text, subject);
    case "whatsapp": return sendWhatsApp(config, target, text);
    default:         return Promise.resolve(fail("알 수 없는 발송 경로입니다."));
  }
}

// ---------------------------------------------------------------------------
// 발송 판단
// ---------------------------------------------------------------------------

function renderAlarm(alarm) {
  const when = alarm.created_at ? new Date(alarm.created_at) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const label = LEVEL_LABEL[alarm.level] ?? alarm.level;
  const lines = [
    `[DH 변압기 ${label}] ${alarm.unit}`,
    alarm.item,
    alarm.detail ? `측정값 ${alarm.detail}` : null,
    `발생 ${stamp}`,
  ].filter(Boolean);
  return { subject: `[DH 변압기 ${label}] ${alarm.unit} · ${alarm.item}`, text: lines.join("\n") };
}

function inQuietHours(r, at) {
  const from = r.quiet_from;
  const to = r.quiet_to;
  if (from === null || to === null || from === undefined || to === undefined) return false;
  if (from === to) return false;
  const hour = at.getHours();
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

async function writeLog(row) {
  await pool.query(
    `INSERT INTO notify_log
       (alarm_id, recipient_id, recipient, channel, target, level, body, status, error, provider_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [row.alarmId, row.recipientId, row.recipientName, row.channel, row.target,
     row.level, row.body, row.status, row.error ?? null, row.providerId ?? null]
  );
}

async function dispatch(alarm) {
  if (alarm.id != null) {
    const claim = await pool.query(
      `INSERT INTO notify_dispatched (alarm_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [alarm.id]
    );
    if (claim.rowCount === 0) {
      log(`알람 ${alarm.id}: 이미 처리됨, 건너뜀`);
      return;
    }
  }

  const [{ rows: channelRows }, { rows: recipients }] = await Promise.all([
    pool.query(`SELECT channel, enabled, config FROM notify_channels`),
    pool.query(
      `SELECT id, name, channel, target, min_level, quiet_from, quiet_to
         FROM notify_recipients WHERE enabled ORDER BY name`
    ),
  ]);
  if (recipients.length === 0) return;

  const channels = new Map(channelRows.map((r) => [r.channel, r]));
  const { subject, text } = renderAlarm(alarm);
  const now = alarm.created_at ? new Date(alarm.created_at) : new Date();

  let sent = 0, failed = 0, skipped = 0;

  for (const r of recipients) {
    const channel = channels.get(r.channel);

    if (!channel?.enabled) {
      skipped += 1;
      await writeLog({ alarmId: alarm.id, recipientId: r.id, recipientName: r.name,
        channel: r.channel, target: r.target, level: alarm.level, body: text,
        status: "skipped", error: "채널이 꺼져 있습니다." });
      continue;
    }

    if (SEVERITY_RANK[alarm.level] < SEVERITY_RANK[r.min_level]) {
      skipped += 1;
      continue;
    }

    if (alarm.level !== "danger" && inQuietHours(r, now)) {
      skipped += 1;
      await writeLog({ alarmId: alarm.id, recipientId: r.id, recipientName: r.name,
        channel: r.channel, target: r.target, level: alarm.level, body: text,
        status: "skipped", error: "야간 미발송 구간" });
      continue;
    }

    const result = await sendVia(r.channel, channel.config ?? {}, r.target, text, subject);
    if (result.ok) sent += 1; else failed += 1;

    await writeLog({ alarmId: alarm.id, recipientId: r.id, recipientName: r.name,
      channel: r.channel, target: r.target, level: alarm.level, body: text,
      status: result.ok ? "sent" : "failed", error: result.error, providerId: result.providerId });

    if (!result.ok) log(`알람 ${alarm.id} → ${r.name}(${r.channel}) 실패: ${result.error}`);
  }

  log(`알람 ${alarm.id} 처리: 발송 ${sent} · 실패 ${failed} · 건너뜀 ${skipped}`);
}

/**
 * 워커가 꺼져 있던 동안 쌓인 알람을 처리합니다.
 * notify_dispatched 에 없는 최근 알람만 골라 한 번씩 보냅니다.
 */
async function catchUp() {
  const { rows } = await pool.query(
    `SELECT a.id, a.device_id, a.unit, a.item, a.level, a.detail, a.created_at
       FROM alarm_events a
       LEFT JOIN notify_dispatched d ON d.alarm_id = a.id
      WHERE d.alarm_id IS NULL
        AND a.created_at > now() - interval '1 hour'
      ORDER BY a.created_at`
  );
  if (rows.length) log(`밀린 알람 ${rows.length}건 처리`);
  for (const row of rows) await dispatch(row);
}

// ---------------------------------------------------------------------------
// LISTEN 연결. 끊기면 다시 붙습니다.
// ---------------------------------------------------------------------------

let listener = null;
let stopping = false;

async function connect() {
  listener = new Client({ connectionString: process.env.DATABASE_URL, ssl });

  listener.on("notification", (msg) => {
    if (msg.channel !== "alarm_event" || !msg.payload) return;
    let alarm;
    try {
      alarm = JSON.parse(msg.payload);
    } catch {
      log("알람 통지를 읽지 못했습니다:", msg.payload);
      return;
    }
    dispatch(alarm).catch((err) => log("발송 처리 중 오류:", err.message));
  });

  listener.on("error", (err) => {
    log("LISTEN 연결 오류:", err.message);
    listener?.end().catch(() => {});
    if (!stopping) setTimeout(connect, 5000);
  });

  try {
    await listener.connect();
    await listener.query("LISTEN alarm_event");
    log("알람 발송 워커 시작 — alarm_event 구독 중");
    await catchUp();
  } catch (err) {
    log("연결 실패, 5초 후 재시도:", err.message);
    if (!stopping) setTimeout(connect, 5000);
  }
}

// 통지를 놓쳤을 경우를 대비해 5분마다 밀린 알람을 한 번씩 훑습니다.
setInterval(() => {
  catchUp().catch((err) => log("밀린 알람 처리 오류:", err.message));
}, 5 * 60_000);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    stopping = true;
    log("종료합니다.");
    await listener?.end().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  });
}

connect();
