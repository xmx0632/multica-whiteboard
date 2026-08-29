/**
 * 站点规范 URL 解析（ZOO-181 SEO）—— metadataBase / canonical / OG / robots /
 * sitemap 共用的绝对地址前缀。
 *
 * 优先级：NEXT_PUBLIC_SITE_URL（显式覆盖，任何环境生效）
 * > Vercel 生产部署 → 正式域名（已确认为 board.multicaboard.com）
 * > Vercel 预览部署 → 部署专属 *.vercel.app 地址（预览隔离，不污染规范元数据）
 * > http://localhost:3000（本地开发）。
 * 换正式域名时改这里的 PRODUCTION_SITE_URL（或配 NEXT_PUBLIC_SITE_URL）即可全站收敛。
 */
const PRODUCTION_SITE_URL = 'https://board.multicaboard.com';

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  if (process.env.VERCEL_ENV === 'production') return PRODUCTION_SITE_URL;

  const vercel =
    process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL;
  if (process.env.VERCEL_ENV === 'preview' && vercel) {
    return `https://${vercel}`;
  }

  return 'http://localhost:3000';
}

/** 站点根地址（无尾斜杠），如 https://board.multicaboard.com */
export const SITE_URL = resolveSiteUrl();
