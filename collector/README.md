# MQTT 수집 서버

장비가 올려 보낸 계측값을 받아 PostgreSQL 에 적재하고, 임계치 판정 결과를
알람으로 남깁니다. 알람이 기록되면 발송 워커(`scripts/notify-worker.mjs`)가
등록된 사람에게 메신저·문자·메일로 보냅니다.

```
측정모듈/브릿지/PC --MQTT--> Mosquitto --> collector.py --> PostgreSQL
                                                              |
                                              웹 화면 / 알람 발송 워커
```

## 1. 왜 발신 주체를 가리지 않는가

토픽은 **누가 보냈는가**, 페이로드는 **어느 설비의 값인가**를 나타냅니다.
그래서 브릿지가 보내든(3안), 측정모듈이 직접 보내든(1안), 사용자 PC를
거치든(2안) 저장 경로가 같습니다.

```
dh/v1/{site}/{srcType}/{srcId}/tele      srcType = bridge | module | gateway
dh/v1/{site}/{srcType}/{srcId}/stat      retain + LWT
dh/v1/{site}/{srcType}/{srcId}/cmd
dh/v1/{site}/{srcType}/{srcId}/cmd/ack
```

계측값 페이로드:

```json
{
  "ts": "2026-09-20T01:23:45Z",
  "seq": 10421,
  "replay": false,
  "items": [
    { "deviceId": "DH-A-01", "ts": "2026-09-20T01:23:40Z",
      "h2": 11.9, "ch4": 3.4, "temp": 48.8, "oil": 1, "q": 0 }
  ]
}
```

설비 하나만 담은 납작한 형태(`items` 없이 최상위에 `deviceId`)도 받습니다.
장비 업체가 어느 쪽으로 보내든 동작하게 하기 위한 것입니다.

| 필드 | 뜻 |
|---|---|
| `deviceId` | 설비 식별자. 브릿지·모듈을 교체해도 바뀌지 않아야 합니다 |
| `ts` | **장치가 측정한 시각.** 없으면 서버 수신 시각으로 대체하지만, 재전송분의 시각이 전부 틀어지므로 장치 NTP 동기가 사실상 필수입니다 |
| `replay` | 버퍼에 쌓였다가 뒤늦게 보내는 과거분. `true` 면 이력만 적재하고 **알람을 울리지 않으며 현재값도 덮어쓰지 않습니다** |
| `oil` | 유면. 현재 2치(정상/낮음)로 저장합니다. 접점(0/1)·문자열·숫자를 모두 받습니다 |
| `q` | 품질 코드. 통신단절과 센서 고장을 구분하기 위한 예비 필드 |

상태 토픽(`stat`)은 `{"online":true,"fw":"1.2.3","rssi":-62}` 형태로,
`bridges` 테이블의 online·fw_version·rssi·last_seen_at 에 반영됩니다.
LWT 로 `{"online":false}` 를 retain 설정해 두면 장치가 죽었을 때 바로 표시됩니다.

## 2. 저장 규칙

- `telemetry` — 원본 이력. `(device_id, measured_at)` 유일 제약이 QoS 1 의
  중복 수신과 재전송 중복을 걸러 냅니다.
- `device_readings` — 설비별 최신값. **더 과거의 값이 뒤늦게 와도 현재 상태를
  밀어내지 않습니다**(`WHERE EXCLUDED.updated_at >= device_readings.updated_at`).
- `alarm_events` — **등급이 올라간 순간에만** 기록합니다. 매 수신마다 남기면
  이력이 의미를 잃습니다. 해제 판정은 히스테리시스 여유만큼 낮은 지점에서
  이뤄져 경계값 근처에서 알람이 반복되지 않습니다.
- 등록되지 않은 `deviceId` 가 값을 올리면 임시로 설비를 만들고 경고를 남깁니다.
  현장 데이터를 버리는 것보다 관리자가 나중에 이름을 고치는 편이 낫습니다.

임계치와 복합 판정 규칙은 웹 화면(설정)에서 바꾸며, 수집기가 30초마다
`app_config` 를 다시 읽어 반영합니다.

## 3. 설치

```bash
cd collector
python3 -m pip install -r requirements.txt
cp .env.example .env      # 브로커 주소·계정을 채웁니다
```

`DATABASE_URL` 은 비워 두면 상위 폴더의 `.env.local` 값을 씁니다.

브로커(Mosquitto)를 같은 서버에 둘 경우:

```bash
sudo apt-get install -y mosquitto mosquitto-clients
# 외부 장비가 붙는다면 익명 접속을 끄고 계정과 TLS(8883)를 설정하세요.
```

## 4. 실행

```bash
python3 collector.py                       # 직접 실행
pm2 start deploy/ecosystem.config.js --only dh-collector   # 운영
```

## 5. 장비 없이 시험하기

`simulator.py` 가 장비를 흉내내 발행합니다. 운영에는 쓰지 않습니다.

```bash
python3 simulator.py                       # 정상값 주기 발행
python3 simulator.py --scenario rise       # 수소·온도를 올려 알람 유발
python3 simulator.py --replay              # 과거 1시간치를 재전송으로 발행
```

`--scenario rise` 는 주의 → 경고 → 위험을 차례로 넘기므로, 수집 → 판정 →
알람 → 메신저 발송까지 전 구간을 한 번에 확인할 수 있습니다.

## 6. 협의가 끝나면 고쳐야 할 곳

- **유면 규격** — 아날로그(%/mm)로 확정되면 `to_oil()` 과 DB 의 `oil_level`
  컬럼(현재 text), 그리고 화면의 게이지를 함께 바꿉니다. 지금 구조에서
  가장 영향이 큰 미확정 항목입니다.
- **토픽 접두사** — `MQTT_TOPIC_PREFIX` 로 조정합니다.
- **재전송 속도 제한** — 장비 쪽에서 한 메시지당 건수와 초당 메시지 수를
  제한해 주어야 합니다. 1분 주기 × 32대 × 30일이면 한 브릿지당 약 138만 건입니다.
