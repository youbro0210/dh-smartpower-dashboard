#!/usr/bin/env python3
"""
장비 흉내내기 — 수집 서버를 시험하기 위한 발행기.

헤디 장비가 오기 전에 수집 → 저장 → 판정 → 알람 → 메신저 발송까지
전체 경로를 확인하기 위한 것입니다. 운영에는 쓰지 않습니다.

    python3 simulator.py                 정상값을 1대씩 주기 발행
    python3 simulator.py --scenario rise 수소가스를 서서히 올려 알람을 유발
    python3 simulator.py --replay        1시간치 과거 데이터를 재전송으로 발행
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timedelta, timezone

import paho.mqtt.client as mqtt

HOST = os.environ.get("MQTT_HOST", "127.0.0.1")
PORT = int(os.environ.get("MQTT_PORT", "1883"))
USER = os.environ.get("MQTT_USER") or None
PASSWORD = os.environ.get("MQTT_PASS") or None
PREFIX = os.environ.get("MQTT_TOPIC_PREFIX", "dh/v1")

SITE = "dh1"
BRIDGE = "BR-1"
DEVICES = ["1", "2", "3"]


def now_iso(offset_minutes: int = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=offset_minutes)).isoformat()


def connect() -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="dh-simulator")
    if USER:
        client.username_pw_set(USER, PASSWORD)
    client.connect(HOST, PORT, 60)
    client.loop_start()
    return client


def publish(client: mqtt.Client, kind: str, body: dict) -> None:
    topic = f"{PREFIX}/{SITE}/bridge/{BRIDGE}/{kind}"
    client.publish(topic, json.dumps(body, ensure_ascii=False), qos=1)
    print(topic, json.dumps(body, ensure_ascii=False)[:160])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", choices=["normal", "rise"], default="normal")
    parser.add_argument("--replay", action="store_true", help="과거 1시간치를 재전송으로 발행")
    parser.add_argument("--count", type=int, default=5, help="발행 횟수")
    parser.add_argument("--interval", type=float, default=2.0, help="발행 간격(초)")
    args = parser.parse_args()

    client = connect()
    publish(client, "stat", {"online": True, "ts": now_iso(), "fw": "sim-1.0", "rssi": -58})

    if args.replay:
        items = []
        for minutes in range(60, 0, -5):
            for i, device in enumerate(DEVICES):
                items.append({
                    "deviceId": device, "ts": now_iso(minutes),
                    "h2": 10 + i, "ch4": 3 + i, "temp": 47 + i, "oil": 1,
                })
        publish(client, "tele", {"ts": now_iso(), "replay": True, "items": items})
        time.sleep(1)
        client.loop_stop()
        return

    for step in range(args.count):
        items = []
        for i, device in enumerate(DEVICES):
            if args.scenario == "rise" and device == "1":
                # 주의(20) → 경고(50) → 위험(100) 을 차례로 넘도록 올립니다.
                h2 = 15 + step * 25
                temp = 50 + step * 7
            else:
                h2 = 10 + i
                temp = 47 + i
            items.append({
                "deviceId": device, "ts": now_iso(),
                "h2": round(h2, 1), "ch4": round(3 + i * 0.5, 1),
                "temp": round(temp, 1), "oil": 1, "q": 0,
            })
        publish(client, "tele", {"ts": now_iso(), "seq": step, "replay": False, "items": items})
        time.sleep(args.interval)

    client.loop_stop()


if __name__ == "__main__":
    main()
