import { createClient } from "@supabase/supabase-js";

/**
 * 서버(Route Handler)에서만 사용합니다.
 * service_role(=secret) 키는 RLS를 완전히 우회하므로,
 * 절대 클라이언트 컴포넌트나 NEXT_PUBLIC_ 환경변수로 노출하면 안 됩니다.
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
