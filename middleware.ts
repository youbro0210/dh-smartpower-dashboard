import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, unsignValue } from "@/lib/cookieSign";

const PUBLIC_PATHS = ["/login", "/signup"];

/**
 * 미들웨어는 쿠키 서명만 검증해 비로그인 사용자를 로그인 화면으로 보냅니다.
 * Edge 런타임이라 DB에 접근할 수 없으므로, 실제 권한 판정(등급 확인 포함)은
 * 각 서버 컴포넌트와 API 라우트가 getSessionUser()/requireAdmin()으로 직접
 * 수행합니다. 미들웨어 단독 판정에 의존하지 않는 구조입니다.
 *
 * 세션 쿠키는 로그인 시점에 한 번만 발급되고 만료 전까지 갱신되지 않으므로,
 * 리다이렉트 응답에서 쿠키가 유실되는 문제가 발생하지 않습니다.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  let signedIn = false;
  try {
    signedIn = Boolean(await unsignValue(request.cookies.get(SESSION_COOKIE)?.value));
  } catch {
    // AUTH_SECRET 미설정 등 설정 오류 — 비로그인으로 처리하고 로그인 화면에서 안내합니다.
    signedIn = false;
  }

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  if (signedIn && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// api 는 제외합니다. 각 라우트 핸들러가 자체적으로 인증을 검증하며,
// 미들웨어가 가로채면 API 가 JSON 대신 HTML 리다이렉트를 반환해 호출부가 깨집니다.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
