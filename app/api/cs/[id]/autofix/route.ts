import { requireAdmin } from "@/lib/auth";
import { one } from "@/lib/db";
import { approveAutofix, closeAutofix, retryDeploy, startAutofix } from "@/lib/cs/autofix";
import { bad, fail, ok, toId } from "@/lib/cs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MESSAGE: Record<string, string> = {
  start: "자동 수정을 보냈습니다.",
  approve: "PR 을 합쳤습니다. 곧 배포를 시작합니다.",
  redeploy: "다시 배포합니다.",
  close: "닫았습니다.",
};

/** 프로그램 자동 수정입니다. 관리자만 보내기·PR 합치고 배포·다시 배포·닫기를 합니다. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin();
    if (!admin) return bad("자동 수정은 관리자만 할 수 있습니다.", 403);
    const id = toId(params.id);
    if (!(await one(`SELECT 1 FROM cs_requests WHERE id = $1`, [id]))) return bad("없는 요청입니다.", 404);
    const b = (await req.json().catch(() => ({}))) as { action?: unknown; jobId?: unknown };
    const jobId = toId(b.jobId);
    if (b.action !== "start" && !(await one(`SELECT 1 FROM autofix_jobs WHERE id = $1 AND request_id = $2`, [jobId, id]))) {
      return bad("없는 작업입니다.", 404);
    }
    const r =
      b.action === "start"
        ? await startAutofix(id, admin.id)
        : b.action === "approve"
          ? await approveAutofix(jobId, admin.id)
          : b.action === "redeploy"
            ? await retryDeploy(jobId, admin.id)
            : b.action === "close"
              ? await closeAutofix(jobId, admin.id)
              : { err: "모르는 처리입니다." };
    if (r.err) return bad(r.err);
    return ok({ message: MESSAGE[b.action as string] });
  } catch (e) {
    return fail(e);
  }
}
