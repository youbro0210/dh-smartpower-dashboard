import { companyScope, SessionUser } from "@/lib/auth";
import { query } from "@/lib/db";

/**
 * 이 사용자가 볼 수 있는 설비 ID 목록. null 이면 제한 없음(DH 직원).
 * 고객사 담당자는 자기 회사 설비만 — 화면에서 숨기는 것만으로는 막히지 않으므로
 * 데이터를 돌려주는 모든 API 가 이 목록으로 거릅니다.
 */
export async function allowedDeviceIds(user: SessionUser): Promise<string[] | null> {
  const scope = companyScope(user);
  if (scope === null) return null;
  const rows = await query<{ device_id: string }>(
    `SELECT device_id FROM devices WHERE company_id = $1`,
    [scope]
  );
  return rows.map((r) => r.device_id);
}

/** 목록 필터: 허용된 설비 것만 남깁니다. */
export function keepAllowed<T extends { device_id?: string | null }>(rows: T[], allowed: string[] | null): T[] {
  if (allowed === null) return rows;
  const set = new Set(allowed);
  return rows.filter((r) => !!r.device_id && set.has(r.device_id));
}

/** 특정 설비 하나를 볼 수 있는지 */
export function canSee(deviceId: string | null | undefined, allowed: string[] | null): boolean {
  if (allowed === null) return true;
  return !!deviceId && allowed.includes(deviceId);
}
