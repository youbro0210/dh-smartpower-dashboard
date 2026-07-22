import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import SettingsClient from "@/components/SettingsClient";

const AUTH_ENABLED = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function SettingsPage() {
  // Supabase 연동 전(순수 mock 실행)에는 등급 검사 없이 바로 보여줍니다.
  if (!AUTH_ENABLED) return <SettingsClient />;

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
            현재 계정 등급: {tier === "viewer" ? "뷰어" : "알 수 없음"}. 설정 변경은 관리자만 가능합니다.
          </p>
          <Link href="/" className="btn primary" style={{ display: "inline-block", textDecoration: "none" }}>대시보드로 돌아가기</Link>
        </div>
      </div>
    );
  }

  return <SettingsClient />;
}
