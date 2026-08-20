'use client';

/**
 * i18n 客户端上下文（ZOO-176）。
 *
 * locale 由服务端 root layout 解析（cookie > Accept-Language > zh-CN）后经 props
 * 注入 —— SSR 与客户端 hydration 使用同一来源，切换无闪烁；lib 模块（parse /
 * conic 等）的翻译器与组件共用同一份 catalog 与 t 签名（LibT）。
 */
import { createContext, useCallback, useContext, useMemo } from 'react';
import { getLibT, type LibT } from './lib';
import { LOCALE_COOKIE_MAX_AGE, type Locale } from './config';

export interface I18nContextValue {
  locale: Locale;
  /** 与 lib 翻译器同签名：组件内直接用，也直接传给 lib 函数 */
  t: LibT;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = useMemo(() => getLibT(locale), [locale]);
  const value = useMemo(() => ({ locale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n 必须在 I18nProvider 内使用');
  return ctx;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useT(): LibT {
  return useI18n().t;
}

/** 客户端切换语言：写 cookie（1 年）后由调用方 router.refresh() 重建 RSC */
export function persistLocaleCookie(locale: Locale): void {
  document.cookie = `locale=${locale};path=/;max-age=${LOCALE_COOKIE_MAX_AGE};samesite=lax`;
}

/** 方便组件内格式化日期 / 时间随语言环境 */
export function useDateFormatter(): (ts: number, opts?: Intl.DateTimeFormatOptions) => string {
  const { locale } = useI18n();
  return useCallback(
    (ts: number, opts?: Intl.DateTimeFormatOptions) => new Date(ts).toLocaleString(locale, opts),
    [locale],
  );
}
