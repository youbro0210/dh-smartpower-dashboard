import { requireAdmin } from "@/lib/auth";
import { execute, one, query } from "@/lib/db";
import { addEvent, notifyCs } from "@/lib/cs/engine";
import { applyFixes, undoFix } from "@/lib/cs/fixes";
import { bad, fail, ok, toId } from "@/lib/cs/http";
import { proposeFixes } from "@/lib/cs/propose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 데이터 정정입니다. 관리자만 정정안 만들기·반영·되돌리기를 합니다. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin();
    if (!admin) return bad("데이터 정정은 관리자만 할 수 있습니다.", 403);
    const id = toId(params.id);
    const r = await one<{ status: string; title: string }>(`SELECT status, title FROM cs_requests WHERE id = $1`, [id]);
    if (!r) return bad("없는 요청입니다.", 404);
    const b = (await req.json().catch(() => ({}))) as { action?: unknown; ids?: unknown; fixId?: unknown };
    const closed = ["DONE", "REJECTED"].includes(r.status);

    if (b.action === "propose") {
      if (closed) return bad("닫힌 요청입니다.");
      const p = await proposeFixes(id);
      if (!p.ok) return bad(p.error ?? "정정안을 만들지 못했습니다.");
      await addEvent(id, admin.id, "FIX_PROPOSED", `정정안 ${p.count}건${p.note ? ` — ${p.note}` : ""}`);
      return ok({ message: p.count ? `정정안 ${p.count}건을 만들었습니다.` : `정정안이 없습니다${p.note ? ` — ${p.note}` : "."}` });
    }

    if (b.action === "apply") {
      if (closed) return bad("닫힌 요청입니다.");
      const ids = Array.isArray(b.ids) ? b.ids.map(toId).filter(Boolean) : [];
      if (!ids.length) return bad("반영할 정정을 고르세요.");
      const a = await applyFixes(id, ids, admin.id);
      if ("err" in a) return bad(a.err);
      const labels = await query<{ label: string }>(
        `SELECT label FROM cs_fixes WHERE request_id = $1 AND id = ANY($2::bigint[]) ORDER BY id`,
        [id, ids]
      );
      const note = `데이터 정정 ${a.applied}건 반영\n${labels.map((l) => `· ${l.label}`).join("\n")}`;
      await execute(
        `UPDATE cs_requests SET status = 'DONE', decided_by = $2, decided_at = now(), done_note = $3, updated_at = now() WHERE id = $1`,
        [id, admin.id, note]
      );
      await addEvent(id, admin.id, "DONE", note);
      await notifyCs(id, "requester", `[DH CS] #${id} 반영 완료 · ${r.title}\n${note}`);
      return ok({ message: `${a.applied}건을 반영했습니다.` });
    }

    if (b.action === "undo") {
      const u = await undoFix(id, toId(b.fixId), admin.id);
      if ("err" in u) return bad(u.err);
      await execute(`UPDATE cs_requests SET status = 'APPROVED', updated_at = now() WHERE id = $1 AND status = 'DONE'`, [id]);
      await addEvent(id, admin.id, "FIX_UNDONE", u.label);
      return ok({ message: "되돌렸습니다." });
    }
    return bad("모르는 처리입니다.");
  } catch (e) {
    return fail(e);
  }
}
