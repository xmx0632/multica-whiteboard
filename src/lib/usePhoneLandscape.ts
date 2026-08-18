'use client';

import { useEffect, useState } from 'react';
import { phoneLandscapeMediaQuery } from './landscape';

/**
 * 手机横屏侦测（ZOO-152）：matchMedia 监听，旋转即时切换。
 * SSR / 首帧恒为 false（与 globals.css 媒体查询互不依赖，桌面 / 竖屏零变化）。
 */
export function usePhoneLandscape(): boolean {
  const [landscape, setLandscape] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(phoneLandscapeMediaQuery());
    const update = () => setLandscape(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return landscape;
}
