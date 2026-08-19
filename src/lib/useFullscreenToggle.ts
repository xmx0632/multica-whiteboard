'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  enterFullscreenLandscape,
  exitFullscreen,
  fullscreenButtonMode,
  fullscreenSupported,
  type FullscreenButtonMode,
} from './fullscreen';

/**
 * 移动端全屏按钮状态（ZOO-152）：
 * 粗指针 + 支持元素全屏才显示；全屏中切换为退出钮。
 * SSR / 首帧恒为 hidden（无 DOM 能力探测），挂载后校正。
 */
export function useFullscreenToggle(): { mode: FullscreenButtonMode; onToggle: () => void } {
  const [coarse, setCoarse] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const [supported, setSupported] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const coarseMq = window.matchMedia('(pointer: coarse)');
    const landscapeMq = window.matchMedia('(orientation: landscape)');
    const sync = () => {
      setCoarse(coarseMq.matches);
      setLandscape(landscapeMq.matches);
      setSupported(fullscreenSupported({
        requestFullscreen: typeof document.documentElement.requestFullscreen === 'function',
        exitFullscreen: typeof document.exitFullscreen === 'function',
      }));
      setFullscreen(document.fullscreenElement != null);
    };
    sync();
    coarseMq.addEventListener('change', sync);
    landscapeMq.addEventListener('change', sync);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      coarseMq.removeEventListener('change', sync);
      landscapeMq.removeEventListener('change', sync);
      document.removeEventListener('fullscreenchange', sync);
    };
  }, []);

  const onToggle = useCallback(() => {
    if (document.fullscreenElement) void exitFullscreen();
    else void enterFullscreenLandscape();
  }, []);

  return { mode: fullscreenButtonMode({ coarse, supported, fullscreen, landscape }), onToggle };
}
