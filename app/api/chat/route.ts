import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query, one } from "@/lib/db";
import { evaluateDevice } from "@/lib/alarmEngine";
import {
  DEFAULT_THRESHOLDS,
  DeviceReading,
  DeviceRegistry,
  STATUS_LABEL,
  ThresholdConfig,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5";
const MAX_TURNS = 5;

const SYSTEM_PROMPT = `당신은 DH 스마트파워의 변압기 통합 모니터링 시스템에 내장된 사내 도우미입니다.

역할
- 현장 운영자와 관리자가 설비 상태, 알람, 임계치를 빠르게 확인하도록 돕습니다.
- 반드시 제공된 도구로 실제 데이터를 조회한 뒤 답하세요. 추측하거나 지어내지 마세요.

답변 규칙
- 한국어로, 현장에서 바로 읽을 수 있게 간결하게 답합니다.
- 수치는 단위를 붙입니다 (수소·메탄 ppm, 온도 ℃).
- 설비는 "4호기"처럼 이름으로 부릅니다.
- 위험·경고 설비가 있으면 먼저 알리고, 필요한 조치를 한 줄로 덧붙입니다.
- 표가 필요하면 간단한 텍스트 목록으로 정리합니다. 마크다운 표는 쓰지 마세요.
- 데이터가 없으면 없다고 분명히 말합니다.

상태 등급은 정상 · 주의 · 경고 · 위험 · 통신단절 5단계입니다.`;

const TOOLS = [
  {
    name: "list_devices",
    description:
      "등록된 모든 변압기의 최신 계측값과 판정 등급을 조회합니다. 상태로 필터링할 수 있습니다.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["all", "normal", "caution", "warning", "danger", "offline"],
          description: "조회할 상태. 생략하면 전체",
        },
      },
    },
  },
  {
    name: "get_device",
    description: "설비 하나의 최신 계측값, 판정 등급, 최근 24시간 추세 요약을 조회합니다.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "설비 이름 또는 번호. 예: 4호기, 4" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_alarms",
    description: "최근 알람 이력을 조회합니다.",
    input_schema: {
      type: "object",
      properties: {
        hours: { type: "number", description: "조회 기간(시간). 기본 24" },
        limit: { type: "number", description: "최대 건수. 기본 20" },
      },
    },
  },
  {
    name: "get_thresholds",
    description: "현재 설정된 센서 임계치와 복합 판정 규칙을 조회합니다.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_threshold",
    description:
      "센서 임계치를 변경합니다. 관리자만 사용할 수 있습니다. 변경 전 사용자에게 확인을 받으세요.",
    input_schema: {
      type: "object",
      properties: {
        sensor: { type: "string", enum: ["h2", "ch4", "temperature"] },
        level: { type: "string", enum: ["caution", "warning", "danger"] },
        value: { type: "number" },
      },
      required: ["sensor", "level", "value"],
    },
  },
];

async function loadEvaluated() {
  const [registry, readings, config] = await Promise.all([
    query<DeviceRegistry>(
      `SELECT device_id, name, building, capacity, bridge_id FROM devices ORDER BY sort_order, device_id`
    ),
    query<DeviceReading>(
      `SELECT device_id, h2, ch4, temperature, oil_level, updated_at FROM device_readings`
    ),
    one<{ thresholds: ThresholdConfig }>(`SELECT thresholds FROM app_config WHERE id = 1`),
  ]);

  const thresholds = config?.thresholds ?? DEFAULT_THRESHOLDS;
  const byId = new Map(readings.map((r) => [r.device_id, r]));

  const devices = registry.map((reg) => {
    const reading = byId.get(reg.device_id);
    if (!reading) {
      return {
        name: reg.name,
        building: reg.building,
        상태: "통신단절",
        비고: "계측 데이터 없음",
      };
    }
    const e = evaluateDevice(reg, reading, undefined, thresholds);
    return {
      name: reg.name,
      building: reg.building,
      capacity: reg.capacity,
      상태: STATUS_LABEL[e.status],
      수소_ppm: reading.h2,
      메탄_ppm: reading.ch4,
      온도_C: reading.temperature,
      유면: reading.oil_level,
      이상항목: e.causes,
      측정시각: reading.updated_at,
    };
  });

  return { devices, thresholds };
}

const STATUS_KEY: Record<string, string> = {
  normal: "정상",
  caution: "주의",
  warning: "경고",
  danger: "위험",
  offline: "통신단절",
};

