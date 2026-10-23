// 폰트는 **한 곳에서만** 선언한다.
//
// `next/font/google` 은 선언마다 빌드 때 구글에서 폰트를 받아 온다. 페이지마다
// 따로 선언하면 선언 수만큼 새로 받아야 하고, 네트워크가 없는 자리에서는
// 빌드가 통째로 실패한다 (실제로 /demo · /livedemo 를 추가하다 겪었다).
// 한 번만 선언해 두면 받아 둔 것을 모든 페이지가 같이 쓴다.
import { IBM_Plex_Mono, Noto_Sans_KR } from "next/font/google";

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

export const fontClass = `${notoKr.variable} ${plexMono.variable}`;
