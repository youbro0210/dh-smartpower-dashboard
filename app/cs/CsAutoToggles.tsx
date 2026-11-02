"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 위험 낮음 자동 처리 켜고 끄기(관리자) */
export default function CsAutoToggles({ data, program, deploy }: { data: boolean; program: boolean; deploy: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function set(body: Record<string, boolean>) {
    setBusy(true);
    await fetch("/api/cs/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    router.refresh();
  }

  return (
    <span className="cs-auto">
      <b>위험 낮음 자동</b>
      <label>
        <input type="checkbox" checked={data} disabled={busy} onChange={(e) => set({ autoDataLow: e.target.checked })} /> 데이터 정정 반영
      </label>
      <label>
        <input type="checkbox" checked={program} disabled={busy} onChange={(e) => set({ autoProgramLow: e.target.checked })} /> 자동 수정 보내기
      </label>
      <label>
        <input type="checkbox" checked={deploy} disabled={busy || !program} onChange={(e) => set({ autoDeployLow: e.target.checked })} /> PR 합치고 배포
      </label>
    </span>
  );
}
