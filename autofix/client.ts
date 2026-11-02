import { createHmac, timingSafeEqual } from "node:crypto";
import { AUTOFIX_EVENT_TYPE, SIGNATURE_HEADER, type AutofixEvent, type AutofixJob } from "./protocol";

/**
 * autofix 클라이언트(앱 쪽) — GitHub REST 만 쓴다(의존성 없음, Node 18+ fetch).
 *   dispatch   : 고칠 일 보내기(repository_dispatch)
 *   verify     : 진행 알림 서명 확인(HMAC-SHA256, 시간 차 공격에 안전한 비교)
 *   pr / mergePr / closePr : PR 보기·합치기·닫기
 * ★ githubToken 은 그 저장소만, 권한은 Contents·Pull requests 쓰기(fine-grained PAT 권장). 앱 서버 환경변수에만 둔다.
 */
export interface AutofixConfig {
  /** "owner/name" */
  repo: string;
  githubToken: string;
  /** 알림 서명 공유 비밀 — GitHub Actions secret AUTOFIX_SECRET 과 같은 값 */
  secret: string;
  apiBase?: string;
}

export function createAutofixClient(cfg: AutofixConfig) {
  const api = (cfg.apiBase ?? "https://api.github.com").replace(/\/$/, "");
  async function gh<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${api}/repos/${cfg.repo}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.githubToken}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28",
                 ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`GitHub ${method} ${path} → ${r.status} ${(await r.text()).slice(0, 300)}`);
    return (r.status === 204 ? undefined : await r.json()) as T;
  }
  return {
    async dispatch(job: AutofixJob) {
      if (!/^[A-Za-z0-9-]{1,60}$/.test(job.job_id)) throw new Error("job_id 는 영문·숫자·- 60자까지");
      if (!/^https:\/\//.test(job.callback_url)) throw new Error("callback_url 은 https 여야 합니다.");
      if ((job.attachments ?? []).some((a) => !/^https:\/\//.test(a.url))) throw new Error("첨부 주소는 https 여야 합니다.");
      await gh("POST", "/dispatches", { event_type: AUTOFIX_EVENT_TYPE, client_payload: { job } });
    },
    /** 첨부 주소 서명 — 앱이 `att:<job>:<file>:<만료초>` 를 서명해 주소에 붙이고, 받을 때 attachmentOk 로 확인 */
    attachmentSig: (job: string, file: string | number, exp: number) => createHmac("sha256", cfg.secret).update(`att:${job}:${file}:${exp}`).digest("hex"),
    attachmentOk(job: string, file: string | number, exp: number, sig: string | null): boolean {
      if (!sig || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
      const want = Buffer.from(createHmac("sha256", cfg.secret).update(`att:${job}:${file}:${exp}`).digest("hex")), got = Buffer.from(sig);
      return want.length === got.length && timingSafeEqual(want, got);
    },
    verify(rawBody: string, signature: string | null): boolean {
      if (!signature?.startsWith("sha256=")) return false;
      const want = Buffer.from(createHmac("sha256", cfg.secret).update(rawBody).digest("hex"));
      const got = Buffer.from(signature.slice(7));
      return want.length === got.length && timingSafeEqual(want, got);
    },
    parse(rawBody: string): AutofixEvent {
      const e = JSON.parse(rawBody) as AutofixEvent;
      if (!e?.job_id || !e?.event) throw new Error("알림 모양이 아닙니다.");
      return e;
    },
    pr: (n: number) => gh<{ state: string; merged: boolean; mergeable: boolean | null; html_url: string; head: { sha: string } }>("GET", `/pulls/${n}`),
    mergePr: (n: number, title?: string) => gh<{ sha: string; merged: boolean }>("PUT", `/pulls/${n}/merge`, { merge_method: "squash", commit_title: title }),
    closePr: (n: number) => gh("PATCH", `/pulls/${n}`, { state: "closed" }),
  };
}
export type AutofixClient = ReturnType<typeof createAutofixClient>;
export { SIGNATURE_HEADER };
