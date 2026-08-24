'use client';

import { useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { usePresentation } from '@/lib/presentation';
import { framesOf } from '@/lib/frame';
import { useT } from '@/i18n/I18nProvider';

/**
 * 演示模式浮层（ZOO-200）：编辑 UI 全部随 presentation-mode 隐藏后，
 * 放映态仅存的最小操作面——
 * - 右上退出钮（Esc 同效）；
 * - 底部居中页码 + ‹ › 翻页钮（键盘 ←/→/空格 与触屏横滑之外的鼠标 / 点按通道）；
 * - 窗口尺寸变化 → 当前页重新等比铺满（旋转 / 拖窗后不满屏即重算）。
 * 激光指针不在此层：轨迹是 Canvas 纯渲染层（不入 elements / 撤销栈）。
 */
export default function PresentationOverlay() {
  const t = useT();
  const active = usePresentation((s) => s.active);
  const frameId = usePresentation((s) => s.frameId);
  const elements = useStore((s) => s.elements);

  const frames = useMemo(() => framesOf(elements), [elements]);
  const index = frameId != null ? frames.findIndex((f) => f.id === frameId) : -1;
  const current = index >= 0 ? index : 0;

  // 窗口尺寸变化：当前页重算铺满视口（全屏进出 / 旋转后不满屏即修正）
  useEffect(() => {
    if (!active) return;
    const onResize = () => usePresentation.getState().refit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active]);

  if (!active) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => usePresentation.getState().exit()}
        aria-label={t('presentation.exitAria')}
        title={`${t('presentation.exitAria')} (Esc)`}
        className="absolute top-3 right-3 z-30 touch-target px-3 py-1.5 text-xs rounded-xl shadow-lg border backdrop-blur-sm bg-gray-900/85 text-white border-gray-700 active:bg-gray-900"
      >
        {t('presentation.exit')}
      </button>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 px-2 py-1.5">
        <button
          type="button"
          onClick={() => usePresentation.getState().step(-1)}
          disabled={current <= 0}
          aria-label={t('presentation.prevPage')}
          title={`${t('presentation.prevPage')} (←)`}
          className="touch-target w-7 h-7 rounded-lg text-sm text-gray-600 hover:bg-gray-100 active:bg-gray-200 disabled:opacity-30"
        >
          ‹
        </button>
        <span
          className="text-xs text-gray-600 tabular-nums min-w-[3.5rem] text-center"
          title={t('presentation.laserTip')}
        >
          {t('presentation.pageOf', { current: current + 1, total: frames.length })}
        </span>
        <button
          type="button"
          onClick={() => usePresentation.getState().step(1)}
          disabled={current >= frames.length - 1}
          aria-label={t('presentation.nextPage')}
          title={`${t('presentation.nextPage')} (→ / 空格)`}
          className="touch-target w-7 h-7 rounded-lg text-sm text-gray-600 hover:bg-gray-100 active:bg-gray-200 disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </>
  );
}
