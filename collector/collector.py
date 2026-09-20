#!/usr/bin/env python3
"""
DH 스마트파워 변압기 모니터링 — MQTT 수집 서버.

장비(측정모듈 · 브릿지 · 게이트웨이 PC)가 MQTT 로 올려 보낸 계측값을 받아
PostgreSQL 에 적재하고, 임계치 판정 결과를 알람으로 남깁니다.

  장비 --MQTT--> 브로커 --> [이 프로그램] --> PostgreSQL
                                                  |
                                    웹 화면 / 알람 발송 워커가 읽음

발신 주체(브릿지든 모듈이든 PC든)와 무관하게 동작합니다.
어느 설비의 값인지는 토픽이 아니라 페이로드의 deviceId 로 판단합니다.

실행:
    python3 collector.py
환경변수는 같은 폴더의 .env 또는 상위 폴더의 .env.local 에서 읽습니다.
"""

from __future__ import annotations

import json
import logging
import os
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
MQTT_HOST = os.environ.get("MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USER = os.environ.get("MQTT_USER") or None
MQTT_PASS = os.environ.get("MQTT_PASS") or None
MQTT_TLS = os.environ.get("MQTT_TLS", "false").lower() == "true"
MQTT_CA = os.environ.get("MQTT_CA") or None
MQTT_CLIENT_ID = os.environ.get("MQTT_CLIENT_ID", "dh-collector")
TOPIC_PREFIX = os.environ.get("MQTT_TOPIC_PREFIX", "dh/v1")

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

# 토픽:  dh/v1/{site}/{srcType}/{srcId}/tele | stat | cmd/ack
TOPIC_TELE = f"{TOPIC_PREFIX}/+/+/+/tele"
TOPIC_STAT = f"{TOPIC_PREFIX}/+/+/+/stat"
TOPIC_ACK = f"{TOPIC_PREFIX}/+/+/+/cmd/ack"

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
        # epoch 초 / 밀리초 모두 받습니다.
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


def extract_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """
    items 배열 형태와, 설비 하나만 담은 납작한 형태를 모두 받습니다.
    장비 업체가 어느 쪽으로 보내든 동작하게 하기 위한 것입니다.
    """
    items = payload.get("items")
    if isinstance(items, list):
        return [i for i in items if isinstance(i, dict)]
    if payload.get("deviceId") or payload.get("device_id"):
        return [payload]
    return []


# ---------------------------------------------------------------------------
# 수집기
# ---------------------------------------------------------------------------


class Collector:
    def __init__(self) -> None:
        self.conn = psycopg.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)
        self.thresholds: dict[str, Any] = dict(DEFAULT_THRESHOLDS)
        self.config_version = 0
        # 센서별 직전 등급. 히스테리시스 판정의 입력입니다.
        self.levels: dict[str, dict[str, str]] = {}
        self.known_devices: set[str] = set()
        self.lock = threading.Lock()
        self.stats = {"tele": 0, "rows": 0, "alarms": 0, "skipped": 0}
        self.reload_config()
        self.load_devices()

    # ---- 설정 ----

    def reload_config(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute("SELECT thresholds, version FROM app_config WHERE id = 1")
            row = cur.fetchone()
        if not row:
            return
        version = row["version"]
        if version == self.config_version:
            return
        merged = dict(DEFAULT_THRESHOLDS)
        merged.update(row["thresholds"] or {})
        self.thresholds = merged
        self.config_version = version
        log.info("임계치 설정 반영 — 버전 %s", version)

    def load_devices(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute("SELECT device_id FROM devices")
            self.known_devices = {r["device_id"] for r in cur.fetchall()}

    def ensure_device(self, device_id: str, bridge_id: str | None) -> None:
        """
        등록되지 않은 설비가 값을 올리면 임시로 만들어 둡니다.
        현장 데이터를 버리는 것보다, 관리자가 나중에 이름을 고치는 편이 낫습니다.
        """
        if device_id in self.known_devices:
            return
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO devices (device_id, name, building, capacity, bridge_id)
                VALUES (%s, %s, '미지정', '', %s)
                ON CONFLICT (device_id) DO NOTHING
                """,
                (device_id, device_id, bridge_id),
            )
        self.known_devices.add(device_id)
        log.warning("미등록 설비 %s 가 값을 보내 임시 등록했습니다. 설정에서 이름을 지정하세요.", device_id)

    def ensure_bridge(self, bridge_id: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO bridges (bridge_id, name) VALUES (%s, %s)
                ON CONFLICT (bridge_id) DO NOTHING
                """,
                (bridge_id, bridge_id),
            )

    # ---- 계측값 ----

    def handle_tele(self, src_type: str, src_id: str, payload: dict[str, Any]) -> None:
        replay = bool(payload.get("replay"))
        bridge_id = src_id if src_type == "bridge" else None
        if bridge_id:
            self.ensure_bridge(bridge_id)

        items = extract_items(payload)
        if not items:
            log.warning("계측값이 비어 있습니다: %s/%s", src_type, src_id)
            return

        for item in items:
            device_id = str(item.get("deviceId") or item.get("device_id") or "").strip()
            if not device_id:
                self.stats["skipped"] += 1
                continue

            self.ensure_device(device_id, bridge_id)

            measured_at = parse_time(item.get("ts") or payload.get("ts"))
            h2 = to_float(item.get("h2"))
            ch4 = to_float(item.get("ch4"))
            temp = to_float(item.get("temp", item.get("temperature")))
            oil = to_oil(item.get("oil", item.get("oil_level")))

            # 원본 이력. (device_id, measured_at) 유일 제약이 중복 수신을 걸러 줍니다.
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO telemetry (device_id, h2, ch4, temperature, oil_level, measured_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (device_id, measured_at) DO NOTHING
                    """,
                    (device_id, h2, ch4, temp, oil, measured_at),
                )
                inserted = cur.rowcount
            self.stats["rows"] += inserted

            if replay:
                # 재전송분은 이력만 채웁니다.
                # 지금 상태를 과거 값으로 덮어쓰거나, 지난 이상으로 알람을 울리면 안 됩니다.
                continue

            # 최신값. 더 과거의 값이 뒤늦게 와도 현재 상태를 밀어내지 않게 합니다.
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

            self.evaluate(device_id, h2, ch4, temp, oil, measured_at)

        self.stats["tele"] += 1

    # ---- 판정 및 알람 ----

    def evaluate(
        self,
        device_id: str,
        h2: float | None,
        ch4: float | None,
        temp: float | None,
        oil: str | None,
        measured_at: datetime,
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

        current["oil_level"] = "danger" if oil == "낮음" else "normal"

        # 등급이 올라간 센서만 알람으로 남깁니다. 매 수신마다 남기면 이력이 무의미해집니다.
        name = self.device_name(device_id)
        for key, level in current.items():
            before = prev.get(key, "normal")
            if SEVERITY_ORDER.index(level) <= SEVERITY_ORDER.index(before):
                continue
            self.write_alarm(device_id, name, key, level, values.get(key), oil, t)

        self.levels[device_id] = current

        # 복합 판정은 전체 등급에만 적용합니다(화면 표시와 동일한 규칙).
        abnormal = [k for k, v in current.items() if v != "normal"]
        if (
            t.get("compositeEnabled")
            and len(abnormal) >= int(t.get("compositeMinSensors", 2))
            and abnormal
        ):
            worst = max(current.values(), key=SEVERITY_ORDER.index)
            raised = escalate(worst)
            if raised != worst:
                log.info(
                    "%s 복합 판정 — %d개 센서 동시 이상으로 %s → %s",
                    name, len(abnormal), worst, raised,
                )

        _ = measured_at  # 알람 시각은 DB 기본값(now())을 씁니다.

    def device_name(self, device_id: str) -> str:
        with self.conn.cursor() as cur:
            cur.execute("SELECT name FROM devices WHERE device_id = %s", (device_id,))
            row = cur.fetchone()
        return row["name"] if row else device_id

    def write_alarm(
        self,
        device_id: str,
        name: str,
        sensor: str,
        level: str,
        value: float | None,
        oil: str | None,
        thresholds: dict[str, Any],
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
                """
                INSERT INTO alarm_events (device_id, unit, item, level, detail)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (device_id, name, item, level, detail),
            )
        self.stats["alarms"] += 1
        log.info("알람 기록 — %s %s (%s)", name, item, detail)
        _ = oil

    # ---- 장치 상태 ----

    def handle_stat(self, src_type: str, src_id: str, payload: dict[str, Any]) -> None:
        if src_type != "bridge":
            return
        self.ensure_bridge(src_id)
        online = bool(payload.get("online", True))
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE bridges
                   SET online = %s,
                       fw_version = COALESCE(%s, fw_version),
                       rssi = COALESCE(%s, rssi),
                       last_seen_at = now()
                 WHERE bridge_id = %s
                """,
                (online, payload.get("fw"), payload.get("rssi"), src_id),
            )
        log.info("브릿지 %s 상태 — %s", src_id, "온라인" if online else "오프라인")


# ---------------------------------------------------------------------------
# MQTT 연결
# ---------------------------------------------------------------------------


def main() -> None:
    collector = Collector()
    stopping = threading.Event()

    def on_connect(client: mqtt.Client, _userdata, _flags, reason_code, _props=None):
        if getattr(reason_code, "is_failure", reason_code != 0):
            log.error("브로커 연결 거부: %s", reason_code)
            return
        client.subscribe([(TOPIC_TELE, 1), (TOPIC_STAT, 1), (TOPIC_ACK, 1)])
        log.info("브로커 연결됨 — 구독 %s", TOPIC_TELE)

    def on_disconnect(_client, _userdata, _flags, reason_code, _props=None):
        if not stopping.is_set():
            log.warning("브로커 연결 끊김(%s). 자동 재연결합니다.", reason_code)

    def on_message(_client, _userdata, msg: mqtt.MQTTMessage):
        parts = msg.topic.split("/")
        prefix_len = len(TOPIC_PREFIX.split("/"))
        if len(parts) < prefix_len + 4:
            return
        _site, src_type, src_id = parts[prefix_len], parts[prefix_len + 1], parts[prefix_len + 2]
        kind = "/".join(parts[prefix_len + 3:])

        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as err:
            log.warning("%s 페이로드를 읽지 못했습니다: %s", msg.topic, err)
            return
        if not isinstance(payload, dict):
            log.warning("%s 페이로드가 객체가 아닙니다.", msg.topic)
            return

        try:
            with collector.lock:
                if kind == "tele":
                    collector.handle_tele(src_type, src_id, payload)
                elif kind == "stat":
                    collector.handle_stat(src_type, src_id, payload)
                elif kind == "cmd/ack":
                    log.info("명령 응답 %s: %s", src_id, payload)
        except psycopg.Error as err:
            log.error("DB 오류 (%s): %s", msg.topic, err)
        except Exception as err:  # 한 건의 오류로 수집이 멈추면 안 됩니다.
            log.exception("처리 실패 (%s): %s", msg.topic, err)

    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=MQTT_CLIENT_ID,
        clean_session=False,
    )
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message
    if MQTT_USER:
        client.username_pw_set(MQTT_USER, MQTT_PASS)
    if MQTT_TLS:
        client.tls_set(ca_certs=MQTT_CA)
    client.reconnect_delay_set(min_delay=1, max_delay=30)

    def shutdown(_signum, _frame):
        stopping.set()
        log.info("종료합니다. 누적 — %s", collector.stats)
        client.disconnect()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # 설정 변경(임계치)을 주기적으로 반영합니다.
    def watch_config():
        while not stopping.wait(30):
            try:
                with collector.lock:
                    collector.reload_config()
                    collector.load_devices()
            except psycopg.Error as err:
                log.error("설정 조회 실패: %s", err)

    threading.Thread(target=watch_config, daemon=True).start()

    log.info("수집 서버 시작 — 브로커 %s:%s", MQTT_HOST, MQTT_PORT)
    while not stopping.is_set():
        try:
            client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            client.loop_forever()
        except OSError as err:
            if stopping.is_set():
                break
            log.error("브로커에 붙지 못했습니다(%s). 5초 후 재시도.", err)
            time.sleep(5)


if __name__ == "__main__":
    main()
