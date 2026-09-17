import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query, execute, one } from "@/lib/db";
import {
  CHANNEL_FIELDS,
  ChannelConfig,
  NOTIFY_CHANNELS,
  NotifyChannel,
} from "@/lib/notify/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MASK = "********";

/** 비밀값은 화면으로 내려보내지 않고, 설정되어 있다는 사실만 알립니다. */
function maskConfig(channel: NotifyChannel, config: ChannelConfig): ChannelConfig {
  const fields = CHANNEL_FIELDS[channel];
  const out: ChannelConfig = {};
  for (const field of fields) {
    const value = config[field.key];
    if (field.secret) out[field.key] = value ? MASK : "";
    else out[field.key] = value ?? "";
  }
  return out;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const rows = await query<{ channel: NotifyChannel; enabled: boolean; config: ChannelConfig }>(
    `SELECT channel, enabled, config FROM notify_channels`
  );
  const byChannel = new Map(rows.map((r) => [r.channel, r]));

  return NextResponse.json({
    channels: NOTIFY_CHANNELS.map((channel) => {
      const row = byChannel.get(channel);
      return {
        channel,
        enabled: row?.enabled ?? false,
        config: maskConfig(channel, row?.config ?? {}),
      };
    }),
  });
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    channel?: string;
    enabled?: boolean;
    config?: ChannelConfig;
  } | null;
  if (!body) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });

  const channel = body.channel as NotifyChannel;
  if (!NOTIFY_CHANNELS.includes(channel)) {
    return NextResponse.json({ error: "알 수 없는 발송 경로입니다." }, { status: 400 });
  }

  const current = await one<{ config: ChannelConfig }>(
    `SELECT config FROM notify_channels WHERE channel = $1`,
    [channel]
  );

  // 화면에서 가려진 채로 돌아온 비밀값은 기존 값을 그대로 둡니다.
  const merged: ChannelConfig = { ...(current?.config ?? {}) };
  for (const field of CHANNEL_FIELDS[channel]) {
    const incoming = body.config?.[field.key];
    if (incoming === undefined) continue;
    if (field.secret && incoming === MASK) continue;
    merged[field.key] = typeof incoming === "string" ? incoming.trim() : incoming;
  }

  await execute(
    `INSERT INTO notify_channels (channel, enabled, config, updated_at, updated_by)
     VALUES ($1, $2, $3::jsonb, now(), $4)
     ON CONFLICT (channel) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            config = EXCLUDED.config,
            updated_at = now(),
            updated_by = EXCLUDED.updated_by`,
    [channel, Boolean(body.enabled), JSON.stringify(merged), admin.id]
  );

  return NextResponse.json({ channel, enabled: Boolean(body.enabled), config: maskConfig(channel, merged) });
}
