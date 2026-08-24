'use client';

import { useState } from 'react';
import Canvas from '@/components/Canvas';
import LeftToolbar from '@/components/LeftToolbar';
import PropertyPanel from '@/components/PropertyPanel';
import TopMenuBar from '@/components/TopMenuBar';
import HistoryPanel from '@/components/HistoryPanel';
import FullscreenToggle from '@/components/FullscreenToggle';
import ImmersiveToggle from '@/components/ImmersiveToggle';
import PageBar from '@/components/PageBar';
import { useShortcuts } from '@/lib/useShortcuts';
import { useAutosave } from '@/lib/useAutosave';
import { usePhonePortrait } from '@/lib/usePhonePortrait';

/**
 * 白板主应用（ZOO-181 SEO 前原 src/app/page.tsx 原样迁入，逻辑零改动）——
 * 迁出是为了让 `/` 路由成为服务端组件，可携带 JSON-LD 结构化数据。
 */
export default function WhiteboardApp() {
  useShortcuts();
  // 自动保存 + 刷新/崩溃恢复（ZOO-170）：挂在页面级，一次挂载全局生效
  useAutosave();

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
      {/* 页导航条（ZOO-198）：分页帧的增删 / 复制 / 重排 / 跳转入口 */}
      <PageBar />
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
