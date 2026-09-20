import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query, one, execute } from "@/lib/db";
import { COMMANDS, CommandKey } from "@/lib/commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET_TYPES = ["bridge", "module", "gateway"];

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const limit = Math.min(200, Number(new URL(request.url).searchParams.get("limit") ?? 50));

  const [commands, targets, site] = await Promise.all([
    query(
      `SELECT c.id, c.site, c.target_type, c.target_id, c.device_id, c.command, c.params,
              c.status, c.requested_at, c.sent_at, c.acked_at, c.ack, c.error,
              u.email AS requested_by
         FROM device_commands c
         LEFT JOIN users u ON u.id = c.requested_by
        ORDER BY c.id DESC
        LIMIT $1`,
      [limit]
    ),
    query(
      `SELECT bridge_id AS id, name, online, last_seen_at FROM bridges ORDER BY bridge_id`
    ),
    one<{ site: string; topic_prefix: string }>(
      `SELECT site, topic_prefix FROM mqtt_config WHERE id = 1`
    ),
  ]);

  const devices = await query(
    `SELECT device_id, name, bridge_id FROM devices ORDER BY sort_order, device_id`
  );

  return NextResponse.json({ commands, bridges: targets, devices, site });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });

  const targetType = String(body.target_type ?? "");
  const targetId = String(body.target_id ?? "").trim();
  const command = String(body.command ?? "").trim();

  if (!TARGET_TYPES.includes(targetType)) {
    return NextResponse.json({ error: "대상 종류를 선택하세요." }, { status: 400 });
  }
  if (!targetId) return NextResponse.json({ error: "대상을 선택하세요." }, { status: 400 });
  if (!command) return NextResponse.json({ error: "명령을 선택하세요." }, { status: 400 });

  const spec = COMMANDS[command as CommandKey];
  if (!spec) return NextResponse.json({ error: "정의되지 않은 명령입니다." }, { status: 400 });

  // 파라미터는 명령 정의에 있는 항목만 받습니다.
  const params: Record<string, string | number | boolean> = {};
  for (const field of spec.fields ?? []) {
    const raw = body.params?.[field.key];
    if (raw === undefined || raw === "") {
      if (field.required) {
        return NextResponse.json({ error: `${field.label} 값이 필요합니다.` }, { status: 400 });
      }
      continue;
    }
    if (field.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: `${field.label} 은(는) 숫자여야 합니다.` }, { status: 400 });
      }
      if (field.min !== undefined && n < field.min) {
        return NextResponse.json({ error: `${field.label} 은(는) ${field.min} 이상이어야 합니다.` }, { status: 400 });
      }
      if (field.max !== undefined && n > field.max) {
        return NextResponse.json({ error: `${field.label} 은(는) ${field.max} 이하여야 합니다.` }, { status: 400 });
      }
      params[field.key] = n;
    } else {
      params[field.key] = String(raw).slice(0, 200);
    }
  }

  const config = await one<{ site: string }>(`SELECT site FROM mqtt_config WHERE id = 1`);

  const row = await one<{ id: number }>(
    `INSERT INTO device_commands
       (site, target_type, target_id, device_id, command, params, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`,
    [
      config?.site ?? "dh1",
      targetType,
      targetId,
      body.device_id ? String(body.device_id) : null,
      command,
      JSON.stringify(params),
      admin.id,
    ]
  );

  return NextResponse.json({ id: row?.id }, { status: 201 });
}

/** 보류 중인 명령 취소 */
export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });

  const changed = await execute(
    `UPDATE device_commands SET status = 'failed', error = '관리자가 취소했습니다.'
      WHERE id = $1 AND status = 'pending'`,
    [Number(id)]
  );
  if (!changed) {
    return NextResponse.json({ error: "이미 발행된 명령은 취소할 수 없습니다." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
