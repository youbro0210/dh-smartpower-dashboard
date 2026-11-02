import { getSessionUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { toId } from "@/lib/cs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CS 요청 첨부 사진입니다. 요청자 본인과 관리자만 봅니다. */
export async function GET(_: Request, { params }: { params: { fid: string } }) {
  const user = await getSessionUser();
  if (!user) return new Response("로그인이 필요합니다.", { status: 401 });
  const f = await one<{ mime: string; data: Buffer; owner: string | null }>(
    `SELECT f.mime, f.data, c.created_by AS owner FROM cs_files f JOIN cs_requests c ON c.id = f.request_id WHERE f.id = $1`,
    [toId(params.fid)]
  );
  if (!f || (f.owner !== user.id && user.tier !== "admin")) return new Response("없습니다.", { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: { "content-type": f.mime, "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600" },
  });
}
