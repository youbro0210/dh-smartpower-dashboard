"use client";

import { useDashboard } from "./configStore";

/**
 * 대시보드 화면용 뷰. 실제 데이터 로딩과 실시간 구독, 판정은
 * ConfigProvider(lib/configStore.tsx)가 담당합니다.
 */
export function useDevices() {
  const { devices, connected, loading, error } = useDashboard();
  return { devices, connected, loading, error };
}
