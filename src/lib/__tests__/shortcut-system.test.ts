/**
 * 快捷键体系单测（ZOO-205）：
 *
 * - matchShortcut：Alt 系按 e.code 物理键位匹配（Mac ⌥V 的 e.key 是 √，按 e.key
 *   匹配会静默失效——这里固化该回归防护）、修饰键精确相等（AltGr = Ctrl+Alt 不误配
 *   Alt 系；Ctrl+Z 与 Ctrl+Shift+Z 互不串扰）；
 * - formatShortcut：Win（Alt+V / Ctrl+Shift+Z）与 Mac（⌥V / ⌘⇧Z）双平台展示；
 * - fitViewport：适应内容的视口数学；
 * - store 多选最小集 + 页面内剪贴板：Ctrl+A 全选 / Ctrl+C 复制 / Ctrl+V 粘贴
 *   （新 id + 偏移）/ Ctrl+X 剪切 / Ctrl+D 复制并平移 / 批量删除 / 多选图层，
 *   全部单条快照可撤销，undo/redo 往返一致；
 * - 编辑态守卫（ZOO-163）对全部键位生效由 useShortcuts 入口保证（keyboard-guard
 *   已覆盖判定函数本身）。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { KEY_BINDINGS, matchShortcut, matchEvent, formatShortcut } from '../keymap';
import { fitViewport } from '../gestures';
import { useStore } from '../store';
import { WhiteboardElement } from '../types';

/** 合成 KeyboardEvent 形状（node 无 DOM） */
const key = (opts: { code?: string; key?: string; alt?: boolean; shift?: boolean; ctrl?: boolean; meta?: boolean }) => ({
  code: opts.code ?? '',
  key: opts.key ?? '',
  altKey: opts.alt ?? false,
  shiftKey: opts.shift ?? false,
  ctrlKey: opts.ctrl ?? false,
  metaKey: opts.meta ?? false,
});

const binding = (id: string) => {
  const b = KEY_BINDINGS.find((kb) => kb.id === id);
  if (!b) throw new Error(`no binding ${id}`);
  return b;
};

describe('matchShortcut（ZOO-205 键位匹配）', () => {
  it('Alt 系按 code 匹配：Mac ⌥V 的 e.key 是 √ 也不影响命中', () => {
    // Mac Option+V 真实事件形状：code=KeyV、key=√、altKey
    expect(matchShortcut(key({ code: 'KeyV', key: '√', alt: true }), binding('tool.select'))).toBe(true);
    // Windows Alt+V：key=v
    expect(matchShortcut(key({ code: 'KeyV', key: 'v', alt: true }), binding('tool.select'))).toBe(true);
  });

  it('裸单字母不命中任何绑定（无裸单键快捷键，owner 要求）', () => {
    expect(matchEvent(key({ code: 'KeyV', key: 'v' }))).toBeNull();
    expect(matchEvent(key({ code: 'KeyT', key: 't' }))).toBeNull();
  });

  it('修饰键精确相等：Alt+V 不被 AltGr（Ctrl+Alt+V）误配；Shift 串扰不命中', () => {
    expect(matchShortcut(key({ code: 'KeyV', key: '√', alt: true, ctrl: true }), binding('tool.select'))).toBe(false);
    expect(matchShortcut(key({ code: 'KeyV', key: 'V', alt: true, shift: true }), binding('tool.select'))).toBe(false);
  });

  it('Ctrl 系：Ctrl+Z 与 Ctrl+Shift+Z 互不串扰；Cmd（Mac）等价 Ctrl', () => {
    const e = key({ code: 'KeyZ', key: 'z', ctrl: true });
    expect(matchShortcut(e, binding('edit.undo'))).toBe(true);
    expect(matchShortcut(e, binding('edit.redo'))).toBe(false);
    expect(matchShortcut(key({ code: 'KeyZ', key: 'Z', ctrl: true, shift: true }), binding('edit.redo'))).toBe(true);
    // Mac ⌘Z：metaKey 等价 ctrlKey
    expect(matchShortcut(key({ code: 'KeyZ', key: 'z', meta: true }), binding('edit.undo'))).toBe(true);
  });

  it('编辑命令 Ctrl 家族（A/C/V/X/D）与工具 Alt 家族不冲突：同字母分属两个修饰体系', () => {
    expect(matchShortcut(key({ code: 'KeyA', key: 'a', ctrl: true }), binding('edit.selectAll'))).toBe(true);
    expect(matchShortcut(key({ code: 'KeyA', key: 'a', alt: true }), binding('tool.arrow'))).toBe(true);
    expect(matchShortcut(key({ code: 'KeyA', key: 'a', ctrl: true }), binding('tool.arrow'))).toBe(false);
  });

  it('符号与编辑键：Alt+= / Alt+- / Alt+0 / Alt+Shift+0 / Alt+/ / PageUp / [ ]', () => {
    expect(matchShortcut(key({ code: 'Equal', key: '=', alt: true }), binding('view.zoomIn'))).toBe(true);
    expect(matchShortcut(key({ code: 'Minus', key: '-', alt: true }), binding('view.zoomOut'))).toBe(true);
    expect(matchShortcut(key({ code: 'Digit0', key: '0', alt: true }), binding('view.zoomReset'))).toBe(true);
    expect(matchShortcut(key({ code: 'Digit0', key: '°', alt: true, shift: true }), binding('view.zoomFit'))).toBe(true);
    expect(matchShortcut(key({ code: 'Slash', key: '∕', alt: true }), binding('ui.help'))).toBe(true);
    expect(matchShortcut(key({ key: 'PageUp' }), binding('view.prevBoard'))).toBe(true);
    expect(matchShortcut(key({ key: ']' }), binding('edit.moveUp'))).toBe(true);
  });

  it('键位表无重复绑定（同一事件命中唯一）', () => {
    const seen = new Set<string>();
    for (const b of KEY_BINDINGS) {
      const sig = [b.code ?? `k:${b.key}`, b.altKey ? 1 : 0, b.shiftKey ? 1 : 0, b.ctrlKey ? 1 : 0].join('|');
      expect(seen.has(sig), `duplicate binding: ${b.id} (${sig})`).toBe(false);
      seen.add(sig);
    }
  });
});

