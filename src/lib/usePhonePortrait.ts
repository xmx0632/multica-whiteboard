'use client';

import { useEffect, useState } from 'react';
import { phonePortraitMediaQuery } from './portrait';

/**
 * 手机竖屏侦测（ZOO-156）：matchMedia 监听，旋转即时切换。
 * SSR / 首帧恒为 false（与 globals.css 媒体查询互不依赖，桌面 / 横屏零变化）。
 */
export function usePhonePortrait(): boolean {
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(phonePortraitMediaQuery());
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return portrait;
}
