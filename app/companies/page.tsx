import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import CompanyClient from "@/components/CompanyClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/companies");

  if (user.tier === "customer") {
    return (
      <div className="card">
        <div className="page-head">
          <h1 className="page-title">DH스마트파워 직원만 접근할 수 있습니다</h1>
        </div>
        <Link href="/" className="btn primary">
          홈으로
        </Link>
      </div>
    );
  }

  return <CompanyClient canEdit={user.tier === "admin"} />;
}
