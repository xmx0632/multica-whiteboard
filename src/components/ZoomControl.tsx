'use client';

import { useCallback } from 'react';
import { useStore } from '@/lib/store';
import {
  zoomAt,
  zoomPercentage,
  stepZoomScale,
  MIN_ZOOM_PERCENT,
  MAX_ZOOM_PERCENT,
} from '@/lib/gestures';
import { useT } from '@/i18n/I18nProvider';

/**
 * 顶部缩放控件（ZOO-161）：− / 百分比 / + 步进器 + 同步滑杆。
 * 步进 ±10%（Shift 微调 ±1%），与滑杆 / wheel / 双指捏合共用同一 viewport 读数；
 * 到达 [10%, 500%] 边界时步进按钮禁用。缩放锚定画布可视中心。
 */
export default function ZoomControl() {
  const { viewport, setViewport } = useStore();
  const t = useT();
  const pct = zoomPercentage(viewport.scale);

  const applyScale = useCallback((nextScale: number) => {
    const vp = useStore.getState().viewport;
    // 画布铺满视口（w-dvh h-dvh），窗口中心即画布中心——步进/滑杆缩放锚定可视中心
    setViewport(zoomAt(vp, { x: window.innerWidth / 2, y: window.innerHeight / 2 }, nextScale));
  }, [setViewport]);

  const step = useCallback((dir: 1 | -1, fine: boolean) => {
    applyScale(stepZoomScale(useStore.getState().viewport.scale, dir, fine));
  }, [applyScale]);

  // 步进读数聚焦后 ↑↓ ±10%、Shift+↑↓ ±1%（spinbutton 语义）
  const onSpinKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
  }, [step]);

  // 滑杆纵向键对齐步进档（±10%，Shift ±1%）；横向键保留原生 1% 微步
  const onSliderKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
  }, [step]);

  return (
    <div role="group" aria-label={t('zoom.groupAria')} className="flex items-center gap-1 px-1">
      <button
        type="button"
        onClick={(e) => step(-1, e.shiftKey)}
        disabled={pct <= MIN_ZOOM_PERCENT}
        aria-label={
          pct > MIN_ZOOM_PERCENT
            ? t('zoom.outAria', { from: pct, to: Math.max(MIN_ZOOM_PERCENT, pct - 10) })
            : t('zoom.outAriaMin')
        }
        title={t('zoom.outTitle')}
        className="touch-target px-1.5 py-1 text-sm text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md disabled:opacity-30"
      >
        −
      </button>

      <span
        role="spinbutton"
        tabIndex={0}
        aria-label={t('zoom.pctAria')}
        aria-valuenow={pct}
        aria-valuemin={MIN_ZOOM_PERCENT}
        aria-valuemax={MAX_ZOOM_PERCENT}
        aria-valuetext={`${pct}%`}
        onKeyDown={onSpinKeyDown}
        className="text-xs text-gray-600 tabular-nums min-w-[3.25rem] text-center rounded-md px-1 py-1 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 cursor-default select-none"
      >
        {pct}%
      </span>

      <button
        type="button"
        onClick={(e) => step(1, e.shiftKey)}
        disabled={pct >= MAX_ZOOM_PERCENT}
        aria-label={
          pct < MAX_ZOOM_PERCENT
            ? t('zoom.inAria', { from: pct, to: Math.min(MAX_ZOOM_PERCENT, pct + 10) })
            : t('zoom.inAriaMax')
        }
        title={t('zoom.inTitle')}
        className="touch-target px-1.5 py-1 text-sm text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md disabled:opacity-30"
      >
        +
      </button>

      <input
        type="range"
        min={MIN_ZOOM_PERCENT}
        max={MAX_ZOOM_PERCENT}
        step={1}
        value={pct}
        onChange={(e) => applyScale(Number(e.target.value) / 100)}
        onKeyDown={onSliderKeyDown}
        aria-label={t('zoom.sliderAria')}
        title={t('zoom.sliderTitle')}
        className="touch-target w-20 accent-blue-500"
      />
    </div>
  );
}
