'use client';

import { useEffect } from 'react';
import { immersiveToggleMode } from '@/lib/portrait';
import { usePhonePortrait } from '@/lib/usePhonePortrait';
import { useT } from '@/i18n/I18nProvider';

/**
 * 手机竖屏沉浸模式切换钮（ZOO-156）：由 page.tsx 放入右下角操作行
 * （与「⛶ 横屏全屏」同行，ZOO-152 追加需求）。
 * - 进入：页面根挂 immersive-mode 类，全部浮层（whiteboard-chrome）隐藏，画布铺满；
 * - 沉浸中：本钮化为半透明唤回钮（同行位置），一键恢复全部浮层；
 * - 旋转离开竖屏自动退出沉浸；桌面 / 横屏不渲染。
 * 纯 CSS 隐藏（不依赖 Fullscreen API），iOS Safari 同样可用；
 * 浏览器级全屏仍由 FullscreenToggle（⛶ 横屏全屏）承担，两者可叠加。
 */
export interface ImmersiveToggleProps {
  immersive: boolean;
  onChange: (next: boolean) => void;
}

export default function ImmersiveToggle({ immersive, onChange }: ImmersiveToggleProps) {
  const phonePortrait = usePhonePortrait();
  const t = useT();

  // 旋转离开竖屏：自动退出沉浸（chrome 恢复，防状态滞留）
  useEffect(() => {
    if (!phonePortrait && immersive) onChange(false);
  }, [phonePortrait, immersive, onChange]);

  const mode = immersiveToggleMode(phonePortrait, immersive);
  if (mode === 'hidden') return null;

  const exit = mode === 'exit';

  return (
    <button
      type="button"
      onClick={() => onChange(!immersive)}
      aria-label={exit ? t('immersive.exitAria') : t('immersive.enterAria')}
      className={`touch-target px-3 py-1.5 text-xs rounded-xl shadow-lg border backdrop-blur-sm transition-colors ${
        exit
          ? 'bg-gray-900/85 text-white border-gray-700 active:bg-gray-900'
          : 'bg-white/90 text-gray-600 border-gray-200 hover:bg-gray-50 active:bg-gray-100'
      }`}
    >
      {exit ? t('immersive.exit') : t('immersive.enter')}
    </button>
  );
}
