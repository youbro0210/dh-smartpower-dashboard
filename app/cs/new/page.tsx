import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { isAdminScreen, SCREENS, screenName } from "@/lib/cs/catalog";
import { KIND_LABEL, STATUS_LABEL } from "@/lib/cs/engine";
import CsForm from "./CsForm";

export const dynamic = "force-dynamic";

/** 요청 접수입니다. 아래는 내 요청이며, 답할 보완 요청을 맨 위에 둡니다. */
export default async function CsNewPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const raw = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page;
  const initialPage = raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/cs") && !isAdminScreen(raw) ? raw.slice(0, 300) : null;

  const mine = await query<{ id: number; title: string; status: string; kind: string | null; at: string; page_url: string | null }>(
    `SELECT id, COALESCE(NULLIF(analysis->>'title', ''), title) AS title, status, kind, page_url,
            to_char(created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS at
       FROM cs_requests WHERE created_by = $1 ORDER BY (status = 'NEEDS_INFO') DESC, id DESC LIMIT 20`,
    [user.id]
  );

  return (
    <>
      <PageHeader
        title="요청 접수"
        breadcrumb="CS 요청 › 요청 접수"
        actions={
          <Link className="btn" href="/cs">
            반영 확인
          </Link>
        }
      />
      <CsForm screens={SCREENS.filter(([h]) => !isAdminScreen(h))} initialPage={initialPage} />

      <h2 className="cs-section-title">내 요청</h2>
      <div className="table-wrap cs-mine">
        <table className="grid">
          <thead>
            <tr>
              <th>번호</th>
              <th>요청</th>
              <th>화면</th>
              <th>구분</th>
              <th>상태</th>
              <th>접수</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((r) => (
              <tr key={r.id}>
                <td className="center">#{r.id}</td>
                <td>
                  <Link href={`/cs?st=&id=${r.id}`}>{r.title}</Link>
                </td>
                <td>{screenName(r.page_url)}</td>
                <td className="center">{r.kind ? KIND_LABEL[r.kind] : "분석 중"}</td>
                <td className={`center cs-${r.status}`}>{STATUS_LABEL[r.status]}</td>
                <td className="center">{r.at}</td>
              </tr>
            ))}
            {!mine.length ? (
              <tr>
                <td colSpan={6} className="empty">
                  조회된 데이터가 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