async function runTool(name: string, input: Record<string, unknown>, isAdmin: boolean) {
  if (name === "list_devices") {
    const { devices } = await loadEvaluated();
    const want = String(input.status ?? "all");
    if (want === "all") return { count: devices.length, devices };
    const label = STATUS_KEY[want] ?? want;
    const filtered = devices.filter((d) => d.상태 === label);
    return { count: filtered.length, status: label, devices: filtered };
  }

  if (name === "get_device") {
    const needle = String(input.name ?? "").replace(/\s/g, "");
    const { devices } = await loadEvaluated();
    const hit =
      devices.find((d) => d.name.replace(/\s/g, "") === needle) ??
      devices.find((d) => d.name.replace(/\s/g, "").includes(needle)) ??
      devices.find((d) => d.name.replace(/\D/g, "") === needle.replace(/\D/g, ""));
    if (!hit) return { error: `'${input.name}' 설비를 찾을 수 없습니다.` };

    const trend = await query(
      `SELECT date_trunc('hour', measured_at) AS 시각,
              round(avg(h2)::numeric, 1) AS 수소_ppm,
              round(avg(temperature)::numeric, 1) AS 온도_C
         FROM telemetry t
         JOIN devices d ON d.device_id = t.device_id
        WHERE d.name = $1 AND measured_at > now() - interval '24 hours'
        GROUP BY 1 ORDER BY 1 DESC LIMIT 6`,
      [hit.name]
    );
    return { device: hit, 최근추세: trend };
  }

  if (name === "list_alarms") {
    const hours = Number(input.hours ?? 24);
    const limit = Math.min(50, Number(input.limit ?? 20));
    const rows = await query(
      `SELECT to_char(created_at, 'MM-DD HH24:MI') AS 시각, unit AS 설비,
              item AS 항목, level AS 등급, detail AS 내용
         FROM alarm_events
        WHERE created_at > now() - ($1 || ' hours')::interval
        ORDER BY created_at DESC LIMIT $2`,
      [String(hours), limit]
    );
    return { 기간_시간: hours, 건수: rows.length, 알람: rows };
  }

  if (name === "get_thresholds") {
    const { thresholds } = await loadEvaluated();
    return { thresholds };
  }

  if (name === "update_threshold") {
    if (!isAdmin) return { error: "임계치 변경은 관리자만 할 수 있습니다." };

    const sensor = String(input.sensor);
    const level = String(input.level);
    const value = Number(input.value);
    if (!["h2", "ch4", "temperature"].includes(sensor)) return { error: "센서 값이 올바르지 않습니다." };
    if (!["caution", "warning", "danger"].includes(level)) return { error: "등급 값이 올바르지 않습니다." };
    if (!Number.isFinite(value) || value <= 0) return { error: "임계치는 양수여야 합니다." };

    const current = await one<{ thresholds: ThresholdConfig }>(
      `SELECT thresholds FROM app_config WHERE id = 1`
    );
    const next = JSON.parse(JSON.stringify(current?.thresholds ?? DEFAULT_THRESHOLDS));
    next[sensor][level] = value;

    const rule = next[sensor];
    if (!(rule.caution < rule.warning && rule.warning < rule.danger)) {
      return {
        error: `변경하면 주의(${rule.caution}) < 경고(${rule.warning}) < 위험(${rule.danger}) 순서가 깨집니다.`,
      };
    }

    const rows = await query<{ version: number }>(
      `UPDATE app_config SET thresholds = $1::jsonb, version = version + 1, updated_at = now()
        WHERE id = 1 RETURNING version`,
      [JSON.stringify(next)]
    );
    return { ok: true, 변경후: rule, 설정버전: rows[0]?.version };
  }

  return { error: `알 수 없는 도구: ${name}` };
}

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "챗봇이 아직 설정되지 않았습니다. 서버의 .env.local 에 ANTHROPIC_API_KEY 를 추가한 뒤 재시작해 주세요.",
      },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  if (!incoming.length) {
    return NextResponse.json({ error: "질문이 비어 있습니다." }, { status: 400 });
  }

  // 대화가 길어져도 최근 12턴만 보냅니다.
  const messages: { role: string; content: unknown }[] = incoming
    .slice(-12)
    .map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? "").slice(0, 4000),
    }));

  const actions: string[] = [];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1200,
          system: `${SYSTEM_PROMPT}\n\n현재 사용자: ${user.email} (등급: ${
            user.tier === "admin" ? "관리자" : "뷰어"
          })`,
          tools: TOOLS,
          messages,
        }),
      });

      if (!res.ok) {
        const detail = await res.text();
        return NextResponse.json(
          { error: `Claude API 오류 (${res.status}): ${detail.slice(0, 300)}` },
          { status: 502 }
        );
      }

      const data = await res.json();
      const blocks: AnthropicBlock[] = data.content ?? [];

      if (data.stop_reason !== "tool_use") {
        const reply = blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return NextResponse.json({ reply: reply || "(응답 없음)", actions });
      }

      messages.push({ role: "assistant", content: blocks });

      const results = [];
      for (const block of blocks) {
        if (block.type !== "tool_use") continue;
        actions.push(block.name ?? "unknown");
        const output = await runTool(
          block.name ?? "",
          block.input ?? {},
          user.tier === "admin"
        );
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(output),
        });
      }
      messages.push({ role: "user", content: results });
    }

    return NextResponse.json({
      reply: "질문을 처리하지 못했습니다. 조금 더 구체적으로 물어봐 주세요.",
      actions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `처리 중 오류가 발생했습니다: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
