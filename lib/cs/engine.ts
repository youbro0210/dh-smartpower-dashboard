import "server-only";
import { analyzeRequest, type AnalyzeContext, type CsAnalysis } from "@/cs-engine/analyze";
import { KIND_LABEL as K, RISK_LABEL as R, STATUS_LABEL as S, type CsKind } from "@/cs-engine/types";
import { execute, one, query } from "@/lib/db";
import { sendVia } from "@/lib/notify/providers";
import type { ChannelConfig } from "@/lib/notify/types";
import { HOWTO, SCREENS } from "./catalog";

/**
 * CS 요청 분석과 알림입니다. 분석은 무슨 일인지와 처리안만 정리하고 고치지 않습니다.
 * 요청 글과 사진 속 글은 자료로만 다룹니다(cs-engine/analyze 의 규칙).
 */
export const csEnabled = () => !!process.env.ANTHROPIC_API_KEY?.trim();
export const csModel = () => process.env.AI_CS_MODEL?.trim() || "claude-sonnet-5-5";

export type { CsAnalysis } from "@/cs-engine/analyze";
export const KIND_LABEL = K as Record<string, string>;
export const RISK_LABEL = R as Record<string, string>;
export const STATUS_LABEL = S as Record<string, string>;

const CTX: AnalyzeContext = {
  appName: "DH 스마트파워 변압기 통합 모니터링",
  screens: SCREENS,
  howto: HOWTO,
  rules: [
    "업무 용어는 요청자가 쓴 말 그대로 쓴다(설비·호기·수소·메탄·유면·임계치·주의·경고·위험·통신단절 등). 쉬운 말로 바꾸지 않는다.",
    "임계치·알람 판정·계측값·알람 이력·장비 제어·수집기·MQTT·알림 수신처·권한·로그인을 바꾸는 일은 risk HIGH, automatable false.",
    "관리 메뉴(주소 /settings·/admin·/login-history)나 메뉴 구성을 바꾸는 프로그램 수정은 risk HIGH, automatable false(자동 수정하지 않는다).",
    "설비명·건물·용량을 바꾸는 일은 현장이 설비를 찾는 근거이므로 risk MEDIUM 이상.",
    "문체는 사내 업무 문서 개조식(«~함», «~필요»).",
  ],
};

export const addEvent = (requestId: number, userId: string | null, action: string, note: string | null) =>
  execute(`INSERT INTO cs_events (request_id, user_id, action, note) VALUES ($1, $2, $3, $4)`, [
    requestId,
    userId,
    action,
    note,
  ]);

