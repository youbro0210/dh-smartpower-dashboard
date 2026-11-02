"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface AutofixView {
  id: number;
  status: string;
  label: string;
  run_url: string | null;
  pr_number: number | null;
  pr_url: string | null;
  summary: string | null;
  files: string[] | null;
  checks: { name: string; ok: boolean }[] | null;
  error: string | null;
  at: string;
}

/** 프로그램 자동 수정입니다. 보내기·검토·PR 합치고 배포·닫기(관리자) */
export default function AutofixPanel({ id, jobs, canStart, on }: { id: number; jobs: AutofixView[]; canStart: boolean; on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go(action: string, jobId?: number) {
    setBusy(`${action}${jobId ?? ""}`);
    setMsg(null);
    const r = await fetch(`/api/cs/${id}/autofix`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, jobId }),
    })
      .then((x) => x.json())
      .catch(() => null);
    setBusy(null);
    setMsg({ ok: !!r?.ok, text: r?.message ?? "처리하지 못했습니다." });
    if (r?.ok) router.refresh();
  }
  const checksOk = (j: AutofixView) => !!j.checks?.length && j.checks.every((c) => c.ok);

  return (
    <div>
      {jobs.length ? (
        <table className="cs-kv">
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <th>
                  {j.label}
                  <div className="cs-muted">{j.at}</div>
                </th>
                <td>
                  {j.summary ? <div className="cs-body">{j.summary}</div> : null}
                  {j.error ? <div className="cs-bad cs-body">{j.error}</div> : null}
                  {j.files?.length ? (
                    <div className="cs-muted">
                      바뀐 파일 {j.files.length}: {j.files.join(", ")}
                    </div>
                  ) : null}
                  {j.checks?.map((c) => (
                    <div key={c.name} className={c.ok ? "cs-ok" : "cs-bad"}>
                      {c.ok ? "통과" : "실패"} · {c.name}
                    </div>
                  ))}
                  <div className="cs-btns">
                    {j.pr_url ? (
                      <a className="btn" href={j.pr_url} target="_blank" rel="noreferrer">
                        PR #{j.pr_number}
                      </a>
                    ) : null}
                    {j.run_url ? (
                      <a className="btn" href={j.run_url} target="_blank" rel="noreferrer">
                        실행 기록
                      </a>
                    ) : null}
                    {j.status === "PR_OPENED" ? (
                      <button type="button" className="btn primary" disabled={!!busy || !checksOk(j)} onClick={() => go("approve", j.id)}>
                        {busy === `approve${j.id}` ? "합치는 중" : "PR 합치고 배포"}
                      </button>
                    ) : null}
                    {j.status === "DEPLOY_FAILED" ? (
                      <button type="button" className="btn" disabled={!!busy} onClick={() => go("redeploy", j.id)}>
                        다시 배포
                      </button>
                    ) : null}
                    {["QUEUED", "RUNNING", "PR_OPENED", "NO_CHANGE", "FAILED"].includes(j.status) ? (
                      <button type="button" className="btn" disabled={!!busy} onClick={() => go("close", j.id)}>
                        닫기
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {canStart ? (
        <div className="cs-btns">
          <button type="button" className="btn primary" disabled={!!busy || !on} onClick={() => go("start")}>
            {busy === "start" ? "보내는 중" : jobs.length ? "자동 수정 다시 보내기" : "자동 수정 보내기"}
          </button>
          {!on ? <span className="cs-muted">자동 수정 미설정</span> : null}
        </div>
      ) : null}
      {msg ? <span className={msg.ok ? "cs-ok" : "cs-bad"}>{msg.text}</span> : null}
    </div>
  );
}
