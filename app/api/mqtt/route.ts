import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { one, execute } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MASK = "********";

interface ConfigRow {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  tls: boolean;
  ca_path: string | null;
  client_id: string;
  topic_prefix: string;
  site: string;
  keep_log_days: number;
  version: number;
  updated_at: string;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const [config, status] = await Promise.all([
    one<ConfigRow>(
      `SELECT host, port, username, password, tls, ca_path, client_id,
              topic_prefix, site, keep_log_days, version, updated_at
         FROM mqtt_config WHERE id = 1`
    ),
    one(
      `SELECT connected, broker, last_error, started_at, last_heartbeat, last_message_at,
              messages, rows_stored, alarms, errors, config_version
         FROM collector_status WHERE id = 1`
    ),
  ]);

  if (!config) return NextResponse.json({ error: "설정을 찾을 수 없습니다." }, { status: 404 });

  // 비밀번호는 설정 여부만 알립니다.
  return NextResponse.json({
    config: { ...config, password: config.password ? MASK : "" },
    status,
  });
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });

  const host = String(body.host ?? "").trim();
  const port = Number(body.port);
  const prefix = String(body.topic_prefix ?? "").trim();
  const site = String(body.site ?? "").trim();
  const clientId = String(body.client_id ?? "").trim();
  const keepDays = Number(body.keep_log_days ?? 7);

  if (!host) return NextResponse.json({ error: "브로커 주소를 입력하세요." }, { status: 400 });
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: "포트는 1~65535 사이의 정수여야 합니다." }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_\-/]+$/.test(prefix)) {
    return NextResponse.json({ error: "토픽 접두사는 영문·숫자·-·_·/ 만 쓸 수 있습니다." }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(site)) {
    return NextResponse.json({ error: "현장 코드는 영문·숫자·-·_ 만 쓸 수 있습니다." }, { status: 400 });
  }
  if (!clientId) return NextResponse.json({ error: "클라이언트 ID를 입력하세요." }, { status: 400 });
  if (!Number.isInteger(keepDays) || keepDays < 1 || keepDays > 365) {
    return NextResponse.json({ error: "수신 내역 보관은 1~365일 사이여야 합니다." }, { status: 400 });
  }

  // 화면에서 가려진 채로 돌아온 비밀번호는 기존 값을 그대로 둡니다.
  const keepPassword = body.password === MASK;

  await execute(
    `UPDATE mqtt_config
        SET host = $1, port = $2, username = $3,
            password = CASE WHEN $4 THEN password ELSE $5 END,
            tls = $6, ca_path = $7, client_id = $8, topic_prefix = $9,
            site = $10, keep_log_days = $11,
            version = version + 1, updated_at = now(), updated_by = $12
      WHERE id = 1`,
    [
      host,
      port,
      body.username ? String(body.username).trim() : null,
      keepPassword,
      body.password ? String(body.password) : null,
      Boolean(body.tls),
      body.ca_path ? String(body.ca_path).trim() : null,
      clientId,
      prefix,
      site,
      keepDays,
      admin.id,
    ]
  );

  return NextResponse.json({ ok: true });
}
