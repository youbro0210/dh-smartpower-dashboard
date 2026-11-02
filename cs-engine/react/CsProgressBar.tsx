"use client";

import { useEffect, useState } from "react";
import { etaText, pctNow, type CsProgress } from "../progress";

/**
 * 진행률 막대(React) — 기계 단계는 1초마다 오르고, refresh 를 주면 5초마다 불러 상태를 새로 읽게 한다(Next 면 router.refresh).
 * compact: 목록 칸(막대 + %), 아니면 상세 머리(막대 + 단계 · 남은 시간 · 기다리는 사람). 모양은 cs-engine/react/progress.css
 */
export default function CsProgressBar({ p, compact = false, refresh }: { p: CsProgress; compact?: boolean; refresh?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const moving = !!p.startedAt && !!p.expectSec;
  useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    const r = refresh ? setInterval(refresh, 5000) : null;
    return () => { clearInterval(t); if (r) clearInterval(r); };
  }, [moving, refresh]);
  const pct = pctNow(p, now);
  const eta = etaText(p, now);
  const cls = `cs-pb${p.done ? " done" : ""}${p.bad ? " bad" : ""}${moving ? " moving" : ""}`;
  const bar = <span className="pbar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="진행률"><i style={{ width: `${pct}%` }} /></span>;
  if (compact) return (
    <span className={`${cls} sm`} title={[p.label, eta ?? p.wait].filter(Boolean).join(" · ")}>{bar}<span className="pct">{p.bad && p.done ? "" : `${pct}%`}</span></span>
  );
  return (
    <div className={cls}>
      <div className="row"><b>{p.label}</b><span className="pct">{p.bad && p.done ? "" : `${pct}%`}</span></div>
      {bar}
      {eta || p.wait ? <div className="eta">{eta ? `예상 완료 ${eta}` : p.wait}</div> : null}
    </div>
  );
}
