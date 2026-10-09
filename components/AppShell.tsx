"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { NAV, labelFor } from "@/lib/nav";
import NavIcon from "./NavIcon";
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
  const [menuQuery, setMenuQuery] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const query = menuQuery.trim().toLowerCase();

  function toggleGroup(label: string) {
    setCollapsed((list) =>
      list.includes(label) ? list.filter((l) => l !== label) : [...list, label]
    );
  }

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

  // 로그인·회원가입 화면은 셸 없이 그대로 보여줍니다.
  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <>
      <header className="topbar">
        <button
          type="button"
          className="topbar-icon-btn"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="메뉴 열기·닫기"
          aria-expanded={sidebarOpen}
        >
          <NavIcon name="menu" size={18} />
        </button>

        <span className="topbar-brand">DH 스마트파워 · 변압기 통합 모니터링</span>

        <div className="topbar-right">
          <Link
            href="/alarms"
            className="topbar-icon-btn"
            title="알람 이력"
            aria-label="알람 이력"
          >
            <NavIcon name="bell" size={18} />
          </Link>

          {/* 사용자 정보와 로그아웃은 메뉴 아래쪽으로 옮겼습니다. */}
          {!loading && !email && (
            <Link href="/login" className="topbar-link">
              로그인
            </Link>
          )}
        </div>
      </header>

      {/* 모바일에서 메뉴가 열렸을 때, 본문을 덮는 막을 눌러 닫을 수 있게 합니다. */}
      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="주 메뉴">
        <div className="side-search">
          <NavIcon name="search" size={16} />
          <input
            type="search"
            value={menuQuery}
            onChange={(e) => setMenuQuery(e.target.value)}
            placeholder="메뉴 검색"
            aria-label="메뉴 검색"
          />
        </div>

        <nav>
          {NAV.map((group) => {
            // 관리자 전용 항목은 등급에 따라 감춥니다.
            // 검색어가 있으면 이름이 맞는 항목만 남깁니다.
            const items = group.items
              .filter((i) => !i.adminOnly || isAdmin)
              .filter((i) => !query || i.label.toLowerCase().includes(query));
            if (!items.length) return null;

            const folded = collapsed.includes(group.label) && !query;

            return (
              <div className="nav-group-block" key={group.label}>
                <button
                  type="button"
                  className={`nav-group${folded ? " folded" : ""}`}
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={!folded}
                >
                  <span>{group.label}</span>
                  <NavIcon name="caret" size={14} />
                </button>

                {!folded &&
                  items.map((item) => {
                    const active = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`nav-item${active ? " active" : ""}`}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setSidebarOpen(false)}
                      >
                        <NavIcon name={item.icon} size={17} />
                        <span className="nav-label">{item.label}</span>
                      </Link>
                    );
                  })}
              </div>
            );
          })}

          {query && !NAV.some((g) =>
            g.items.some(
              (i) => (!i.adminOnly || isAdmin) && i.label.toLowerCase().includes(query)
            )
          ) && <p className="side-empty">찾는 메뉴가 없습니다.</p>}
        </nav>

        <div className="side-foot">
          <p className="side-user">
            {loading ? "확인 중..." : email ? (
              <>
                <b>DH 스마트파워</b> · {email.split("@")[0]} ·{" "}
                {isAdmin ? "ADMIN" : "VIEWER"}
              </>
            ) : (
              "로그인하지 않음"
            )}
          </p>
          {email && (
            <button type="button" className="side-btn" onClick={logout}>
              로그아웃
            </button>
          )}
        </div>
      </aside>

      <nav className="tabbar" aria-label="열린 화면">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tab${pathname === tab.href ? " active" : ""}`}
          >
            {tab.label}
            {tab.href !== "/" && (
              <button
                type="button"
                className="tab-close"
                onClick={(e) => closeTab(tab.href, e)}
                aria-label={`${tab.label} 탭 닫기`}
              >
                <NavIcon name="close" size={13} />
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
