'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { COLORS, ToolType, WhiteboardElement } from '@/lib/types';
import { canFillFromToolPanel, elementFillColor } from '@/lib/stroke';
import { useT } from '@/i18n/I18nProvider';
import { KEY_BINDINGS, formatShortcut, isMacPlatform, ShortcutId } from '@/lib/keymap';
import type { LibT } from '@/i18n/lib';

const tools: { tool: ToolType; labelKey: string; bindingId: ShortcutId; icon: string; divider?: boolean }[] = [
  { tool: 'hand', labelKey: 'toolbar.hand', bindingId: 'tool.hand', icon: '✋' },
  { tool: 'select', labelKey: 'toolbar.select', bindingId: 'tool.select', icon: '⇱', divider: true },
  { tool: 'pen', labelKey: 'toolbar.pen', bindingId: 'tool.pen', icon: '✎' },
  { tool: 'rectangle', labelKey: 'toolbar.rectangle', bindingId: 'tool.rectangle', icon: '▭' },
  { tool: 'circle', labelKey: 'toolbar.circle', bindingId: 'tool.circle', icon: '○' },
  { tool: 'diamond', labelKey: 'toolbar.diamond', bindingId: 'tool.diamond', icon: '◇' },
  { tool: 'line', labelKey: 'toolbar.line', bindingId: 'tool.line', icon: '╱' },
  { tool: 'arrow', labelKey: 'toolbar.arrow', bindingId: 'tool.arrow', icon: '→' },
  { tool: 'text', labelKey: 'toolbar.text', bindingId: 'tool.text', icon: 'T' },
  { tool: 'eraser', labelKey: 'toolbar.eraser', bindingId: 'tool.eraser', icon: '⌫' },
  { tool: 'equation', labelKey: 'toolbar.equation', bindingId: 'tool.equation', icon: 'ƒ', divider: true },
];

/** 透明填充指示：灰框 + 红斜杠（透明 = 无填充，ZOO-228） */
function NoFillMark({ className }: { className?: string }) {
  return (
    <span
      className={`rounded-full border-2 border-gray-300 bg-white ${className ?? ''}`}
      style={{
        backgroundImage: 'linear-gradient(to top right, transparent 44%, #EF4444 44% 56%, transparent 56%)',
      }}
    />
  );
}

export default function LeftToolbar() {
  const {
    activeTool, setTool,
    elements, selectedId, selectedIds,
    fillColor, pickFillColor, inputFillColor, commitFillStyle,
  } = useStore();
  const t: LibT = useT();
  // tooltip 按键文案与实际绑定同源（keymap 配置表，ZOO-205），仅符号按平台显示
  const mac = useMemo(() => isMacPlatform(), []);
  const shortcutOf = (id: ShortcutId) => {
    const b = KEY_BINDINGS.find((kb) => kb.id === id);
    return b ? formatShortcut(b, mac) : '';
  };

  // —— 填充色板浮层（ZOO-228）：选中矩形/菱形/圆形 → 批量改填充；无选中 → 设新形状默认 ——
  const [fillOpen, setFillOpen] = useState(false);
  const selIds = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
  const fillTargets: WhiteboardElement[] = selIds.length > 0
    ? elements.filter((e) => selIds.includes(e.id) && canFillFromToolPanel(e))
    : [];
  // 回显取主选中（selectedId 优先，多选无匹配时取末位），无选中回退默认填充
  const primaryFillEl = fillTargets.find((e) => e.id === selectedId) ?? fillTargets[fillTargets.length - 1] ?? null;
  const panelFill = primaryFillEl ? elementFillColor(primaryFillEl) : fillColor;

  // 浮层关闭（ZOO-228）：Esc / 点击浮层与切换钮以外的界面 chrome；画布触点不收——
  // 保持面板常驻，连选连填多个形状（Excalidraw 同款面板语义）
  useEffect(() => {
    if (!fillOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.closest('canvas') || el.closest('.fill-popover') || el.closest('.fill-toggle')) return;
      setFillOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFillOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [fillOpen]);

  return (
    <div className="whiteboard-chrome touch-toolbar absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-1.5 z-10">
      {tools.map(({ tool, labelKey, bindingId, icon, divider }) => (
        <div key={tool} className="flex flex-col gap-1">
          {divider && <div className="toolbar-divider h-px bg-gray-200 mx-1 my-0.5" />}
          <button
            onClick={() => setTool(tool)}
            className={`touch-target w-9 h-9 rounded-lg flex items-center justify-center text-base transition-all ${
              activeTool === tool
                ? 'bg-blue-500 text-white shadow-md'
                : 'text-gray-600 hover:bg-gray-100 active:bg-gray-200'
            }`}
            title={`${t(labelKey)} (${shortcutOf(bindingId)})`}
          >
            {tool === 'equation' ? <span className="font-serif italic">{icon}</span> : icon}
          </button>
        </div>
      ))}

      {/* 填充颜色（ZOO-228）：矩形/菱形/圆形内部填充入口 */}
      <div className="relative flex flex-col gap-1">
        <div className="toolbar-divider h-px bg-gray-200 mx-1 my-0.5" />
        <button
          onClick={() => setFillOpen((v) => !v)}
          aria-pressed={fillOpen}
          title={t('toolbar.fill')}
          className={`fill-toggle touch-target w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
            fillOpen ? 'bg-blue-500 shadow-md' : 'text-gray-600 hover:bg-gray-100 active:bg-gray-200'
          }`}
        >
          {panelFill ? (
            <span className="w-5 h-5 rounded border-2" style={{ backgroundColor: panelFill, borderColor: panelFill }} />
          ) : (
            <NoFillMark className="w-5 h-5" />
          )}
        </button>

        {fillOpen && (
          <div className="fill-popover touch-panel absolute bottom-0 left-full ml-2 w-48 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3 z-20">
            <label className="text-xs font-medium text-gray-500 mb-1 block">
              {t('panel.fill')}{fillTargets.length > 0 ? t('panel.selectedSuffix') : ''}
            </label>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                title={t('panel.fillNone')}
                aria-label={t('panel.fillNone')}
                aria-pressed={panelFill === null}
                onClick={() => pickFillColor(null)}
                className={`touch-swatch flex items-center justify-center ${panelFill === null ? 'scale-110' : ''}`}
              >
                <NoFillMark className={`w-5 h-5 ${panelFill === null ? 'border-blue-500' : ''}`} />
              </button>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => pickFillColor(c)}
                  className={`touch-swatch w-5 h-5 rounded-full border-2 ${panelFill === c ? 'border-blue-500 scale-110' : 'border-gray-300'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={panelFill ?? '#000000'}
                onChange={(e) => inputFillColor(e.target.value)}
                onBlur={commitFillStyle}
                className="touch-swatch w-5 h-5 rounded cursor-pointer border border-gray-300"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
