"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AuthAside from "@/components/AuthAside";
import NavIcon from "@/components/NavIcon";

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // 입력칸에 실제로 들어 있는 값을 읽습니다.
    // 브라우저가 저장된 비밀번호를 자동으로 채울 때는 React 의 onChange 가
    // 울리지 않는 경우가 있습니다. 그러면 화면에는 점이 찍혀 있는데 실제로는
    // 빈 값이 전송되어, 맞는 비밀번호인데도 로그인이 실패합니다.
    const data = new FormData(e.currentTarget);
    const sendEmail = String(data.get("email") ?? "").trim() || email.trim();
    const sendPassword = String(data.get("password") ?? "") || password;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sendEmail, password: sendPassword }),
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
                name="email"
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
              {/* 입력한 글자를 눈으로 확인할 수 있어야 합니다.
                  한글 입력 상태나 Caps Lock 때문에 다른 글자가 들어가도
                  점으로만 보이면 알 길이 없습니다. */}
              <div className="pw-wrap">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
