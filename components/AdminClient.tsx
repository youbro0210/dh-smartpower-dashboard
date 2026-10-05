"use client";

import { useEffect, useState } from "react";
import PageHeader from "./PageHeader";

interface AdminUser {
  id: string;
  email: string | undefined;
  full_name: string | null;
  tier: string;
  created_at: string;
  last_login_at: string | null;
}
interface LoginEvent {
  id: number;
  user_id: string | null;
  email: string | null;
  created_at: string;
}

const PAGE_SIZE = 20;

export default function AdminClient() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userFrom, setUserFrom] = useState("");
  const [userTo, setUserTo] = useState("");
  const [userLoading, setUserLoading] = useState(true);
  const [userError, setUserError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [logins, setLogins] = useState<LoginEvent[]>([]);
  const [loginTotal, setLoginTotal] = useState(0);
  const [loginPage, setLoginPage] = useState(1);
  const [loginFrom, setLoginFrom] = useState("");
  const [loginTo, setLoginTo] = useState("");
  const [loginLoading, setLoginLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  async function loadUsers(page = userPage) {
    setUserLoading(true);
    setUserError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (userFrom) params.set("from", userFrom);
    if (userTo) params.set("to", userTo);
    const res = await fetch(`/api/admin/users?${params}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUserError(json.error ?? "회원 목록을 불러오지 못했습니다.");
      setUsers([]);
      setUserTotal(0);
    } else {
      setUsers(json.users ?? []);
      setUserTotal(json.total ?? 0);
      setUserPage(page);
    }
    setUserLoading(false);
  }

  async function loadLogins(page = loginPage) {
    setLoginLoading(true);
    setLoginError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (loginFrom) params.set("from", loginFrom);
    if (loginTo) params.set("to", loginTo);
    const res = await fetch(`/api/admin/logins?${params}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoginError(json.error ?? "로그인 이력을 불러오지 못했습니다.");
      setLogins([]);
      setLoginTotal(0);
    } else {
      setLogins(json.events ?? []);
      setLoginTotal(json.total ?? 0);
      setLoginPage(page);
    }
    setLoginLoading(false);
  }

  useEffect(() => {
    loadUsers(1);
    loadLogins(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeTier(id: string, tier: string) {
    setSavingId(id);
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: id, tier }),
    });
    await loadUsers(userPage);
    setSavingId(null);
  }

  const userPages = Math.max(1, Math.ceil(userTotal / PAGE_SIZE));
  const loginPages = Math.max(1, Math.ceil(loginTotal / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="회원 관리"
        breadcrumb="홈 › 회원관리"
        subtitle="회원 등급 변경 · 로그인 이력 조회"
      />

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            전체 회원
          </div>
          <span className="card-note">총 {userTotal.toLocaleString()}명</span>
        </div>

        <div className="filterbar">
          <span className="filter-label">가입일</span>
          <input className="field" type="date" value={userFrom} onChange={(e) => setUserFrom(e.target.value)} />
          <span>~</span>
          <input className="field" type="date" value={userTo} onChange={(e) => setUserTo(e.target.value)} />
          <div className="filterbar-right">
            {(userFrom || userTo) && (
              <button className="btn" onClick={() => { setUserFrom(""); setUserTo(""); loadUsers(1); }}>초기화</button>
            )}
            <button className="btn primary" onClick={() => loadUsers(1)}>조회</button>
          </div>
        </div>

        {userError && <div className="banner error">{userError}</div>}

        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr><th>이메일</th><th>이름</th><th style={{ width: 110 }}>가입일</th><th style={{ width: 170 }}>최근 로그인</th><th style={{ width: 110 }}>등급</th></tr>
            </thead>
            <tbody>
              {userLoading ? (
                <tr><td className="empty" colSpan={5}>불러오는 중...</td></tr>
              ) : users.length === 0 && !userError ? (
                <tr><td className="empty" colSpan={5}>조회된 데이터가 없습니다.</td></tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.full_name ?? "-"}</td>
                    <td className="center">{new Date(u.created_at).toLocaleDateString("ko-KR")}</td>
                    <td className="center">{u.last_login_at ? new Date(u.last_login_at).toLocaleString("ko-KR") : "-"}</td>
                    <td className="center">
                      <select value={u.tier} disabled={savingId === u.id} onChange={(e) => changeTier(u.id, e.target.value)}>
                        <option value="viewer">뷰어</option>
                        <option value="admin">관리자</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {userTotal > 0 && (
          <div className="save-bar" style={{ justifyContent: "center" }}>
            <button className="btn" disabled={userPage <= 1} onClick={() => loadUsers(userPage - 1)}>이전</button>
            <span className="card-note">{userPage} / {userPages}</span>
            <button className="btn" disabled={userPage >= userPages} onClick={() => loadUsers(userPage + 1)}>다음</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            최근 로그인 이력
          </div>
          <span className="card-note">총 {loginTotal.toLocaleString()}건</span>
        </div>

        <div className="filterbar">
          <span className="filter-label">로그인 일자</span>
          <input className="field" type="date" value={loginFrom} onChange={(e) => setLoginFrom(e.target.value)} />
          <span>~</span>
          <input className="field" type="date" value={loginTo} onChange={(e) => setLoginTo(e.target.value)} />
          <div className="filterbar-right">
            {(loginFrom || loginTo) && (
              <button className="btn" onClick={() => { setLoginFrom(""); setLoginTo(""); loadLogins(1); }}>초기화</button>
            )}
            <button className="btn primary" onClick={() => loadLogins(1)}>조회</button>
          </div>
        </div>

        {loginError && <div className="banner error">{loginError}</div>}

        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr><th style={{ width: 52 }}>No</th><th style={{ width: 190 }}>시각</th><th>계정</th></tr>
            </thead>
            <tbody>
              {loginLoading ? (
                <tr><td className="empty" colSpan={3}>불러오는 중...</td></tr>
              ) : logins.length === 0 && !loginError ? (
                <tr><td className="empty" colSpan={3}>조회된 데이터가 없습니다.</td></tr>
              ) : (
                logins.map((l, i) => (
                  <tr key={l.id}>
                    <td className="center">{(loginPage - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="center">{new Date(l.created_at).toLocaleString("ko-KR")}</td>
                    <td>{l.email ?? l.user_id ?? "알 수 없음"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {loginTotal > 0 && (
          <div className="save-bar" style={{ justifyContent: "center" }}>
            <button className="btn" disabled={loginPage <= 1} onClick={() => loadLogins(loginPage - 1)}>이전</button>
            <span className="card-note">{loginPage} / {loginPages}</span>
            <button className="btn" disabled={loginPage >= loginPages} onClick={() => loadLogins(loginPage + 1)}>다음</button>
          </div>
        )}
      </div>
    </>
  );
}
