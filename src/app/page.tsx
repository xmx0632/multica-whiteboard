'use client';

import { useState } from 'react';
import Canvas from '@/components/Canvas';
import LeftToolbar from '@/components/LeftToolbar';
import PropertyPanel from '@/components/PropertyPanel';
import TopMenuBar from '@/components/TopMenuBar';
import HistoryPanel from '@/components/HistoryPanel';
import FullscreenToggle from '@/components/FullscreenToggle';
import ImmersiveToggle from '@/components/ImmersiveToggle';
import { useShortcuts } from '@/lib/useShortcuts';

export default function Home() {
  useShortcuts();

  // 手机竖屏沉浸模式（ZOO-156）：隐藏全部浮层（whiteboard-chrome），画布铺满
  const [immersive, setImmersive] = useState(false);

  return (
    <div className={`w-dvw h-dvh overflow-hidden relative bg-gray-50 flex flex-col${immersive ? ' immersive-mode' : ''}`}>
      <Canvas />
      <LeftToolbar />
      <PropertyPanel />
      <TopMenuBar />
      <HistoryPanel />
      <FullscreenToggle />
      <ImmersiveToggle immersive={immersive} onChange={setImmersive} />
    </div>
  );
}
