"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 13,
};

function LoginForm() {
  const router = useRouter();
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

      // 서버 컴포넌트가 새 세션을 읽도록 강제 새로고침합니다.
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError("서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.");
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div className="brand" style={{ marginBottom: 28, justifyContent: "center" }}>
          <div className="brand-mark">DH</div>
          <div className="brand-text">
            <div className="t1">DH SMART POWER</div>
            <div className="t2">로그인</div>
          </div>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 12.5, color: "var(--muted)" }}>
                이메일
              </label>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={inputStyle}
                required
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 12.5, color: "var(--muted)" }}>
                비밀번호
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
                required
              />
            </div>

            {error && (
              <p role="alert" style={{ color: "var(--danger)", fontSize: 12, marginTop: 10 }}>
                {error}
              </p>
            )}

            <button className="btn primary" type="submit" disabled={loading} style={{ width: "100%", marginTop: 18 }}>
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>
        </div>

        <p style={{ fontSize: 12.5, color: "var(--muted)", textAlign: "center", marginTop: 14 }}>
          계정이 없으신가요?{" "}
          <Link href="/signup" style={{ color: "var(--cyan)" }}>
            회원가입
          </Link>
        </p>
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
