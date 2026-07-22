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

export default function AdminClient() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [logins, setLogins] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [uRes, lRes] = await Promise.all([
      fetch("/api/admin/users").then((r) => r.json()),
      fetch("/api/admin/logins").then((r) => r.json()),
    ]);
    setUsers(uRes.users ?? []);
    setLogins(lRes.events ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function changeTier(id: string, tier: string) {
    setSavingId(id);
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: id, tier }),
    });
    await load();
    setSavingId(null);
  }

  return (
    <AppShell active="admin">
      <div className="page-header">
        <div>
          <div className="page-title">회원 관리</div>
          <div className="page-meta">회원 등급 변경 · 로그인 이력 조회</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title"><span className="accent-bar" />전체 회원 ({users.length})</div></div>
        {loading ? (
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>불러오는 중...</p>
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
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title"><span className="accent-bar" />최근 로그인 이력</div></div>
        {logins.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>기록이 없습니다.</p>
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
      </div>
    </AppShell>
  );
}
