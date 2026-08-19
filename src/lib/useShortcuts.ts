'use client';

import { useEffect } from 'react';
import { useStore } from './store';
import { ToolType } from './types';

export function useShortcuts() {
  const { setTool, undo, redo, deleteSelected, activeTool } = useStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
        return;
      }

      const toolMap: Record<string, ToolType> = {
        h: 'hand', v: 'select', b: 'pen', r: 'rectangle', c: 'circle',
        l: 'line', a: 'arrow', t: 'text', e: 'eraser', f: 'equation',
      };
      const tool = toolMap[e.key.toLowerCase()];
      if (tool && tool !== activeTool) {
        setTool(tool);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setTool, undo, redo, deleteSelected, activeTool]);
}
