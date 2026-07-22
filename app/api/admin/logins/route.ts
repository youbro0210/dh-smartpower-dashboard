import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: profile } = await supabase.from("profiles").select("tier").eq("id", user.id).single();
  if (profile?.tier !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const adminClient = createSupabaseAdminClient();
  const { data, error } = await adminClient
    .from("login_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data });
}
