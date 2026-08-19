'use client';

import { useFullscreenToggle } from '@/lib/useFullscreenToggle';

/**
 * 移动端全屏切换钮（ZOO-152 追加需求）：右上角常驻。
 * - 竖屏：进入「横屏全屏」（全屏 + 方向锁横屏，最大化画布）；
 * - 横屏非全屏：进入全屏；全屏中：退出全屏（方向锁随之释放）。
 * 桌面（细指针）与不支持元素全屏的浏览器（iOS Safari）不渲染。
 */
export default function FullscreenToggle() {
  const { mode, onToggle } = useFullscreenToggle();

  if (mode === 'hidden') return null;

  const label =
    mode === 'exit' ? '✕ 退出全屏'
    : mode === 'enter-landscape' ? '⛶ 横屏全屏'
    : '⛶ 全屏';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      className={`fullscreen-toggle touch-target absolute top-3 right-3 z-20 px-3 py-1.5 text-xs rounded-xl shadow-lg border flex items-center gap-1 backdrop-blur-sm transition-colors ${
        mode === 'exit'
          ? 'bg-gray-900/85 text-white border-gray-700 active:bg-gray-900'
          : 'bg-white/90 text-gray-600 border-gray-200 hover:bg-gray-50 active:bg-gray-100'
      }`}
    >
      {label}
    </button>
  );
}
