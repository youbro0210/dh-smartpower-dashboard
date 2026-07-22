"use client";

import { useEffect, useState } from "react";
import AppShell from "./AppShell";

interface AdminUser {
  id: string;
  email: string | undefined;
  full_name: string | null;
  tier: string;
  created_at: string;
  last_sign_in_at: string | null;
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
    const json = await res.json();
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
    const json = await res.json();
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
    <AppShell active="admin">
      <div className="page-header">
        <div>
          <div className="page-title">회원 관리</div>
          <div className="page-meta">회원 등급 변경 · 로그인 이력 조회</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title"><span className="accent-bar" />전체 회원 ({userTotal})</div></div>

        <div className="form-row" style={{ marginBottom: 14 }}>
          <label>가입일 범위</label>
          <input type="date" value={userFrom} onChange={(e) => setUserFrom(e.target.value)} />
          <span style={{ color: "var(--muted)", fontSize: 12 }}>~</span>
          <input type="date" value={userTo} onChange={(e) => setUserTo(e.target.value)} />
          <button className="btn primary" onClick={() => loadUsers(1)}>조회</button>
          {(userFrom || userTo) && (
            <button className="btn ghost" onClick={() => { setUserFrom(""); setUserTo(""); loadUsers(1); }}>초기화</button>
          )}
        </div>

        {userError && <p style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{userError}</p>}

        {userLoading ? (
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>불러오는 중...</p>
        ) : users.length === 0 && !userError ? (
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>조건에 맞는 회원이 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr><th>이메일</th><th>이름</th><th>가입일</th><th>최근 로그인</th><th>등급</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.full_name ?? "-"}</td>
                  <td className="num" style={{ fontSize: 11.5 }}>{new Date(u.created_at).toLocaleDateString("ko-KR")}</td>
                  <td className="num" style={{ fontSize: 11.5 }}>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("ko-KR") : "-"}</td>
                  <td>
                    <select value={u.tier} disabled={savingId === u.id} onChange={(e) => changeTier(u.id, e.target.value)}>
                      <option value="viewer">뷰어</option>
                      <option value="admin">관리자</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {userTotal > 0 && (
          <div className="save-bar">
            <button className="btn ghost" disabled={userPage <= 1} onClick={() => loadUsers(userPage - 1)}>이전</button>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{userPage} / {userPages} 페이지</span>
            <button className="btn ghost" disabled={userPage >= userPages} onClick={() => loadUsers(userPage + 1)}>다음</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title"><span className="accent-bar" />최근 로그인 이력 ({loginTotal})</div></div>

        <div className="form-row" style={{ marginBottom: 14 }}>
          <label>로그인 일자 범위</label>
          <input type="date" value={loginFrom} onChange={(e) => setLoginFrom(e.target.value)} />
          <span style={{ color: "var(--muted)", fontSize: 12 }}>~</span>
          <input type="date" value={loginTo} onChange={(e) => setLoginTo(e.target.value)} />
          <button className="btn primary" onClick={() => loadLogins(1)}>조회</button>
          {(loginFrom || loginTo) && (
            <button className="btn ghost" onClick={() => { setLoginFrom(""); setLoginTo(""); loadLogins(1); }}>초기화</button>
          )}
        </div>

        {loginError && <p style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{loginError}</p>}

        {loginLoading ? (
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>불러오는 중...</p>
        ) : logins.length === 0 && !loginError ? (
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>조건에 맞는 로그인 기록이 없습니다.</p>
        ) : (
          <div>
            {logins.map((l) => (
              <div className="alarm-item" key={l.id}>
                <span className="time">{new Date(l.created_at).toLocaleString("ko-KR")}</span>
                <span className="desc">{l.email ?? l.user_id ?? "알 수 없음"}</span>
              </div>
            ))}
          </div>
        )}

        {loginTotal > 0 && (
          <div className="save-bar">
            <button className="btn ghost" disabled={loginPage <= 1} onClick={() => loadLogins(loginPage - 1)}>이전</button>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{loginPage} / {loginPages} 페이지</span>
            <button className="btn ghost" disabled={loginPage >= loginPages} onClick={() => loadLogins(loginPage + 1)}>다음</button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
