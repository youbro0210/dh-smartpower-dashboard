"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } }, // profiles 트리거에서 사용
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="auth-page">
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div className="card">
          <h3>가입 신청이 완료되었습니다</h3>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            이메일 확인이 켜져 있는 프로젝트라면 받은편지함의 인증 링크를 클릭해야 로그인할 수 있습니다.
            신규 계정은 기본적으로 <b>viewer</b> 등급으로 생성되며, 관리자 권한이 필요하면
            Supabase의 profiles 테이블에서 tier를 admin으로 바꿔주세요.
          </p>
          <Link href="/login" className="btn primary" style={{ display: "inline-block", textDecoration: "none", marginTop: 8 }}>로그인 하러 가기</Link>
        </div>
      </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div style={{ width: "100%", maxWidth: 380 }}>
      <div className="brand" style={{ marginBottom: 28, justifyContent: "center" }}>
        <div className="brand-mark">DH</div>
        <div className="brand-text"><div className="t1">DH SMART POWER</div><div className="t2">회원가입</div></div>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 12.5, color: "var(--muted)" }}>이름</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" style={{ width: "100%", padding: "9px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }} required />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 12.5, color: "var(--muted)" }}>이메일</label>
            <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ width: "100%", padding: "9px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }} required />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 12.5, color: "var(--muted)" }}>비밀번호</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8자 이상" minLength={8} style={{ width: "100%", padding: "9px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }} required />
          </div>
          {error && <p style={{ color: "var(--danger)", fontSize: 12 }}>{error}</p>}
          <button className="btn primary" type="submit" disabled={loading} style={{ width: "100%", marginTop: 4 }}>
            {loading ? "가입 처리 중..." : "회원가입"}
          </button>
        </form>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", textAlign: "center", marginTop: 14 }}>
        이미 계정이 있으신가요? <Link href="/login" style={{ color: "var(--cyan)" }}>로그인</Link>
      </p>
      </div>
    </div>
  );
}
