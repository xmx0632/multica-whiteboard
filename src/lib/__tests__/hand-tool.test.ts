/**
 * 手型平移工具单测（ZOO-157）：
 * - panBy：屏幕位移 → viewport 平移的纯函数数学（offset 同系叠加、scale 不变、纯函数）；
 * - store：'hand' 为合法工具（setTool 接线、切换清选中——平移工具不持有元素选中态）。
 *
 * Canvas.tsx 只做 Pointer 事件接线（本仓库惯例：viewport 数学沉淀 gestures.ts 供单测）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { panBy } from '../gestures';
import { useStore } from '../store';

describe('panBy（手型 / 空格 / 中键平移共用数学，ZOO-157）', () => {
  const vp = { offsetX: 40, offsetY: -25, scale: 1.5 };

  it('位移直接叠加到 offset，scale 不变', () => {
    const next = panBy(vp, 120, -80);
    expect(next.offsetX).toBe(160);
    expect(next.offsetY).toBe(-105);
    expect(next.scale).toBe(1.5);
  });

  it('纯函数：不修改入参 viewport', () => {
    const input = { ...vp };
    panBy(input, 7, 9);
    expect(input).toEqual(vp);
  });

  it('零位移返回等值 viewport（对象新建，内容不变）', () => {
    const next = panBy(vp, 0, 0);
    expect(next).toEqual(vp);
    expect(next).not.toBe(vp);
  });

  it('与既有 pan 落定公式代数等价（offsetStart + delta，桌面回归保护）', () => {
    const start = { offsetX: 17, offsetY: 9, scale: 2 };
    const dx = 33;
    const dy = -21;
    const legacy = { offsetX: start.offsetX + dx, offsetY: start.offsetY + dy, scale: start.scale };
    expect(panBy(start, dx, dy)).toEqual(legacy);
  });
});

describe('手型工具 store 接线', () => {
  beforeEach(() => {
    useStore.setState({
      elements: [],
      selectedId: null,
      activeTool: 'pen',
      undoStack: [],
      redoStack: [],
      isDirty: false,
    });
  });

  it("setTool('hand') 生效：activeTool 置为 'hand'", () => {
    useStore.getState().setTool('hand');
    expect(useStore.getState().activeTool).toBe('hand');
  });

  it('切到手型清选中：平移手势不作用于元素、不残留选中框', () => {
    useStore.setState({
      elements: [{ id: 'el-1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null }],
      selectedId: 'el-1',
    });
    useStore.getState().setTool('hand');
    expect(useStore.getState().selectedId).toBeNull();
  });
});
