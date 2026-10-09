#!/usr/bin/env python3
"""
명령을 받아 응답하는 가짜 장치. 장비 제어 화면을 시험하기 위한 것입니다.

구성 1·2·3안 모두 서버에서 명령을 받을 수 있으므로, 어느 주체로 붙을지
골라서 띄웁니다.

    python3 fake_device.py --type bridge --id BR-1      3안 — 브릿지
    python3 fake_device.py --type gateway --id PC-1     2안 — 사용자 PC
    python3 fake_device.py --type module --id MOD-7     1안 — 측정모듈 직결
    python3 fake_device.py --fail                       실패 응답으로 동작
    python3 fake_device.py --delay 5                    응답을 늦춰 미응답 처리 확인
"""

import argparse
import json
import os
import time

import paho.mqtt.client as mqtt

PREFIX = os.environ.get("MQTT_TOPIC_PREFIX", "dh/v1")
SITE = os.environ.get("MQTT_SITE", "dh1")

parser = argparse.ArgumentParser()
parser.add_argument("--type", dest="src_type", default="bridge",
                    choices=["bridge", "gateway", "module"])
parser.add_argument("--id", dest="src_id", default="BR-1")
parser.add_argument("--fail", action="store_true", help="모든 명령에 실패로 응답")
parser.add_argument("--delay", type=float, default=0.0, help="응답을 늦출 시간(초)")
args = parser.parse_args()

BASE = f"{PREFIX}/{SITE}/{args.src_type}/{args.src_id}"


def on_connect(client, *_):
    client.subscribe(f"{BASE}/cmd", qos=1)
    print(f"가짜 장치 대기 중 — {BASE}/cmd")


def on_message(client, _userdata, msg):
    body = json.loads(msg.payload.decode())
    print("명령 수신:", body)

    if args.delay:
        # 응답 대기시간을 넘겼을 때 서버가 미응답으로 정리하는지 보기 위한 것입니다.
        print(f"{args.delay}초 늦춰 응답합니다.")
        time.sleep(args.delay)

    ack = {
        "cmdId": body.get("cmdId"),
        "ok": not args.fail,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if args.fail:
        ack["error"] = "지원하지 않는 명령입니다."
    else:
        result = {"echo": body.get("command"), "rtt_ms": 12}
        # 측정 주기 변경은 적용된 값을 돌려줍니다.
        if body.get("command") == "set_interval":
            result["interval"] = (body.get("params") or {}).get("seconds")
        ack["result"] = result

    client.publish(f"{BASE}/cmd/ack", json.dumps(ack), qos=1)
    print("응답 발행:", ack)


client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                     client_id=f"fake-{args.src_type}-{args.src_id}")
if os.environ.get("MQTT_USER"):
    client.username_pw_set(os.environ["MQTT_USER"], os.environ.get("MQTT_PASS"))
client.on_connect, client.on_message = on_connect, on_message
client.connect(os.environ.get("MQTT_HOST", "127.0.0.1"),
               int(os.environ.get("MQTT_PORT", "1883")), 60)
client.loop_forever()
