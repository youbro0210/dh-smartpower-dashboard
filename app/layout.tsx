import type { Metadata } from "next";
import "./globals.css";
import { ConfigProvider } from "@/lib/configStore";

export const metadata: Metadata = {
  title: "DH 스마트파워 · 변압기 통합 모니터링",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ConfigProvider>{children}</ConfigProvider>
      </body>
    </html>
  );
}
