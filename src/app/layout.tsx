import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MulticaBoard - Online Whiteboard",
  description: "Online whiteboard tool with export and persistence",
  /**
   * ZOO-162 应用图标集：候选 A「蓝色画布 · 白色正弦」定稿
   * （SVG 源与备选方案见 docs/design/app-icon/）
   */
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

/**
 * ZOO-144 移动端触摸适配：禁用浏览器页面级双指缩放 / 双击放大
 * （画布缩放由应用内双指捏合手势接管），IME 唤起采用 resizes-visual
 * 保证方程输入聚焦时面板布局不被顶起。
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: "resizes-visual",
  // ZOO-162：PWA 主题色与品牌蓝一致
  themeColor: "#3B82F6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* ZOO-167 Vercel Web Analytics：开发环境自动 no-op，仅生产上报访问量 */}
        <Analytics />
      </body>
    </html>
  );
}
