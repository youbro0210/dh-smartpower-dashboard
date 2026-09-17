import { query, one, execute } from "@/lib/db";
import { sendVia } from "./providers";
import {
  AlarmPayload,
  ChannelConfig,
  ChannelRow,
  NotifyChannel,
  Recipient,
  SEVERITY_RANK,
  Severity,
} from "./types";

const LEVEL_LABEL: Record<Severity, string> = {
  caution: "주의",
  warning: "경고",
  danger: "위험",
};

/** 문자·알림톡을 고려해 짧고 사실만 담은 한 덩어리로 씁니다. */
export function renderAlarm(alarm: AlarmPayload): { subject: string; text: string } {
  const when = alarm.created_at ? new Date(alarm.created_at) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const label = LEVEL_LABEL[alarm.level];

  const lines = [
    `[DH 변압기 ${label}] ${alarm.unit}`,
    alarm.item,
    alarm.detail ? `측정값 ${alarm.detail}` : null,
    `발생 ${stamp}`,
  ].filter(Boolean) as string[];

  return {
    subject: `[DH 변압기 ${label}] ${alarm.unit} · ${alarm.item}`,
    text: lines.join("\n"),
  };
}

/**
 * 야간 미발송 구간에 들어가는지 봅니다.
 * from=22, to=7 처럼 자정을 넘는 구간도 다룹니다.
 * 위험(danger) 등급은 이 구간에도 보냅니다 — 사람이 바로 알아야 하는 상황입니다.
 */
export function inQuietHours(
  recipient: Pick<Recipient, "quiet_from" | "quiet_to">,
  at: Date
): boolean {
  const { quiet_from: from, quiet_to: to } = recipient;
  if (from === null || to === null || from === undefined || to === undefined) return false;
  if (from === to) return false;
  const hour = at.getHours();
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

export async function loadChannels(): Promise<Map<NotifyChannel, ChannelRow>> {
  const rows = await query<{ channel: NotifyChannel; enabled: boolean; config: ChannelConfig }>(
    `SELECT channel, enabled, config FROM notify_channels`
  );
  return new Map(rows.map((r) => [r.channel, r]));
}

export async function loadRecipients(onlyEnabled = true): Promise<Recipient[]> {
  return query<Recipient>(
    `SELECT id, name, channel, target, min_level, quiet_from, quiet_to, enabled, memo
       FROM notify_recipients
      ${onlyEnabled ? "WHERE enabled" : ""}
      ORDER BY name, channel`
  );
}

interface LogRow {
  alarmId: number | null;
  recipientId: number | null;
  recipientName: string;
  channel: NotifyChannel;
  target: string;
  level: Severity | null;
  body: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
  providerId?: string;
}

async function writeLog(row: LogRow): Promise<void> {
  await execute(
    `INSERT INTO notify_log
       (alarm_id, recipient_id, recipient, channel, target, level, body, status, error, provider_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      row.alarmId,
      row.recipientId,
      row.recipientName,
      row.channel,
      row.target,
      row.level,
      row.body,
      row.status,
      row.error ?? null,
      row.providerId ?? null,
    ]
  );
}

export interface DispatchSummary {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * 알람 한 건을 조건에 맞는 모든 수신자에게 보냅니다.
 *
 * 한 사람의 발송이 실패해도 나머지는 계속 보내고, 성공·실패·건너뜀을
 * 모두 notify_log 에 남깁니다. 같은 알람을 두 번 처리하지 않도록
 * notify_dispatched 에 먼저 표시를 남기고 시작합니다.
 */
export async function dispatchAlarm(alarm: AlarmPayload): Promise<DispatchSummary> {
  const summary: DispatchSummary = { sent: 0, failed: 0, skipped: 0 };

  if (alarm.id != null) {
    const claimed = await execute(
      `INSERT INTO notify_dispatched (alarm_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [alarm.id]
    );
    // 이미 처리된 알람이면 아무것도 하지 않습니다.
    if (claimed === 0) return summary;
  }

  const [channels, recipients] = await Promise.all([loadChannels(), loadRecipients(true)]);
  if (recipients.length === 0) return summary;

  const { subject, text } = renderAlarm(alarm);
  const now = alarm.created_at ? new Date(alarm.created_at) : new Date();

  // 같은 채널로 연달아 보내면 발송사에서 막힐 수 있어 순서대로 보냅니다.
  for (const r of recipients) {
    const channel = channels.get(r.channel);

    if (!channel?.enabled) {
      summary.skipped += 1;
      await writeLog({
        alarmId: alarm.id ?? null,
        recipientId: r.id,
        recipientName: r.name,
        channel: r.channel,
        target: r.target,
        level: alarm.level,
        body: text,
        status: "skipped",
        error: "채널이 꺼져 있습니다.",
      });
      continue;
    }

    if (SEVERITY_RANK[alarm.level] < SEVERITY_RANK[r.min_level]) {
      summary.skipped += 1;
      continue; // 등급 미달은 흔한 일이라 이력에 남기지 않습니다.
    }

    if (alarm.level !== "danger" && inQuietHours(r, now)) {
      summary.skipped += 1;
      await writeLog({
        alarmId: alarm.id ?? null,
        recipientId: r.id,
        recipientName: r.name,
        channel: r.channel,
        target: r.target,
        level: alarm.level,
        body: text,
        status: "skipped",
        error: "야간 미발송 구간",
      });
      continue;
    }

    const result = await sendVia(r.channel, channel.config, r.target, text, subject);
    if (result.ok) summary.sent += 1;
    else summary.failed += 1;

    await writeLog({
      alarmId: alarm.id ?? null,
      recipientId: r.id,
      recipientName: r.name,
      channel: r.channel,
      target: r.target,
      level: alarm.level,
      body: text,
      status: result.ok ? "sent" : "failed",
      error: result.error,
      providerId: result.providerId,
    });
  }

  return summary;
}

/** 설정 화면의 '테스트 발송' 버튼이 쓰는 경로입니다. */
export async function sendTest(recipientId: number): Promise<{ ok: boolean; error?: string }> {
  const r = await one<Recipient>(
    `SELECT id, name, channel, target, min_level, quiet_from, quiet_to, enabled, memo
       FROM notify_recipients WHERE id = $1`,
    [recipientId]
  );
  if (!r) return { ok: false, error: "수신자를 찾을 수 없습니다." };

  const channels = await loadChannels();
  const channel = channels.get(r.channel);
  if (!channel?.enabled) return { ok: false, error: "이 발송 경로가 꺼져 있습니다." };

  const stamp = new Date().toLocaleString("ko-KR", { hour12: false });
  const text = `[DH 변압기 모니터링] 테스트 발송입니다.\n이 메시지가 보이면 ${r.name} 님의 ${r.target} 로 알람이 정상 전달됩니다.\n발송 ${stamp}`;

  const result = await sendVia(
    r.channel,
    channel.config,
    r.target,
    text,
    "[DH 변압기 모니터링] 테스트 발송"
  );

  await writeLog({
    alarmId: null,
    recipientId: r.id,
    recipientName: r.name,
    channel: r.channel,
    target: r.target,
    level: null,
    body: text,
    status: result.ok ? "sent" : "failed",
    error: result.error,
    providerId: result.providerId,
  });

  return { ok: result.ok, error: result.error };
}
