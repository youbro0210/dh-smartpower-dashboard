"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }
    fetch("/api/log-login", { method: "POST" }).catch(() => {});
    setLoading(false);
    router.push("/");
    router.refresh();
  }

  return (
    <div className="auth-page">
      <div style={{ width: "100%", maxWidth: 380 }}>
      <div className="brand" style={{ marginBottom: 28, justifyContent: "center" }}>
        <div className="brand-mark">DH</div>
        <div className="brand-text"><div className="t1">DH SMART POWER</div><div className="t2">로그인</div></div>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-row" style={{ display: "block" }}>
            <label style={{ display: "block", marginBottom: 6 }}>이메일</label>
            <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ width: "100%", padding: "9px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }} required />
          </div>
          <div className="form-row" style={{ display: "block", marginTop: 14 }}>
            <label style={{ display: "block", marginBottom: 6 }}>비밀번호</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ width: "100%", padding: "9px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }} required />
          </div>
          {error && <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 10 }}>{error}</p>}
          <button className="btn primary" type="submit" disabled={loading} style={{ width: "100%", marginTop: 18 }}>
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", textAlign: "center", marginTop: 14 }}>
        계정이 없으신가요? <Link href="/signup" style={{ color: "var(--cyan)" }}>회원가입</Link>
      </p>
      </div>
    </div>
  );
}
