import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/**
 * sitemap.xml（ZOO-181 SEO）：站点仅两个可索引路由——
 * `/` 白板主应用、`/mathplot-demo` 方程出图演示页。
 * 构建期静态生成，lastModified 取构建时刻。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/mathplot-demo`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ];
}
