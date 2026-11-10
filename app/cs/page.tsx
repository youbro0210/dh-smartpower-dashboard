import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { progressOf } from "@/cs-engine/progress";
import { EVENT_LABEL } from "@/cs-engine/types";
import { getSessionUser } from "@/lib/auth";
import { query, one } from "@/lib/db";
import { csSettings } from "@/lib/cs/auto";
import { AUTOFIX_STATUS_LABEL, autofixEnabled, jobsOf, OPEN_JOB, type AutofixRow } from "@/lib/cs/autofix";
import { screenName } from "@/lib/cs/catalog";
import { csEnabled, KIND_LABEL, RISK_LABEL, STATUS_LABEL, type CsAnalysis } from "@/lib/cs/engine";
import AutofixPanel from "./AutofixPanel";
import CsActions from "./CsActions";
import CsAutoToggles from "./CsAutoToggles";
import CsProgressBar from "./CsProgressBar";
import FixPanel, { type FixRow } from "./FixPanel";

export const dynamic = "force-dynamic";

const OPEN = ["RECEIVED", "ANALYZED", "NEEDS_INFO", "APPROVED"];
const STEPS: [string, string[]][] = [
  ["접수", ["RECEIVED"]],
  ["AI 분석", ["ANALYZED", "NEEDS_INFO"]],
  ["승인", ["APPROVED"]],
  ["반영 완료", ["DONE"]],
];

interface ListRow {
  id: number;
  title: string;
  status: string;
  kind: string | null;
  risk: string | null;
  who: string | null;
  at: string;
  page_url: string | null;
  upd: number;
  fx: number;
  job_status: string | null;
  job_at: number | null;
  failed: boolean;
}

interface CurRow {
  id: number;
  title: string;
  body: string;
  page_url: string | null;
  status: string;
  kind: string | null;
  analysis: CsAnalysis | null;
  analysis_error: string | null;
  who: string | null;
  created_by: string | null;
  at: string;
  done_note: string | null;
}

