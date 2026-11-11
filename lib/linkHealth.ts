import type { Bridge, DeviceEvaluated } from "./types";

/**
 * 설비 통신 상태 (홈 화면 신호등)
 *   ok       연결     — 정해진 주기 안에 값이 들어오고 있음
 *   unstable 불안정   — 값이 늦거나(주기 3회분 이상 지연), 연결이 끊겼다는 신호는 왔지만 최근 값은 있음
 *   fail     연결실패 — 값을 받은 적이 없거나, 서버가 통신단절로 판정함
 */
export type LinkHealth = "ok" | "unstable" | "fail";

export const LINK_HEALTH_LABEL: Record<LinkHealth, string> = {
  ok: "연결",
  unstable: "불안정",
  fail: "연결실패",
};

const DEFAULT_INTERVAL_SEC = 60;
const LATE_FACTOR = 3;

export function linkHealthOf(d: DeviceEvaluated, bridges: Map<string, Bridge>, nowMs: number): LinkHealth {
  const times = [d.updated_at, d.last_seen_at]
    .map((t) => (t ? new Date(t).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (!times.length || d.status === "offline") return "fail";

  const ageSec = (nowMs - Math.max(...times)) / 1000;
  const interval = d.interval_sec && d.interval_sec > 0 ? d.interval_sec : DEFAULT_INTERVAL_SEC;
  const bridge = d.bridge_id ? bridges.get(d.bridge_id) : undefined;
  const linkDown = (d.link_type === "direct" && d.online === false) || (bridge !== undefined && !bridge.online);

  if (linkDown && ageSec > interval * LATE_FACTOR) return "fail";
  if (linkDown || ageSec > interval * LATE_FACTOR) return "unstable";
  return "ok";
}
