# 햅틱 밴드 — 제작 설명서

부품 목록은 [`haptic_부품목록.md`](haptic_부품목록.md) 에 있습니다. 이 문서는 **받은 부품으로
실제로 동작하게 만드는 순서**입니다.

> ## ⚠️ 먼저 읽을 것
>
> **이 문서의 코드는 실물 장치에서 검증되지 않았습니다.** 저에게 보드가 없어서
> 컴파일도 실행도 해 보지 못했습니다. 부품 사양과 라이브러리 API는 공식 문서로
> 확인했지만, **처음 돌릴 때는 틀린 곳이 나올 수 있습니다.** 그때 쓰라고 각
> 단계마다 "여기까지 됐는지 확인하는 법"을 넣어 뒀습니다.
>
> 대회 전날에 처음 만들지 마십시오. **최소 이틀 여유를 두십시오.**

---

# 1단계 · 부품 확인 (5분)

| 확인할 것 | 맞으면 |
|---|---|
| **DA7280 보드** | 빨간 보드 위에 **검은 원통(LRA 모터)** 이 붙어 있음 |
| **Feather 보드** | 옆면에 **흰색 4핀 소켓**(STEMMA QT) |
| **Qwiic 케이블** | 양 끝에 흰 4핀 플러그가 달린 완제품 |
| **USB-C 케이블** | 폰에 꽂았을 때 **파일이 보이면** 데이터 지원 (충전 전용이면 안 됨) |

> 🔴 **모터(검은 원통)가 없으면 모터 별매 버전이 온 것입니다.** 그대로는 못 씁니다.

---

# 2단계 · 조립 (5분)

최종 형태는 이것뿐입니다. **선은 딱 두 개**입니다.

```
[맥북] ──① USB-C 케이블── [ESP32-S3 Feather] ──② Qwiic 케이블── [DA7280 + 모터]
```

## 2-1 · 케이블 10개 중 어느 것을 쓰나

Qwiic Cable Kit 에는 **10개**가 들어 있습니다. 이 중 **8개는 써도 되고 2개는 쓰면 안 됩니다.**

| 들어 있는 것 | 개수 | 쓰나 |
|---|---|---|
| Qwiic 케이블 **50mm** | 3개 | ✅ |
| Qwiic 케이블 **100mm** | 3개 | ✅ **← 이걸 쓰십시오** |
| Qwiic 케이블 **200mm** | 1개 | ✅ (길어도 됨) |
| Qwiic 케이블 **500mm** | 1개 | ✅ (너무 김) |
| Breadboard Jumper (4핀) | 1개 | ❌ |
| Female Jumper (4핀) | 1개 | ❌ |

### 구분법 — 양쪽 끝만 보면 됩니다

> **양쪽 끝이 모두 하얀 사각 플러그** → **쓰는 것** (8개)
> **한쪽 끝이 갈라진 색색 전선**(빨강·검정·파랑·노랑이 낱개로) → **쓰면 안 되는 것** (2개)

갈라진 쪽은 브레드보드에 꽂는 용도라 우리 구성에는 꽂을 데가 없습니다. 봉투에 도로 넣으십시오.

**왜 100mm인가**: 보드 두 장을 손목에 나란히 올릴 거라 50mm는 당겨지고, 200mm 이상은 남아서
걸리적거립니다. 100mm가 딱 맞습니다. 세 개 들어 있으니 하나 망가져도 여유가 있습니다.

> 전선 색(빨강=3.3V, 검정=GND, 파랑=SDA, 노랑=SCL)은 **알 필요 없습니다.** 커넥터 안에
> 순서가 이미 맞춰져 있습니다.

## 2-2 · 어느 구멍에 꽂나 — 여기서 제일 많이 틀립니다

### ESP32-S3 Feather (검은 보드)

이 보드 옆면에는 **비슷하게 생긴 소켓이 두 개** 있습니다. 반드시 구분하십시오.

| 소켓 | 생김새 | 용도 |
|---|---|---|
| **STEMMA QT** | 구멍 **4개** · 더 **좁다** | ✅ **여기에 꽂습니다** |
| 배터리 | 구멍 **2개** · 더 **넓고 두껍다** | ❌ 리튬 배터리용. **우리는 안 씁니다** |

