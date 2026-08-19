'use client';

import { useEffect } from 'react';
import { useStore } from './store';
import { isEditableTarget } from './keyboard';
import { ToolType } from './types';

export function useShortcuts() {
  const { setTool, undo, redo, deleteSelected, activeTool } = useStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 编辑态守卫（ZOO-163 单一来源）：焦点在输入控件时全部快捷键放行——
      // 空格 / 方向键 / 删除键 / 单字母工具切换（v/b/r/…/t）不得劫持文本输入
      if (isEditableTarget(e.target)) {
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