describe('formatShortcut（双平台展示）', () => {
  it('Win：Ctrl+Shift+Z / Alt+V；Mac：⌘⇧Z / ⌥V', () => {
    expect(formatShortcut(binding('edit.redo'), false)).toBe('Ctrl+Shift+Z');
    expect(formatShortcut(binding('edit.redo'), true)).toBe('⌘⇧Z');
    expect(formatShortcut(binding('tool.select'), false)).toBe('Alt+V');
    expect(formatShortcut(binding('tool.select'), true)).toBe('⌥V');
    expect(formatShortcut(binding('ui.help'), false)).toBe('Alt+/');
    expect(formatShortcut(binding('view.zoomReset'), true)).toBe('⌥0');
  });
});

describe('fitViewport（适应内容）', () => {
  it('内容居中完整可见，scale 取宽高较小者', () => {
    const vp = fitViewport({ x: 0, y: 0, width: 200, height: 100 }, { width: 500, height: 500 });
    expect(vp).not.toBeNull();
    // 可用区 500-120=380 → scale = min(380/200, 380/100) = 1.9
    expect(vp!.scale).toBeCloseTo(1.9, 5);
    expect(vp!.offsetX).toBeCloseTo(500 / 2 - 100 * 1.9, 5);
    expect(vp!.offsetY).toBeCloseTo(500 / 2 - 50 * 1.9, 5);
  });

  it('空内容 / 零尺寸返回 null（调用方保持视口不动）', () => {
    expect(fitViewport(null, { width: 500, height: 500 })).toBeNull();
    expect(fitViewport({ x: 0, y: 0, width: 0, height: 10 }, { width: 500, height: 500 })).toBeNull();
  });

  it('超大内容缩到下限 10% 仍完整可见', () => {
    const vp = fitViewport({ x: 0, y: 0, width: 100000, height: 100000 }, { width: 800, height: 600 });
    expect(vp!.scale).toBe(0.1);
  });
});

/** 矩形元素工厂（测试用） */
const rect = (id: string, x = 0, y = 0): WhiteboardElement => ({
  id, type: 'rectangle', x, y, width: 10, height: 10,
  strokeColor: '#000', strokeWidth: 2, opacity: 1,
} as unknown as WhiteboardElement);