🔴 **색으로 구분하지 마십시오. 둘 다 흰색입니다.** (실물 확인함) 반드시 **구멍 개수**로
구분하십시오. 4핀 플러그가 2핀 소켓에 물리적으로 들어가지는 않지만, 헐겁게 얹혀만 있어도
꽂힌 것처럼 보여서 몇 시간을 허비하게 됩니다.

> **STEMMA QT = Qwiic 입니다.** Adafruit과 SparkFun이 이름만 다르게 부르는 같은 규격이라,
> 두 회사 보드를 섞어 써도 그대로 맞습니다.

### DA7280 (빨간 보드)

**검은색 4핀 소켓이 두 개** 있습니다. (SparkFun은 검은 커넥터를 씁니다 — Adafruit의 흰
커넥터와 색이 다를 뿐 같은 규격입니다.) **아무 쪽이나 꽂으면 됩니다** — 둘은 서로 연결돼 있어서,
하나는 다음 장치를 이어 붙이라고 있는 여분입니다. 하나만 쓰고 나머지는 비워 둡니다.

> 보드에 보이는 **동그란 납땜 구멍들(GND, 3V3, SDA, SCL…)은 손대지 않습니다.** 굳이
> 납땜하고 싶은 사람용 예비입니다.

## 2-3 · 꽂는 법

1. 플러그의 **툭 튀어나온 쪽(걸쇠)이 위로** 가게 잡습니다
2. 소켓에 **똑바로** 밀어 넣습니다 — 비스듬히 넣지 마십시오
3. **딸깍** 소리가 나거나 더 안 들어가면 끝입니다

모양 때문에 **거꾸로는 안 들어갑니다.** 안 들어가면 방향이 틀린 것이니 힘주지 말고 뒤집으십시오.

**제대로 꽂혔는지 확인**: 케이블을 살짝(정말 살짝) 당겼을 때 빠지지 않으면 됩니다.
금속 단자가 밖에서 보이면 덜 들어간 것입니다.

## 2-4 · USB-C 케이블

Feather의 **USB-C 포트**(보드 짧은 쪽 끝)와 맥북을 연결합니다. 이게 **전원과 데이터를
동시에** 공급하기 때문에 배터리가 필요 없습니다.

🔴 **충전 전용 케이블이면 안 됩니다.** 확인하는 법: 그 케이블로 폰을 맥북에 연결했을 때
**파일이 보이면** 데이터 지원, 충전만 되면 못 씁니다.

## 2-5 · 다 됐는지 확인

| | |
|---|---|
| 선이 몇 개인가 | **2개** (USB-C 하나, Qwiic 하나) |
| 남은 Qwiic 케이블 | 9개 — 봉투에 보관 |
| 납땜한 곳 | **0군데** |
| 배터리 | **안 씀** (Feather의 2핀 소켓은 비워 둠) |

USB를 꽂으면 Feather에 **작은 LED가 켜집니다.** 안 켜지면 케이블이 충전 전용입니다.

> ⚠️ **모터를 아직 손목에 묶지 마십시오.** 먼저 책상 위에서 동작을 확인한 뒤 묶습니다.
> 고정되지 않은 모터는 생각보다 세게 튑니다.

---

# 3단계 · Arduino IDE 설정 (15분, 한 번만)

> Arduino IDE는 **영어판**입니다. 아래 `이런 글씨`는 화면에 그대로 보이는 영어 메뉴이므로,
> 번역하지 말고 그 글자를 찾으십시오. 버전은 Arduino IDE **2.x** 기준입니다.

## 3-1 · 보드 지원 추가 (ESP32를 아는 IDE로 만들기)

기본 상태의 Arduino IDE는 ESP32를 모릅니다. 주소를 하나 알려 줘야 합니다.

**① 설정 창 열기** — 맥 화면 맨 위 왼쪽 메뉴에서

```
Arduino IDE  →  Settings…
```

