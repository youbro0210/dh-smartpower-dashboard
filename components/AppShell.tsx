"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { NAV, labelFor } from "@/lib/nav";
import Chatbot from "./Chatbot";

const TABS_KEY = "dh-open-tabs";

interface Tab {
  href: string;
  label: string;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { email, tier, loading, logout } = useSession();
  const [tabs, setTabs] = useState<Tab[]>([{ href: "/", label: "홈" }]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isAuthPage = pathname === "/login" || pathname === "/signup";

  // 열려 있는 탭 목록을 세션 동안 유지합니다(브라우저 탭과 동일한 수명).
  useEffect(() => {
    if (isAuthPage) return;

    let stored: Tab[] = [{ href: "/", label: "홈" }];
    try {
      const raw = sessionStorage.getItem(TABS_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {
      /* 손상된 값은 무시 */
    }
    if (!stored.some((t) => t.href === pathname)) {
      stored = [...stored, { href: pathname, label: labelFor(pathname) }];
    }
    setTabs(stored);
    try {
      sessionStorage.setItem(TABS_KEY, JSON.stringify(stored));
    } catch {
      /* 저장 실패는 무시 */
    }
  }, [pathname, isAuthPage]);

  function closeTab(href: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = tabs.filter((t) => t.href !== href);
    const list = next.length ? next : [{ href: "/", label: "홈" }];
    setTabs(list);
    try {
      sessionStorage.setItem(TABS_KEY, JSON.stringify(list));
    } catch {
      /* 무시 */
    }
    if (href === pathname) router.push(list[list.length - 1].href);
  }

  const isAdmin = tier === "admin";
  const initial = (email ?? "?").charAt(0).toUpperCase();

  // 로그인·회원가입 화면은 셸 없이 그대로 보여줍니다.
  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <>
      <header className="topbar">
        <button
          className="topbar-menu"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="메뉴"
        >
          ☰
        </button>
        <span className="topbar-brand">DH 스마트파워 · 변압기 통합 모니터링</span>
        <span className="topbar-spacer" />
        <div className="topbar-right">
          {loading ? (
            <span style={{ color: "#9fb8c6" }}>확인 중...</span>
          ) : email ? (
            <>
              <div className="topbar-user">
                <span className="topbar-avatar">{initial}</span>
                <span className="topbar-user-name">
                  {email.split("@")[0]}
                  <small>{isAdmin ? "시스템 관리자" : "뷰어"}</small>
                </span>
              </div>
              <button className="topbar-link" onClick={logout}>
                로그아웃
              </button>
            </>
          ) : (
            <Link href="/login" className="topbar-link">
              로그인
            </Link>
          )}
        </div>
      </header>

      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.adminOnly || isAdmin);
          if (!items.length) return null;
          return (
            <div key={group.label}>
              <div className="nav-group">{group.label}</div>
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item${pathname === item.href ? " active" : ""}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <span className="nav-dot" />
                  {item.label}
                </Link>
              ))}
            </div>
          );
        })}
      </aside>

      <nav className="tabbar">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tab${pathname === tab.href ? " active" : ""}`}
          >
            {tab.label}
            {tab.href !== "/" && (
              <button
                className="tab-close"
                onClick={(e) => closeTab(tab.href, e)}
                aria-label={`${tab.label} 탭 닫기`}
              >
                ×
              </button>
            )}
          </Link>
        ))}
      </nav>

      <main className="main">{children}</main>

      <Chatbot />
    </>
  );
}
