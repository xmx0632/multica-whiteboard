'use client';

/**
 * 语言切换菜单（ZOO-176；四语言起为下拉，替代两语言时代的二元切换钮）：
 * 列表项显示各语言自称（lang.nativeName，经该语言自己的 catalog 取文案，
 * 恒为「中文 / English / 日本語 / 한국어」，不随当前界面语言变化）；
 * 选中写 locale cookie（1 年，优先级高于自动检测）→ router.refresh() 服务端
 * 重解析，组件不卸载 → zustand 白板内容 / 撤销栈原样保留，仅文案随语言重建。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n, persistLocaleCookie } from '@/i18n/I18nProvider';
import { getLibT } from '@/i18n/lib';
import { LOCALES, type Locale } from '@/i18n/config';

export default function LanguageSwitch() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击菜单外 / Esc 收起（语言菜单需要显式关闭出口，与导出菜单的点选即关不同）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSelect = useCallback(
    (next: Locale) => {
      setOpen(false);
      if (next === locale) return;
      persistLocaleCookie(next);
      router.refresh();
    },
    [locale, router],
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={t('lang.title')}
        aria-label={t('lang.title')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="touch-target px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md"
      >
        {t('lang.nativeName')} ▾
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[110px] z-30">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={l === locale}
              onClick={() => handleSelect(l)}
              className={`touch-target w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 active:bg-gray-100 flex items-center justify-between gap-2 ${
                l === locale ? 'text-blue-600 font-medium' : 'text-gray-600'
              }`}
            >
              {getLibT(l)('lang.nativeName')}
              {l === locale && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
