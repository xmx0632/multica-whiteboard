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
import { usePhonePortrait } from '@/lib/usePhonePortrait';

export default function Home() {
  useShortcuts();

  // 手机竖屏沉浸模式（ZOO-156）：隐藏全部浮层（whiteboard-chrome），画布铺满
  const [immersive, setImmersive] = useState(false);
  const phonePortrait = usePhonePortrait();

  return (
    <div className={`w-dvw h-dvh overflow-hidden relative bg-gray-50 flex flex-col${immersive ? ' immersive-mode' : ''}`}>
      <Canvas />
      <LeftToolbar />
      <PropertyPanel />
      <TopMenuBar />
      <HistoryPanel />
      {phonePortrait ? (
        /* 手机竖屏（ZOO-152 追加）：右下角操作行——沉浸与横屏全屏同行，不再两行叠放；
         * 沉浸中全屏钮随 whiteboard-chrome 隐藏，行内仅剩退出沉浸 */
        <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5">
          <ImmersiveToggle immersive={immersive} onChange={setImmersive} />
          <FullscreenToggle inRow />
        </div>
      ) : (
        <>
          <FullscreenToggle />
          {/* ImmersiveToggle 非竖屏渲染 null，但保留挂载以维持「旋转离开竖屏自动退出沉浸」副作用 */}
          <ImmersiveToggle immersive={immersive} onChange={setImmersive} />
        </>
      )}
    </div>
  );
}
