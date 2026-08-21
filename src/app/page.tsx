import { cookies, headers } from 'next/headers';
import WhiteboardApp from '@/components/WhiteboardApp';
import { LOCALE_COOKIE, resolveLocale } from '@/i18n/config';
import { getLibT } from '@/i18n/lib';
import { SITE_URL } from '@/lib/site';

/**
 * `/` 路由（ZOO-181 SEO 改为服务端组件）：界面仍是 WhiteboardApp 客户端应用、
 * 行为零改动；本层新增 JSON-LD 结构化数据（WebApplication），向搜索引擎与
 * AI 摘要说明产品形态——纯 canvas 应用对爬虫不可见的部分在这里补偿。
 */
async function getLocale() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get('accept-language'),
  );
}

export default async function Home() {
  const locale = await getLocale();
  const t = getLibT(locale);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: t('app.title'),
    description: t('app.description'),
    url: SITE_URL,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript',
    isAccessibleForFree: true,
    inLanguage: locale,
  };

  return (
    <>
      <script
        type="application/ld+json"
        // JSON-LD 官方指南的 XSS 防护：转义 `<` 阻断标签注入
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <WhiteboardApp />
    </>
  );
}
