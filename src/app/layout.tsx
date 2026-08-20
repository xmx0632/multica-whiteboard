import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { cookies, headers } from "next/headers";
import { I18nProvider } from "@/i18n/I18nProvider";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";
import { getLibT } from "@/i18n/lib";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * ZOO-176 i18n：服务端解析 locale（cookie 偏好 > Accept-Language > zh-CN）。
 * 读 cookies/headers 使页面按请求动态渲染 —— 换取 SSR 首屏即为用户语言，
 * 客户端 hydration 同源，无语言闪烁。
 */
async function getLocale() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get("accept-language"),
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getLibT(locale);
  return {
    title: t("app.title"),
    description: t("app.description"),
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
}

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        {/* ZOO-167 Vercel Web Analytics：开发环境自动 no-op，仅生产上报访问量 */}
        <Analytics />
        {/* ZOO-175 Vercel Speed Insights：RUM 性能指标采集，开发环境 no-op，仅生产上报 */}
        <SpeedInsights />
      </body>
    </html>
  );
}
