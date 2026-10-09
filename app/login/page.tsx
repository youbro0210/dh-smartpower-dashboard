"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AuthAside from "@/components/AuthAside";

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error ?? "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        setLoading(false);
        return;
      }

      // 클라이언트 라우팅(router.replace)으로 넘어가면 레이아웃이 다시 마운트되지
      // 않아, 로그인 화면에서 비로그인 상태로 실패했던 최초 데이터 조회가 그대로
      // 남습니다. 전체 페이지 로드로 이동해 모든 상태를 새로 시작합니다.
      window.location.assign(next.startsWith("/") ? next : "/");
    } catch {
      setError("서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.");
      setLoading(false);
    }
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

          <h2>로그인</h2>
          <p className="auth-lead">등록된 계정으로 들어가면 현재 상태를 바로 볼 수 있습니다.</p>

          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="email">이메일</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="password">비밀번호</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}

            <button className="btn primary auth-submit" type="submit" disabled={loading}>
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>

          <p className="auth-foot">
            계정이 없으신가요? <Link href="/signup">회원가입</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth-page" />}>
      <LoginForm />
    </Suspense>
  );
}
