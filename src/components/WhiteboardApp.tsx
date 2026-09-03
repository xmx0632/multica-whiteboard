'use client';

import { useState } from 'react';
import Canvas from '@/components/Canvas';
import LeftToolbar from '@/components/LeftToolbar';
import PropertyPanel from '@/components/PropertyPanel';
import TopMenuBar from '@/components/TopMenuBar';
import HistoryPanel from '@/components/HistoryPanel';
import FullscreenToggle from '@/components/FullscreenToggle';
import ImmersiveToggle from '@/components/ImmersiveToggle';
import SiteEntryBadge from '@/components/SiteEntryBadge';
import PageBar from '@/components/PageBar';
import PresentationOverlay from '@/components/PresentationOverlay';
import { usePresentation } from '@/lib/presentation';
import { useShortcuts } from '@/lib/useShortcuts';
import ShortcutsHelpPanel from '@/components/ShortcutsHelpPanel';
import ConfirmDialog from '@/components/ConfirmDialog';
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
  // 演示模式（ZOO-200）：与沉浸正交——演示进入 / 退出不碰 immersive 态，
  // 两类 class 同时在挂也只是叠加隐藏浮层；退出演示后沉浸态原样恢复
  const presenting = usePresentation((s) => s.active);

  return (
    <div className={`w-dvw h-dvh overflow-hidden relative bg-gray-50 flex flex-col${immersive ? ' immersive-mode' : ''}${presenting ? ' presentation-mode' : ''}`}>
      <Canvas />
      <LeftToolbar />
      <PropertyPanel />
      <TopMenuBar />
      <HistoryPanel />
      {/* 官网跳转徽标（ZOO-357）：全端右上角，新窗口打开 multicaboard.com；
       * 横屏触屏与全屏钮同排（让位规则见 globals.css .site-entry） */}
      <SiteEntryBadge />
      {/* 页导航条（ZOO-198）：分页帧的增删 / 复制 / 重排 / 跳转入口 */}
      <PageBar />
      {/* 演示模式浮层（ZOO-200）：放映态仅存的退出钮 + 页码 / 翻页钮（自判 active 渲染） */}
      <PresentationOverlay />
      {/* 快捷键帮助面板（ZOO-205）：Alt+/ 或顶栏 ? 呼出，portal 到 body */}
      <ShortcutsHelpPanel />
      {/* 自定义确认弹窗（ZOO-209）：confirmDialog() 命令式发起，单例 portal 到 body */}
      <ConfirmDialog />
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
