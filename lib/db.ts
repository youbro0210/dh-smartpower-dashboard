import { Pool, types } from "pg";

// pg는 bigint(OID 20)와 numeric(OID 1700)을 기본적으로 문자열로 돌려줍니다.
// 이 앱이 다루는 범위(알람 id, 센서 실수값)에서는 숫자로 받는 편이 안전합니다.
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => parseFloat(v));

declare global {
  // eslint-disable-next-line no-var
  var __dhPool: Pool | undefined;
}

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL 환경변수가 설정되지 않았습니다. .env.local 또는 배포 환경변수를 확인하세요."
    );
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // 같은 EC2 인스턴스의 로컬 PostgreSQL에 붙으므로 기본은 TLS 미사용.
    // 외부 DB로 옮길 경우 PGSSL=require 로 켭니다.
    ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
  });
}

// 개발 모드의 HMR 재실행으로 풀이 계속 늘어나는 것을 막습니다.
export const pool: Pool = global.__dhPool ?? createPool();
if (process.env.NODE_ENV !== "production") global.__dhPool = pool;

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await pool.query(text, params as never[]);
  return res.rows as T[];
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length ? rows[0] : null;
}

export async function execute(text: string, params?: unknown[]): Promise<number> {
  const res = await pool.query(text, params as never[]);
  return res.rowCount ?? 0;
}

/** 여러 쿼리를 하나의 트랜잭션으로 묶습니다. */
export async function transaction<T>(
  fn: (q: (text: string, params?: unknown[]) => Promise<unknown[]>) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(async (text, params) => {
      const r = await client.query(text, params as never[]);
      return r.rows;
    });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
