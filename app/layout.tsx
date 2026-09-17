import type { Metadata } from "next";
import "./globals.css";
import { ConfigProvider } from "@/lib/configStore";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "DH 스마트파워 · 변압기 통합 모니터링",
  description: "유입변압기 수소·메탄·유면·온도 실시간 감시 및 이상 등급 판정",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <ConfigProvider>
          <AppShell>{children}</AppShell>
        </ConfigProvider>
      </body>
    </html>
  );
}
