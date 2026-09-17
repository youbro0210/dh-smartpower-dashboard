#!/usr/bin/env node
/**
 * 관리자 계정 생성 / 등급 변경 스크립트
 *
 *   node scripts/create-admin.mjs                          (대화형)
 *   node scripts/create-admin.mjs you@corp.com '비밀번호' '홍길동'
 *
 * 이미 존재하는 계정이면 비밀번호를 재설정하고 등급을 admin 으로 올립니다.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// .env.local → .env 순으로 읽어 DATABASE_URL 을 채웁니다.
for (const name of [".env.local", ".env"]) {
  const file = resolve(ROOT, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

if (!process.env.DATABASE_URL) {
  console.error("오류: DATABASE_URL 이 설정되지 않았습니다 (.env.local 확인).");
  process.exit(1);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, 32, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString("base64url"), hash.toString("base64url")].join("$");
}

const [argEmail, argPassword, argName] = process.argv.slice(2);

let email = argEmail;
let password = argPassword;
let fullName = argName;

if (!email || !password) {
  const rl = createInterface({ input: stdin, output: stdout });
  email = email || (await rl.question("이메일: "));
  fullName = fullName || (await rl.question("이름: "));
  password = password || (await rl.question("비밀번호 (8자 이상): "));
  rl.close();
}

email = String(email).trim();
fullName = (fullName || "").trim() || null;

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("오류: 이메일 형식이 올바르지 않습니다.");
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error("오류: 비밀번호는 8자 이상이어야 합니다.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, password_hash, tier)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (lower(email)) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            tier          = 'admin',
            is_active     = true,
            full_name     = COALESCE(EXCLUDED.full_name, users.full_name)
     RETURNING id, email, full_name, tier`,
    [email, fullName, passwordHash]
  );

  // 비밀번호를 바꿨으므로 기존 세션은 모두 무효화합니다.
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [rows[0].id]);

  console.log("관리자 계정이 준비되었습니다.");
  console.log(`  이메일 : ${rows[0].email}`);
  console.log(`  이름   : ${rows[0].full_name ?? "-"}`);
  console.log(`  등급   : ${rows[0].tier}`);
} catch (err) {
  console.error("실패:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
