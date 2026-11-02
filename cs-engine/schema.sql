-- cs-engine 표 견본 — 이름 앞머리(cs_)는 프로젝트에 맞게 바꾼다(여각: logi_cs_*, db/migrations/090·091·094·095·092)
create table if not exists cs_requests (
  id bigserial primary key, company_id bigint not null, created_by bigint not null,
  title text not null, body text not null, page_url text,
  status text not null default 'RECEIVED' check (status in ('RECEIVED','ANALYZED','NEEDS_INFO','APPROVED','DONE','REJECTED')),
  kind text check (kind in ('DATA','PROGRAM','QUESTION','OTHER')),
  analysis jsonb, analysis_error text, analyzed_at timestamptz,
  decided_by bigint, decided_at timestamptz, done_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists cs_files (id bigserial primary key, request_id bigint not null references cs_requests(id) on delete cascade,
  name text not null, mime text not null, data bytea not null, created_at timestamptz not null default now());
create table if not exists cs_events (id bigserial primary key, request_id bigint not null references cs_requests(id) on delete cascade,
  user_id bigint, action text not null, note text, created_at timestamptz not null default now());
create table if not exists cs_fixes (id bigserial primary key, request_id bigint not null references cs_requests(id) on delete cascade,
  op jsonb not null, label text not null, reason text, before jsonb, after jsonb,
  status text not null default 'PROPOSED' check (status in ('PROPOSED','APPLIED','UNDONE','FAILED','DROPPED')),
  error text, applied_by bigint, applied_at timestamptz, undone_by bigint, undone_at timestamptz, created_at timestamptz not null default now());
create table if not exists cs_settings (company_id bigint primary key, auto_data_low boolean not null default true,
  auto_program_low boolean not null default true, auto_deploy_low boolean not null default true, updated_by bigint, updated_at timestamptz not null default now());
-- 프로그램 자동 수정 작업은 autofix/ 의 작업 표(여각 logi_autofix_jobs, 092·095) — auto 칸이 «위험 낮음으로 자동으로 보낸 것»
