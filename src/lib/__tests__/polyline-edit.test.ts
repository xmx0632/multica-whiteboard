/**
 * 直线/箭头折线化单测（ZOO-168）：
 * - polyline.ts 纯函数：lineVertices 退化回退、polylinePatch 首尾同步与退化清 points、
 *   插点投影 / 删点约束 / 顶点拖动、nearestOnPolyline 段命中；
 * - renderer：折线平移形状不变、包围盒覆盖全顶点、hitTest 线段距离阈值
 *   （折线包围盒内部空白不再误命中）；
 * - shapeResize：端点手柄补丁与 points 首尾保持一致（双数据源不漂移）；
 * - store：编辑态进出（选中变化 / 切工具退出）、Delete 删中间顶点接入历史栈、
 *   撤销回退直线后编辑态自动失效；
 * - export：SVG 折线输出与箭头随最后一段方向。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  lineVertices, isPolyline, polylinePatch, insertVertexPatch, removeVertexPatch,
  vertexDragPatch, nearestOnPolyline, parseVertexHandle, vertexHandle,
} from '../polyline';
import { translateElement, getElementBounds, hitTest } from '../renderer';
import { endpointResizePatch } from '../shapeResize';
import { useStore } from '../store';
import { exportToSvg } from '../export';
import { ArrowElement, LineElement, Point, WhiteboardElement } from '../types';

const base = { id: 'el-1', strokeColor: '#000000', strokeWidth: 2, opacity: 1 };

const line: LineElement = { ...base, type: 'line', x: 0, y: 0, x2: 200, y2: 0 };
const arrow: ArrowElement = { ...base, type: 'arrow', x: 0, y: 0, x2: 200, y2: 0 };
const vp = { offsetX: 0, offsetY: 0, scale: 1 };
const V = (id: string, pts: Point[], type: 'line' | 'arrow' = 'line') =>
  ({ ...base, id, type, x: pts[0].x, y: pts[0].y, x2: pts[pts.length - 1].x, y2: pts[pts.length - 1].y, points: pts }) as LineElement;

describe('polyline 纯函数（ZOO-168）', () => {
  it('lineVertices：无 points 的旧格式回退两端点；折线取 points', () => {
    expect(lineVertices(line)).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    const poly = V('p', [{ x: 0, y: 0 }, { x: 100, y: -40 }, { x: 200, y: 0 }]);
    expect(lineVertices(poly)).toHaveLength(3);
    expect(isPolyline(poly)).toBe(true);
    expect(isPolyline(line)).toBe(false);
  });

  it('polylinePatch：首尾顶点同步 x/y 与 x2/y2；≤2 顶点清掉 points（退化为普通直线）', () => {
    const patch = polylinePatch(line, [{ x: 10, y: 20 }, { x: 60, y: 30 }, { x: 90, y: 40 }]);
    expect(patch.x).toBe(10);
    expect(patch.y).toBe(20);
    expect(patch.x2).toBe(90);
    expect(patch.y2).toBe(40);
    expect(patch.points).toHaveLength(3);

    const degraded = polylinePatch(line, [{ x: 5, y: 5 }, { x: 50, y: 50 }]);
    expect(degraded.points).toBeUndefined();
    expect(degraded.x).toBe(5);
    expect(degraded.x2).toBe(50);
    // Object.assign 覆盖语义：旧 points 数组被显式清空（3→2 删除场景）
    const merged = Object.assign({}, V('p', [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]), degraded);
    expect(merged.points).toBeUndefined();
    expect(isPolyline(merged)).toBe(false);
    // 序列化不残留 points 键（旧存档格式等价）
    expect(JSON.parse(JSON.stringify(merged)).points).toBeUndefined();
  });

  it('nearestOnPolyline：逐段投影取最近（距离 / 段下标 / 投影点）', () => {
    const poly = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const near = nearestOnPolyline({ x: 40, y: 30 }, poly)!;
    expect(near.segIndex).toBe(0);
    expect(near.point).toEqual({ x: 40, y: 0 });
    expect(near.dist).toBeCloseTo(30);
    const near2 = nearestOnPolyline({ x: 130, y: 60 }, poly)!;
    expect(near2.segIndex).toBe(1);
    expect(near2.point).toEqual({ x: 100, y: 60 });
    expect(nearestOnPolyline({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBeNull();
  });

  it('insertVertexPatch：双击点投影到最近段插入，返回补丁 + 新顶点下标', () => {
    const r = insertVertexPatch(line, { x: 80, y: 60 })!;
    expect(r.index).toBe(1);
    const patched = { ...line, ...r.patch };
    expect(lineVertices(patched)).toEqual([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 200, y: 0 }]);
    expect(patched.x2).toBe(200); // 端点字段不漂移

    // 距段端点过近不插（双击落在端点手柄附近，防重合顶点）
    expect(insertVertexPatch(line, { x: 5, y: 0 }, { minEndDist: 12 })).toBeNull();
    expect(insertVertexPatch(line, { x: 196, y: 3 }, { minEndDist: 12 })).toBeNull();
  });

  it('removeVertexPatch：仅中间顶点可删；3→2 退化直线（points 清空）', () => {
    const poly = V('p', [{ x: 0, y: 0 }, { x: 100, y: -40 }, { x: 200, y: 0 }]);
    expect(removeVertexPatch(poly, 0)).toBeNull(); // 首端点不可删
    expect(removeVertexPatch(poly, 2)).toBeNull(); // 尾端点不可删
    const patch = removeVertexPatch(poly, 1)!;
    expect(patch.points).toBeUndefined();
    expect(patch.x).toBe(0);
    expect(patch.x2).toBe(200);

    const four = V('f', [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }, { x: 150, y: 50 }]);
    const kept = removeVertexPatch(four, 1)!;
    expect(kept.points).toHaveLength(3);
    expect(lineVertices({ ...four, ...kept } as LineElement)).toEqual([
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 50 },
    ]);
  });

  it('vertexDragPatch：中间顶点改位其余不动；v0 / v末位 同端点语义；越界返回 null', () => {
    const poly = V('p', [{ x: 0, y: 0 }, { x: 100, y: -40 }, { x: 200, y: 0 }]);
    const mid = { ...poly, ...vertexDragPatch(poly, 1, { x: 120, y: -80 })! };
    expect(lineVertices(mid)).toEqual([{ x: 0, y: 0 }, { x: 120, y: -80 }, { x: 200, y: 0 }]);
    expect(mid.x).toBe(0);
    expect(mid.x2).toBe(200);

    const head = { ...poly, ...vertexDragPatch(poly, 0, { x: -30, y: 10 })! };
    expect(head.x).toBe(-30);
    expect(head.y).toBe(10);
    expect(lineVertices(head)[0]).toEqual({ x: -30, y: 10 });

    const tail = { ...poly, ...vertexDragPatch(poly, 2, { x: 240, y: 20 })! };
    expect(tail.x2).toBe(240);
    expect(tail.y2).toBe(20);

    expect(vertexDragPatch(poly, 3, { x: 0, y: 0 })).toBeNull();
  });

  it('parseVertexHandle / vertexHandle：vN 手柄 id 往返；非顶点手柄返回 null', () => {
    expect(vertexHandle(3)).toBe('v3');
    expect(parseVertexHandle('v12')).toBe(12);
    expect(parseVertexHandle('p1')).toBeNull();
    expect(parseVertexHandle('nw')).toBeNull();
  });
});

describe('renderer 折线适配（ZOO-168）', () => {
  it('translateElement：折线全顶点同步位移，形状不变', () => {
    const poly = V('p', [{ x: 0, y: 0 }, { x: 100, y: -40 }, { x: 200, y: 0 }], 'arrow');
    const moved = translateElement(poly, 30, 10) as ArrowElement;
    expect(lineVertices(moved)).toEqual([{ x: 30, y: 10 }, { x: 130, y: -30 }, { x: 230, y: 10 }]);
    expect(moved.x).toBe(30);
    expect(moved.x2).toBe(230);
  });

  it('getElementBounds：折线包围盒覆盖全部顶点', () => {
    const poly = V('p', [{ x: 20, y: -10 }, { x: 100, y: -60 }, { x: 180, y: 30 }]);
    const b = getElementBounds(poly)!;
    expect(b).toEqual({ x: 20, y: -60, width: 160, height: 90 });
  });

  it('hitTest：线段距离阈值——线上命中、折线包围盒内部空白不命中（验收 2 命中口径）', () => {
    const poly = V('p', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(hitTest(poly, { x: 50, y: 4 }, vp)).toBe(true);
    expect(hitTest(poly, { x: 104, y: 50 }, vp)).toBe(true);
    // 折线开口（包围盒左下区域）距两段均远 → 不命中
    expect(hitTest(poly, { x: 5, y: 95 }, vp)).toBe(false);
    // 普通斜线：包围盒角空白不再误命中
    const diag: LineElement = { ...base, type: 'line', x: 0, y: 0, x2: 100, y2: 100 };
    expect(hitTest(diag, { x: 50, y: 55 }, vp)).toBe(true);
    expect(hitTest(diag, { x: 90, y: 10 }, vp)).toBe(false);
  });
});

describe('端点手柄与折线一致性（ZOO-168）', () => {
  it('endpointResizePatch：p1/p2 拖动同步改 points 首尾（防双数据源漂移）', () => {
    const poly = V('p', [{ x: 0, y: 0 }, { x: 100, y: -40 }, { x: 200, y: 0 }]);
    const p1 = endpointResizePatch('p1', poly, { x: -20, y: 8 });
    const moved1 = { ...poly, ...p1 };
    expect(moved1.x).toBe(-20);
    expect(lineVertices(moved1)[0]).toEqual({ x: -20, y: 8 });
    expect(lineVertices(moved1)).toHaveLength(3);

    const p2 = endpointResizePatch('p2', poly, { x: 300, y: 60 });
    const moved2 = { ...poly, ...p2 };
    expect(moved2.x2).toBe(300);
    expect(lineVertices(moved2)[2]).toEqual({ x: 300, y: 60 });
  });
});

describe('store 折线编辑态（ZOO-168）', () => {
  const polyEl: WhiteboardElement = {
    ...base, id: 'poly-1', type: 'line', x: 0, y: 0, x2: 200, y2: 0,
    points: [{ x: 0, y: 0 }, { x: 100, y: -40 }, { x: 200, y: 0 }],
  };

  beforeEach(() => {
    useStore.setState({
      elements: [polyEl],
      selectedId: null,
      polylineEditId: null,
      polylineVertexIndex: null,
      undoStack: [],
      redoStack: [],
      isDirty: false,
    });
  });

  it('选中变化 / 切工具退出编辑态；编辑中元素保持选中', () => {
    const st = useStore.getState();
    st.setSelected('poly-1');
    st.beginPolylineEdit('poly-1');
    expect(useStore.getState().polylineEditId).toBe('poly-1');

    st.setSelected('poly-1'); // 同元素：保留编辑态
    expect(useStore.getState().polylineEditId).toBe('poly-1');

    st.setSelected(null); // 点空白
    expect(useStore.getState().polylineEditId).toBeNull();

    st.beginPolylineEdit('poly-1');
    useStore.getState().setTool('pen'); // 切工具
    expect(useStore.getState().polylineEditId).toBeNull();
  });

  it('deletePolylineVertex：删中间顶点单条快照入栈，undo 恢复', () => {
    const st = useStore.getState();
    st.beginPolylineEdit('poly-1');
    useStore.setState({ polylineVertexIndex: 1 });
    st.deletePolylineVertex();

    const cur = useStore.getState().elements[0] as LineElement;
    expect(cur.points).toBeUndefined(); // 3→2 退化直线
    expect(useStore.getState().polylineEditId).toBeNull(); // 退化即退出编辑态
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    const restored = useStore.getState().elements[0] as LineElement;
    expect(restored.points).toHaveLength(3);
  });

  it('删除后仍是折线（4 顶点）：保持编辑态，仅清顶点选中', () => {
    const four: WhiteboardElement = {
      ...base, id: 'four-1', type: 'line', x: 0, y: 0, x2: 150, y2: 50,
      points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }, { x: 150, y: 50 }],
    };
    useStore.setState({ elements: [four] });
    const st = useStore.getState();
    st.beginPolylineEdit('four-1');
    useStore.setState({ polylineVertexIndex: 1 });
    st.deletePolylineVertex();

    expect((useStore.getState().elements[0] as LineElement).points).toHaveLength(3);
    expect(useStore.getState().polylineEditId).toBe('four-1');
    expect(useStore.getState().polylineVertexIndex).toBeNull();
  });

  it('未选中顶点 / 端点下标：Delete 删顶点为无操作（不误删元素）', () => {
    const st = useStore.getState();
    st.beginPolylineEdit('poly-1'); // 未选顶点
    st.deletePolylineVertex();
    expect(useStore.getState().elements).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(0);

    useStore.setState({ polylineVertexIndex: 0 }); // 端点不可删
    st.deletePolylineVertex();
    expect((useStore.getState().elements[0] as LineElement).points).toHaveLength(3);
  });

  it('撤销双击转换（直线 ← 折线）→ 元素退回直线，编辑态自动失效', () => {
    const plain: WhiteboardElement = {
      ...base, id: 'plain-1', type: 'line', x: 0, y: 0, x2: 200, y2: 0,
    };
    useStore.setState({ elements: [plain] });
    const st = useStore.getState();
    st.setSelected('plain-1');
    st.beginPolylineEdit('plain-1');
    // 模拟双击转换插入的顶点更新（plain → 折线）
    st.updateElement('plain-1', insertVertexPatch(plain as LineElement, { x: 80, y: 30 })!.patch);
    expect(isPolyline(useStore.getState().elements[0] as LineElement)).toBe(true);

    useStore.getState().undo(); // 撤销转换
    expect(useStore.getState().elements[0]).toEqual(plain); // 退回普通直线
    expect(useStore.getState().polylineEditId).toBeNull(); // 编辑态失效
  });
});

describe('导出折线（ZOO-168）', () => {
  it('SVG：折线 line 输出 <polyline>；arrow 箭头跟随最后一段方向', () => {
    const poly: LineElement = {
      ...base, id: 'pl', type: 'line', x: 0, y: 0, x2: 200, y2: 0,
      points: [{ x: 0, y: 0 }, { x: 100, y: -50 }, { x: 200, y: 0 }],
    };
    const svg = exportToSvg([poly]);
    expect(svg).toContain('<polyline points="0,0 100,-50 200,0"');

    const polyArrow: ArrowElement = {
      ...base, id: 'pa', type: 'arrow', x: 0, y: 0, x2: 200, y2: 0,
      points: [{ x: 0, y: 0 }, { x: 100, y: -50 }, { x: 200, y: 0 }],
    };
    const svgArrow = exportToSvg([polyArrow]);
    expect(svgArrow).toContain('<polyline points="0,0 100,-50 200,0"');
    // 箭头头部按最后一段 (100,-50)→(200,0) 的方向计算
    const angle = Math.atan2(0 - -50, 200 - 100);
    const headLen = Math.max(10, polyArrow.strokeWidth * 4);
    const ax1 = 200 - headLen * Math.cos(angle - Math.PI / 6);
    const ay1 = 0 - headLen * Math.sin(angle - Math.PI / 6);
    const ax2 = 200 - headLen * Math.cos(angle + Math.PI / 6);
    const ay2 = 0 - headLen * Math.sin(angle + Math.PI / 6);
    expect(svgArrow).toContain(`<polygon points="200,0 ${ax1},${ay1} ${ax2},${ay2}"`);
  });

  it('SVG：两点直线保持既有 <line> 输出（旧格式零变化）', () => {
    expect(exportToSvg([line])).toContain('<line x1="0" y1="0" x2="200" y2="0"');
    expect(exportToSvg([arrow])).toContain('<polygon points="200,0');
  });
});