/** 반영 확인입니다. 관리자는 모든 요청을 처리하고, 그 밖의 계정은 자기 요청을 봅니다. */
export default async function CsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const admin = user.tier === "admin";

  const text = (k: string) => {
    const v = searchParams[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? null;
  };
  // st= (빈 값)은 전체입니다. 없으면 관리자는 처리할 것, 그 밖의 계정은 전체로 엽니다.
  const rawSt = text("st");
  const st = rawSt === null ? (admin ? "OPEN" : "") : rawSt;
  const id = Number(text("id")) || null;
  const kw = text("q") || null;
  const PAGE_SIZE = 20;
  const pg = Math.max(1, Number(text("pg")) || 1);

  const rows = await query<ListRow>(
    `SELECT c.id, COALESCE(NULLIF(c.analysis->>'title', ''), c.title) AS title, c.status, c.kind, c.analysis->>'risk' AS risk,
            COALESCE(u.full_name, u.email) AS who, c.page_url,
            to_char(c.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS at,
            (extract(epoch FROM c.updated_at) * 1000)::float8 AS upd,
            (c.analysis_error IS NOT NULL AND c.analysis IS NULL) AS failed,
            (SELECT count(*)::int FROM cs_fixes f WHERE f.request_id = c.id AND f.status = 'PROPOSED') AS fx,
            j.status AS job_status, (extract(epoch FROM j.updated_at) * 1000)::float8 AS job_at
       FROM cs_requests c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN LATERAL (SELECT status, updated_at FROM autofix_jobs WHERE request_id = c.id AND status <> 'CLOSED' ORDER BY id DESC LIMIT 1) j ON true
      WHERE ($1::boolean OR c.created_by = $2)
        AND ($3::text = '' OR ($3 = 'OPEN' AND c.status IN ('RECEIVED', 'ANALYZED', 'NEEDS_INFO', 'APPROVED')) OR c.status = $3)
        AND ($4::text IS NULL OR concat_ws(' ', '#' || c.id, c.title, c.analysis->>'title', c.body, u.full_name, u.email) ILIKE '%' || $4 || '%')
      ORDER BY CASE WHEN $1 THEN c.status IN ('RECEIVED', 'ANALYZED', 'APPROVED') ELSE c.status = 'NEEDS_INFO' END DESC, c.id DESC
      LIMIT $5 OFFSET $6`,
    [admin, user.id, st, kw, PAGE_SIZE, (pg - 1) * PAGE_SIZE]
  );
  const listTotal =
    (
      await one<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM cs_requests c
           LEFT JOIN users u ON u.id = c.created_by
          WHERE ($1::boolean OR c.created_by = $2)
            AND ($3::text = '' OR ($3 = 'OPEN' AND c.status IN ('RECEIVED', 'ANALYZED', 'NEEDS_INFO', 'APPROVED')) OR c.status = $3)
            AND ($4::text IS NULL OR concat_ws(' ', '#' || c.id, c.title, c.analysis->>'title', c.body, u.full_name, u.email) ILIKE '%' || $4 || '%')
`,
        [admin, user.id, st, kw]
      )
    )?.n ?? 0;
  const lastPg = Math.max(1, Math.ceil(listTotal / PAGE_SIZE));
  const cnt = await one<{ open: number; ask: number; all: number; done: number; rej: number }>(
    `SELECT count(*) FILTER (WHERE status IN ('RECEIVED', 'ANALYZED', 'NEEDS_INFO', 'APPROVED'))::int AS open,
            count(*) FILTER (WHERE status = 'NEEDS_INFO')::int AS ask, count(*)::int AS all,
            count(*) FILTER (WHERE status = 'DONE')::int AS done, count(*) FILTER (WHERE status = 'REJECTED')::int AS rej
       FROM cs_requests WHERE $1::boolean OR created_by = $2`,
    [admin, user.id]
  );
  const cur = id
    ? await one<CurRow>(
        `SELECT c.id, c.title, c.body, c.page_url, c.status, c.kind, c.analysis, c.analysis_error,
                COALESCE(u.full_name, u.email) AS who, c.created_by, c.done_note,
                to_char(c.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at
           FROM cs_requests c LEFT JOIN users u ON u.id = c.created_by
          WHERE c.id = $1 AND ($2::boolean OR c.created_by = $3)`,
        [id, admin, user.id]
      )
    : null;

  const [files, events, fixes, jobs] = cur
    ? await Promise.all([
        query<{ id: number; name: string }>(`SELECT id, name FROM cs_files WHERE request_id = $1 ORDER BY id`, [cur.id]),
        query<{ action: string; note: string | null; who: string | null; at: string }>(
          `SELECT e.action, e.note, COALESCE(u.full_name, u.email) AS who,
                  to_char(e.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS at
             FROM cs_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.request_id = $1 ORDER BY e.id`,
          [cur.id]
        ),
        admin
          ? query<FixRow>(
              `SELECT id, label, reason, status, error,
                      to_char(COALESCE(undone_at, applied_at) AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS at
                 FROM cs_fixes WHERE request_id = $1 ORDER BY id`,
              [cur.id]
            )
          : Promise.resolve([] as FixRow[]),
        admin ? jobsOf(cur.id) : Promise.resolve([] as AutofixRow[]),
      ])
    : [[], [], [] as FixRow[], [] as AutofixRow[]];

  const a = cur?.analysis ?? null;
  const auto = admin ? await csSettings() : null;
  const aiOn = csEnabled();

  const tabs: [string, string, number, boolean][] = [
    ["OPEN", "처리할 것", cnt?.open ?? 0, false],
    ["NEEDS_INFO", "보완 요청", cnt?.ask ?? 0, !admin && !!cnt?.ask],
    ["", "전체", cnt?.all ?? 0, false],
    ["DONE", "반영 완료", cnt?.done ?? 0, false],
    ["REJECTED", "반려", cnt?.rej ?? 0, false],
  ];
  const href = (p: Record<string, string | number | null>) => {
    const v = { st, q: kw, pg: pg > 1 ? pg : null, ...p };
    const u = new URLSearchParams();
    for (const [k, x] of Object.entries(v)) if (x != null && x !== "") u.set(k, String(x));
    if (v.st === "") u.set("st", "");
    return `/cs?${u}`;
  };

  const others = rows.filter((r) => OPEN.includes(r.status) && r.id !== cur?.id);
  const at = cur ? rows.findIndex((r) => r.id === cur.id) : -1;
  const next = rows.slice(at + 1).find((r) => OPEN.includes(r.status)) ?? others[0] ?? null;
  const ask = cur?.status === "NEEDS_INFO" ? ([...events].reverse().find((e) => e.action === "NEEDS_INFO")?.note ?? null) : null;
  const stepAt = cur ? STEPS.findIndex(([, s]) => s.includes(cur.status)) : -1;
  const progress = (r: ListRow) =>
    progressOf({
      status: r.status,
      at: r.upd,
      failed: r.failed,
      fixesProposed: r.fx,
      kind: r.kind,
      job: r.job_status ? { status: r.job_status, at: r.job_at ?? r.upd } : null,
    });
  const curRow = cur ? (rows.find((r) => r.id === cur.id) ?? null) : null;
  // 화면 새로 읽기는 막대 하나만 합니다. 상세가 열려 있으면 상세가 읽습니다.
  const liveId = cur
    ? null
    : (rows.find((r) => {
        const p = progress(r);
        return p.startedAt && p.expectSec;
      })?.id ?? null);

  return (
    <>
      <PageHeader
        title="반영 확인"
        breadcrumb="CS 요청 › 반영 확인"
        subtitle={admin ? "모든 요청" : "내 요청"}
        actions={
          <>
            {auto && <CsAutoToggles data={auto.autoDataLow} program={auto.autoProgramLow} deploy={auto.autoDeployLow} />}
            <Link className="btn" href="/cs/new">
              요청 접수
            </Link>
          </>
        }
      />

      <nav className="cs-sttabs" aria-label="상태">
        {tabs.map(([k, label, n, alert]) => (
          <Link key={k || "all"} href={href({ st: k, id: null, pg: null })} className={`cs-sttab${st === k ? " on" : ""}${alert ? " alert" : ""}`}>
            {label}
            {n ? <span className="cnt">{n}</span> : null}
          </Link>
        ))}
      </nav>

      <form className="filterbar" method="get" action="/cs">
        <span className="filter-label">찾기</span>
        <input className="field" name="q" defaultValue={kw ?? ""} aria-label="찾기" />
        <input type="hidden" name="st" value={st} />
        <div className="filterbar-right">
          <button type="submit" className="btn">
            조회
          </button>
          {kw ? (
            <Link className="btn" href={href({ q: null, id: null, pg: null })}>
              초기화
            </Link>
          ) : null}
        </div>
      </form>

      <div className={`cs-split${cur ? " has-cur" : ""}`}>
        <div className="table-wrap cs-list">
          <table className="grid">
            <thead>
              <tr>
                <th>번호</th>
                <th>요청</th>
                <th>화면</th>
                <th>구분</th>
                <th>위험</th>
                <th>상태</th>
                <th>진행</th>
                <th>요청자</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.id === cur?.id ? "selected" : undefined}>
                  <td className="center">#{r.id}</td>
                  <td>
                    <Link href={href({ id: r.id })}>{r.title}</Link>
                  </td>
                  <td>{screenName(r.page_url)}</td>
                  <td className="center">{r.kind ? KIND_LABEL[r.kind] : "분석 중"}</td>
                  <td className={`center cs-risk-${r.risk ?? ""}`}>{r.risk ? RISK_LABEL[r.risk] : ""}</td>
                  <td className={`center cs-${r.status}`}>{STATUS_LABEL[r.status]}</td>
                  <td className="cs-pbcell">
                    <CsProgressBar p={progress(r)} compact live={r.id === liveId} />
                  </td>
                  <td className="center">
                    {r.who ?? ""} · {r.at}
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={8} className="empty">
                    조회된 데이터가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {lastPg > 1 ? (
            <nav className="pager" aria-label="페이지">
              {[
                ["처음", 1],
                ["이전", Math.max(1, pg - 1)],
              ].map(([label, n]) => (
                <Link key={label} className={`btn sm${pg <= 1 ? " disabled" : ""}`} href={href({ pg: n, id: null })} aria-disabled={pg <= 1}>
                  {label}
                </Link>
              ))}
              {Array.from({ length: Math.min(10, lastPg - Math.floor((pg - 1) / 10) * 10) }, (_, i) => Math.floor((pg - 1) / 10) * 10 + i + 1).map((n) => (
                <Link key={n} className={`btn sm pager-num${n === pg ? " on" : ""}`} href={href({ pg: n, id: null })}>
                  {n}
                </Link>
              ))}
              {[
                ["다음", Math.min(lastPg, pg + 1)],
                ["끝", lastPg],
              ].map(([label, n]) => (
                <Link key={label} className={`btn sm${pg >= lastPg ? " disabled" : ""}`} href={href({ pg: n, id: null })} aria-disabled={pg >= lastPg}>
                  {label}
                </Link>
              ))}
              <span className="pager-total">
                총 {listTotal.toLocaleString()}건 · {pg} / {lastPg}
              </span>
            </nav>
          ) : null}
        </div>

        {cur ? (
          <section className="cs-cur" aria-label={`요청 #${cur.id}`}>
            <div className="cs-nav">
              <Link className="btn cs-back" href={href({ id: null })}>
                목록
              </Link>
              {next ? (
                <Link className="btn" href={href({ id: next.id })}>
                  다음 요청 #{next.id}
                </Link>
              ) : null}
            </div>
            <div className="cs-h">
              <b>
                #{cur.id} {cur.title}
              </b>
              <span className={`cs-st cs-${cur.status}`}>{STATUS_LABEL[cur.status]}</span>
            </div>
            {curRow ? <CsProgressBar p={progress(curRow)} /> : null}
            <ol className="cs-steps" aria-label="진행 단계">
              {cur.status === "REJECTED" ? (
                <li className="on bad">반려</li>
              ) : (
                STEPS.map(([label], i) => (
                  <li key={label} className={i < stepAt ? "done" : i === stepAt ? "on" : undefined}>
                    {label}
                    {i === 1 && cur.status === "NEEDS_INFO" ? " · 보완 요청" : ""}
                  </li>
                ))
              )}
            </ol>
            {ask ? (
              <div className="banner warn-soft">
                <b>보완 요청</b>
                <div className="cs-body">{ask}</div>
              </div>
            ) : null}

            <table className="cs-kv">
              <tbody>
                <tr>
                  <th>요청자</th>
                  <td>
                    {cur.who ?? ""} · {cur.at}
                  </td>
                </tr>
                {cur.kind ? (
                  <tr>
                    <th>구분</th>
                    <td>
                      {KIND_LABEL[cur.kind]}
                      {a ? <span className={`cs-risk-${a.risk}`}> · 위험 {RISK_LABEL[a.risk]}</span> : null}
                    </td>
                  </tr>
                ) : null}
                {cur.page_url ? (
                  <tr>
                    <th>화면</th>
                    <td>
                      <Link href={cur.page_url}>{screenName(cur.page_url)}</Link>
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <th>내용</th>
                  <td className="cs-body">{cur.body}</td>
                </tr>
                {files.length ? (
                  <tr>
                    <th>사진</th>
                    <td className="cs-imgs">
                      {files.map((f) => (
                        <a key={f.id} href={`/api/cs/file/${f.id}`} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/cs/file/${f.id}`} alt={f.name} />
                        </a>
                      ))}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            <h3 className="cs-sub">AI 분석</h3>
            {a ? (
              <table className="cs-kv">
                <tbody>
                  <tr>
                    <th>종류</th>
                    <td>
                      {KIND_LABEL[a.kind]}
                      {a.automatable ? " · 처리안 분명" : ""}
                    </td>
                  </tr>
                  <tr>
                    <th>요약</th>
                    <td className="cs-body">{a.summary}</td>
                  </tr>
                  {a.screen ? (
                    <tr>
                      <th>화면</th>
                      <td>{screenName(a.screen)}</td>
                    </tr>
                  ) : null}
                  {a.target ? (
                    <tr>
                      <th>대상</th>
                      <td className="cs-body">{a.target}</td>
                    </tr>
                  ) : null}
                  {a.answer ? (
                    <tr>
                      <th>답</th>
                      <td className="cs-body">{a.answer}</td>
                    </tr>
                  ) : null}
                  {a.plan.length ? (
                    <tr>
                      <th>처리안</th>
                      <td>
                        <ol className="cs-ol">
                          {a.plan.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ol>
                      </td>
                    </tr>
                  ) : null}
                  <tr>
                    <th>위험</th>
                    <td className={`cs-risk-${a.risk}`}>
                      {RISK_LABEL[a.risk]} — {a.risk_reason}
                    </td>
                  </tr>
                  {a.questions.length ? (
                    <tr>
                      <th>되물을 것</th>
                      <td>
                        <ul className="cs-ol">
                          {a.questions.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            ) : cur.analysis_error ? (
              <div className="banner error">{cur.analysis_error}</div>
            ) : (
              <div className="cs-muted">AI가 분석하고 있습니다.</div>
            )}

            {admin && (cur.kind === "DATA" || fixes.length) ? (
              <>
                <h3 className="cs-sub">데이터 정정</h3>
                <FixPanel key={fixes.map((f) => `${f.id}${f.status}`).join(",")} id={cur.id} fixes={fixes} aiOn={aiOn} open={OPEN.includes(cur.status)} />
              </>
            ) : null}

            {admin && (cur.kind === "PROGRAM" || jobs.length) ? (
              <>
                <h3 className="cs-sub">프로그램 자동 수정</h3>
                <AutofixPanel
                  id={cur.id}
                  on={autofixEnabled()}
                  jobs={jobs.map((j) => ({ ...j, label: AUTOFIX_STATUS_LABEL[j.status] }))}
                  canStart={cur.kind === "PROGRAM" && ["ANALYZED", "APPROVED"].includes(cur.status) && !jobs.some((j) => OPEN_JOB.includes(j.status))}
                />
              </>
            ) : null}

            {cur.done_note ? (
              <>
                <h3 className="cs-sub">반영 내용</h3>
                <div className="cs-body">{cur.done_note}</div>
              </>
            ) : null}

            <h3 className="cs-sub">진행</h3>
            <ol className="cs-tl">
              {events.map((e, i) => (
                <li key={i}>
                  <span className="at">{e.at}</span> <b>{EVENT_LABEL[e.action] ?? e.action}</b>
                  {e.who ? ` · ${e.who}` : ""}
                  {e.note ? <div className="cs-body">{e.note}</div> : null}
                </li>
              ))}
            </ol>

            <CsActions
              id={cur.id}
              status={cur.status}
              admin={admin}
              mine={cur.created_by === user.id}
              aiOn={aiOn}
              questions={a?.questions ?? []}
              answer={a?.answer ?? ""}
              nextHref={next ? href({ id: next.id }) : null}
            />
          </section>
        ) : null}
      </div>
    </>
  );
}
