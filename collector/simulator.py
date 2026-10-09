#!/usr/bin/env python3
"""
장비 흉내내기 — 수집 서버를 시험하기 위한 발행기.

헤디 장비가 오기 전에 수집 → 저장 → 판정 → 알람 → 메신저 발송까지
전체 경로를 확인하기 위한 것입니다. 운영에는 쓰지 않습니다.

㈜헤디와 협의된 세 가지 구성을 모두 흉내낼 수 있습니다.

    python3 simulator.py --link bridge              3안 — 브릿지가 여러 설비분을 모아 전송
    python3 simulator.py --link gateway             2안 — 사용자 PC가 모아 전송
    python3 simulator.py --link direct --device 7   1안 — 측정모듈이 자기 값만 직접 전송
    python3 simulator.py --scenario rise            수소가스를 올려 주의→경고→위험 유발
    python3 simulator.py --replay --replay-hours 24 과거분을 재전송으로 발행(이력만 적재)
    python3 simulator.py --replay --replay-hours 720 --chunk 500
                                                    1개월분 백필을 상한 단위로 쪼개 전송
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

SITE = os.environ.get("MQTT_SITE", "dh1")

# 구성별 기본 발신자 ID 입니다.
DEFAULT_SRC = {"bridge": "BR-1", "gateway": "PC-1", "direct": "MOD-7"}


def now_iso(offset_minutes: float = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=offset_minutes)).isoformat()


def connect(client_id: str) -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
    if USER:
        client.username_pw_set(USER, PASSWORD)
    client.connect(HOST, PORT, 60)
    client.loop_start()
    return client


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--link", choices=["bridge", "gateway", "direct"], default="bridge",
                        help="구성 — bridge(3안) · gateway(2안) · direct(1안)")
    parser.add_argument("--src-id", help="발신자 ID. 기본값은 구성별로 정해집니다.")
    parser.add_argument("--device", help="직결(1안)에서 쓸 설비 ID 하나")
    parser.add_argument("--devices", default="1,2,3", help="브릿지·PC 경유에서 쓸 설비 ID 목록")
    parser.add_argument("--scenario", choices=["normal", "rise", "oil"], default="normal")
    parser.add_argument("--replay", action="store_true", help="과거분을 재전송으로 발행")
    parser.add_argument("--replay-hours", type=int, default=1, help="재전송할 과거 구간(시간)")
    parser.add_argument("--replay-step", type=int, default=5, help="재전송 간격(분)")
    parser.add_argument("--chunk", type=int, default=500, help="한 메시지에 담을 최대 항목 수")
    parser.add_argument("--flat", action="store_true",
                        help="items 없이 최상위에 값을 담은 납작한 형태로 발행")
    parser.add_argument("--count", type=int, default=5, help="발행 횟수")
    parser.add_argument("--interval", type=float, default=2.0, help="발행 간격(초)")
    args = parser.parse_args()

    src_type = "module" if args.link == "direct" else args.link
    src_id = args.src_id or (args.device if args.link == "direct" else None) \
        or DEFAULT_SRC[args.link]
    devices = [args.device or src_id] if args.link == "direct" \
        else [d.strip() for d in args.devices.split(",") if d.strip()]

    base = f"{PREFIX}/{SITE}/{src_type}/{src_id}"

    client = connect(f"dh-sim-{src_type}-{src_id}")

    def publish(kind: str, body: dict) -> None:
        topic = f"{base}/{kind}"
        client.publish(topic, json.dumps(body, ensure_ascii=False), qos=1)
        print(topic, json.dumps(body, ensure_ascii=False)[:200])

    # 자기 상태를 먼저 알립니다. 1안이면 설비 자신의 상태가 됩니다.
    stat: dict = {"online": True, "ts": now_iso(), "fw": "sim-1.0", "rssi": -58}
    if args.link == "direct":
        stat["interval"] = 60
    publish("stat", stat)

    def reading(device: str, i: int, offset: float, step: int = 0) -> dict:
        if args.scenario == "rise" and device == devices[0]:
            # 주의(20) → 경고(50) → 위험(100) 을 차례로 넘도록 올립니다.
            h2, temp = 15 + step * 25, 50 + step * 7
        else:
            h2, temp = 10 + i, 47 + i
        item = {
            "deviceId": device, "ts": now_iso(offset),
            "h2": round(h2, 1), "ch4": round(3 + i * 0.5, 1),
            "temp": round(temp, 1),
            "oil": 0 if args.scenario == "oil" and device == devices[0] else 1,
            "q": 0,
        }
        return item

    # ---- 재전송(백필) ----
    if args.replay:
        minutes_total = args.replay_hours * 60
        offsets = list(range(minutes_total, 0, -args.replay_step))
        items = [reading(d, i, m) for m in offsets for i, d in enumerate(devices)]
        print(f"재전송 대상 {len(items)}건 — {args.chunk}개 단위로 나눠 보냅니다.")
        for start in range(0, len(items), args.chunk):
            chunk = items[start:start + args.chunk]
            publish("tele", {"ts": now_iso(), "replay": True, "items": chunk})
            time.sleep(0.2)
        time.sleep(1)
        client.loop_stop()
        return

    # ---- 평시 발행 ----
    for step in range(args.count):
        items = [reading(d, i, 0, step) for i, d in enumerate(devices)]
        if args.flat:
            # 1안의 모듈이 자기 값 하나만 올리는 가장 단순한 형태입니다.
            body = dict(items[0])
            body.pop("deviceId", None)
            body["replay"] = False
            publish("tele", body)
        else:
            publish("tele", {"ts": now_iso(), "seq": step, "replay": False, "items": items})
        time.sleep(args.interval)

    client.loop_stop()


if __name__ == "__main__":
    main()
