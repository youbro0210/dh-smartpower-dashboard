import { NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { one, query } from "@/lib/db";
import { DEFAULT_THRESHOLDS, LinearConversion, ThresholdConfig, ThresholdRule } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const row = await one<{ thresholds: ThresholdConfig; version: number; updated_at: string }>(
    `SELECT thresholds, version, updated_at FROM app_config WHERE id = 1`
  );

  return NextResponse.json({
    thresholds: row?.thresholds ?? DEFAULT_THRESHOLDS,
    version: row?.version ?? 1,
    updatedAt: row?.updated_at ?? null,
  });
}

function readRule(input: unknown, fallback: ThresholdRule): ThresholdRule | null {
  const value = input as Partial<ThresholdRule> | undefined;
  const rule = {
    caution: Number(value?.caution ?? fallback.caution),
    warning: Number(value?.warning ?? fallback.warning),
    danger: Number(value?.danger ?? fallback.danger),
  };
  if (!Object.values(rule).every((n) => Number.isFinite(n) && n >= 0)) return null;
  // 진입값은 주의 < 경고 < 위험 순서를 지켜야 판정이 성립합니다.
  if (!(rule.caution < rule.warning && rule.warning < rule.danger)) return null;
  return rule;
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });

  const h2 = readRule(body.h2, DEFAULT_THRESHOLDS.h2);
  const ch4 = readRule(body.ch4, DEFAULT_THRESHOLDS.ch4);
  const temperature = readRule(body.temperature, DEFAULT_THRESHOLDS.temperature);

  if (!h2 || !ch4 || !temperature) {
    return NextResponse.json(
      { error: "임계치는 주의 < 경고 < 위험 순서의 양수여야 합니다." },
      { status: 400 }
    );
  }

  const margin = Number(body.hysteresisMarginPct);
  if (!Number.isFinite(margin) || margin < 0 || margin >= 1) {
    return NextResponse.json(
      { error: "히스테리시스 여유는 0 이상 1 미만이어야 합니다." },
      { status: 400 }
    );
  }

  const minSensors = Number(body.compositeMinSensors);
  if (!Number.isInteger(minSensors) || minSensors < 2 || minSensors > 4) {
    return NextResponse.json(
      { error: "격상 기준 센서 수는 2 이상 4 이하의 정수여야 합니다." },
      { status: 400 }
    );
  }

  const offlineMinutes = Number(body.offlineMinutes ?? DEFAULT_THRESHOLDS.offlineMinutes);
  if (!Number.isFinite(offlineMinutes) || offlineMinutes < 1) {
    return NextResponse.json({ error: "통신단절 판정 시간은 1분 이상이어야 합니다." }, { status: 400 });
  }

  const levels = ["caution", "warning", "danger"];
  const oilLowLevel = levels.includes(body.oilLowLevel) ? body.oilLowLevel : "warning";
  const oilHighLevel = [...levels, "none"].includes(body.oilHighLevel) ? body.oilHighLevel : "none";

  const readConv = (v: unknown, label: string): LinearConversion | string => {
    const o = (v ?? {}) as { scale?: unknown; offset?: unknown };
    const scale = Number(o.scale ?? 1);
    const offset = Number(o.offset ?? 0);
    if (!Number.isFinite(scale) || scale <= 0) return `${label} 환산 배율은 0보다 커야 합니다.`;
    if (!Number.isFinite(offset)) return `${label} 환산 보정값은 숫자여야 합니다.`;
    return { scale, offset };
  };
  const convH2 = readConv(body.conversion?.h2, "수소");
  const convCh4 = readConv(body.conversion?.ch4, "메탄");
  if (typeof convH2 === "string") return NextResponse.json({ error: convH2 }, { status: 400 });
  if (typeof convCh4 === "string") return NextResponse.json({ error: convCh4 }, { status: 400 });

  const thresholds: ThresholdConfig = {
    h2,
    ch4,
    temperature,
    hysteresisMarginPct: margin,
    compositeEnabled: Boolean(body.compositeEnabled),
    compositeMinSensors: minSensors,
    offlineMinutes,
    oilLowLevel,
    oilHighLevel,
    conversion: { h2: convH2, ch4: convCh4 },
  };

  const rows = await query<{ version: number }>(
    `UPDATE app_config
        SET thresholds = $1::jsonb,
            version    = version + 1,
            updated_at = now(),
            updated_by = $2
      WHERE id = 1
      RETURNING version`,
    [JSON.stringify(thresholds), admin.id]
  );

  // 설정 버전이 올라가면 수집 서버가 이를 감지해 각 브리지로 MQTT command 를
  // 내려보냅니다. (수집 서버가 app_config 를 폴링하거나 LISTEN 합니다.)
  return NextResponse.json({ thresholds, version: rows[0]?.version ?? 1 });
}
