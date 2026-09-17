"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/lib/configStore";
import AppShell from "@/components/AppShell";
import SummaryStrip from "@/components/SummaryStrip";
import DeviceTable from "@/components/DeviceTable";
import AlarmList from "@/components/AlarmList";

export default function DashboardPage() {
  const { devices, bridges, thresholds, alarms, alarms24h, connected, loading, error } =
    useDashboard();
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    const update = () => setNow(new Date().toLocaleString("ko-KR", { hour12: false }));
    update();
    const tick = setInterval(update, 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <AppShell active="dashboard">
      <div className="page-header">
        <div>
          <div className="page-title">변압기 통합 모니터링</div>
          <div className="page-meta">
            {loading ? "불러오는 중..." : connected ? "실시간 연결됨" : "재연결 중..."} · 최종
            업데이트 {now || "-"}
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--danger)", marginBottom: 14 }}>
          <b style={{ color: "var(--danger)" }}>데이터를 불러오지 못했습니다</b>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 0" }}>{error}</p>
        </div>
      )}

      <SummaryStrip
        devices={devices}
        bridges={bridges}
        alarms24h={alarms24h}
        thresholds={thresholds}
      />

      <div className="grid">
        <div>
          <DeviceTable devices={devices} alarms={alarms} />
        </div>
        <div>
          <AlarmList alarms={alarms} />
        </div>
      </div>

      <footer className="note">
        임계치와 복합 판정 규칙은 설정 화면에서 변경하며, 변경 즉시 모든 사용자의 화면에 동일하게
        반영됩니다.
      </footer>
    </AppShell>
  );
}
