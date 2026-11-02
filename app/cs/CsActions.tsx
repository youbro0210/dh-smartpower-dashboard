"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** 처리 단추입니다. 관리자: 승인·보완 요청·반려·반영 완료·다시 분석, 요청자: 댓글(보완 요청이면 답하기) */
export default function CsActions({
  id,
  status,
  admin,
  mine,
  aiOn,
  questions = [],
  answer = "",
  nextHref = null,
}: {
  id: number;
  status: string;
  admin: boolean;
  mine: boolean;
  aiOn: boolean;
  questions?: string[];
  answer?: string;
  nextHref?: string | null;
}) {
  const router = useRouter();
  const box = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; next?: boolean } | null>(null);
  const open = ["RECEIVED", "ANALYZED", "NEEDS_INFO", "APPROVED"].includes(status);
  const needNote: Record<string, string> = {
    reject: "반려 까닭",
    needs_info: "보완 요청할 것",
    comment: mine && status === "NEEDS_INFO" ? "답" : "댓글",
  };

  async function act(action: string) {
    if (needNote[action] && !note.trim()) {
      setMsg({ ok: false, text: `${needNote[action]}을(를) 적으세요.` });
      box.current?.focus();
      return;
    }
    setBusy(action);
    setMsg(null);
    const r = await fetch(`/api/cs/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note }),
    })
      .then((x) => x.json())
      .catch(() => null);
    setBusy(null);
    setMsg({
      ok: !!r?.ok,
      text: r?.message ?? "처리하지 못했습니다.",
      next: !!r?.ok && admin && ["approve", "reject", "needs_info", "done"].includes(action),
    });
    if (r?.ok) {
      setNote("");
      router.refresh();
    }
  }

  const button = (action: string, label: string, primary = false, show = true) =>
    show ? (
      <button type="button" className={`btn${primary ? " primary" : ""}`} disabled={!!busy} onClick={() => act(action)}>
        {busy === action ? `${label} 중` : label}
      </button>
    ) : null;
  const fill = (t: string) => {
    setNote((o) => (o.trim() ? `${o.trim()}\n${t}` : t));
    box.current?.focus();
  };

  if (!admin && !mine) return null;

  return (
    <div className="cs-act">
      <label htmlFor={`cs-note-${id}`}>{admin ? "메모" : status === "NEEDS_INFO" ? "답" : "댓글"}</label>
      {admin && open && (questions.length || answer) ? (
        <div className="cs-quick">
          {questions.length ? (
            <button type="button" className="btn" onClick={() => fill(questions.map((x) => `- ${x}`).join("\n"))}>
              되물을 것 넣기
            </button>
          ) : null}
          {answer ? (
            <button type="button" className="btn" onClick={() => fill(answer)}>
              AI 답 넣기
            </button>
          ) : null}
        </div>
      ) : null}
      <textarea id={`cs-note-${id}`} ref={box} className="field" rows={3} value={note} maxLength={3000} onChange={(e) => setNote(e.target.value)} />
      <div className="cs-btns">
        {admin ? (
          <>
            {button("approve", "승인", true, ["RECEIVED", "ANALYZED", "NEEDS_INFO"].includes(status))}
            {button("done", "반영 완료", status === "APPROVED", ["ANALYZED", "APPROVED"].includes(status))}
            {button("needs_info", "보완 요청", false, ["RECEIVED", "ANALYZED", "APPROVED"].includes(status))}
            {button("reject", "반려", false, open)}
            {button("reanalyze", "다시 분석", false, open && aiOn)}
          </>
        ) : null}
        {button("comment", mine && status === "NEEDS_INFO" ? "답하기" : "댓글", mine && status === "NEEDS_INFO")}
      </div>
      {msg ? (
        <span className={msg.ok ? "cs-ok" : "cs-bad"}>
          {msg.text}
          {msg.next && nextHref ? (
            <>
              {" "}
              <Link href={nextHref}>다음 요청</Link>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