> 단축키 `⌘ ,` 로 열어도 같습니다. 버전에 따라 `Settings…` 대신 `Preferences…` 라고
> 적혀 있을 수 있는데 같은 것입니다.

**② 맨 아래 칸에 주소 붙여넣기**

창 제일 아래 `Additional boards manager URLs` 칸에 이 주소를 붙여넣고 `OK`:

```
https://espressif.github.io/arduino-esp32/package_esp32_index.json
```

> 이미 다른 주소가 들어 있으면 **지우지 말고** 쉼표(`,`)로 이어 붙이십시오.

**③ 보드 패키지 설치**

왼쪽 세로 막대에서 **두 번째 아이콘**(칩 모양, `Boards Manager`)을 누릅니다.
메뉴로 가도 됩니다: `Tools → Board → Boards Manager…`

검색창에 `esp32` 입력 → 목록에서 **`esp32` by Espressif Systems** 를 찾아 `INSTALL`.

> ⏳ **200MB가 넘어 5~15분 걸립니다.** 진행 막대가 멈춘 것처럼 보여도 기다리십시오.
> 비슷한 이름의 다른 항목들이 같이 나오는데, 만든 곳이 **Espressif Systems** 인 것이 맞습니다.

## 3-2 · 보드 선택

설치가 끝나면 목록에 우리 보드가 생깁니다.

```
Tools  →  Board  →  esp32  →  Adafruit Feather ESP32-S3 2MB PSRAM
```

`esp32` 하위 목록이 아주 길어서 스크롤이 필요합니다. `Adafruit` 로 시작하는 것들이
알파벳 순서로 모여 있습니다.

> 정확히 이 이름이 안 보이면 **`Adafruit Feather ESP32-S3`** 로 시작하는 것을 고르십시오.
> 그것도 없으면 `ESP32S3 Dev Module` 로도 동작합니다.

## 3-3 · 🔴 가장 중요한 설정 — 이것 하나 때문에 제일 많이 막힙니다

**보드를 고른 뒤에야** `Tools` 메뉴에 설정 항목들이 나타납니다. 그중:

```
Tools  →  USB CDC On Boot  →  Enabled
```

기본값이 `Disabled` 입니다. **반드시 `Enabled` 로 바꾸십시오.**

**왜 중요한가**: 이 설정이 꺼져 있으면 보드가 USB로 말을 걸지 못합니다. 업로드는 성공한 것처럼
보이는데 **브라우저에서 포트 목록에 보드가 아예 안 뜹니다.** 그러면 원인을 코드나 케이블에서
찾게 되어 몇 시간을 버립니다. ESP32-S3에서 가장 흔한 함정입니다.

나머지 `Tools` 항목(`Flash Size`, `Partition Scheme`, `Upload Speed` 등)은 **손대지 마십시오.**
기본값이 맞습니다.

## 3-4 · 라이브러리 설치

DA7280 칩에 명령을 보내는 코드는 SparkFun이 이미 만들어 두었습니다.

왼쪽 세로 막대에서 **세 번째 아이콘**(책 모양, `Library Manager`)을 누릅니다.
메뉴로 가도 됩니다: `Tools → Manage Libraries…` (단축키 `⇧⌘I`)

검색창에 `DA7280` 입력 → **`SparkFun Qwiic Haptic Driver DA7280`** 를 찾아 `INSTALL`.

> 의존성 설치 여부를 묻는 창이 뜨면 `INSTALL ALL` 을 누르십시오.
> 이쪽은 용량이 작아 몇 초면 끝납니다.

## 3-5 · 여기까지 제대로 됐는지 확인

보드를 USB-C로 연결한 뒤 확인합니다.

| 확인할 곳 | 보여야 하는 것 |
|---|---|
| 창 왼쪽 위 드롭다운 | `Adafruit Feather ESP32-S3 2MB PSRAM` |
| `Tools → USB CDC On Boot` | **`Enabled`** 에 체크 |
| `Tools → Port` | `/dev/cu.usbmodem…` 같은 항목이 **존재** |

🔴 **`Port` 에 아무것도 없다면** 순서대로 확인하십시오:
1. USB 케이블이 **충전 전용**인지 (2-4 참고 — 제일 흔한 원인)
2. 케이블이 보드에 끝까지 꽂혔는지
3. 보드의 작은 LED가 켜져 있는지

