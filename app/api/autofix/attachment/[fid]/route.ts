import { one } from "@/lib/db";
import { attachmentOk } from "@/lib/cs/autofix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GitHub Actions 가 요청 사진을 받는 곳입니다. 서명(작업·파일·만료)을 확인하고 그 작업의 사진만 줍니다. */
export async function GET(req: Request, { params }: { params: { fid: string } }) {
  const fid = Number(params.fid) || 0;
  const u = new URL(req.url);
  const job = u.searchParams.get("job") ?? "";
  const exp = Number(u.searchParams.get("exp"));
  if (!fid || !attachmentOk(job, fid, exp, u.searchParams.get("sig"))) {
    return new Response("권한이 없습니다.", { status: 401 });
  }
  const f = await one<{ mime: string; data: Buffer }>(
    `SELECT f.mime, f.data FROM cs_files f JOIN autofix_jobs j ON j.request_id = f.request_id
      WHERE f.id = $1 AND j.job_id = $2 AND j.status IN ('QUEUED', 'RUNNING')`,
    [fid, job]
  );
  if (!f) return new Response("없는 파일입니다.", { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: { "content-type": f.mime, "x-content-type-options": "nosniff", "cache-control": "no-store" },
  });
}
