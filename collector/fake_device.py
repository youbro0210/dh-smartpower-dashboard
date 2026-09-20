#!/usr/bin/env python3
"""명령을 받아 응답하는 가짜 장치. 장비 제어 화면을 시험하기 위한 것입니다."""
import json, os, sys, time
import paho.mqtt.client as mqtt

PREFIX = os.environ.get("MQTT_TOPIC_PREFIX", "dh/v1")
SITE, TARGET = "dh1", "BR-1"
FAIL = "--fail" in sys.argv

def on_connect(c, *_):
    c.subscribe(f"{PREFIX}/{SITE}/bridge/{TARGET}/cmd", qos=1)
    print("가짜 장치 대기 중")

def on_message(c, _u, msg):
    body = json.loads(msg.payload.decode())
    print("명령 수신:", body)
    ack = {"cmdId": body.get("cmdId"), "ok": not FAIL,
           "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if FAIL:
        ack["error"] = "지원하지 않는 명령입니다."
    else:
        ack["result"] = {"echo": body.get("command"), "rtt_ms": 12}
    c.publish(f"{PREFIX}/{SITE}/bridge/{TARGET}/cmd/ack", json.dumps(ack), qos=1)
    print("응답 발행:", ack)

c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="fake-device")
c.on_connect, c.on_message = on_connect, on_message
c.connect(os.environ.get("MQTT_HOST", "127.0.0.1"), int(os.environ.get("MQTT_PORT", "1883")), 60)
c.loop_forever()
