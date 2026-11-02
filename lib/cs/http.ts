import { NextResponse } from "next/server";

/** CS API 응답 모양입니다. 화면은 ok 와 message 만 봅니다. */
export const ok = (body: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...body });

export const bad = (message: string, status = 400) =>
  NextResponse.json({ ok: false, message }, { status });

export function fail(err: unknown) {
  console.error("[CS]", err);
  return NextResponse.json({ ok: false, message: "처리 중 오류가 발생했습니다." }, { status: 500 });
}

export const toId = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