describe('store：多选最小集 + 页面内剪贴板（ZOO-205）', () => {
  beforeEach(() => {
    const st = useStore.getState();
    st.clearAll();
    useStore.setState({ undoStack: [], redoStack: [], clipboard: [], selectedIds: [], selectedId: null });
    useStore.getState().addElement(rect('a', 0, 0));
    useStore.getState().addElement(rect('b', 20, 0));
    useStore.getState().addElement(rect('c', 40, 0));
    useStore.setState({ undoStack: [], redoStack: [] });
  });

  it('selectAll：全选内容元素，selectedId=最上层，selectedIds=全部', () => {
    useStore.getState().selectAll();
    const s = useStore.getState();
    expect(s.selectedIds).toEqual(['a', 'b', 'c']);
    expect(s.selectedId).toBe('c');
  });

  it('Ctrl+C → Ctrl+V：新 id 偏移落位、单条快照、粘贴结果成为新选中', () => {
    const st = useStore.getState();
    st.setSelected('a');
    st.copySelected();
    expect(useStore.getState().clipboard).toHaveLength(1);
    st.pasteClipboard();
    const s = useStore.getState();
    expect(s.elements).toHaveLength(4);
    const pasted = s.elements[3];
    expect(pasted.id).not.toBe('a');
    expect(pasted.x).toBe(16);
    expect(pasted.y).toBe(16);
    expect(s.selectedIds).toEqual([pasted.id]);
    expect(useStore.getState().undoStack).toHaveLength(1);
    // undo 撤销粘贴 → 回到 3 个元素
    s.undo();
    expect(useStore.getState().elements).toHaveLength(3);
  });

  it('多选 Ctrl+C → Ctrl+V：整组新 id 偏移落位，一条快照整体撤销', () => {
    useStore.getState().selectAll();
    useStore.getState().copySelected();
    useStore.getState().pasteClipboard();
    let s = useStore.getState();
    expect(s.elements).toHaveLength(6);
    expect(s.selectedIds).toHaveLength(3);
    expect(useStore.getState().undoStack.at(-1)).toHaveLength(3);
    s.undo();
    s = useStore.getState();
    expect(s.elements).toHaveLength(3);
  });

  it('Ctrl+X：入剪贴板 + 删除源（单条快照），Ctrl+V 恢复为新 id', () => {
    useStore.getState().selectAll();
    useStore.getState().cutSelected();
    let s = useStore.getState();
    expect(s.elements).toHaveLength(0);
    expect(s.clipboard).toHaveLength(3);
    expect(useStore.getState().undoStack.at(-1)).toHaveLength(3);
    s.undo();
    expect(useStore.getState().elements).toHaveLength(3);
  });

  it('Ctrl+D：原地克隆偏移落位，不触碰剪贴板', () => {
    useStore.getState().selectAll();
    useStore.getState().duplicateSelected();
    const s = useStore.getState();
    expect(s.elements).toHaveLength(6);
    expect(s.clipboard).toHaveLength(0);
    expect(s.selectedIds).toHaveLength(3);
    expect(s.selectedIds.every((id) => !['a', 'b', 'c'].includes(id))).toBe(true);
  });

  it('deleteSelected：多选批量删除单条快照；undo 整体恢复', () => {
    useStore.getState().selectAll();
    useStore.getState().deleteSelected();
    expect(useStore.getState().elements).toHaveLength(0);
    expect(useStore.getState().selectedIds).toEqual([]);
    useStore.getState().undo();
    expect(useStore.getState().elements).toHaveLength(3);
  });

  it('deleteElement 单删自动把 id 从集合中摘除（selectedId ∈ selectedIds 不变量）', () => {
    useStore.getState().selectAll();
    useStore.getState().deleteElement('b');
    const s = useStore.getState();
    expect(s.selectedIds).toEqual(['a', 'c']);
    expect(s.selectedIds).toContain(s.selectedId!);
  });

  it('多选图层 moveUp：整组上移一层，单条快照可撤销', () => {
    useStore.getState().selectAll();
    useStore.getState().moveUp();
    let s = useStore.getState();
    // a、b、c 各上移一层：c 已在顶层空转，a 0→1，b 1→2，c 停留末位
    expect(s.elements.map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(useStore.getState().undoStack.at(-1)).toHaveLength(1);
    s.undo();
    s = useStore.getState();
    expect(s.elements.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('setTool 清空集合（切换工具退出多选，与单选行为一致）', () => {
    useStore.getState().selectAll();
    useStore.getState().setTool('pen');
    const s = useStore.getState();
    expect(s.selectedIds).toEqual([]);
    expect(s.selectedId).toBeNull();
  });
});