---

# 4단계 · 펌웨어 올리기

새 스케치에 아래를 그대로 붙여넣고 업로드합니다.

```cpp
// SoundShape 햅틱 밴드 — 수신 펌웨어
//
// USB 시리얼로 1바이트를 받아 그대로 진동 세기로 씁니다.
//   0~127 : 진동 세기 (0 = 정지)
//   255   : 비상 정지
// 한 바이트가 하나의 완결된 명령이라, 중간에 유실돼도 다음 바이트에서 회복됩니다.

#include <Wire.h>
#include "Haptic_Driver.h"

#ifndef PIN_I2C_POWER          // 'ESP32S3 Dev Module' 을 고른 경우 대비
#define PIN_I2C_POWER 7
#endif

Haptic_Driver hapDrive;

const uint8_t MAX_AMP   = 127;   // 라이브러리 상한. 넘기면 안 됩니다.
const uint16_t TIMEOUT  = 400;   // ms — 이 시간 동안 값이 없으면 멈춤

uint32_t lastByteAt = 0;

void setup() {
  Serial.begin(115200);

  // 🔴 Adafruit Feather ESP32-S3 는 Qwiic(STEMMA QT) 포트 전원이 GPIO 7 로 따로 켜집니다.
  // 이 세 줄이 없으면 햅틱 보드에 전기가 안 들어가 I2C 에 아예 나타나지 않습니다.
  // (실측 확인: 이 핀을 LOW 로 두면 보드 내장 잔량계 0x36 까지 사라집니다.)
  pinMode(PIN_I2C_POWER, OUTPUT);
  digitalWrite(PIN_I2C_POWER, HIGH);
  delay(100);                     // 보드가 깨어날 시간

  Wire.begin();

  if (!hapDrive.begin()) {
    // I2C로 보드를 못 찾은 경우 — Qwiic 케이블을 확인하십시오.
    while (true) { Serial.println("DA7280 not found"); delay(1000); }
  }
  hapDrive.defaultMotor();        // 보드에 붙은 LRA 기본값
  hapDrive.enableFreqTrack(false);
  hapDrive.setOperationMode(DRO_MODE);
  hapDrive.setVibrate(0);

  Serial.println("ready");
}

void loop() {
  while (Serial.available()) {
    uint8_t v = Serial.read();
    lastByteAt = millis();
    if (v == 255) { hapDrive.setVibrate(0); continue; }
    hapDrive.setVibrate(v > MAX_AMP ? MAX_AMP : v);
  }

  // 브라우저가 끊기거나 탭이 닫혔을 때 계속 울지 않도록.
  if (lastByteAt && millis() - lastByteAt > TIMEOUT) {
    hapDrive.setVibrate(0);
    lastByteAt = 0;
  }
}
```

### 여기까지 됐는지 확인하는 법

`도구 → 시리얼 모니터` 를 **115200** 으로 열었을 때:

- **`ready`** 가 뜨면 → 보드와 모터가 정상입니다
- **`DA7280 not found`** 가 반복되면 → Qwiic 케이블이 덜 꽂혔거나 반대쪽 소켓입니다

동작 확인은 시리얼 모니터에서 직접 보낼 수 있습니다. 전송 형식을 **"line ending 없음"**
으로 두고 아무 글자나 보내면 그 글자의 코드값만큼 진동합니다 (예: `d` = 100).

---

# 5단계 · 브라우저와 연결 (Web Serial)

**이 단계는 아직 SoundShape 앱에 들어 있지 않습니다.** 붙이는 코드는 아래와 같습니다.

