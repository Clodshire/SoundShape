import type { Metadata } from "next";
import { SoundShapeSite } from "@/components/site/SoundShapeSite";
import { fontClass } from "./fonts";

export const metadata: Metadata = {
  title: "SoundShape — 말투가 들리지 않아도, 감정은 보이게",
  description:
    "청각장애인·난청인을 위한 감정 자막. 목소리 톤에서 감정을 읽어 자막에 색과 움직임으로 보여줍니다.",
};

export default function Home() {
  return <SoundShapeSite fontClass={fontClass} />;
}
