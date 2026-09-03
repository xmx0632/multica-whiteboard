'use client';

import { useT } from '@/i18n/I18nProvider';

/** 官网地址（ZOO-357）：右上角品牌徽标新窗口跳转的目标 */
export const OFFICIAL_SITE_URL = 'https://multicaboard.com';

/**
 * 官网跳转入口（ZOO-357，ZOO-356 评审稿 v2 方案 A）：全端统一钉在右上角——
 * 「右上角 = 官网」心智三形态（桌面 / 竖屏 / 横屏）一致。
 * - 桌面（细指针）：带文字 Logo pill（品牌标 + MulticaBoard + ↗）；
 * - 触屏（粗指针）：48×48 图标徽标（命中区 ≥44px，见 globals.css .site-entry）；
 * - 横屏触屏与「⛶ 全屏」同排：徽标钉角，全屏钮左移让位（FullscreenToggle）。
 * 挂 whiteboard-chrome：沉浸 / 演示模式随其余浮层一并隐藏，不破坏放映态。
 */
export default function SiteEntryBadge() {
  const t = useT();
  const label = t('siteEntry.aria');

  return (
    <a
      href={OFFICIAL_SITE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className="site-entry whiteboard-chrome touch-target absolute top-3 right-3 z-10"
    >
      {/* 品牌标：沿用应用图标（public/icons/icon.svg）的蓝渐变底 + 白色正弦曲线 */}
      <svg className="site-entry-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="site-entry-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#60A5FA" />
            <stop offset="1" stopColor="#2563EB" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="14.5" fill="url(#site-entry-grad)" />
        <path
          d="M10 36 C 20 12, 28 12, 34 32 S 48 54, 54 30"
          stroke="#fff"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="site-entry-name">MulticaBoard</span>
      <span className="site-entry-ext" aria-hidden="true">↗</span>
    </a>
  );
}
