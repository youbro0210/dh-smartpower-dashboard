import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createAutofixClient, type AutofixClient } from "@/autofix/client";
import {
  NEXT_STATUS,
  STATUS_LABEL,
  type AutofixCheck,
  type AutofixEvent,
  type AutofixJob,
  type AutofixStatus,
} from "@/autofix/protocol";
import { canAutoMerge } from "@/cs-engine/policy";
import { execute, one, query } from "@/lib/db";
import { isAdminScreen } from "./catalog";
import { addEvent, notifyCs, type CsAnalysis } from "./engine";

/**
 * CS 요청과 autofix 엔진(autofix/)을 잇는 어댑터입니다.
 * 환경변수: AUTOFIX_REPO(owner/name) · AUTOFIX_GITHUB_TOKEN · AUTOFIX_SECRET · PUBLIC_BASE_URL(https)
 * 네 값이 없으면 자동 수정은 꺼져 있고, 프로그램 수정 요청은 개발 수정 대기로 남습니다.
 */
const env = (k: string) => process.env[k]?.trim() || "";
export const autofixEnabled = () =>
  !!(env("AUTOFIX_REPO") && env("AUTOFIX_GITHUB_TOKEN") && env("AUTOFIX_SECRET") && /^https:\/\//.test(env("PUBLIC_BASE_URL")));
const client = (): AutofixClient =>
  createAutofixClient({
    repo: env("AUTOFIX_REPO"),
    githubToken: env("AUTOFIX_GITHUB_TOKEN"),
    secret: env("AUTOFIX_SECRET"),
    apiBase: env("AUTOFIX_API_BASE") || undefined,
  });
export { STATUS_LABEL as AUTOFIX_STATUS_LABEL };

export interface AutofixRow {
  id: number;
  job_id: string;
  status: AutofixStatus;
  run_url: string | null;
  pr_number: number | null;
  pr_url: string | null;
  summary: string | null;
  files: string[] | null;
  checks: AutofixCheck[] | null;
  error: string | null;
  at: string;
}

export const jobsOf = (requestId: number) =>
  query<AutofixRow>(
    `SELECT id, job_id, status, run_url, pr_number, pr_url, summary, files, checks, error,
            to_char(updated_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS at
       FROM autofix_jobs WHERE request_id = $1 ORDER BY id`,
    [requestId]
  );

export const OPEN_JOB = ["QUEUED", "RUNNING", "PR_OPENED", "APPROVED", "DEPLOYING", "DEPLOY_FAILED"];

function jobBody(r: { body: string; analysis: CsAnalysis | null }, talk: string[]): string {
  const a = r.analysis;
  return [
    r.body,
    talk.length ? `\n[이어진 대화]\n${talk.join("\n")}` : "",
    a ? `\n[CS 분석]\n요약: ${a.summary}\n대상: ${a.target}\n처리안:\n${a.plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : "",
    a?.questions.length
      ? `\n[확실하지 않은 것 — 저장소·화면을 보고 알맞게 정하고, 무엇으로 정했는지 요약에 쓴다. 정할 수 없으면 고치지 말고 무엇이 필요한지 쓴다]\n${a.questions.map((x) => `- ${x}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** opts.auto 는 위험 낮음으로 자동으로 보낸 작업입니다. 이 작업만 자동 합치기 대상이 됩니다. */
export async function startAutofix(requestId: number, userId: string | null, opts: { auto?: boolean } = {}): Promise<{ err?: string }> {
  if (!autofixEnabled()) return { err: "자동 수정이 설정되지 않았습니다." };
  const r = await one<{ title: string; body: string; page_url: string | null; status: string; kind: string | null; analysis: CsAnalysis | null }>(
    `SELECT title, body, page_url, status, kind, analysis FROM cs_requests WHERE id = $1`,
    [requestId]
  );
  if (!r) return { err: "없는 요청입니다." };
  if (!["ANALYZED", "APPROVED"].includes(r.status)) return { err: "분석·승인된 요청만 보낼 수 있습니다." };
  if (r.kind !== "PROGRAM") return { err: "프로그램 수정 요청만 보낼 수 있습니다." };
  if (isAdminScreen(r.analysis?.screen) || isAdminScreen(r.page_url)) return { err: "관리 메뉴 화면은 자동 수정하지 않습니다." };
  if (await one(`SELECT 1 FROM autofix_jobs WHERE request_id = $1 AND status = ANY($2)`, [requestId, OPEN_JOB])) {
    return { err: "진행 중인 자동 수정이 있습니다." };
  }

  const talk = (
    await query<{ action: string; note: string }>(
      `SELECT action, note FROM cs_events
        WHERE request_id = $1 AND action IN ('COMMENT', 'NEEDS_INFO', 'APPROVED') AND note IS NOT NULL ORDER BY id`,
      [requestId]
    )
  ).map((e) => `${e.action === "NEEDS_INFO" ? "관리자 질문" : e.action === "APPROVED" ? "관리자 지시" : "댓글"}: ${e.note}`);

  const jobId = `cs${requestId}-${randomBytes(3).toString("hex")}`;
  const exp = Math.floor(Date.now() / 1000) + 3 * 3600;
  const base = env("PUBLIC_BASE_URL").replace(/\/$/, "");
  const files = await query<{ id: number; name: string }>(`SELECT id, name FROM cs_files WHERE request_id = $1 ORDER BY id`, [requestId]);
  const job: AutofixJob = {
    job_id: jobId,
    attachments: files.map((f) => ({
      name: f.name.replace(/[^\p{L}\p{N}._-]/gu, "_"),
      url: `${base}/api/autofix/attachment/${f.id}?job=${jobId}&exp=${exp}&sig=${client().attachmentSig(jobId, f.id, exp)}`,
    })),
    source: `DH CS #${requestId}`,
    title: r.analysis?.title || r.title,
    body: jobBody(r, talk),
    screen: r.analysis?.screen || r.page_url || undefined,
    callback_url: `${base}/api/autofix/callback`,
  };
  await execute(`INSERT INTO autofix_jobs (job_id, request_id, created_by, auto) VALUES ($1, $2, $3, $4)`, [jobId, requestId, userId, !!opts.auto]);
  try {
    await client().dispatch(job);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await execute(`UPDATE autofix_jobs SET status = 'FAILED', error = $2, updated_at = now() WHERE job_id = $1`, [jobId, m]);
    await addEvent(requestId, userId, "AUTOFIX_FAIL", m);
    return { err: "GitHub 로 보내지 못했습니다." };
  }
  await execute(
    `UPDATE cs_requests SET status = 'APPROVED', decided_by = COALESCE(decided_by, $2), decided_at = COALESCE(decided_at, now()), updated_at = now()
      WHERE id = $1 AND status = 'ANALYZED'`,
    [requestId, userId]
  );
  await addEvent(requestId, userId, "AUTOFIX_SENT", null);
  return {};
}

/** 늦게 오거나 두 번 온 알림이 상태를 뒤로 돌리지 않도록, 받을 수 있는 앞 상태를 정해 둡니다. */
const FROM: Record<AutofixEvent["event"], AutofixStatus[]> = {
  started: ["QUEUED"],
  pr_opened: ["QUEUED", "RUNNING"],
  no_change: ["QUEUED", "RUNNING"],
  failed: ["QUEUED", "RUNNING"],
  deploy_started: ["APPROVED", "DEPLOYING"],
  deployed: ["APPROVED", "DEPLOYING"],
  deploy_failed: ["APPROVED", "DEPLOYING"],
};
const ACTION: Record<AutofixEvent["event"], string> = {
  started: "AUTOFIX_STARTED",
  pr_opened: "AUTOFIX_PR",
  no_change: "AUTOFIX_NOCHANGE",
  failed: "AUTOFIX_FAIL",
  deploy_started: "AUTOFIX_DEPLOYING",
  deployed: "AUTOFIX_DEPLOYED",
  deploy_failed: "AUTOFIX_DEPLOY_FAIL",
};

const secretOn = () => env("AUTOFIX_SECRET").length >= 32;
const verifier = () => createAutofixClient({ repo: "-", githubToken: "-", secret: env("AUTOFIX_SECRET") });
export const attachmentOk = (job: string, fid: number, exp: number, sig: string | null) =>
  secretOn() && verifier().attachmentOk(job, fid, exp, sig);
export const verifyCallback = (raw: string, sig: string | null) => secretOn() && verifier().verify(raw, sig);

export async function onAutofixEvent(e: AutofixEvent): Promise<{ err?: string }> {
  const j = await one<{ id: number; request_id: number | null; status: AutofixStatus; auto: boolean }>(
    `SELECT id, request_id, status, auto FROM autofix_jobs WHERE job_id = $1`,
    [e.job_id]
  );
  if (!j) return { err: "없는 작업" };
  if (!FROM[e.event]?.includes(j.status)) return {};

  const failedChecks = (e.checks ?? []).filter((c) => !c.ok).map((c) => c.name);
  await execute(
    `UPDATE autofix_jobs
        SET status = $2, run_url = COALESCE($3, run_url), branch = COALESCE($4, branch), pr_number = COALESCE($5, pr_number),
            pr_url = COALESCE($6, pr_url), summary = COALESCE($7, summary), files = COALESCE($8, files), checks = COALESCE($9, checks),
            commit = COALESCE($10, commit), error = $11, updated_at = now()
      WHERE job_id = $1`,
    [
      e.job_id,
      NEXT_STATUS[e.event],
      e.run_url ?? null,
      e.branch ?? null,
      e.pr_number ?? null,
      e.pr_url ?? null,
      e.summary?.trim() || null,
      e.files ? JSON.stringify(e.files) : null,
      e.checks ? JSON.stringify(e.checks) : null,
      e.commit ?? null,
      e.error?.slice(0, 2000) ?? null,
    ]
  );
  if (!j.request_id) return {};

  const rid = j.request_id;
  const head = (e.summary ?? "").trim().split("\n")[0];
  const note =
    e.event === "pr_opened"
      ? `${head}${failedChecks.length ? `\n검사 실패: ${failedChecks.join(", ")}` : "\n검사 통과"}`
      : e.event === "no_change"
        ? head || null
        : e.event === "failed" || e.event === "deploy_failed"
          ? (e.error ?? "").slice(0, 500) || null
          : null;
  await addEvent(rid, null, ACTION[e.event], note);
  const title = (await one<{ title: string }>(`SELECT COALESCE(analysis->>'title', title) AS title FROM cs_requests WHERE id = $1`, [rid]))?.title ?? "";

  if (e.event === "pr_opened") {
    const files = e.files ?? [];
    const setting = await one<{ on: boolean }>(`SELECT auto_deploy_low AS on FROM cs_settings WHERE id = 1`);
    const autoOk = canAutoMerge({ auto: j.auto, setting: setting?.on ?? true, checks: e.checks, files, maxFiles: 5 });
    const merged = autoOk ? await approveAutofix(j.id, null) : null;
    if (merged && !merged.err) {
      await addEvent(rid, null, "AUTO_MERGE", `PR #${e.pr_number} — 위험 낮음·검사 통과·파일 ${files.length}개 → 자동으로 합치고 배포`);
      await notifyCs(rid, "admins", `[DH CS] #${rid} 자동 수정 — 위험 낮음이라 PR 합치고 배포합니다 · ${title}\n${note}\n바뀐 파일: ${files.join(", ")}${e.pr_url ? `\n${e.pr_url}` : ""}`);
    } else {
      if (merged?.err) await addEvent(rid, null, "AUTO_SKIP", `자동 합치기 못 함 — ${merged.err}`);
      await notifyCs(rid, "admins", `[DH CS] #${rid} 자동 수정 검토 대기 · ${title}\n${note}`);
    }
  }
  if (e.event === "no_change" || e.event === "failed" || e.event === "deploy_failed") {
    await notifyCs(rid, "admins", `[DH CS] #${rid} 자동 수정 ${STATUS_LABEL[NEXT_STATUS[e.event]]} · ${title}${note ? `\n${note}` : ""}`);
  }
  if (j.auto && (e.event === "no_change" || e.event === "failed")) {
    const { askRequester } = await import("./auto");
    await askRequester(
      rid,
      title,
      (e.event === "no_change" ? (e.summary ?? "").trim() : `자동 수정이 실패했습니다.\n${(e.error ?? "").slice(0, 300)}`) ||
        "자동 수정에서 고칠 곳을 정하지 못했습니다. 조금 더 자세히 적어 주세요."
    );
  }
  if (e.event === "deployed") {
    const s = await one<{ summary: string | null; pr_url: string | null }>(`SELECT summary, pr_url FROM autofix_jobs WHERE job_id = $1`, [e.job_id]);
    const done = `프로그램 수정 반영\n${(s?.summary ?? "").trim()}${s?.pr_url ? `\n${s.pr_url}` : ""}`.trim();
    await execute(`UPDATE cs_requests SET status = 'DONE', done_note = $2, updated_at = now() WHERE id = $1 AND status = 'APPROVED'`, [rid, done]);
    await addEvent(rid, null, "DONE", head || null);
    await notifyCs(rid, "requester", `[DH CS] #${rid} 반영 완료 · ${title}${head ? `\n${head}` : ""}`);
  }
  return {};
}

/** 검사를 모두 통과한 PR 만 합치고 배포 대기로 둡니다. */
export async function approveAutofix(jobRowId: number, userId: string | null): Promise<{ err?: string }> {
  const j = await one<{ job_id: string; request_id: number | null; status: string; pr_number: number | null; checks: AutofixCheck[] | null; summary: string | null }>(
    `SELECT job_id, request_id, status, pr_number, checks, summary FROM autofix_jobs WHERE id = $1`,
    [jobRowId]
  );
  if (!j) return { err: "없는 작업입니다." };
  if (j.status !== "PR_OPENED" || !j.pr_number) return { err: "검토 대기인 작업만 합칠 수 있습니다." };
  if (!j.checks?.length || j.checks.some((c) => !c.ok)) return { err: "검사를 통과하지 못한 PR 은 합치지 않습니다." };
  try {
    const c = client();
    const pr = await c.pr(j.pr_number);
    if (pr.state !== "open") return { err: "PR 이 열려 있지 않습니다." };
    if (pr.mergeable === false) return { err: "PR 이 main 과 부딪힙니다. 다시 보내세요." };
    const m = await c.mergePr(j.pr_number, `[autofix] ${(j.summary ?? "").split("\n")[0] || j.job_id} (#${j.pr_number})`);
    await execute(
      `UPDATE autofix_jobs SET status = 'APPROVED', merge_commit = $2, decided_by = $3, decided_at = now(), error = NULL, updated_at = now() WHERE id = $1`,
      [jobRowId, m.sha, userId]
    );
  } catch (e) {
    return { err: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
  if (j.request_id) await addEvent(j.request_id, userId, "AUTOFIX_MERGED", `PR #${j.pr_number}`);
  return {};
}

export async function retryDeploy(jobRowId: number, userId: string): Promise<{ err?: string }> {
  const r = await one<{ request_id: number | null }>(
    `UPDATE autofix_jobs SET status = 'APPROVED', decided_at = now(), error = NULL, updated_at = now()
      WHERE id = $1 AND status = 'DEPLOY_FAILED' RETURNING request_id`,
    [jobRowId]
  );
  if (!r) return { err: "배포 실패한 작업만 다시 배포합니다." };
  if (r.request_id) await addEvent(r.request_id, userId, "AUTOFIX_MERGED", "다시 배포");
  return {};
}

export async function closeAutofix(jobRowId: number, userId: string): Promise<{ err?: string }> {
  const j = await one<{ request_id: number | null; status: string; pr_number: number | null }>(
    `SELECT request_id, status, pr_number FROM autofix_jobs WHERE id = $1`,
    [jobRowId]
  );
  if (!j) return { err: "없는 작업입니다." };
  if (!["QUEUED", "RUNNING", "PR_OPENED", "NO_CHANGE", "FAILED"].includes(j.status)) return { err: "합친 작업은 닫지 않습니다." };
  if (j.pr_number && j.status === "PR_OPENED") {
    try {
      await client().closePr(j.pr_number);
    } catch {
      /* PR 이 이미 닫혔어도 작업은 닫습니다. */
    }
  }
  await execute(`UPDATE autofix_jobs SET status = 'CLOSED', decided_by = $2, decided_at = now(), updated_at = now() WHERE id = $1`, [jobRowId, userId]);
  if (j.request_id) await addEvent(j.request_id, userId, "AUTOFIX_CLOSED", null);
  return {};
}

/** 배포기 묻기 서명입니다. HMAC("queue:<초>"), 5분 안만 받습니다. */
export function verifyQueue(ts: string | null, sig: string | null): boolean {
  if (!secretOn() || !ts || !/^\d{9,11}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300 || !sig?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", env("AUTOFIX_SECRET")).update(`queue:${ts}`).digest("hex"));
  const got = Buffer.from(sig.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** 배포 대기 중 가장 오래된 하나입니다. 30분 넘게 DEPLOYING 이면 배포기가 죽은 것으로 보고 다시 줍니다. */
export const nextDeploy = () =>
  one<{ job_id: string; commit: string | null }>(
    `SELECT job_id, merge_commit AS commit FROM autofix_jobs
      WHERE status = 'APPROVED' OR (status = 'DEPLOYING' AND updated_at < now() - interval '30 minutes')
      ORDER BY decided_at NULLS LAST, id LIMIT 1`
  );
