'use client';

import { useStore } from '@/lib/store';
import { ToolType } from '@/lib/types';
import { useT } from '@/i18n/I18nProvider';
import type { LibT } from '@/i18n/lib';

const tools: { tool: ToolType; labelKey: string; shortcut: string; icon: string; divider?: boolean }[] = [
  { tool: 'hand', labelKey: 'toolbar.hand', shortcut: 'H', icon: '✋' },
  { tool: 'select', labelKey: 'toolbar.select', shortcut: 'V', icon: '⇱', divider: true },
  { tool: 'pen', labelKey: 'toolbar.pen', shortcut: 'B', icon: '✎' },
  { tool: 'rectangle', labelKey: 'toolbar.rectangle', shortcut: 'R', icon: '▭' },
  { tool: 'circle', labelKey: 'toolbar.circle', shortcut: 'C', icon: '○' },
  { tool: 'line', labelKey: 'toolbar.line', shortcut: 'L', icon: '╱' },
  { tool: 'arrow', labelKey: 'toolbar.arrow', shortcut: 'A', icon: '→' },
  { tool: 'text', labelKey: 'toolbar.text', shortcut: 'T', icon: 'T' },
  { tool: 'eraser', labelKey: 'toolbar.eraser', shortcut: 'E', icon: '⌫' },
  { tool: 'equation', labelKey: 'toolbar.equation', shortcut: 'F', icon: 'ƒ', divider: true },
];

export default function LeftToolbar() {
  const { activeTool, setTool } = useStore();
  const t: LibT = useT();

  return (
    <div className="whiteboard-chrome touch-toolbar absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-1.5 z-10">
      {tools.map(({ tool, labelKey, shortcut, icon, divider }) => (
        <div key={tool} className="flex flex-col gap-1">
          {divider && <div className="toolbar-divider h-px bg-gray-200 mx-1 my-0.5" />}
          <button
            onClick={() => setTool(tool)}
            className={`touch-target w-9 h-9 rounded-lg flex items-center justify-center text-base transition-all ${
              activeTool === tool
                ? 'bg-blue-500 text-white shadow-md'
                : 'text-gray-600 hover:bg-gray-100 active:bg-gray-200'
            }`}
            title={`${t(labelKey)} (${shortcut})`}
          >
            {tool === 'equation' ? <span className="font-serif italic">{icon}</span> : icon}
          </button>
        </div>
      ))}
    </div>
  );
}
