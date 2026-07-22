import { SeverityLevel, SEVERITY_ORDER, ThresholdRule } from "./types";

/**
 * 진입값(caution/warning/danger)은 그대로, 해제는 진입값보다 낮은 지점에서
 * 이뤄지도록 해서 경계값 근처에서 알람이 반복 발생하지 않도록 합니다.
 */
export function classifySensor(
  value: number,
  rule: ThresholdRule,
  currentLevel: SeverityLevel,
  hysteresisMarginPct: number
): SeverityLevel {
  const exit = (enter: number) => enter * (1 - hysteresisMarginPct);
  const currentIdx = SEVERITY_ORDER.indexOf(currentLevel);

  if (value >= rule.danger) return "danger";
  if (currentIdx >= SEVERITY_ORDER.indexOf("danger") && value >= exit(rule.danger)) return "danger";

  if (value >= rule.warning) return "warning";
  if (currentIdx >= SEVERITY_ORDER.indexOf("warning") && value >= exit(rule.warning)) return "warning";

  if (value >= rule.caution) return "caution";
  if (currentIdx >= SEVERITY_ORDER.indexOf("caution") && value >= exit(rule.caution)) return "caution";

  return "normal";
}

export function escalate(level: SeverityLevel): SeverityLevel {
  const idx = SEVERITY_ORDER.indexOf(level);
  return SEVERITY_ORDER[Math.min(idx + 1, SEVERITY_ORDER.length - 1)];
}
