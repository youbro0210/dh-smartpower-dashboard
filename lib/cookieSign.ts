/**
 * 세션 쿠키 서명/검증.
 *
 * 이 모듈은 middleware.ts(Edge 런타임)와 서버 코드(Node 런타임) 양쪽에서
 * 함께 쓰입니다. 그래서 node:crypto 대신 두 런타임에 모두 존재하는
 * WebCrypto(crypto.subtle)만 사용합니다.
 *
 * 쿠키 값 형식:  <sessionId>.<HMAC-SHA256 서명 base64url>
 *
 * middleware는 서명만 검증해 비로그인 사용자를 걸러내고(DB 접근 불가),
 * 실제 권한 판정은 서버 컴포넌트와 API 라우트가 DB를 조회해 수행합니다.
 * 미들웨어 단독 판정에 의존하지 않는 구조라 미들웨어 우회 취약점이
 * 있더라도 권한이 뚫리지 않습니다.
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE = "dh_session";

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET 환경변수가 없거나 너무 짧습니다(32자 이상 필요). " +
        "`openssl rand -base64 48` 로 생성한 값을 설정하세요."
    );
  }
  return secret;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedKey: CryptoKey | null = null;
let cachedSecret: string | null = null;

async function getKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedSecret === secret) return cachedKey;
  cachedKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  cachedSecret = secret;
  return cachedKey;
}

/** 길이가 같은 두 문자열을 상수 시간으로 비교합니다. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signValue(value: string, secret = getAuthSecret()): Promise<string> {
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return `${value}.${toBase64Url(signature)}`;
}

/** 서명이 유효하면 원래 값을, 아니면 null 을 돌려줍니다. */
export async function unsignValue(
  token: string | undefined | null,
  secret = getAuthSecret()
): Promise<string | null> {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const value = token.slice(0, separator);
  const expected = await signValue(value, secret);
  return timingSafeEqual(expected, token) ? value : null;
}
