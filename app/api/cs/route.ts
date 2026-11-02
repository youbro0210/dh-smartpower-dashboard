import { getSessionUser } from "@/lib/auth";
import { one, transaction } from "@/lib/db";
import { autoHandle } from "@/lib/cs/auto";
import { isAdminScreen } from "@/lib/cs/catalog";
import { analyzeCs, KIND_LABEL, notifyCs } from "@/lib/cs/engine";
import { bad, fail, ok } from "@/lib/cs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
// AI 호출 비용이 새지 않도록 계정당 접수를 제한합니다.
const MAX_PER_HOUR = 10;

/** 메뉴 건수입니다. 관리자는 처리할 요청, 그 밖의 계정은 답할 보완 요청입니다. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return bad("로그인이 필요합니다.", 401);
    const row =
      user.tier === "admin"
        ? await one<{ count: number }>(`SELECT count(*)::int AS count FROM cs_requests WHERE status IN ('RECEIVED', 'ANALYZED', 'APPROVED')`)
        : await one<{ count: number }>(`SELECT count(*)::int AS count FROM cs_requests WHERE status = 'NEEDS_INFO' AND created_by = $1`, [user.id]);
    const signups =
      user.tier === "admin"
        ? await one<{ count: number }>(`SELECT count(*)::int AS count FROM users WHERE approval = 'pending'`)
        : null;
    return ok({ count: row?.count ?? 0, pendingSignups: signups?.count ?? 0 });
  } catch (e) {
    return fail(e);
  }
}

/** 요청 접수입니다. 접수는 바로 끝내고 AI 분석과 위험 낮음 자동 처리는 뒤에서 돌립니다. */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return bad("로그인이 필요합니다.", 401);

    const recent = await one<{ count: number }>(
      `SELECT count(*)::int AS count FROM cs_requests WHERE created_by = $1 AND created_at > now() - interval '1 hour'`,
      [user.id]
    );
    if ((recent?.count ?? 0) >= MAX_PER_HOUR) return bad("요청이 많습니다. 잠시 후 다시 접수하세요.", 429);

    const f = await req.formData();
    const body = String(f.get("body") ?? "").trim().slice(0, 5000);
    if (!body) return bad("내용을 적으세요.");
    const title = (String(f.get("title") ?? "").trim() || body.split("\n")[0].trim().slice(0, 40)).slice(0, 120);
    const kindHint = String(f.get("kind") ?? "");
    const kind = ["DATA", "PROGRAM", "QUESTION", "OTHER"].includes(kindHint) ? kindHint : null;
    const pageIn = String(f.get("page") ?? "").trim().slice(0, 300);
    const page = pageIn.startsWith("/") && !pageIn.startsWith("//") && !isAdminScreen(pageIn) ? pageIn : null;

    const files = f
      .getAll("files")
      .filter((x): x is File => x instanceof File && x.size > 0)
      .slice(0, MAX_FILES);
    for (const x of files) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(x.type)) return bad(`사진만 붙일 수 있습니다(${x.name}).`);
      if (x.size > MAX_BYTES) return bad(`사진은 한 장에 5MB 까지입니다(${x.name}).`);
    }
    const images = await Promise.all(
      files.map(async (x) => ({ name: x.name.slice(0, 200), mime: x.type, data: Buffer.from(await x.arrayBuffer()) }))
    );

    const id = await transaction(async (run) => {
      const rows = (await run(
        `INSERT INTO cs_requests (created_by, title, body, page_url, kind) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [user.id, title, body, page, kind]
      )) as { id: number }[];
      const newId = rows[0].id;
      for (const x of images) {
        await run(`INSERT INTO cs_files (request_id, name, mime, data) VALUES ($1, $2, $3, $4)`, [newId, x.name, x.mime, x.data]);
      }
      await run(`INSERT INTO cs_events (request_id, user_id, action) VALUES ($1, $2, 'RECEIVED')`, [newId, user.id]);
      return newId;
    });

    const who = user.full_name || user.email;
    void analyzeCs(id)
      .then(async (a) => {
        const done = a.ok ? await autoHandle(id).catch((e) => (console.error("[CS 자동 처리]", e), null)) : null;
        if (done === "applied") return;
        const k = await one<{ kind: string | null }>(`SELECT kind FROM cs_requests WHERE id = $1`, [id]);
        await notifyCs(
          id,
          "admins",
          `[DH CS] 새 요청 #${id} · ${who}\n${title}${
            a.ok && k?.kind
              ? `\nAI 분석: ${KIND_LABEL[k.kind]}${done === "autofix" ? " · 위험 낮음 — 자동 수정 보냄" : ""}`
              : "\nAI 분석 실패 — 화면에서 다시 분석"
          }`
        );
      })
      .catch((e) => console.error("[CS 분석]", e));

    return ok({ id, message: `접수했습니다(#${id}). AI가 분석하고 있습니다.` });
  } catch (e) {
    return fail(e);
  }
}
