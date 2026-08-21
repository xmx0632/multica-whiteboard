import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, resolveLocale } from '@/i18n/config';
import { getLibT } from '@/i18n/lib';
import { SITE_URL } from '@/lib/site';

/**
 * /mathplot-demo 路由级 metadata（ZOO-181 SEO）：此前与首页共用同一份
 * title/description（重复内容信号）；此处按路由覆写，并给出独立 canonical。
 * openGraph 对象在子路由整体覆写根布局的同名字段（Metadata API 合并规则）。
 */
async function getLocale() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get('accept-language'),
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getLibT(locale);
  const title = t('demo.metaTitle');
  const description = t('demo.metaDescription');

  return {
    title,
    description,
    alternates: { canonical: '/mathplot-demo' },
    openGraph: {
      type: 'website',
      url: `${SITE_URL}/mathplot-demo`,
      title,
      description,
      siteName: 'MulticaBoard',
      locale,
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: t('app.ogImageAlt'),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og-image.png'],
    },
  };
}

export default function MathPlotDemoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
