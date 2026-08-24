'use client';

import { useEffect } from 'react';
import { useStore } from './store';
import { isEditableTarget } from './keyboard';
import { matchEvent, useShortcutUI, ShortcutId } from './keymap';
import { zoomAt, stepZoomScale, fitViewport } from './gestures';
import { getAllElementsBounds } from './renderer';
import { saveToLocal, listLocalDocuments, listServerDocuments, loadFromLocal, loadFromServer } from './persistence';
import { useAutosaveStore } from './autosave';
import { useT } from '@/i18n/I18nProvider';
import type { ToolType } from './types';

/**
 * 快捷键统一接管层（ZOO-205）：键位定义唯一来源在 keymap.ts（配置表驱动），
 * 本文件只做事件接线与动作分派——与 gestures.ts / keyboard.ts 同一惯例。
 *
 * 两条入口守卫（顺序固定）：
 * 1. 编辑态守卫（ZOO-163 单一来源）：焦点在 input/textarea/contenteditable 时全部
 *    放行（不 preventDefault、不动作）——单字母工具键（现 Alt 系）、Ctrl 系编辑键、
 *    删除键不得劫持文本输入；输入框内 Option/Alt+字母继续原生输入数学符号（√ ≈ ≤）。
 * 2. 模态守卫：帮助面板 / 高级公式面板（role=dialog）打开期间除 Esc / Alt+/ 外全部
 *    失效——防后台切工具、误触发保存。
 *
 * Esc 优先级（一次按下只做一件事）：关帮助面板 > 折线编辑退出（ZOO-168）>
 * 其他模态自身关闭（此处放行不动作）> 取消选中。
 */
const TOOL_OF_BINDING: Partial<Record<ShortcutId, ToolType>> = {
  'tool.select': 'select', 'tool.hand': 'hand', 'tool.pen': 'pen', 'tool.penAlias': 'pen',
  'tool.rectangle': 'rectangle', 'tool.circle': 'circle', 'tool.circleAlias': 'circle',
  'tool.line': 'line', 'tool.arrow': 'arrow', 'tool.text': 'text',
  'tool.eraser': 'eraser', 'tool.equation': 'equation',
};