/** 요청 한 건을 분석해 저장하고 ANALYZED 로 넘깁니다. 실패하면 까닭을 남기고 상태는 그대로 둡니다. */
export async function analyzeCs(id: number): Promise<{ ok: boolean; error?: string }> {
  const r = await one<{
    title: string;
    body: string;
    page_url: string | null;
    who: string;
    tier: string | null;
    at: string;
    kind: string | null;
  }>(
    `SELECT c.title, c.body, c.page_url, c.kind, COALESCE(u.full_name, u.email, '') AS who, u.tier,
            to_char(c.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at
       FROM cs_requests c LEFT JOIN users u ON u.id = c.created_by
      WHERE c.id = $1`,
    [id]
  );
  if (!r) return { ok: false, error: "없는 요청입니다." };

  const files = await query<{ mime: string; data: Buffer }>(
    `SELECT mime, data FROM cs_files WHERE request_id = $1 ORDER BY id LIMIT 3`,
    [id]
  );
  const events = await query<{ action: string; note: string | null }>(
    `SELECT action, note FROM cs_events
      WHERE request_id = $1 AND action IN ('COMMENT', 'NEEDS_INFO') AND note IS NOT NULL ORDER BY id`,
    [id]
  );

  let analysis: CsAnalysis | null = null;
  let error: string | null = null;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    error = "AI가 설정되지 않았습니다(ANTHROPIC_API_KEY).";
  } else {
    const out = await analyzeRequest({
      apiKey,
      model: csModel(),
      ctx: CTX,
      kindLabel: (k) => KIND_LABEL[k as CsKind] ?? k,
      input: {
        title: r.title,
        body: r.body,
        pageUrl: r.page_url,
        who: `${r.who}${r.tier ? `(${r.tier})` : ""}`,
        at: r.at,
        kindHint: r.kind,
        talk: events.map((e) => ({
          from: e.action === "NEEDS_INFO" ? ("admin" as const) : ("requester" as const),
          note: e.note ?? "",
        })),
        images: files.map((f) => ({ mime: f.mime, base64: f.data.toString("base64") })),
      },
    });
    if ("analysis" in out) analysis = out.analysis;
    else error = out.error;
  }

  await execute(
    `UPDATE cs_requests
        SET analysis = COALESCE($2::jsonb, analysis), kind = COALESCE($3, kind), analysis_error = $4, analyzed_at = now(),
            status = CASE WHEN $2::jsonb IS NOT NULL AND status IN ('RECEIVED', 'NEEDS_INFO') THEN 'ANALYZED' ELSE status END,
            updated_at = now()
      WHERE id = $1`,
    [id, analysis ? JSON.stringify(analysis) : null, analysis?.kind ?? null, error]
  );
  await addEvent(
    id,
    null,
    analysis ? "ANALYZED" : "ANALYZE_FAIL",
    analysis ? `${KIND_LABEL[analysis.kind]} · 위험 ${RISK_LABEL[analysis.risk]}` : error
  );
  return analysis ? { ok: true } : { ok: false, error: error ?? "분석 실패" };
}

/**
 * 알림입니다. 새 요청은 관리자에게, 상태 변화는 요청자에게 메일로 보냅니다.
 * 여각은 계정마다 텔레그램이 묶여 있지만 DH 계정에는 메일만 있어 설정 › 알림 발송의 메일 경로를 씁니다.
 * 메일이 꺼져 있으면 메뉴 건수로만 드러납니다. 발송 실패가 본 처리를 막지 않고, 결과는 notify_log 에 남습니다.
 */
export async function notifyCs(id: number, to: "admins" | "requester", text: string) {
  let sent = 0;
  try {
    const base = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
    const body = base ? `${text}\n${base}/cs?id=${id}` : text;
    const subject = text.split("\n")[0].slice(0, 120);
    const channel = await one<{ enabled: boolean; config: ChannelConfig }>(
      `SELECT enabled, config FROM notify_channels WHERE channel = 'email'`
    );
    const rows = channel?.enabled
      ? await query<{ email: string; name: string }>(
          to === "admins"
            ? `SELECT email, COALESCE(full_name, email) AS name FROM users WHERE tier = 'admin' AND is_active`
            : `SELECT u.email, COALESCE(u.full_name, u.email) AS name
                 FROM cs_requests c JOIN users u ON u.id = c.created_by
                WHERE c.id = $1 AND u.is_active`,
          to === "admins" ? [] : [id]
        )
      : [];
    for (const r of rows) {
      const result = await sendVia("email", channel!.config, r.email, body, subject);
      if (result.ok) sent += 1;
      await execute(
        `INSERT INTO notify_log (recipient, channel, target, body, status, error, provider_id)
         VALUES ($1, 'email', $2, $3, $4, $5, $6)`,
        [r.name, r.email, body, result.ok ? "sent" : "failed", result.error ?? null, result.providerId ?? null]
      );
    }
  } catch (err) {
    console.error("[CS 알림]", err);
  }
  if (to === "requester") {
    await addEvent(
      id,
      null,
      sent ? "NOTIFIED" : "NOTIFY_NONE",
      sent ? "요청자 메일" : "메일 미발송 — 반영 확인 화면으로 확인"
    );
  }
}
