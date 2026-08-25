'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { ToolType } from '@/lib/types';
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

export default function LeftToolbar() {
  const { activeTool, setTool } = useStore();
  const t: LibT = useT();
  // tooltip 按键文案与实际绑定同源（keymap 配置表，ZOO-205），仅符号按平台显示
  const mac = useMemo(() => isMacPlatform(), []);
  const shortcutOf = (id: ShortcutId) => {
    const b = KEY_BINDINGS.find((kb) => kb.id === id);
    return b ? formatShortcut(b, mac) : '';
  };

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
    </div>
  );
}
