// SoundShape 햅틱 — I2C 진단 스케치 (2차: 전원 극성 양쪽 시험)
//
// Qwiic 포트 전원 핀을 HIGH 로도 켜 보고 LOW 로도 켜 보면서 각각 스캔합니다.
// 보드마다 극성이 달라서, 한쪽만 시험하면 멀쩡한 연결을 불량으로 오판할 수 있습니다.
//
// 🔎 돌리는 동안 DA7280 보드를 눈으로 보십시오.
//    불이 3초마다 켜졌다 꺼졌다 하면 → 전기는 도달하고 있습니다 (신호선 문제)
//    계속 꺼져 있으면                → 전기가 못 가고 있습니다 (케이블·소켓 문제)

#include <Wire.h>

#ifndef PIN_I2C_POWER
#define PIN_I2C_POWER 7
#endif

// 주소 하나가 응답하는지 확인
bool present(uint8_t a) {
  Wire.beginTransmission(a);
  return Wire.endTransmission() == 0;
}

// 현재 상태로 한 번 스캔하고, 0x4A 를 찾았는지 돌려줌
bool scanOnce(const char* label) {
  Serial.print("["); Serial.print(label); Serial.print("] 응답한 주소:");
  bool haptic = false, any = false;
  for (uint8_t a = 1; a < 127; a++) {
    if (!present(a)) continue;
    any = true;
    Serial.print(" 0x");
    if (a < 16) Serial.print("0");
    Serial.print(a, HEX);
    if (a == 0x4A) { Serial.print("(DA7280!)"); haptic = true; }
    if (a == 0x36) Serial.print("(내장 잔량계)");
  }
  if (!any) Serial.print(" 없음");
  Serial.println();
  return haptic;
}

void setup() {
  Serial.begin(115200);
  uint32_t t = millis();
  while (!Serial && millis() - t < 3000) delay(10);
  pinMode(PIN_I2C_POWER, OUTPUT);
  Wire.begin();
  Serial.println();
  Serial.println("=== Qwiic 전원 극성 양쪽 시험 (GPIO 7) ===");
  Serial.println("DA7280 보드의 불이 깜빡이는지 같이 보십시오.");
  Serial.println();
}

void loop() {
  digitalWrite(PIN_I2C_POWER, HIGH);
  delay(3000);                      // 눈으로 확인할 시간
  bool okHigh = scanOnce("전원핀 HIGH");

  digitalWrite(PIN_I2C_POWER, LOW);
  delay(3000);
  bool okLow = scanOnce("전원핀 LOW ");

  Serial.print(">>> 결론: ");
  if (okHigh && okLow)      Serial.println("양쪽 다 보임 — 이 핀은 전원과 무관. 연결은 정상입니다.");
  else if (okHigh)          Serial.println("HIGH 일 때만 보임 — 펌웨어에 HIGH 로 고정하십시오.");
  else if (okLow)           Serial.println("LOW 일 때만 보임 — 펌웨어를 LOW 로 바꾸십시오.");
  else                      Serial.println("양쪽 다 0x4A 없음 — 전원 극성 문제가 아닙니다. 케이블·소켓·보드 쪽입니다.");
  Serial.println();
}
