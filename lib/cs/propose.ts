import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { proposeWithTools } from "@/cs-engine/propose";
import { entitiesText } from "@/cs-engine/fields";
import { one, query } from "@/lib/db";
import { csModel } from "./engine";
import { ENTITIES } from "./entities";
import { saveProposals, type FixOp } from "./fixes";

/**
 * 정정안 만들기입니다. AI 에게는 읽기 전용 찾기 도구만 주고, 마지막에 propose_fixes 로 정정안만 받습니다.
 * DB 를 바꾸는 도구는 없습니다. 반영은 관리자 또는 위험 낮음 자동 규칙이 lib/cs/fixes.ts 로 합니다.
 */
const LIMIT = 30;
const str = { type: "string" } as const;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "find_maintenance",
    description: "점검 이력 찾기. 설비 이름·작업 내용·작업자 글자, 작업일 범위로",
    input_schema: { type: "object", properties: { keyword: str, device: str, from: str, to: str } },
  },
  {
    name: "find_devices",
    description: "설비 찾기. 설비명·건물 글자로",
    input_schema: { type: "object", properties: { keyword: str } },
  },
  {
    name: "find_recipients",
    description: "알림 수신자 찾기. 이름 글자로. 받는 곳(번호·메일)은 돌려주지 않는다",
    input_schema: { type: "object", properties: { keyword: str } },
  },
];

const like = (s: unknown) => (typeof s === "string" && s.trim() ? `%${s.trim()}%` : null);
const day = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

async function runTool(name: string, a: Record<string, unknown>): Promise<unknown> {
  if (name === "find_maintenance") {
    return query(
      `SELECT id, unit, to_char(work_date, 'YYYY-MM-DD') AS work_date, kind, title, detail, worker,
              to_char(next_due, 'YYYY-MM-DD') AS next_due
         FROM maintenance_logs
        WHERE ($1::text IS NULL OR concat_ws(' ', title, detail, worker) ILIKE $1)
          AND ($2::text IS NULL OR unit ILIKE $2)
          AND ($3::date IS NULL OR work_date >= $3) AND ($4::date IS NULL OR work_date <= $4)
        ORDER BY work_date DESC, id DESC LIMIT ${LIMIT}`,
      [like(a.keyword), like(a.device), day(a.from), day(a.to)]
    );
  }
  if (name === "find_devices") {
    return query(
      `SELECT device_id AS id, name, building, capacity FROM devices
        WHERE ($1::text IS NULL OR concat_ws(' ', name, building) ILIKE $1)
        ORDER BY sort_order, device_id LIMIT ${LIMIT}`,
      [like(a.keyword)]
    );
  }
  if (name === "find_recipients") {
    return query(
      `SELECT id, name, channel, memo FROM notify_recipients
        WHERE ($1::text IS NULL OR name ILIKE $1) ORDER BY name LIMIT ${LIMIT}`,
      [like(a.keyword)]
    );
  }
  return { error: `모르는 도구: ${name}` };
}

const FIX_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["update"] },
    entity: { type: "string", enum: Object.keys(ENTITIES) },
    id: { type: "string", description: "찾기 결과의 id 그대로" },
    set: { type: "object", description: "칸 이름 → 새 값(날짜 YYYY-MM-DD, 글, 비우려면 null)" },
    reason: { type: "string", description: "이 정정을 하는 까닭 한 줄" },
  },
  required: ["type", "entity", "id", "set", "reason"],
};

const RULES = [
  `정정 종류는 update(정해진 칸 고치기) 하나뿐이다. 고칠 수 있는 칸: ${entitiesText(ENTITIES)}.`,
  "계측값·알람 이력·임계치·장비 명령·수집 설정·계정·알림 받는 곳은 정정할 수 없다. 그런 요청이면 fixes 를 비우고 note 에 «화면에서 사람이 처리 필요» 와 까닭을 쓴다.",
];

export async function proposeFixes(
  requestId: number
): Promise<{ ok: boolean; count?: number; note?: string; error?: string }> {
  const r = await one<{ title: string; body: string; analysis: unknown }>(
    `SELECT title, body, analysis FROM cs_requests WHERE id = $1`,
    [requestId]
  );
  if (!r) return { ok: false, error: "없는 요청입니다." };
  const talk = await query<{ action: string; note: string }>(
    `SELECT action, note FROM cs_events
      WHERE request_id = $1 AND action IN ('COMMENT', 'NEEDS_INFO') AND note IS NOT NULL ORDER BY id`,
    [requestId]
  );
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "AI가 설정되지 않았습니다(ANTHROPIC_API_KEY)." };

  const request = [
    `<요청 제목>${r.title}</요청 제목>`,
    `<요청 내용>\n${r.body}\n</요청 내용>`,
    talk.length
      ? `<이어진 대화>\n${talk.map((t) => `${t.action === "NEEDS_INFO" ? "관리자" : "요청자"}: ${t.note}`).join("\n")}\n</이어진 대화>`
      : "",
    r.analysis ? `<AI 분석>\n${JSON.stringify(r.analysis)}\n</AI 분석>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const out = await proposeWithTools<FixOp>({
    apiKey,
    model: csModel(),
    appName: "DH 스마트파워 변압기 통합 모니터링",
    rules: RULES,
    tools: TOOLS,
    fixSchema: FIX_SCHEMA,
    runTool,
    request,
  });
  if (!out.ok) return { ok: false, error: out.error };
  const count = await saveProposals(requestId, out.ops);
  return { ok: true, count, note: out.note };
}
