import type { Metadata, Viewport } from "next";
import { Chakra_Petch, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const display = Chakra_Petch({
  subsets: ["latin", "thai"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const body = IBM_Plex_Sans_Thai({
  subsets: ["latin", "thai"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "OFFICE SMASH — ศึกชิงเงินรางวัลสุดพิเศษ",
  description: "ลงทะเบียนเข้าร่วมทัวร์นาเมนต์ปิงปองของออฟฟิศ",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07120f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body className={`${display.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}
