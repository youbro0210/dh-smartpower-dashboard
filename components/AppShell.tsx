"use client";

import Link from "next/link";
import { useSession } from "@/lib/useSession";

export default function AppShell({
  active,
  children,
}: {
  active: "dashboard" | "settings" | "admin";
  children: React.ReactNode;
}) {
  const { email, tier, loading, logout } = useSession();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">DH</div>
          <div className="brand-text">
            <div className="t1">DH SMART POWER</div>
            <div className="t2">변압기 모니터링</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <Link href="/" className={`nav-item${active === "dashboard" ? " active" : ""}`}>
            <span className="nav-dot" />
            대시보드
          </Link>
          {tier === "admin" && (
            <Link href="/admin" className={`nav-item${active === "admin" ? " active" : ""}`}>
              <span className="nav-dot" />
              회원관리
            </Link>
          )}
          <Link href="/settings" className={`nav-item${active === "settings" ? " active" : ""}`}>
            <span className="nav-dot" />
            설정
          </Link>
        </nav>

        <div className="sidebar-foot">
          {loading ? (
            <div className="sidebar-user">확인 중...</div>
          ) : email ? (
            <>
              <div className="sidebar-user">
                {email}
                <span className="tier-tag">{tier === "admin" ? "관리자" : "뷰어"}</span>
              </div>
              <button className="sidebar-logout" onClick={logout}>
                로그아웃
              </button>
            </>
          ) : (
            <div className="sidebar-user">로그인 필요</div>
          )}
        </div>
      </aside>

      <main className="shell-main">{children}</main>
    </div>
  );
}
