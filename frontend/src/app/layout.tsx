import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Geist has no Hangul coverage, and roughly half this UI is Korean. Without a
// named Korean face every machine picked its own fallback and the interface
// changed shape between the demo laptop and the room's. Pretendard is the
// closest Korean match to Geist's proportions, and it is vendored into the repo
// rather than pulled from a CDN so the demo does not depend on venue wifi.
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  weight: "45 920",
  display: "swap",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "SoundShape",
  description:
    "자막은 무엇을 말했는지 전한다. SoundShape는 어떻게 말했는지 보여준다. 청각장애인을 위한 감정 시각화 자막.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      // Korean is the default; LocaleSwitch rewrites this at runtime, which
      // React would otherwise flag as a hydration mismatch.
      lang="ko"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${pretendard.variable} h-full antialiased`}
      // Geist first so Latin and the wordmark keep their shape; Pretendard
      // picks up every Hangul glyph Geist cannot draw.
      style={
        {
          "--font-sans-stack":
            "var(--font-geist-sans), var(--font-pretendard), ui-sans-serif, system-ui, sans-serif",
        } as React.CSSProperties
      }
    >
      <body className="flex min-h-full flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
