import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LoginHistoryClient from "@/components/LoginHistoryClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LoginHistoryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/login-history");

  if (user.tier !== "admin") {
    return (
      <div className="card" style={{ maxWidth: 420 }}>
        <div className="card-title">관리자 등급만 접근할 수 있습니다</div>
        <p className="hint" style={{ marginTop: 8 }}>
          현재 계정 등급: 뷰어
        </p>
        <Link href="/" className="btn primary">
          대시보드로 돌아가기
        </Link>
      </div>
    );
  }

  return <LoginHistoryClient />;
}
