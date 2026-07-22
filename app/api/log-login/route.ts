import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no session" }, { status: 401 });

  const adminClient = createSupabaseAdminClient();
  await adminClient.from("login_events").insert({ user_id: user.id, email: user.email });

  return NextResponse.json({ ok: true });
}
