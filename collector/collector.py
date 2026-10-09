#!/usr/bin/env python3
"""
DH 스마트파워 변압기 모니터링 — MQTT 수집 서버.

장비(측정모듈 · 브릿지 · 게이트웨이 PC)가 MQTT 로 올려 보낸 계측값을 받아
PostgreSQL 에 적재하고, 임계치 판정 결과를 알람으로 남깁니다.
반대 방향으로, 화면에서 넣은 명령을 장비로 내보내고 응답을 받아 적습니다.

  장비 --MQTT--> 브로커 --> [이 프로그램] --> PostgreSQL
       <--------          <--              (명령)          |
                                        웹 화면 / 알람 발송 워커

발신 주체(브릿지든 모듈이든 PC든)와 무관하게 동작합니다.
어느 설비의 값인지는 토픽이 아니라 페이로드의 deviceId 로 판단합니다.

브로커 접속 정보는 DB(mqtt_config)에서 읽습니다. 화면에서 바꾸면 곧바로
다시 접속합니다. DB 에 값이 없을 때만 환경변수를 씁니다.

실행:
    python3 collector.py
DATABASE_URL 은 같은 폴더의 .env 또는 상위 폴더의 .env.local 에서 읽습니다.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import signal
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import paho.mqtt.client as mqtt
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent


def load_env() -> None:
    """collector/.env 와 프로젝트 .env.local 을 읽습니다. 기존 환경변수가 우선입니다."""
    for path in (ROOT / ".env", ROOT.parent / ".env.local"):
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key in os.environ:
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            os.environ[key] = value


load_env()

DATABASE_URL = os.environ.get("DATABASE_URL")
LOG_LEVEL = os.environ.get("COLLECTOR_LOG_LEVEL", "INFO").upper()

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S%z",
)
log = logging.getLogger("collector")

if not DATABASE_URL:
    log.error("DATABASE_URL 이 없습니다. collector/.env 또는 .env.local 을 확인하세요.")
    sys.exit(1)

# DB 에 설정이 없을 때만 쓰는 값입니다.
ENV_FALLBACK = {
    "host": os.environ.get("MQTT_HOST", "127.0.0.1"),
    "port": int(os.environ.get("MQTT_PORT", "1883")),
    "username": os.environ.get("MQTT_USER") or None,
    "password": os.environ.get("MQTT_PASS") or None,
    "tls": os.environ.get("MQTT_TLS", "false").lower() == "true",
    "ca_path": os.environ.get("MQTT_CA") or None,
    "client_id": os.environ.get("MQTT_CLIENT_ID", "dh-collector"),
    "topic_prefix": os.environ.get("MQTT_TOPIC_PREFIX", "dh/v1"),
    "site": os.environ.get("MQTT_SITE", "dh1"),
    "keep_log_days": 7,
    # 명령 응답 대기시간. 헤디 회신은 1초 이내이지만 왕복 지연을 감안한 값입니다.
    "ack_timeout_sec": int(os.environ.get("COMMAND_ACK_TIMEOUT", "10")),
    # 재전송 한 메시지에 담을 수 있는 최대 항목 수.
    "max_replay_items": int(os.environ.get("MAX_REPLAY_ITEMS", "500")),
    # 수신 내역에 원문을 남길 최대 항목 수. 넘으면 요약만 남깁니다.
    "log_payload_items": int(os.environ.get("LOG_PAYLOAD_ITEMS", "20")),
    "version": 0,
}

# 값을 모아 보내는 주체(브릿지 · PC 게이트웨이)의 토픽상 종류입니다.
PARENT_TYPES = {"bridge", "gateway"}

# ---------------------------------------------------------------------------
# 판정 규칙 — 웹 화면(lib/alarmEngine.ts)과 같은 규칙입니다.
# ---------------------------------------------------------------------------

SEVERITY_ORDER = ["normal", "caution", "warning", "danger"]
SENSOR_LABEL = {
    "h2": "수소가스",
    "ch4": "메탄가스",
    "temperature": "절연유 온도",
    "oil_level": "절연유 유면",
}
SENSOR_UNIT = {"h2": "ppm", "ch4": "ppm", "temperature": "℃"}

DEFAULT_THRESHOLDS: dict[str, Any] = {
    "h2": {"caution": 20, "warning": 50, "danger": 100},
    "ch4": {"caution": 15, "warning": 30, "danger": 60},
    "temperature": {"caution": 55, "warning": 65, "danger": 75},
    "hysteresisMarginPct": 0.1,
    "compositeEnabled": True,
    "compositeMinSensors": 2,
    "offlineMinutes": 15,
    # 유면 저하를 몇 등급으로 볼지. 웹 화면(lib/types.ts)과 같은 기본값입니다.
    "oilLowLevel": "warning",
}


def classify(value: float, rule: dict[str, float], current: str, margin: float) -> str:
    """
    진입값은 그대로, 해제는 진입값보다 낮은 지점에서 이뤄지게 합니다.
    경계값 근처에서 알람이 반복 발생하는 것을 막습니다.
    """
    idx = SEVERITY_ORDER.index(current) if current in SEVERITY_ORDER else 0

    def exit_at(enter: float) -> float:
        return enter * (1 - margin)

    if value >= rule["danger"]:
        return "danger"
    if idx >= SEVERITY_ORDER.index("danger") and value >= exit_at(rule["danger"]):
        return "danger"
    if value >= rule["warning"]:
        return "warning"
    if idx >= SEVERITY_ORDER.index("warning") and value >= exit_at(rule["warning"]):
        return "warning"
    if value >= rule["caution"]:
        return "caution"
    if idx >= SEVERITY_ORDER.index("caution") and value >= exit_at(rule["caution"]):
        return "caution"
    return "normal"


def escalate(level: str) -> str:
    i = SEVERITY_ORDER.index(level)
    return SEVERITY_ORDER[min(i + 1, len(SEVERITY_ORDER) - 1)]


# ---------------------------------------------------------------------------
# 값 정규화
# ---------------------------------------------------------------------------


def to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def to_int(value: Any) -> int | None:
    f = to_float(value)
    return int(f) if f is not None else None


def to_oil(value: Any) -> str | None:
    """
    유면은 아직 규격 협의 중입니다.
    지금은 2치(정상/낮음)로 저장하며, 접점(0/1) · 문자열 · 숫자를 모두 받습니다.
    아날로그(%)로 확정되면 이 함수와 DB 컬럼을 함께 바꿉니다.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return "정상" if value else "낮음"
    if isinstance(value, (int, float)):
        return "정상" if value >= 1 else "낮음"
    text = str(value).strip().lower()
    if text in ("정상", "normal", "ok", "1", "true", "high"):
        return "정상"
    if text in ("낮음", "low", "0", "false", "alarm"):
        return "낮음"
    return None


