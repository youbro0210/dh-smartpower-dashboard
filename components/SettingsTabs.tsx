"use client";

import Link from "next/link";

const TABS = [
  { href: "/settings", key: "threshold", label: "임계치 · 설비" },
  { href: "/settings/mqtt", key: "mqtt", label: "데이터 연결" },
  { href: "/settings/ingest", key: "ingest", label: "수집 내역" },
  { href: "/settings/commands", key: "commands", label: "장비 제어" },
  { href: "/settings/notify", key: "notify", label: "알림 발송" },
];

/** 설정 화면 안에서 하위 화면을 오가는 탭입니다. */
export default function SettingsTabs({ active }: { active: string }) {
  return (
    <div className="subtabs">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} className={`subtab${t.key === active ? " active" : ""}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
