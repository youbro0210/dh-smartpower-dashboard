"use client";

import { useState } from "react";
import Link from "next/link";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 13,
};

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, fullName }),
      });

      const json = await res.json().catch(() => ({}));
      setLoading(false);

      if (!res.ok) {
        setError(json.error ?? "가입에 실패했습니다.");
        return;
      }
      setTier(json.tier ?? "viewer");
    } catch {
      setLoading(false);
      setError("서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.");
    }
  }

  if (tier) {
    return (
      <div className="auth-page">
        <div style={{ width: "100%", maxWidth: 380 }}>
          <div className="card">
            <h3>가입이 완료되었습니다</h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              {tier === "admin"
                ? "최초 가입자이므로 관리자 등급으로 생성되었습니다. 바로 로그인하실 수 있습니다."
                : "뷰어 등급으로 생성되었습니다. 설정 변경과 회원관리가 필요하면 관리자에게 등급 변경을 요청해 주세요."}
            </p>
            <Link
              href="/login"
              className="btn primary"
              style={{ display: "inline-block", textDecoration: "none", marginTop: 8 }}
            >
              로그인 하러 가기
            </Link>
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
          <div className="brand-text">
            <div className="t1">DH SMART POWER</div>
            <div className="t2">회원가입</div>
          </div>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 12.5, color: "var(--muted)" }}>이름</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="홍길동" style={inputStyle} required />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 12.5, color: "var(--muted)" }}>이메일</label>
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} required />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 12.5, color: "var(--muted)" }}>비밀번호</label>
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8자 이상" minLength={8} style={inputStyle} required />
            </div>

            {error && (
              <p role="alert" style={{ color: "var(--danger)", fontSize: 12 }}>
                {error}
              </p>
            )}

            <button className="btn primary" type="submit" disabled={loading} style={{ width: "100%", marginTop: 4 }}>
              {loading ? "가입 처리 중..." : "회원가입"}
            </button>
          </form>
        </div>

        <p style={{ fontSize: 12.5, color: "var(--muted)", textAlign: "center", marginTop: 14 }}>
          이미 계정이 있으신가요?{" "}
          <Link href="/login" style={{ color: "var(--cyan)" }}>
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
