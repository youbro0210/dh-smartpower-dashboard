import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query, execute, one } from "@/lib/db";
import { NOTIFY_CHANNELS, NotifyChannel, Recipient } from "@/lib/notify/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEVELS = ["caution", "warning", "danger"];

function readHour(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
}

/** 입력값을 검사하고 저장 가능한 형태로 다듬습니다. */
function parse(body: Record<string, unknown>): { ok: true; value: Omit<Recipient, "id"> } | { ok: false; error: string } {
  const name = String(body.name ?? "").trim();
  const channel = String(body.channel ?? "") as NotifyChannel;
  const target = String(body.target ?? "").trim();
  const minLevel = String(body.min_level ?? "warning");

  if (!name) return { ok: false, error: "이름을 입력하세요." };
  if (!NOTIFY_CHANNELS.includes(channel)) return { ok: false, error: "발송 경로를 선택하세요." };
  if (!target) return { ok: false, error: "받는 곳(번호·주소)을 입력하세요." };
  if (!LEVELS.includes(minLevel)) return { ok: false, error: "발송 기준 등급이 올바르지 않습니다." };

  if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    return { ok: false, error: "메일 주소 형식이 올바르지 않습니다." };
  }
  if ((channel === "sms" || channel === "kakao") && target.replace(/[^0-9]/g, "").length < 9) {
    return { ok: false, error: "전화번호 형식이 올바르지 않습니다." };
  }
  if (channel === "whatsapp" && target.replace(/[^0-9]/g, "").length < 10) {
    return { ok: false, error: "WhatsApp 번호는 국가번호를 포함해 입력하세요." };
  }
  if (channel === "telegram" && !/^-?\d+$/.test(target.trim())) {
    return { ok: false, error: "텔레그램은 숫자로 된 chat id 를 입력하세요." };
  }

  const quietFrom = readHour(body.quiet_from);
  const quietTo = readHour(body.quiet_to);
  if ((quietFrom === null) !== (quietTo === null)) {
    return { ok: false, error: "야간 미발송은 시작과 끝을 모두 지정해야 합니다." };
  }

  return {
    ok: true,
    value: {
      name,
      channel,
      target,
      min_level: minLevel as Recipient["min_level"],
      quiet_from: quietFrom,
      quiet_to: quietTo,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      memo: body.memo ? String(body.memo).trim() : null,
    },
  };
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const recipients = await query<Recipient>(
    `SELECT id, name, channel, target, min_level, quiet_from, quiet_to, enabled, memo
       FROM notify_recipients ORDER BY name, channel`
  );
  return NextResponse.json({ recipients });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });

  const parsed = parse(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  try {
    const row = await one<{ id: number }>(
      `INSERT INTO notify_recipients (name, channel, target, min_level, quiet_from, quiet_to, enabled, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [v.name, v.channel, v.target, v.min_level, v.quiet_from, v.quiet_to, v.enabled, v.memo]
    );
    return NextResponse.json({ id: row?.id }, { status: 201 });
  } catch (err) {
    // 같은 경로에 같은 번호가 이미 있으면 중복 발송이 되므로 막습니다.
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "같은 경로에 이미 등록된 번호·주소입니다." }, { status: 409 });
    }
    throw err;
  }
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });

  // 켜고 끄기만 바꾸는 경우는 따로 처리해 입력 검사를 건너뜁니다.
  if (Object.keys(body).length === 2 && "enabled" in body) {
    const changed = await execute(`UPDATE notify_recipients SET enabled = $2 WHERE id = $1`, [
      Number(body.id),
      Boolean(body.enabled),
    ]);
    if (!changed) return NextResponse.json({ error: "수신자를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  const parsed = parse(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  try {
    const changed = await execute(
      `UPDATE notify_recipients
          SET name = $2, channel = $3, target = $4, min_level = $5,
              quiet_from = $6, quiet_to = $7, enabled = $8, memo = $9
        WHERE id = $1`,
      [Number(body.id), v.name, v.channel, v.target, v.min_level, v.quiet_from, v.quiet_to, v.enabled, v.memo]
    );
    if (!changed) return NextResponse.json({ error: "수신자를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "같은 경로에 이미 등록된 번호·주소입니다." }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });

  const removed = await execute(`DELETE FROM notify_recipients WHERE id = $1`, [Number(id)]);
  if (!removed) return NextResponse.json({ error: "수신자를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
