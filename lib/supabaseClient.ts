import { createBrowserClient } from "@supabase/ssr";

// @supabase/ssr의 브라우저 클라이언트를 사용합니다.
// 일반 createClient()는 세션을 localStorage에만 저장하지만,
// 이 클라이언트는 세션을 쿠키에도 동기화해서 middleware.ts(서버)가 로그인 상태를 읽을 수 있게 합니다.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);