```ts
// frontend/src/lib/haptic.ts  (신규)
//
// 화면에 그려지는 것과 같은 숫자를 손목으로 보냅니다. 하이브리드 모드에서
// visual.size 는 AI 추정이 아니라 측정된 운율에서 나오므로, 진동과 화면이
// 같은 값에서 갈라져 나옵니다 — 보고서가 주장하는 "100% 일치"가 이 뜻입니다.

let port: SerialPort | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

/** 사용자 제스처(클릭) 안에서만 호출해야 합니다 — 브라우저 정책. */
export async function connectBand(): Promise<boolean> {
  if (!("serial" in navigator)) return false;      // 크롬·엣지만 지원
  port = await navigator.serial.requestPort();      // 사용자가 포트를 고름
  await port.open({ baudRate: 115200 });
  writer = port.writable!.getWriter();
  return true;
}

/** size: 0~1 (visual.size 를 그대로 넣으면 됩니다). */
export async function sendIntensity(size: number): Promise<void> {
  if (!writer) return;
  const amp = Math.round(Math.max(0, Math.min(1, size)) * 127);
  await writer.write(new Uint8Array([amp]));
}

export async function disconnectBand(): Promise<void> {
  if (writer) { await writer.write(new Uint8Array([255])); writer.releaseLock(); }
  await port?.close();
  port = null; writer = null;
}
```

`page.tsx` 에서는 이렇게 씁니다.

```ts
// 재생 중 현재 프레임이 바뀔 때마다
useEffect(() => { void sendIntensity(visual.size); }, [visual.size]);
```

### 알아 둘 것

- **크롬·엣지만 됩니다.** 사파리·파이어폭스에는 Web Serial이 없습니다.
- **HTTPS 또는 localhost** 에서만 동작합니다 — `localhost:3000` 은 괜찮습니다.
- 포트 선택 창은 **버튼 클릭 안에서** 띄워야 합니다. 자동 연결은 막혀 있습니다.
- 시리얼 모니터를 켜 둔 채로 브라우저에서 연결하면 **포트를 뺏깁니다.** 하나만 쓰십시오.

---

# 6단계 · 손목에 묶기

동작을 확인한 뒤에만 합니다.

- **모터(검은 원통)가 손목 안쪽에 닿게** 벨크로로 감습니다
- 보드 두 장을 같이 올리고 **USB 선만 노트북으로** 뺍니다 — 그래서 Qwiic 케이블은 짧아도 됩니다
- 너무 세게 조이지 마십시오. 진동이 오히려 둔해집니다

---

# 문제 해결

| 증상 | 원인 |
|---|---|
| 브라우저 포트 목록에 아무것도 없음 | **`USB CDC On Boot: Enabled`** 안 켬 (3단계 ③) · 또는 충전 전용 케이블 |
| `DA7280 not found` | Qwiic 케이블 접촉 불량 · 반대쪽 소켓에 꽂음 |
| 업로드가 안 됨 | **BOOT 버튼을 누른 채** RESET 을 눌렀다 떼고 업로드 |
| 진동이 안 느껴짐 | 모터가 고정 안 되면 약하게 느껴집니다. 손목에 묶고 다시 확인 |
| 계속 진동함 | 브라우저 탭이 살아 있습니다. 탭을 닫으면 0.4초 뒤 자동으로 멈춥니다 |

---

# 다음 단계 (v2)

지금 설계는 **구간 단위**로 세기를 보냅니다. `prosody.intensity_curve` 를 쓰면
**한 문장 안의 리듬**까지 전달할 수 있습니다 — 강세와 쉼이 손목에서 느껴집니다.
백엔드가 이미 그 값을 내보내고 있으므로, 브라우저에서 시간에 맞춰 흘려보내기만
하면 됩니다. **먼저 v1이 동작한 뒤에 손대십시오.**

---

# 보고서에 쓸 때

**만들었다고 쓰기 전에 실제로 동작시켜 보십시오.** 지금 포스터와 보고서에는
`제작 예정 · 미구현` 으로 적혀 있고, 동작 확인 전까지는 그대로 두는 것이 맞습니다.

동작하면 고칠 곳은 [`보고서_최종수정목록.md`](../보고서_최종수정목록.md) 8절에
정리돼 있습니다 — Ⅱ-4 작품 제작 표에 행 추가, 동작 확인 결과, 촉각 대체 참고문헌.

**수치를 넣으려면 측정이 필요합니다.** "진동이 온다"는 동작 확인이지 검증이 아닙니다.
