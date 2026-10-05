import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import SettingsClient from "@/components/SettingsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/settings");

  if (user.tier !== "admin") {
    return (
      <div className="card">
        <div className="page-head">
          <h1 className="page-title">관리자 등급만 접근할 수 있습니다</h1>
        </div>
        <p className="hint">
          현재 계정 등급: 뷰어
        </p>
        <Link href="/" className="btn primary">
          대시보드로 돌아가기
        </Link>
      </div>
    );
  }

  return <SettingsClient />;
}
