import { getSessionUser } from "@/lib/auth";
import { execute, one } from "@/lib/db";
import { afterApprove, autoHandle } from "@/lib/cs/auto";
import { addEvent, analyzeCs, notifyCs, STATUS_LABEL } from "@/lib/cs/engine";
import { bad, fail, ok, toId } from "@/lib/cs/http";
import { TRANSITIONS } from "@/cs-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CS 요청 처리입니다.
 * 관리자: 승인·반려·보완 요청·반영 완료·다시 분석. 요청자·관리자: 댓글.
 * 보완 요청에 요청자가 답하면 다시 분석하고 위험 낮음이면 다시 자동으로 진행합니다.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return bad("로그인이 필요합니다.", 401);
    const admin = user.tier === "admin";
    const id = toId(params.id);
    const r = await one<{ status: string; created_by: string | null; title: string }>(
      `SELECT status, created_by, title FROM cs_requests WHERE id = $1`,
      [id]
    );
    if (!r) return bad("없는 요청입니다.", 404);
    const b = (await req.json().catch(() => ({}))) as { action?: unknown; note?: unknown };
    const action = String(b.action ?? "");
    const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 3000) : null;

    if (action === "comment") {
      if (!admin && r.created_by !== user.id) return bad("내 요청에만 댓글을 달 수 있습니다.", 403);
      if (!note) return bad("내용을 적으세요.");
      await addEvent(id, user.id, "COMMENT", note);
      if (r.status === "NEEDS_INFO" && r.created_by === user.id) {
        await execute(`UPDATE cs_requests SET status = 'RECEIVED', updated_at = now() WHERE id = $1`, [id]);
        void analyzeCs(id)
          .then(async (a) => {
            const done = a.ok ? await autoHandle(id).catch(() => null) : null;
            if (done !== "applied") await notifyCs(id, "admins", `[DH CS] #${id} 보완 답변 · ${r.title}`);
          })
          .catch((e) => console.error("[CS 분석]", e));
        return ok({ message: "답했습니다. AI가 다시 분석합니다." });
      }
      return ok({ message: "댓글을 남겼습니다." });
    }

    if (!admin) return bad("관리자만 처리할 수 있습니다.", 403);

    if (action === "reanalyze") {
      const a = await analyzeCs(id);
      return a.ok ? ok({ message: "다시 분석했습니다." }) : bad(a.error ?? "분석하지 못했습니다.");
    }

    const n = Object.prototype.hasOwnProperty.call(TRANSITIONS, action)
      ? TRANSITIONS[action as keyof typeof TRANSITIONS]
      : null;
    if (!n) return bad("모르는 처리입니다.");
    if (!n.from.includes(r.status as never)) {
      return bad(`«${STATUS_LABEL[r.status]}» 상태에서는 ${n.label}할 수 없습니다.`);
    }
    if (n.needNote && !note) return bad(`${n.label} 까닭을 적으세요.`);

    await execute(
      `UPDATE cs_requests
          SET status = $2, decided_by = $3, decided_at = now(),
              done_note = CASE WHEN $2 = 'DONE' THEN $4 ELSE done_note END, updated_at = now()
        WHERE id = $1`,
      [id, n.to, user.id, note]
    );
    await addEvent(id, user.id, n.to, note);
    await notifyCs(id, "requester", `[DH CS] #${id} ${n.label} · ${r.title}${note ? `\n${note}` : ""}`);

    if (action === "approve") {
      const next = await afterApprove(id, user.id).catch(() => null);
      if (next === "autofix") return ok({ message: "승인했습니다. 자동 수정을 보냈습니다." });
      if (next === "dev") return ok({ message: "승인했습니다. 자동 수정을 보낼 수 없어 개발 수정 대기로 두었습니다." });
    }
    return ok({ message: `${n.label}했습니다.` });
  } catch (e) {
    return fail(e);
  }
}
