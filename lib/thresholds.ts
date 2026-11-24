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

/**
 * 설비별 온도 기준을 반영한 판정 기준.
 * 설비에 경고 기준(temp_limit)이 있으면 그 값을 경고로, 주의는 공통 주의와 그 값 중 낮은 쪽,
 * 위험은 공통 위험과 그 값 중 높은 쪽으로 둡니다. 수집 서버(collector.py rule_for)와 같은 규칙입니다.
 */
export function ruleFor(rule: ThresholdRule, limit: number | null | undefined): ThresholdRule {
  if (limit === null || limit === undefined || !Number.isFinite(limit)) return rule;
  return {
    caution: Math.min(rule.caution, limit),
    warning: limit,
    danger: Math.max(rule.danger, limit),
  };
}
