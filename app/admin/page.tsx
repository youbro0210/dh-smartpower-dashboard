import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AdminClient from "@/components/AdminClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");

  if (user.tier !== "admin") {
    return (
      <div id="app" style={{ maxWidth: 420, paddingTop: 80, margin: "0 auto" }}>
        <div className="card">
          <h3>관리자 등급만 접근할 수 있습니다</h3>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>현재 계정 등급: 뷰어.</p>
          <Link
            href="/"
            className="btn primary"
            style={{ display: "inline-block", textDecoration: "none" }}
          >
            대시보드로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return <AdminClient />;
}