/** 视口中心（画布铺满视口，窗口中心即画布中心——与 ZoomControl 同口径） */
function viewportCenter() {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** 上一 / 下一白板（ZOO-205 PageUp/PageDown）：合并本地 + 服务器列表按更新时间降序，
 *  当前文档不在列表（未保存的新白板）视作最新端；切换前未保存改动走确认。 */
async function switchBoard(dir: 1 | -1, confirmText: string): Promise<void> {
  const st = useStore.getState();
  if (st.isDirty && !confirm(confirmText)) return;
  const merged = new Map<string, { id: string; updatedAt: number; source: 'local' | 'server' }>();
  for (const d of listLocalDocuments()) {
    merged.set(d.id, { id: d.id, updatedAt: d.updatedAt, source: 'local' });
  }
  for (const d of await listServerDocuments()) {
    const prev = merged.get(d.id);
    if (!prev || d.updatedAt > prev.updatedAt) {
      merged.set(d.id, { id: d.id, updatedAt: d.updatedAt, source: prev?.source ?? 'server' });
    }
  }
  const list = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  if (list.length === 0) return;
  // dir = +1（PageUp，更新一档）/ -1（PageDown，更旧一档）；当前不在列表 → 视作 idx = -1
  const idx = list.findIndex((d) => d.id === st.documentId);
  const next = list[(idx === -1 ? 0 : idx) + dir];
  if (!next) return;
  const doc = next.source === 'local' ? loadFromLocal(next.id) : await loadFromServer(next.id);
  if (doc) useStore.getState().loadDocument(doc);
}

export function useShortcuts() {
  const t = useT();

  useEffect(() => {
    const runAction = (id: ShortcutId) => {
      const st = useStore.getState();
      const tool = TOOL_OF_BINDING[id];
      if (tool) {
        if (tool !== st.activeTool) st.setTool(tool);
        return;
      }
      switch (id) {
        case 'edit.undo':
          st.undo();
          return;
        case 'edit.redo':
        case 'edit.redoAlias':
          st.redo();
          return;
        case 'edit.selectAll':
          st.selectAll();
          return;
        case 'edit.copy':
          st.copySelected();
          return;
        case 'edit.paste':
          st.pasteClipboard();
          return;
        case 'edit.cut':
          st.cutSelected();
          return;
        case 'edit.duplicate':
          st.duplicateSelected();
          return;
        case 'edit.delete':
        case 'edit.deleteBackspace':
          // 折线编辑态删选中顶点优先（ZOO-168 语义不回归）
          if (st.polylineEditId) {
            st.deletePolylineVertex();
            return;
          }
          st.deleteSelected();
          return;
        case 'edit.moveUp':
          st.moveUp();
          return;
        case 'edit.moveDown':
          st.moveDown();
          return;
        case 'file.new':
          if (st.isDirty && !confirm(t('menu.confirmDiscard'))) return;
          st.newDocument(t('common.untitled'));
          return;
        case 'file.save': {
          // 手动保存 = 立即落盘（ZOO-170 协同：签名未变则自动保存不再重复写）
          saveToLocal({
            id: st.documentId, title: st.documentTitle, elements: st.elements,
            viewport: st.viewport, createdAt: Date.now(), updatedAt: Date.now(),
          });
          st.markSaved();
          useAutosaveStore.getState().setNotice({ kind: 'saved', text: t('menu.savedLocal'), at: Date.now() });
          return;
        }
        case 'view.zoomIn':
        case 'view.zoomOut': {
          const vp = st.viewport;
          const dir = id === 'view.zoomIn' ? 1 : -1;
          st.setViewport(zoomAt(vp, viewportCenter(), stepZoomScale(vp.scale, dir)));
          return;
        }
        case 'view.zoomReset':
          st.setViewport(zoomAt(st.viewport, viewportCenter(), 1));
          return;
        case 'view.zoomFit': {
          const fitted = fitViewport(
            getAllElementsBounds(st.elements),
            { width: window.innerWidth, height: window.innerHeight },
          );
          if (fitted) st.setViewport(fitted);
          return;
        }
        case 'view.prevBoard':
          void switchBoard(1, t('menu.confirmDiscard'));
          return;
        case 'view.nextBoard':
          void switchBoard(-1, t('menu.confirmDiscard'));
          return;
        case 'ui.help':
          useShortcutUI.getState().setHelpOpen(!useShortcutUI.getState().helpOpen);
          return;
        default:
          return;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // 守卫 1（ZOO-163）：编辑态全部放行——文本输入优先于一切快捷键
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;

      const { helpOpen, setHelpOpen } = useShortcutUI.getState();

      // Esc 优先级链（见文件头注释）；Escape 不在 KEY_BINDINGS 分派里匹配（防 modifier 误配）
      if (e.key === 'Escape') {
        if (helpOpen) {
          e.preventDefault();
          setHelpOpen(false);
          return;
        }
        const modalOpen = typeof document !== 'undefined' && !!document.querySelector('[role="dialog"]');
        const st = useStore.getState();
        if (st.polylineEditId) {
          e.preventDefault();
          st.endPolylineEdit();
          return;
        }
        if (modalOpen) return; // 高级公式面板等模态：其自身监听关闭，此处不叠加动作
        e.preventDefault();
        st.setSelected(null);
        return;
      }

      const binding = matchEvent(e);
      if (!binding) return;

      // 守卫 2：模态打开期间仅保留帮助面板开合
      const modalOpen = typeof document !== 'undefined' && !!document.querySelector('[role="dialog"]');
      if ((helpOpen || modalOpen) && binding.id !== 'ui.help') return;

      e.preventDefault();
      runAction(binding.id);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [t]);
}
