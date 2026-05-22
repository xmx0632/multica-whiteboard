'use client';

import { useStore } from '@/lib/store';
import { ToolType } from '@/lib/types';

const tools: { tool: ToolType; label: string; shortcut: string; icon: string }[] = [
  { tool: 'select', label: 'Select', shortcut: 'V', icon: '⇱' },
  { tool: 'pen', label: 'Pen', shortcut: 'B', icon: '✎' },
  { tool: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: '▭' },
  { tool: 'circle', label: 'Circle', shortcut: 'C', icon: '○' },
  { tool: 'line', label: 'Line', shortcut: 'L', icon: '╱' },
  { tool: 'arrow', label: 'Arrow', shortcut: 'A', icon: '→' },
  { tool: 'text', label: 'Text', shortcut: 'T', icon: 'T' },
  { tool: 'eraser', label: 'Eraser', shortcut: 'E', icon: '⌫' },
];

export default function LeftToolbar() {
  const { activeTool, setTool } = useStore();

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-1.5 z-10">
      {tools.map(({ tool, label, shortcut, icon }) => (
        <button
          key={tool}
          onClick={() => setTool(tool)}
          className={`w-9 h-9 rounded-lg flex items-center justify-center text-base transition-all ${
            activeTool === tool
              ? 'bg-blue-500 text-white shadow-md'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
          title={`${label} (${shortcut})`}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
