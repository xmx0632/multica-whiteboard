import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/**
 * robots.txt（ZOO-181 SEO）：全站允许抓取；/api/ 是数据接口（保存白板 JSON），
 * 无索引价值且防爬虫误触写接口。构建期静态生成。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
