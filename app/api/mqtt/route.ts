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
  ack_timeout_sec: number;
  max_replay_items: number;
  log_payload_items: number;
  version: number;
  updated_at: string;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const [config, status] = await Promise.all([
    one<ConfigRow>(
      `SELECT host, port, username, password, tls, ca_path, client_id,
              topic_prefix, site, keep_log_days, ack_timeout_sec,
              max_replay_items, log_payload_items, version, updated_at
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
  const ackTimeout = Number(body.ack_timeout_sec ?? 10);
  const maxReplay = Number(body.max_replay_items ?? 500);
  const logItems = Number(body.log_payload_items ?? 20);

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
  // 장비 규격은 1초 이내 응답입니다. 왕복 지연을 감안해 1~120초 범위로 둡니다.
  if (!Number.isInteger(ackTimeout) || ackTimeout < 1 || ackTimeout > 120) {
    return NextResponse.json({ error: "응답 대기시간은 1~120초 사이여야 합니다." }, { status: 400 });
  }
  if (!Number.isInteger(maxReplay) || maxReplay < 10 || maxReplay > 5000) {
    return NextResponse.json(
      { error: "한 메시지 항목 수 상한은 10~5000 사이여야 합니다." },
      { status: 400 }
    );
  }
  if (!Number.isInteger(logItems) || logItems < 1 || logItems > 500) {
    return NextResponse.json(
      { error: "수신 내역 원문 보관 항목 수는 1~500 사이여야 합니다." },
      { status: 400 }
    );
  }

  // 화면에서 가려진 채로 돌아온 비밀번호는 기존 값을 그대로 둡니다.
  const keepPassword = body.password === MASK;

  await execute(
    `UPDATE mqtt_config
        SET host = $1, port = $2, username = $3,
            password = CASE WHEN $4 THEN password ELSE $5 END,
            tls = $6, ca_path = $7, client_id = $8, topic_prefix = $9,
            site = $10, keep_log_days = $11, ack_timeout_sec = $12,
            max_replay_items = $13, log_payload_items = $14,
            version = version + 1, updated_at = now(), updated_by = $15
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
      ackTimeout,
      maxReplay,
      logItems,
      admin.id,
    ]
  );

  return NextResponse.json({ ok: true });
}
