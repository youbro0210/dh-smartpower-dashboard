"use client";

import { useState } from "react";
import Link from "next/link";
import AuthAside from "@/components/AuthAside";
import NavIcon from "@/components/NavIcon";

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // 로그인 화면과 같은 이유로, 입력칸의 실제 값을 읽습니다.
    const data = new FormData(e.currentTarget);
    const sendEmail = String(data.get("email") ?? "").trim() || email.trim();
    const sendPassword = String(data.get("password") ?? "") || password;
    const sendName = String(data.get("name") ?? "").trim() || fullName.trim();

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sendEmail, password: sendPassword, fullName: sendName }),
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
        <AuthAside />
        <div className="auth-main">
          <div className="auth-card">
            <h2>가입이 완료되었습니다</h2>
            <p className="auth-lead">
              부여된 등급은 {tier === "admin" ? "관리자" : "뷰어"} 입니다.
            </p>
            <Link href="/login" className="btn primary auth-submit">
              로그인하러 가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <AuthAside />
      <div className="auth-main">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-mark">DH</div>
            <div className="brand-text">
              <div className="t1">DH SMART POWER</div>
              <div className="t2">변압기 통합 모니터링</div>
            </div>
          </div>

          <h2>회원가입</h2>
          <p className="auth-lead">가입 후 관리자가 등급을 올려주면 설정을 바꿀 수 있습니다.</p>

          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="name">이름</label>
              <input id="name" name="name" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="auth-field">
              <label htmlFor="email">이메일</label>
              <input id="email" name="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="auth-field">
              <label htmlFor="password">비밀번호</label>
              <div className="pw-wrap">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8자 이상"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "비밀번호 가리기" : "비밀번호 보기"}
                  aria-pressed={showPassword}
                  title={showPassword ? "비밀번호 가리기" : "비밀번호 보기"}
                >
                  <NavIcon name={showPassword ? "eye-off" : "eye"} size={19} />
                </button>
              </div>
            </div>

            {error && <p role="alert" className="auth-error">{error}</p>}

          <button className="btn primary auth-submit" type="submit" disabled={loading}>
            {loading ? "가입 처리 중..." : "회원가입"}
          </button>
        </form>

        <p className="auth-foot">
          이미 계정이 있으신가요? <Link href="/login">로그인</Link>
        </p>
        </div>
      </div>
    </div>
  );
}
