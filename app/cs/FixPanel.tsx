"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface FixRow {
  id: number;
  label: string;
  reason: string | null;
  status: string;
  error: string | null;
  at: string | null;
}

const STATUS_TEXT: Record<string, string> = { PROPOSED: "제안", APPLIED: "반영", UNDONE: "되돌림", FAILED: "반영 못 함", DROPPED: "" };

/** 데이터 정정입니다. 정정안 만들기·고른 정정 반영·반영한 정정 되돌리기(관리자) */
export default function FixPanel({ id, fixes, open, aiOn }: { id: number; fixes: FixRow[]; open: boolean; aiOn: boolean }) {
  const router = useRouter();
  const [pick, setPick] = useState<number[]>(() => fixes.filter((f) => f.status === "PROPOSED").map((f) => f.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const shown = fixes.filter((f) => f.status !== "DROPPED");

  async function go(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setMsg(null);
    const r = await fetch(`/api/cs/${id}/fixes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    })
      .then((x) => x.json())
      .catch(() => null);
    setBusy(null);
    setMsg({ ok: !!r?.ok, text: r?.message ?? "처리하지 못했습니다." });
    if (r?.ok) router.refresh();
  }

  return (
    <div>
      {shown.length ? (
        <table className="grid cs-fixes">
          <thead>
            <tr>
              <th>반영</th>
              <th>정정</th>
              <th>상태</th>
              <th>되돌리기</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id}>
                <td className="center">
                  {f.status === "PROPOSED" && open ? (
                    <input
                      type="checkbox"
                      checked={pick.includes(f.id)}
                      aria-label={`정정 #${f.id} 반영`}
                      onChange={(e) => setPick((p) => (e.target.checked ? [...p, f.id] : p.filter((x) => x !== f.id)))}
                    />
                  ) : null}
                </td>
                <td>
                  <div>{f.label}</div>
                  {f.reason ? <div className="cs-muted">{f.reason}</div> : null}
                  {f.error ? <div className="cs-bad">{f.error}</div> : null}
                </td>
                <td className="center">
                  {STATUS_TEXT[f.status]}
                  {f.at ? <div className="cs-muted">{f.at}</div> : null}
                </td>
                <td className="center">
                  {f.status === "APPLIED" ? (
                    <button type="button" className="btn" disabled={!!busy} onClick={() => go("undo", { fixId: f.id })}>
                      {busy === "undo" ? "되돌리는 중" : "되돌리기"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="cs-muted">정정안이 없습니다.</div>
      )}
      {open ? (
        <div className="cs-btns">
          <button type="button" className="btn" disabled={!!busy || !aiOn} onClick={() => go("propose")}>
            {busy === "propose" ? "AI가 찾는 중" : shown.some((f) => f.status === "PROPOSED") ? "정정안 다시 만들기" : "정정안 만들기"}
          </button>
          <button type="button" className={`btn${pick.length ? " primary" : ""}`} disabled={!!busy || !pick.length} onClick={() => go("apply", { ids: pick })}>
            {busy === "apply" ? "반영 중" : `선택한 정정 반영${pick.length ? ` (${pick.length})` : ""}`}
          </button>
        </div>
      ) : null}
      {msg ? <span className={msg.ok ? "cs-ok" : "cs-bad"}>{msg.text}</span> : null}
    </div>
  );
}
