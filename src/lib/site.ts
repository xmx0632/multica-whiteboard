/**
 * 站点规范 URL 解析（ZOO-181 SEO）—— metadataBase / canonical / OG / robots /
 * sitemap 共用的绝对地址前缀。
 *
 * 优先级：NEXT_PUBLIC_SITE_URL（自定义域名，部署时在 Vercel 配置）
 * > NEXT_PUBLIC_VERCEL_URL / VERCEL_URL（Vercel 自动注入，无协议需补 https）
 * > http://localhost:3000（本地开发兜底）。
 * 上线自定义域名时只需设置一个环境变量，全站 SEO 地址随之收敛。
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const vercel =
    process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return 'http://localhost:3000';
}

/** 站点根地址（无尾斜杠），如 https://multicaboard.example */
export const SITE_URL = resolveSiteUrl();