def parse_time(value: Any) -> datetime:
    """장치가 준 시각을 씁니다. 없거나 이상하면 서버 시각으로 대체합니다."""
    now = datetime.now(timezone.utc)
    if value is None:
        return now
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 1e11 else value
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return now
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return now


MEASURE_KEYS = ("h2", "ch4", "temp", "temperature", "oil", "oil_level")


def extract_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """
    items 배열 형태와, 설비 하나만 담은 납작한 형태를 모두 받습니다.
    장비 업체가 어느 쪽으로 보내든 동작하게 하기 위한 것입니다.

    구성 1안처럼 모듈이 자기 값 하나만 올릴 때는 deviceId 가 없을 수 있습니다.
    측정값 키가 하나라도 있으면 설비 한 대의 값으로 보고, 어느 설비인지는
    호출한 쪽에서 토픽의 발신자 ID 로 채웁니다.
    """
    items = payload.get("items")
    if isinstance(items, list):
        return [i for i in items if isinstance(i, dict)]
    if payload.get("deviceId") or payload.get("device_id"):
        return [payload]
    if any(key in payload for key in MEASURE_KEYS):
        return [payload]
    return []


# ---------------------------------------------------------------------------
# 수집기
# ---------------------------------------------------------------------------


class Collector:
    def __init__(self) -> None:
        self.conn = psycopg.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)
        self.thresholds: dict[str, Any] = dict(DEFAULT_THRESHOLDS)
        self.config_version = -1
        self.broker: dict[str, Any] = dict(ENV_FALLBACK)
        self.levels: dict[str, dict[str, str]] = {}
        # 복합 판정으로 격상된 종합 등급. 같은 등급을 반복 기록하지 않기 위해 둡니다.
        self.composite: dict[str, str] = {}
        self.known_devices: set[str] = set()
        self.lock = threading.Lock()
        self.stats = {"messages": 0, "rows": 0, "alarms": 0, "errors": 0}
        self.started_at = datetime.now(timezone.utc)
        self.reload_thresholds()
        self.load_devices()
        self.load_broker()

    # ---- 설정 ----

    def load_broker(self) -> bool:
        """브로커 설정을 읽습니다. 바뀌었으면 True 를 돌려줍니다."""
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT host, port, username, password, tls, ca_path,
                       client_id, topic_prefix, site, keep_log_days,
                       ack_timeout_sec, max_replay_items, log_payload_items,
                       version
                  FROM mqtt_config WHERE id = 1
                """
            )
            row = cur.fetchone()
        if not row:
            return False
        changed = row != self.broker
        self.broker = dict(row)
        return changed

    def reload_thresholds(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute("SELECT thresholds, version FROM app_config WHERE id = 1")
            row = cur.fetchone()
        if not row or row["version"] == self.config_version:
            return
        merged = dict(DEFAULT_THRESHOLDS)
        merged.update(row["thresholds"] or {})
        self.thresholds = merged
        self.config_version = row["version"]
        log.info("임계치 설정 반영 — 버전 %s", self.config_version)

    def load_devices(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute("SELECT device_id FROM devices")
            self.known_devices = {r["device_id"] for r in cur.fetchall()}

    # ---- 상태 보고 ----

    def report_status(self, connected: bool | None = None, error: str | None = None) -> None:
        sets = [
            "last_heartbeat = now()",
            "messages = %s",
            "rows_stored = %s",
            "alarms = %s",
            "errors = %s",
            "broker = %s",
            "started_at = %s",
            "config_version = %s",
        ]
        args: list[Any] = [
            self.stats["messages"],
            self.stats["rows"],
            self.stats["alarms"],
            self.stats["errors"],
            f"{self.broker['host']}:{self.broker['port']}",
            self.started_at,
            self.config_version,
        ]
        if connected is not None:
            sets.append("connected = %s")
            args.append(connected)
        if error is not None:
            sets.append("last_error = %s")
            args.append(error[:500])
        try:
            with self.conn.cursor() as cur:
                cur.execute(f"UPDATE collector_status SET {', '.join(sets)} WHERE id = 1", args)
        except psycopg.Error as err:
            log.error("상태 기록 실패: %s", err)

    # ---- 수신 내역 ----

    def write_ingest(
        self,
        topic: str,
        src_type: str | None,
        src_id: str | None,
        kind: str | None,
        payload: Any,
        status: str,
        message: str | None = None,
        device_ids: list[str] | None = None,
        item_count: int = 0,
        stored_count: int = 0,
        replay: bool = False,
    ) -> None:
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ingest_log
                      (topic, src_type, src_id, kind, device_ids, item_count,
                       stored_count, replay, status, message, payload)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        topic, src_type, src_id, kind, device_ids or [], item_count,
                        stored_count, replay, status, message,
                        Json(payload) if payload is not None else None,
                    ),
                )
        except psycopg.Error as err:
            log.error("수신 내역 기록 실패: %s", err)

    def prune_logs(self) -> None:
        days = int(self.broker.get("keep_log_days") or 7)
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM ingest_log WHERE received_at < now() - (%s || ' days')::interval",
                    (days,),
                )
                if cur.rowcount:
                    log.info("오래된 수신 내역 %s건 정리", cur.rowcount)
        except psycopg.Error as err:
            log.error("수신 내역 정리 실패: %s", err)

    # ---- 설비 · 브릿지 ----

    def ensure_device(self, device_id: str, parent_id: str | None, link_type: str) -> bool:
        """
        등록되지 않은 설비가 값을 올리면 임시로 만들어 둡니다.
        현장 데이터를 버리는 것보다, 관리자가 나중에 이름을 고치는 편이 낫습니다.
        새로 만들었으면 True 를 돌려줍니다.
        """
        if device_id in self.known_devices:
            return False
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO devices (device_id, name, building, capacity, bridge_id, link_type)
                VALUES (%s, %s, '미지정', '', %s, %s)
                ON CONFLICT (device_id) DO NOTHING
                """,
                (device_id, device_id, parent_id, link_type),
            )
        self.known_devices.add(device_id)
        log.warning("미등록 설비 %s 가 값을 보내 임시 등록했습니다. (연결 %s)", device_id, link_type)
        return True

    def ensure_bridge(self, bridge_id: str, kind: str = "bridge") -> None:
        """브릿지와 2안의 사용자 PC(게이트웨이)를 같은 표에 담습니다."""
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO bridges (bridge_id, name, kind) VALUES (%s, %s, %s)
                ON CONFLICT (bridge_id) DO UPDATE SET kind = EXCLUDED.kind
                 WHERE bridges.kind <> EXCLUDED.kind
                """,
                (bridge_id, bridge_id, kind),
            )

    def check_capacity(self, parent_id: str) -> str | None:
        """
        RS-485 한 가닥의 수용 대수를 넘었는지 봅니다.
        넘었어도 값은 버리지 않고 경고만 남깁니다 — 현장 데이터가 우선입니다.
        """
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT b.max_devices,
                       (SELECT count(*) FROM devices d WHERE d.bridge_id = b.bridge_id) AS used
                  FROM bridges b WHERE b.bridge_id = %s
                """,
                (parent_id,),
            )
            row = cur.fetchone()
        if not row:
            return None
        limit = int(row["max_devices"] or 32)
        used = int(row["used"] or 0)
        if used > limit:
            return f"{parent_id} 에 등록된 설비가 {used}대로 수용 한도 {limit}대를 넘었습니다."
        return None

    # ---- 계측값 ----

    def handle_tele(self, topic: str, src_type: str, src_id: str, payload: dict[str, Any]) -> None:
        """
        계측값을 받습니다. 세 가지 구성 모두 이 한 곳에서 처리합니다.

          1안  토픽 .../module/<모듈ID>/tele     → 앞단 없음, link_type = direct
          2안  토픽 .../gateway/<PC ID>/tele     → 앞단은 사용자 PC
          3안  토픽 .../bridge/<브릿지ID>/tele   → 앞단은 브릿지

        어느 설비의 값인지는 페이로드의 deviceId 로 판단하고,
        1안처럼 deviceId 가 없으면 토픽의 발신자 ID 를 설비 ID 로 씁니다.
        """
        replay = bool(payload.get("replay"))
        is_parent = src_type in PARENT_TYPES
        parent_id = src_id if is_parent else None
        link_type = src_type if is_parent else "direct"
        if parent_id:
            self.ensure_bridge(parent_id, src_type)

        items = extract_items(payload)
        if not items:
            self.stats["errors"] += 1
            self.write_ingest(topic, src_type, src_id, "tele", payload, "error",
                              "계측값(items)이 비어 있거나 형식이 다릅니다.")
            log.warning("계측값이 비어 있습니다: %s", topic)
            return

        notes: list[str] = []
        received = len(items)  # 장비가 실제로 보낸 항목 수 (수신 내역에 그대로 남깁니다)
        limit = int(self.broker.get("max_replay_items") or 500)
        if len(items) > limit:
            # 1개월분을 한 번에 쏟아부으면 수집이 막힙니다.
            # 상한까지만 받고, 남은 구간은 다시 요청하게 둡니다.
            notes.append(f"한 메시지 항목 수 상한 {limit}개를 넘어 앞의 {limit}개만 받았습니다.")
            log.warning("%s 항목 %d개 — 상한 %d개까지만 처리합니다.", topic, len(items), limit)
            items = items[:limit]

        seen: list[str] = []
        rows: list[tuple[Any, ...]] = []
        # 설비별 마지막 값만 현재값·판정에 씁니다 (한 메시지에 여러 시각이 담길 수 있음).
        latest: dict[str, tuple[datetime, float | None, float | None, float | None, str | None]] = {}

        for item in items:
            device_id = str(
                item.get("deviceId") or item.get("device_id")
                or (src_id if not is_parent else "")
            ).strip()
            if not device_id:
                notes.append("deviceId 없는 항목을 건너뛰었습니다.")
                continue

            if self.ensure_device(device_id, parent_id, link_type):
                notes.append(f"미등록 설비 {device_id} 임시 등록")
            if device_id not in seen:
                seen.append(device_id)

            measured_at = parse_time(item.get("ts") or payload.get("ts"))
            h2 = to_float(item.get("h2"))
            ch4 = to_float(item.get("ch4"))
            temp = to_float(item.get("temp", item.get("temperature")))
            oil = to_oil(item.get("oil", item.get("oil_level")))

            if h2 is None and ch4 is None and temp is None and oil is None:
                notes.append(f"{device_id}: 읽을 수 있는 측정값이 없습니다.")

            rows.append((device_id, h2, ch4, temp, oil, measured_at))
            prior = latest.get(device_id)
            if prior is None or measured_at >= prior[0]:
                latest[device_id] = (measured_at, h2, ch4, temp, oil)

        stored = self.store_telemetry(rows)

        if parent_id:
            warn = self.check_capacity(parent_id)
            if warn:
                notes.append(warn)

        if not replay:
            for device_id, (measured_at, h2, ch4, temp, oil) in latest.items():
                self.store_current(device_id, h2, ch4, temp, oil, measured_at)
                self.mark_device_seen(device_id, measured_at)
                self.evaluate(device_id, h2, ch4, temp, oil)
        else:
            # 재전송분은 이력만 채웁니다.
            # 지금 상태를 과거 값으로 덮어쓰거나, 지난 이상으로 알람을 울리면 안 됩니다.
            notes.append(f"재전송 {len(rows)}건 — 이력만 적용(현재값·알람 제외)")

        self.stats["rows"] += stored
        self.stats["messages"] += 1
        self.write_ingest(
            topic, src_type, src_id, "tele", self.log_payload(payload, received),
            "warn" if notes else "ok",
            " / ".join(notes) if notes else None,
            device_ids=seen, item_count=received, stored_count=stored, replay=replay,
        )

    def store_telemetry(self, rows: list[tuple[Any, ...]]) -> int:
        """
        계측값을 한 번에 넣습니다. 1개월분 재전송처럼 항목이 많을 때
        한 건씩 왕복하면 수집이 따라가지 못합니다.
        """
        if not rows:
            return 0
        with self.conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO telemetry (device_id, h2, ch4, temperature, oil_level, measured_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (device_id, measured_at) DO NOTHING
                """,
                rows,
            )
            # executemany 의 rowcount 는 드라이버마다 다릅니다. 음수면 건수를 알 수 없다는 뜻입니다.
            return cur.rowcount if cur.rowcount and cur.rowcount > 0 else len(rows)

    def store_current(
        self, device_id: str, h2: float | None, ch4: float | None,
        temp: float | None, oil: str | None, measured_at: datetime,
    ) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO device_readings (device_id, h2, ch4, temperature, oil_level, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (device_id) DO UPDATE
                   SET h2 = EXCLUDED.h2,
                       ch4 = EXCLUDED.ch4,
                       temperature = EXCLUDED.temperature,
                       oil_level = EXCLUDED.oil_level,
                       updated_at = EXCLUDED.updated_at
                 WHERE EXCLUDED.updated_at >= device_readings.updated_at
                """,
                (device_id, h2, ch4, temp, oil, measured_at),
            )

    def mark_device_seen(self, device_id: str, measured_at: datetime) -> None:
        """값이 올라온 설비는 접속 중으로 봅니다 (1안 모듈 직결에서 특히 필요)."""
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE devices
                   SET online = true,
                       last_seen_at = GREATEST(COALESCE(last_seen_at, %s), %s)
                 WHERE device_id = %s
                """,
                (measured_at, measured_at, device_id),
            )

    def mark_stale_offline(self) -> None:
        """
        통신단절 판정 시간을 넘긴 설비·앞단을 오프라인으로 내립니다.
        화면은 updated_at 으로도 판정하지만, 표에 접속 상태를 직접 보여주기 위해 적어 둡니다.
        """
        minutes = int(self.thresholds.get("offlineMinutes", 15))
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE devices SET online = false
                 WHERE online = true
                   AND (last_seen_at IS NULL OR last_seen_at < now() - (%s || ' minutes')::interval)
                """,
                (minutes,),
            )
            cur.execute(
                """
                UPDATE bridges SET online = false
                 WHERE online = true
                   AND (last_seen_at IS NULL OR last_seen_at < now() - (%s || ' minutes')::interval)
                """,
                (minutes,),
            )

    def log_payload(self, payload: dict[str, Any], item_count: int) -> dict[str, Any]:
        """
        수신 내역에는 원문을 남기지만, 재전송처럼 항목이 많으면
        앞부분만 남기고 나머지는 건수로 적습니다. 로그 표가 비대해지는 것을 막습니다.
        """
        keep = int(self.broker.get("log_payload_items") or 20)
        if item_count <= keep:
            return payload
        trimmed = {k: v for k, v in payload.items() if k != "items"}
        items = payload.get("items")
        if isinstance(items, list):
            trimmed["items"] = items[:keep]
        trimmed["_생략"] = f"항목 {item_count}개 중 앞 {keep}개만 보관"
        return trimmed

    # ---- 판정 및 알람 ----

    def evaluate(
        self,
        device_id: str,
        h2: float | None,
        ch4: float | None,
        temp: float | None,
        oil: str | None,
    ) -> None:
        t = self.thresholds
        margin = float(t.get("hysteresisMarginPct", 0.1))
        prev = self.levels.get(device_id, {k: "normal" for k in SENSOR_LABEL})

        current: dict[str, str] = {}
        values: dict[str, float | None] = {"h2": h2, "ch4": ch4, "temperature": temp}

        for key in ("h2", "ch4", "temperature"):
            value = values[key]
            if value is None:
                # 값이 안 왔으면 직전 등급을 유지합니다. 임의로 정상으로 내리지 않습니다.
                current[key] = prev.get(key, "normal")
                continue
            current[key] = classify(value, t[key], prev.get(key, "normal"), margin)

        # 유면 저하를 몇 등급으로 볼지는 설정값입니다. 웹 화면과 같은 값을 씁니다.
        oil_level = str(t.get("oilLowLevel", "warning"))
        if oil_level not in SEVERITY_ORDER:
            oil_level = "warning"
        current["oil_level"] = oil_level if oil == "낮음" else "normal"

        name = self.device_name(device_id)
        for key, level in current.items():
            before = prev.get(key, "normal")
            if SEVERITY_ORDER.index(level) <= SEVERITY_ORDER.index(before):
                continue
            self.write_alarm(device_id, name, key, level, values.get(key), t)

        self.levels[device_id] = current

        # ---- 복합 판정: 동시에 이상인 센서가 기준 개수 이상이면 한 단계 격상 ----
        abnormal = [k for k, v in current.items() if v != "normal"]
        worst = max(current.values(), key=SEVERITY_ORDER.index)
        overall = worst
        if t.get("compositeEnabled") and len(abnormal) >= int(t.get("compositeMinSensors", 2)):
            overall = escalate(worst)

        before_overall = self.composite.get(device_id, "normal")
        if overall != worst and SEVERITY_ORDER.index(overall) > SEVERITY_ORDER.index(before_overall):
            labels = ", ".join(SENSOR_LABEL[k] for k in abnormal)
            self.write_composite_alarm(device_id, name, overall, len(abnormal), labels)
        self.composite[device_id] = overall

    def device_name(self, device_id: str) -> str:
        with self.conn.cursor() as cur:
            cur.execute("SELECT name FROM devices WHERE device_id = %s", (device_id,))
            row = cur.fetchone()
        return row["name"] if row else device_id

    def write_alarm(
        self, device_id: str, name: str, sensor: str, level: str,
        value: float | None, thresholds: dict[str, Any],
    ) -> None:
        label = SENSOR_LABEL[sensor]
        level_word = {"caution": "주의", "warning": "경고", "danger": "위험"}[level]

        if sensor == "oil_level":
            item = "절연유 유면 저하"
            detail = "유면 낮음 감지"
        else:
            item = f"{label} {level_word} 임계치 초과"
            unit = SENSOR_UNIT.get(sensor, "")
            limit = thresholds[sensor][level]
            detail = f"{value:.1f} {unit} / 기준 {limit}" if value is not None else f"기준 {limit}"

        with self.conn.cursor() as cur:
            cur.execute(
                "INSERT INTO alarm_events (device_id, unit, item, level, detail) VALUES (%s,%s,%s,%s,%s)",
                (device_id, name, item, level, detail),
            )
        self.stats["alarms"] += 1
        log.info("알람 기록 — %s %s (%s)", name, item, detail)

    def write_composite_alarm(
        self, device_id: str, name: str, level: str, count: int, labels: str,
    ) -> None:
        """여러 센서가 동시에 이상일 때의 종합 판정을 알람으로 남깁니다."""
        level_word = {"caution": "주의", "warning": "경고", "danger": "위험"}[level]
        with self.conn.cursor() as cur:
            cur.execute(
                "INSERT INTO alarm_events (device_id, unit, item, level, detail) VALUES (%s,%s,%s,%s,%s)",
                (device_id, name, f"복합 이상 {level_word} 판정", level,
                 f"{count}개 센서 동시 이상 ({labels})"),
            )
        self.stats["alarms"] += 1
        log.info("복합 판정 알람 — %s %d개 센서 동시 이상 → %s", name, count, level)

    # ---- 장치 상태 ----

    def handle_stat(self, topic: str, src_type: str, src_id: str, payload: dict[str, Any]) -> None:
        """
        접속 상태를 받습니다. 브릿지(3안) · 사용자 PC(2안) · 모듈 직결(1안)
        모두 자기 자신의 상태를 올릴 수 있습니다.
        """
        online = bool(payload.get("online", True))
        note = "온라인" if online else "오프라인"

        if src_type in PARENT_TYPES:
            self.ensure_bridge(src_id, src_type)
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE bridges
                       SET online = %s,
                           kind = %s,
                           fw_version = COALESCE(%s, fw_version),
                           rssi = COALESCE(%s, rssi),
                           last_seen_at = now()
                     WHERE bridge_id = %s
                    """,
                    (online, src_type, payload.get("fw"), payload.get("rssi"), src_id),
                )
            label = "브릿지" if src_type == "bridge" else "게이트웨이"
            log.info("%s %s 상태 — %s", label, src_id, note)
        else:
            # 1안. 모듈이 직접 붙은 경우입니다. 설비 자신의 상태로 적습니다.
            device_id = str(payload.get("deviceId") or payload.get("device_id") or src_id).strip()
            self.ensure_device(device_id, None, "direct")
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE devices
                       SET online = %s,
                           fw_version = COALESCE(%s, fw_version),
                           rssi = COALESCE(%s, rssi),
                           interval_sec = COALESCE(%s, interval_sec),
                           last_seen_at = now()
                     WHERE device_id = %s
                    """,
                    (online, payload.get("fw"), payload.get("rssi"),
                     to_int(payload.get("interval")), device_id),
                )
            note = f"설비 {device_id} {note}"
            log.info("측정모듈 %s 상태 — %s", device_id, "온라인" if online else "오프라인")

        self.stats["messages"] += 1
        self.write_ingest(topic, src_type, src_id, "stat", payload, "ok", note)

    # ---- 명령 응답 ----

    def handle_ack(self, topic: str, src_type: str, src_id: str, payload: dict[str, Any]) -> None:
        cmd_id = payload.get("cmdId") or payload.get("cmd_id") or payload.get("id")
        ok = payload.get("ok", True)
        self.stats["messages"] += 1

        if cmd_id is None:
            self.write_ingest(topic, src_type, src_id, "cmd/ack", payload, "warn",
                              "cmdId 가 없어 어느 명령의 응답인지 알 수 없습니다.")
            return

        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE device_commands
                   SET status = %s, acked_at = now(), ack = %s,
                       error = CASE WHEN %s THEN NULL ELSE %s END
                 WHERE id = %s AND status IN ('pending','sent','timeout')
             RETURNING command, params, device_id, target_id, target_type
                """,
                ("acked" if ok else "failed", Json(payload), ok,
                 str(payload.get("error") or "장치가 실패로 응답했습니다."), int(cmd_id)),
            )
            row = cur.fetchone()
            matched = cur.rowcount

        # 측정 주기 변경이 성공했으면 설비에 적용된 값으로 적어 둡니다.
        if row and ok and row["command"] == "set_interval":
            seconds = to_int((row["params"] or {}).get("seconds"))
            target = row["device_id"] or (row["target_id"] if row["target_type"] == "module" else None)
            if seconds and target:
                with self.conn.cursor() as cur:
                    cur.execute(
                        "UPDATE devices SET interval_sec = %s WHERE device_id = %s",
                        (seconds, target),
                    )

        self.write_ingest(topic, src_type, src_id, "cmd/ack", payload,
                          "ok" if matched else "warn",
                          f"명령 {cmd_id} {'응답 반영' if matched else '을 찾지 못했습니다'}")
        log.info("명령 %s 응답 — %s", cmd_id, "성공" if ok else "실패")

    # ---- 명령 발행 ----

    def pending_commands(self, only_id: int | None = None) -> list[dict[str, Any]]:
        sql = """
            SELECT id, site, target_type, target_id, device_id, command, params
              FROM device_commands
             WHERE status = 'pending'
        """
        args: list[Any] = []
        if only_id is not None:
            sql += " AND id = %s"
            args.append(only_id)
        sql += " ORDER BY id"
        with self.conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchall()

    def mark_command(self, cmd_id: int, status: str, error: str | None = None) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE device_commands
                   SET status = %s,
                       sent_at = CASE WHEN %s = 'sent' THEN now() ELSE sent_at END,
                       error = %s
                 WHERE id = %s
                """,
                (status, status, error, cmd_id),
            )

    def expire_commands(self) -> None:
        """
        응답이 오지 않은 명령을 시간이 지나면 미응답으로 정리합니다.
        대기시간은 화면(데이터 연결)에서 바꿀 수 있습니다.
        장비 규격은 1초 이내 응답이므로 기본 10초면 넉넉합니다.
        """
        timeout = int(self.broker.get("ack_timeout_sec") or 10)
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE device_commands
                   SET status = 'timeout',
                       error = %s
                 WHERE status = 'sent'
                   AND sent_at < now() - (%s || ' seconds')::interval
                """,
                (f"{timeout}초 안에 응답이 오지 않았습니다.", timeout),
            )
            if cur.rowcount:
                log.warning("명령 %s건이 응답 없이 시간 초과되었습니다.", cur.rowcount)


# ---------------------------------------------------------------------------
# MQTT 연결
# ---------------------------------------------------------------------------


def main() -> None:
    collector = Collector()
    stopping = threading.Event()
    restart = threading.Event()
    command_queue: queue.Queue[int | None] = queue.Queue()

    state: dict[str, Any] = {"client": None}

    def topics(prefix: str) -> list[tuple[str, int]]:
        return [
            (f"{prefix}/+/+/+/tele", 1),
            (f"{prefix}/+/+/+/stat", 1),
            (f"{prefix}/+/+/+/cmd/ack", 1),
        ]

    # ---- 명령 발행 ----

    def publish_commands(only_id: int | None = None) -> None:
        client = state.get("client")
        if client is None:
            return
        try:
            with collector.lock:
                rows = collector.pending_commands(only_id)
        except psycopg.Error as err:
            log.error("명령 조회 실패: %s", err)
            return

        for row in rows:
            prefix = collector.broker["topic_prefix"]
            topic = f"{prefix}/{row['site']}/{row['target_type']}/{row['target_id']}/cmd"
            body = {
                "cmdId": row["id"],
                "command": row["command"],
                "ts": datetime.now(timezone.utc).isoformat(),
            }
            if row["device_id"]:
                body["deviceId"] = row["device_id"]
            if row["params"]:
                body["params"] = row["params"]

            try:
                info = client.publish(topic, json.dumps(body, ensure_ascii=False), qos=1)
                info.wait_for_publish(timeout=5)
                published = info.is_published()
            except (ValueError, RuntimeError, OSError) as err:
                published = False
                log.error("명령 %s 발행 실패: %s", row["id"], err)

            with collector.lock:
                if published:
                    collector.mark_command(row["id"], "sent")
                    log.info("명령 %s 발행 — %s %s", row["id"], topic, row["command"])
                else:
                    collector.mark_command(row["id"], "failed", "브로커로 내보내지 못했습니다.")

    # ---- 콜백 ----

    def on_connect(client: mqtt.Client, _userdata, _flags, reason_code, _props=None):
        if getattr(reason_code, "is_failure", reason_code != 0):
            log.error("브로커 연결 거부: %s", reason_code)
            with collector.lock:
                collector.report_status(connected=False, error=f"연결 거부: {reason_code}")
            return
        prefix = collector.broker["topic_prefix"]
        client.subscribe(topics(prefix))
        log.info("브로커 연결됨 — 구독 %s/+/+/+/{tele,stat,cmd/ack}", prefix)
        with collector.lock:
            collector.report_status(connected=True, error="")
        command_queue.put(None)  # 밀린 명령 발행

    def on_disconnect(_client, _userdata, _flags, reason_code, _props=None):
        with collector.lock:
            collector.report_status(connected=False)
        if not stopping.is_set() and not restart.is_set():
            log.warning("브로커 연결 끊김(%s). 자동 재연결합니다.", reason_code)

    def on_message(_client, _userdata, msg: mqtt.MQTTMessage):
        prefix_len = len(collector.broker["topic_prefix"].split("/"))
        parts = msg.topic.split("/")
        if len(parts) < prefix_len + 4:
            with collector.lock:
                collector.write_ingest(msg.topic, None, None, "unknown", None, "error",
                                       "토픽 형식이 규격과 다릅니다.")
            return
        _site, src_type, src_id = parts[prefix_len], parts[prefix_len + 1], parts[prefix_len + 2]
        kind = "/".join(parts[prefix_len + 3:])

        raw = msg.payload.decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as err:
            with collector.lock:
                collector.stats["errors"] += 1
                collector.write_ingest(msg.topic, src_type, src_id, kind,
                                       {"raw": raw[:2000]}, "error", f"JSON 파싱 실패: {err}")
            log.warning("%s 페이로드를 읽지 못했습니다: %s", msg.topic, err)
            return
        if not isinstance(payload, dict):
            with collector.lock:
                collector.stats["errors"] += 1
                collector.write_ingest(msg.topic, src_type, src_id, kind,
                                       {"raw": raw[:2000]}, "error", "페이로드가 객체가 아닙니다.")
            return

        try:
            with collector.lock:
                if kind == "tele":
                    collector.handle_tele(msg.topic, src_type, src_id, payload)
                elif kind == "stat":
                    collector.handle_stat(msg.topic, src_type, src_id, payload)
                elif kind == "cmd/ack":
                    collector.handle_ack(msg.topic, src_type, src_id, payload)
                else:
                    collector.write_ingest(msg.topic, src_type, src_id, kind, payload,
                                           "warn", "처리 대상이 아닌 토픽입니다.")
                collector.conn.execute(
                    "UPDATE collector_status SET last_message_at = now() WHERE id = 1"
                )
        except psycopg.Error as err:
            log.error("DB 오류 (%s): %s", msg.topic, err)
        except Exception as err:  # 한 건의 오류로 수집이 멈추면 안 됩니다.
            log.exception("처리 실패 (%s): %s", msg.topic, err)

    # ---- DB 통지 구독 (명령 · 설정 변경) ----

    def listen_db():
        while not stopping.is_set():
            try:
                with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
                    conn.execute("LISTEN device_command")
                    conn.execute("LISTEN mqtt_config")
                    conn.execute("LISTEN devices_changed")
                    log.info("DB 통지 구독 — device_command, mqtt_config, devices_changed")
                    # notifies() 는 timeout 이 지나면 끝납니다.
                    # 같은 접속을 유지한 채 다시 기다립니다 (매번 재접속하지 않습니다).
                    while not stopping.is_set():
                        for note in conn.notifies(timeout=5):
                            if stopping.is_set():
                                break
                            if note.channel == "device_command":
                                command_queue.put(int(note.payload))
                            elif note.channel == "devices_changed":
                                # 화면에서 설비를 지우거나 추가한 직후에도
                                # 다음 값이 그대로 적재되게 합니다.
                                with collector.lock:
                                    collector.load_devices()
                            elif note.channel == "mqtt_config":
                                log.info("브로커 설정 변경 감지 — 다시 접속합니다.")
                                restart.set()
                                client = state.get("client")
                                if client:
                                    client.disconnect()
            except psycopg.Error as err:
                if stopping.is_set():
                    break
                log.error("DB 통지 구독 끊김: %s", err)
                time.sleep(5)

    def dispatch_commands():
        while not stopping.is_set():
            try:
                cmd_id = command_queue.get(timeout=2)
            except queue.Empty:
                continue
            publish_commands(cmd_id)

    def housekeeping():
        # 응답 대기시간이 10초 단위이므로 5초마다 돌립니다.
        # 무거운 작업(설정 재읽기 · 로그 정리)은 6번에 한 번만 합니다.
        tick = 0
        while not stopping.wait(5):
            tick += 1
            try:
                with collector.lock:
                    collector.expire_commands()
                    if tick % 6 == 0:
                        collector.reload_thresholds()
                        collector.load_devices()
                        collector.report_status()
                        collector.prune_logs()
                        collector.mark_stale_offline()
                if tick % 6 == 0:
                    # 통지를 놓쳤을 경우를 대비해 밀린 명령을 훑습니다.
                    publish_commands(None)
            except psycopg.Error as err:
                log.error("주기 작업 실패: %s", err)

    threading.Thread(target=listen_db, daemon=True).start()
    threading.Thread(target=dispatch_commands, daemon=True).start()
    threading.Thread(target=housekeeping, daemon=True).start()

    def shutdown(_signum, _frame):
        stopping.set()
        log.info("종료합니다. 누적 — %s", collector.stats)
        with collector.lock:
            collector.report_status(connected=False)
        client = state.get("client")
        if client:
            client.disconnect()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # ---- 접속 루프 ----

    while not stopping.is_set():
        restart.clear()
        with collector.lock:
            collector.load_broker()
            broker = dict(collector.broker)

        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=broker["client_id"],
            clean_session=False,
        )
        client.on_connect = on_connect
        client.on_disconnect = on_disconnect
        client.on_message = on_message
        if broker.get("username"):
            client.username_pw_set(broker["username"], broker.get("password"))
        if broker.get("tls"):
            client.tls_set(ca_certs=broker.get("ca_path") or None)
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        state["client"] = client

        log.info("수집 서버 시작 — 브로커 %s:%s", broker["host"], broker["port"])
        try:
            client.connect(broker["host"], int(broker["port"]), keepalive=60)
            client.loop_forever()
        except OSError as err:
            if stopping.is_set():
                break
            log.error("브로커에 붙지 못했습니다(%s). 5초 후 재시도.", err)
            with collector.lock:
                collector.report_status(connected=False, error=str(err))
            time.sleep(5)
        finally:
            state["client"] = None


if __name__ == "__main__":
    main()
