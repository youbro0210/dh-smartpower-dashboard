import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSafeOp } from "../cs-engine/policy.ts";
import { ADMIN_PREFIXES, isAdminScreen, screenName } from "../lib/cs/catalog.ts";
import { AUTO_FIELDS, ENTITIES } from "../lib/cs/entities.ts";

/** DH 어댑터 규칙입니다. 감시 판정에 닿는 것이 자동 반영 경로로 들어오지 않는지 지킵니다. */
const op = (entity: string, set: Record<string, unknown>) => ({ type: "update", entity, id: 1, set }) as never;

test("판정·계측·계정 표는 정정 대상이 아니다", () => {
  const tables = Object.values(ENTITIES).map((e) => e.table);
  for (const t of ["app_config", "telemetry", "device_readings", "alarm_events", "device_commands", "mqtt_config", "users", "notify_channels"]) {
    assert.equal(tables.includes(t), false, t);
  }
  assert.equal("target" in ENTITIES.recipient.fields, false);
  assert.equal("min_level" in ENTITIES.recipient.fields, false);
});

test("자동 반영 칸은 정정 가능한 칸 안에 있고, 날짜·설비 정보는 뺀다", () => {
  for (const [entity, fields] of Object.entries(AUTO_FIELDS)) {
    for (const f of fields) assert.ok(ENTITIES[entity].fields[f], `${entity}.${f}`);
  }
  assert.equal(isSafeOp(op("maintenance", { detail: "메모" }), AUTO_FIELDS), true);
  assert.equal(isSafeOp(op("maintenance", { detail: "메모", work_date: "2026-11-01" }), AUTO_FIELDS), false);
  assert.equal(isSafeOp(op("maintenance", { next_due: "2026-12-01" }), AUTO_FIELDS), false);
  assert.equal(isSafeOp(op("device", { building: "B동" }), AUTO_FIELDS), false);
  assert.equal(isSafeOp(op("recipient", { name: "홍길동" }), AUTO_FIELDS), false);
});

test("칸 이름과 표 이름은 SQL 에 그대로 들어가므로 식별자 형식만 쓴다", () => {
  for (const e of Object.values(ENTITIES)) {
    for (const n of [e.table, e.idColumn, ...Object.keys(e.fields)]) assert.match(n, /^[a-z_]+$/);
  }
});

test("관리 메뉴 판별", () => {
  for (const u of ["/settings", "/settings/notify", "/admin", "/login-history?x=1"]) assert.equal(isAdminScreen(u), true, u);
  for (const u of ["/", "/devices", "/settingsx", "/maintenance", null]) assert.equal(isAdminScreen(u), false, String(u));
});

test("화면 이름은 가장 길게 맞는 주소로 찾는다", () => {
  assert.equal(screenName("/settings/notify?x=1"), "설정 › 알림 발송");
  assert.equal(screenName("/devices"), "설비 현황");
  assert.equal(screenName("/없는화면"), "/없는화면");
});

test(".autofix.yml 이 감시·권한 경로와 관리 메뉴를 막는다", () => {
  const yml = readFileSync(new URL("../.autofix.yml", import.meta.url), "utf8");
  const forbidden = [...yml.matchAll(/^\s+- "([^"]+)"$/gm)].map((m) => m[1]);
  for (const p of ["collector/*", "lib/alarmEngine*", "lib/thresholds*", "lib/auth*", "middleware.ts", "app/api/commands/*", "db/*", "deploy/*", ".github/*", "lib/cs/*", "cs-engine/*"]) {
    assert.ok(forbidden.includes(p), p);
  }
  for (const p of ADMIN_PREFIXES) assert.ok(forbidden.includes(`app${p}/*`), p);
});
