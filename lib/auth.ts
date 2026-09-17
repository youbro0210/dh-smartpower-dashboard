import "server-only";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { query, one, execute } from "./db";
import { SESSION_COOKIE, signValue, unsignValue } from "./cookieSign";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

// scrypt 파라미터. N=16384 는 OWASP 권장 하한이며 t3.small 에서 약 50ms 소요됩니다.
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;

export const SESSION_DAYS = 7;

// ----------------------------------------------------------------------------
// 비밀번호
// ----------------------------------------------------------------------------

/** 저장 형식: scrypt$N$r$p$<salt>$<hash>  (salt/hash 는 base64url) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltPart, hashPart] = parts;
  const salt = Buffer.from(saltPart, "base64url");
  const expected = Buffer.from(hashPart, "base64url");

  const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * 존재하지 않는 계정에 대해서도 해시 연산과 같은 시간을 소비해
 * 응답 시간 차이로 가입 여부가 드러나지 않도록 합니다.
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function burnTime(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH).catch(() => false);
}

// ----------------------------------------------------------------------------
// 사용자
// ----------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  email: string;
  full_name: string | null;
  tier: "viewer" | "admin";
}

interface UserRow extends SessionUser {
  password_hash: string;
  is_active: boolean;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return one<UserRow>(
    `SELECT id, email, full_name, tier, password_hash, is_active
       FROM users
      WHERE lower(email) = lower($1)`,
    [email.trim()]
  );
}

export async function createUser(input: {
  email: string;
  password: string;
  fullName?: string | null;
  tier?: "viewer" | "admin";
}): Promise<SessionUser> {
  const passwordHash = await hashPassword(input.password);
  const rows = await query<SessionUser>(
    `INSERT INTO users (email, full_name, password_hash, tier)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, full_name, tier`,
    [input.email.trim(), input.fullName ?? null, passwordHash, input.tier ?? "viewer"]
  );
  return rows[0];
}

// ----------------------------------------------------------------------------
// 세션
// ----------------------------------------------------------------------------

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<string> {
  const sessionId = randomBytes(32).toString("base64url");
  await execute(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, $4, $5)`,
    [sessionId, userId, String(SESSION_DAYS), meta.ip ?? null, meta.userAgent ?? null]
  );
  await execute(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);
  return signValue(sessionId);
}

export async function destroySession(signedToken: string | undefined): Promise<void> {
  const sessionId = await unsignValue(signedToken);
  if (sessionId) await execute(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

/** 만료된 세션을 정리합니다. 로그인 시점에 가볍게 호출합니다. */
export async function pruneSessions(): Promise<void> {
  await execute(`DELETE FROM sessions WHERE expires_at < now()`);
}

/**
 * 현재 요청의 로그인 사용자. 쿠키 서명 검증 후 DB에서 세션을 조회합니다.
 * 권한 판정은 반드시 이 함수(또는 requireAdmin)를 통해야 합니다.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const sessionId = await unsignValue(token);
  if (!sessionId) return null;

  return one<SessionUser>(
    `SELECT u.id, u.email, u.full_name, u.tier
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1
        AND s.expires_at > now()
        AND u.is_active`,
    [sessionId]
  );
}

export async function requireUser(): Promise<SessionUser | null> {
  return getSessionUser();
}

export async function requireAdmin(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user && user.tier === "admin" ? user : null;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
  // HTTPS 배포에서는 Secure 를 켭니다. 로컬 HTTP 개발에서는 꺼야 쿠키가 저장됩니다.
  secure: process.env.COOKIE_SECURE === "true",
};
