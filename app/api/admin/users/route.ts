import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

async function requireAdmin() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("tier").eq("id", user.id).single();
  return data?.tier === "admin" ? user : null;
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10));

  const adminClient = createSupabaseAdminClient();

  // supabase-js의 auth.admin.* 계열이 새 API 키 체계에서 인증 헤더를 잘못 구성하는
  // 알려진 버그가 있어(github.com/supabase/supabase-js/issues/1568),
  // GoTrue Admin REST 엔드포인트를 직접 호출해 우회합니다.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const listRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!listRes.ok) {
    const text = await listRes.text();
    return NextResponse.json({ error: `auth admin error: ${text}` }, { status: 500 });
  }
  const listJson = await listRes.json();
  const authUsersList: { id: string; email?: string; created_at: string; last_sign_in_at: string | null }[] = listJson.users ?? [];

  const { data: profiles, error: profileError } = await adminClient.from("profiles").select("id, tier, full_name, created_at");
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  let users = authUsersList.map((u) => ({
    id: u.id,
    email: u.email,
    full_name: profileMap.get(u.id)?.full_name ?? null,
    tier: profileMap.get(u.id)?.tier ?? "viewer",
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
  }));

  if (from) users = users.filter((u) => u.created_at >= from);
  if (to) users = users.filter((u) => u.created_at <= `${to}T23:59:59`);

  users.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const total = users.length;
  const start = (page - 1) * pageSize;
  const pageUsers = users.slice(start, start + pageSize);

  return NextResponse.json({ users: pageUsers, total, page, pageSize });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { user_id, tier } = await request.json();
  if (!user_id || !["viewer", "admin"].includes(tier)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const adminClient = createSupabaseAdminClient();
  const { error } = await adminClient.from("profiles").update({ tier }).eq("id", user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
