/**
 * 图层顺序（z-order）纯函数（ZOO-183）：
 *
 * 元素数组顺序即渲染层级（renderer 按序绘制，末位最上层）——本模块只做数组
 * 重排，不引入新字段，持久化 / 导出 / 缩略图天然兼容。四操作与主流工具同义：
 * bringToFront 置于最上层（移到末位）/ sendToBack 置于最底层（移到首位）/
 * bringForward 上移一层（与后一位交换）/ sendBackward 下移一层（与前一位交换）。
 *
 * 边界语义（统一为「空转」）：未选中 / 元素不存在 / 已在目标边界 → 返回 null，
 * 调用方（store）不置脏、不压撤销栈——与面板按钮置灰双保险。所有元素类型
 * （path / 形状 / 文本 / mathPlot）一视同仁，仅按数组位置判定。
 */
import { WhiteboardElement } from './types';

export type ZOrderAction = 'bringToFront' | 'sendToBack' | 'bringForward' | 'sendBackward';

/** 单元素 / 双元素场景下的边界判定（面板按钮置灰用，不依赖具体操作）：单元素四向全禁 */
export function zOrderBounds(elements: WhiteboardElement[], id: string | null): { atFront: boolean; atBack: boolean } {
  const idx = id == null ? -1 : elements.findIndex((e) => e.id === id);
  if (idx < 0) return { atFront: false, atBack: false };
  return { atFront: idx === elements.length - 1, atBack: idx === 0 };
}

/**
 * 重排元素数组。返回新数组（原数组不动，元素对象原引用复用）；
 * 无位移（空转）返回 null。
 */
export function reorderElements(
  elements: WhiteboardElement[],
  id: string | null,
  action: ZOrderAction,
): WhiteboardElement[] | null {
  if (id == null) return null;
  const idx = elements.findIndex((e) => e.id === id);
  if (idx < 0) return null;

  const next = [...elements];
  switch (action) {
    case 'bringToFront': {
      if (idx === next.length - 1) return null; // 已在最上层
      next.splice(idx, 1);
      next.push(elements[idx]);
      return next;
    }
    case 'sendToBack': {
      if (idx === 0) return null; // 已在最底层
      next.splice(idx, 1);
      next.unshift(elements[idx]);
      return next;
    }
    case 'bringForward': {
      if (idx === next.length - 1) return null;
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    }
    case 'sendBackward': {
      if (idx === 0) return null;
      [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
      return next;
    }
  }
}

/**
 * 多选图层重排（ZOO-205 最小选中集合）：对 ids 内全部元素逐个施加同一操作，
 * 在同一份结果数组上迭代（一次快照可撤销）。
 *
 * 迭代顺序按操作方向取：bringForward / bringToFront 自顶向下（先移最上层，
 * 后续元素下标不受影响），sendBackward / sendToBack 自底向上——组内相对顺序保持。
 * 全部空转（无位移）返回 null，与单元素语义一致（不置脏、不入撤销栈）。
 */
export function reorderElementsMulti(
  elements: WhiteboardElement[],
  ids: string[],
  action: ZOrderAction,
): WhiteboardElement[] | null {
  const present = ids.filter((id) => elements.some((e) => e.id === id));
  if (present.length === 0) return null;
  const indices = present
    .map((id) => elements.findIndex((e) => e.id === id))
    .filter((idx) => idx >= 0);
  // bringForward 系自顶向下、sendBackward 系自底向上，保证组内逐个相邻交换成立
  const ordered = action === 'bringForward' || action === 'bringToFront'
    ? indices.sort((a, b) => b - a)
    : indices.sort((a, b) => a - b);
  let current = elements;
  let changed = false;
  for (const idx of ordered) {
    const next = reorderElements(current, current[idx].id, action);
    if (next) {
      current = next;
      changed = true;
    }
  }
  return changed ? current : null;
}
