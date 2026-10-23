// 시연용 주소. 발표 중에는 주소 표시줄도 심사위원에게 보이므로,
// `?script=…&wait=…` 같은 질의 문자열 대신 읽어서 뜻이 통하는 경로를 쓴다.
//
//   /demo      — 미리 만들어 둔 결과를 바로 재생
//   /livedemo  — 파일을 직접 골라 올리고, 준비된 결과를 6.5초 뒤 재생
//
// 어느 쪽인지는 `DemoCard` 가 주소에서 읽는다.
import type { Metadata } from "next";
import { SoundShapeSite } from "@/components/site/SoundShapeSite";
import { fontClass } from "../fonts";

export const metadata: Metadata = {
  title: "SoundShape — 말투가 들리지 않아도, 감정은 보이게",
};

export default function Page() {
  return <SoundShapeSite fontClass={fontClass} />;
}
