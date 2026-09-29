import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_KR } from "next/font/google";
import { SoundShapeSite } from "@/components/site/SoundShapeSite";

const notoKr = Noto_Sans_KR({
  weight: ["400", "500", "600", "700", "900"],
  subsets: ["latin"],
  preload: false,
  variable: "--font-noto-kr",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "SoundShape — 말투가 들리지 않아도, 감정은 보이게",
  description:
    "청각장애인·난청인을 위한 감정 자막. 목소리 톤에서 감정을 읽어 자막에 색과 움직임으로 보여줍니다.",
};

export default function Home() {
  return <SoundShapeSite fontClass={`${notoKr.variable} ${plexMono.variable}`} />;
}
