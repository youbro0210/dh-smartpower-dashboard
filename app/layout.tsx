import type { Metadata } from "next";
import "./globals.css";
import "@/cs-engine/react/progress.css";
import { ConfigProvider } from "@/lib/configStore";
import AppShell from "@/components/AppShell";
import I18nProvider from "@/components/I18nProvider";

export const metadata: Metadata = {
  title: "DH 스마트파워 · 변압기 통합 모니터링",
  description: "유입변압기 수소·메탄·유면·온도 실시간 감시 및 이상 등급 판정",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 영어·일본어로 볼 때 번역이 끝날 때까지 화면을 가립니다. 2초 뒤에는 무조건 보입니다. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var l=localStorage.getItem('dh.lang');if(l==='en'||l==='ja'){var d=document.documentElement;d.classList.add('i18n-pending');d.lang=l;setTimeout(function(){d.classList.remove('i18n-pending')},2000)}}catch(e){}",
          }}
        />
      </head>
      <body>
        <I18nProvider />
        <ConfigProvider>
          <AppShell>{children}</AppShell>
        </ConfigProvider>
      </body>
    </html>
  );
}
