"use client";

import { useEffect, useState } from "react";
import { useDevices } from "@/lib/useDevices";
import { useConfig } from "@/lib/configStore";
import { MOCK_ALARMS } from "@/lib/mockData";
import AppShell from "@/components/AppShell";
import SummaryStrip from "@/components/SummaryStrip";
import DeviceTable from "@/components/DeviceTable";
import AlarmList from "@/components/AlarmList";

export default function DashboardPage() {
  const { devices, connected, isMock } = useDevices();
  const { config } = useConfig();
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date().toLocaleString("ko-KR", { hour12: false })), 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <AppShell active="dashboard">
      <div className="page-header">
        <div>
          <div className="page-title">변압기 통합 모니터링</div>
          <div className="page-meta">
            {isMock ? "가상 데이터 모드" : connected ? "실시간 연결됨" : "연결 중..."} · 최종 업데이트 {now || "-"}
          </div>
        </div>
      </div>

      <SummaryStrip devices={devices} bridges={config.bridges} alarms24h={MOCK_ALARMS.length} thresholds={config.thresholds} />

      <div className="grid">
        <div>
          <DeviceTable devices={devices} alarms={MOCK_ALARMS} />
        </div>
        <div>
          <AlarmList alarms={MOCK_ALARMS} />
        </div>
      </div>

      <footer className="note">
        {isMock
          ? "가상 데이터로 동작 중입니다 · 설정에서 임계치/설비를 바꾸면 판정에 즉시 반영됩니다"
          : "실시간 센서 데이터 기반"}
      </footer>
    </AppShell>
  );
}
