import { requireAdmin } from "@/lib/auth";
import { execute } from "@/lib/db";
import { bad, fail, ok } from "@/lib/cs/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 위험 낮음 자동 처리 켜고 끄기입니다. 관리자만 바꿉니다. */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) return bad("관리자만 바꿀 수 있습니다.", 403);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const pick = (k: string) => (typeof b[k] === "boolean" ? b[k] : null);
    const [d, p, dp] = [pick("autoDataLow"), pick("autoProgramLow"), pick("autoDeployLow")];
    if (d === null && p === null && dp === null) return bad("바꿀 것이 없습니다.");
    await execute(
      `UPDATE cs_settings
          SET auto_data_low = COALESCE($1, auto_data_low), auto_program_low = COALESCE($2, auto_program_low),
              auto_deploy_low = COALESCE($3, auto_deploy_low), updated_by = $4, updated_at = now()
        WHERE id = 1`,
      [d, p, dp, admin.id]
    );
    return ok({ message: "바꿨습니다." });
  } catch (e) {
    return fail(e);
  }
}
