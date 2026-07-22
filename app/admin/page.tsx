import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import AdminClient from "@/components/AdminClient";

const AUTH_ENABLED = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function AdminPage() {
  if (!AUTH_ENABLED) {
    return (
      <div id="app" style={{ maxWidth: 420, paddingTop: 80 }}>
        <div className="card">
          <h3>회원 관리는 로그인 연동 후 사용할 수 있습니다</h3>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>NEXT_PUBLIC_SUPABASE_URL / ANON_KEY를 설정하면 사용할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  let tier: string | null = null;
  if (user) {
    const { data } = await supabase.from("profiles").select("tier").eq("id", user.id).single();
    tier = data?.tier ?? "viewer";
  }

  if (tier !== "admin") {
    return (
      <div id="app" style={{ maxWidth: 420, paddingTop: 80 }}>
        <div className="card">
          <h3>관리자 등급만 접근할 수 있습니다</h3>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            현재 계정 등급: {tier === "viewer" ? "뷰어" : "알 수 없음"}.
          </p>
          <Link href="/" className="btn primary" style={{ display: "inline-block", textDecoration: "none" }}>대시보드로 돌아가기</Link>
        </div>
      </div>
    );
  }

  return <AdminClient />;
}
