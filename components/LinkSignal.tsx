"use client";

import { useMemo } from "react";
import type { Bridge, DeviceEvaluated } from "@/lib/types";
import { LINK_HEALTH_LABEL, LinkHealth, linkHealthOf } from "@/lib/linkHealth";

const ORDER: LinkHealth[] = ["ok", "unstable", "fail"];

/**
 * 홈 화면 오른쪽 신호등. 해당하는 설비가 한 대라도 있는 색은 켜지고, 없으면 꺼진 채로 둡니다.
 * now 는 화면 시계(1초)로 다시 그리기 위해 받습니다.
 */
export default function LinkSignal({
  devices,
  bridges,
  now,
}: {
  devices: DeviceEvaluated[];
  bridges: Bridge[];
  now: number;
}) {
  const groups = useMemo(() => {
    const byId = new Map(bridges.map((b) => [b.bridge_id, b]));
    const g: Record<LinkHealth, string[]> = { ok: [], unstable: [], fail: [] };
    for (const d of devices) g[linkHealthOf(d, byId, now)].push(d.name);
    return g;
  }, [devices, bridges, now]);

  return (
    <aside className="signal" aria-label="설비 연결 상태">
      <div className="signal-title">설비 연결</div>
      <div className="signal-body">
        <div className="signal-housing" aria-hidden="true">
          {ORDER.map((h) => (
            <span key={h} className={`signal-lamp ${h}${groups[h].length ? " on" : ""}`} />
          ))}
        </div>
        <ul className="signal-legend">
          {ORDER.map((h) => (
            <li
              key={h}
              className={groups[h].length ? `${h} on` : h}
              title={groups[h].length ? groups[h].join(", ") : undefined}
            >
              <span className="signal-label">{LINK_HEALTH_LABEL[h]}</span>
              <span className="signal-count">{groups[h].length}대</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
