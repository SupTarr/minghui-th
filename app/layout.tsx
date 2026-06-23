import type { Metadata } from "next";
import { Inter, Geist_Mono, Noto_Serif_Thai, Playfair_Display } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const notoSerifThai = Noto_Serif_Thai({
  variable: "--font-serif-th",
  subsets: ["thai"],
  weight: ["400", "700"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-serif-en",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Minghui Insights (TH)",
  description:
    "ระบบแปลบทความแชร์ประสบการณ์บำเพ็ญธรรมจาก en.minghui.org เป็นภาษาไทยอัตโนมัติ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${inter.variable} ${geistMono.variable} ${notoSerifThai.variable} ${playfairDisplay.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#060913] text-[#f8fafc]">{children}</body>
    </html>
  );
}
