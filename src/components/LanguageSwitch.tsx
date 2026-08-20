'use client';

/**
 * 语言切换钮（ZOO-176，可选手动切换需求落地）：
 * 写 locale cookie（1 年，优先级高于自动检测）→ router.refresh() 服务端重解析，
 * 组件不卸载 → zustand 白板内容 / 撤销栈原样保留，仅文案随语言重建。
 */
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n, persistLocaleCookie } from '@/i18n/I18nProvider';
import { LOCALES, type Locale } from '@/i18n/config';

export default function LanguageSwitch() {
  const { locale, t } = useI18n();
  const router = useRouter();

  const next: Locale = LOCALES.find((l) => l !== locale) ?? locale;

  const handleSwitch = useCallback(() => {
    persistLocaleCookie(next);
    router.refresh();
  }, [next, router]);

  return (
    <button
      type="button"
      onClick={handleSwitch}
      title={t('lang.toggleAria')}
      aria-label={t('lang.toggleAria')}
      className="touch-target px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md tabular-nums"
    >
      {t('lang.toggle')}
    </button>
  );
}
