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

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const adminClient = createSupabaseAdminClient();

  const { data: authUsers, error: authError } = await adminClient.auth.admin.listUsers();
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 });

  const { data: profiles } = await adminClient.from("profiles").select("id, tier, full_name, created_at");
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const users = authUsers.users.map((u) => ({
    id: u.id,
    email: u.email,
    full_name: profileMap.get(u.id)?.full_name ?? null,
    tier: profileMap.get(u.id)?.tier ?? "viewer",
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
  }));

  return NextResponse.json({ users });
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
