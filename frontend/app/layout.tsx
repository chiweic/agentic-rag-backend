import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_TC } from "next/font/google";
import { AppTabs } from "@/components/app-tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// CJK font with consistent glyph metrics across weights. Without a
// declared CJK font, Chinese characters fall back to whatever the OS
// ships (PingFang TC on macOS, Microsoft JhengHei on Windows, etc.)
// and semibold vs. regular glyphs end up with different side-bearings,
// which leaves the welcome h1/subtitle looking left-misaligned.
const notoSansTC = Noto_Sans_TC({
  variable: "--font-noto-sans-tc",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "法鼓山AI專案演示",
  description: "法鼓山AI專案演示",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoSansTC.variable} flex h-dvh flex-col antialiased`}
      >
        <TooltipProvider>
          <AppTabs />
          <div className="min-h-0 flex-1">{children}</div>
        </TooltipProvider>
      </body>
    </html>
  );
}
