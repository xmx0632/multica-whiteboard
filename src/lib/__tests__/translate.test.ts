import { describe, it, expect } from 'vitest';
import { translateElement, getElementBounds } from '../renderer';
import { WhiteboardElement, LineElement, ArrowElement, PathElement } from '../types';

const base = { id: 'el-1', strokeColor: '#000000', strokeWidth: 2, opacity: 1 };

const line: LineElement = { ...base, type: 'line', x: 200, y: 300, x2: 400, y2: 420 };
const arrow: ArrowElement = { ...base, type: 'arrow', x: 200, y: 300, x2: 400, y2: 420 };
const path: PathElement = {
  ...base, type: 'path', x: 10, y: 20,
  points: [{ x: 10, y: 20 }, { x: 40, y: 80 }, { x: 90, y: 60 }],
};

/** 两点间欧氏距离（校验几何形状不变） */
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(b.x - a.x, b.y - a.y);

describe('translateElement（选中拖动整体平移，ZOO-154）', () => {
  it('PM 复现数据回归：箭头 (200,300)→(400,420) 水平拖 +80，两端点同步位移、形状不变', () => {
    const moved = translateElement(arrow, 80, 0) as ArrowElement;
    expect(moved.x).toBe(280);
    expect(moved.y).toBe(300);
    expect(moved.x2).toBe(480);
    expect(moved.y2).toBe(420);
    // 修复前终点钉死 (400,420)：宽度 194→115 被拉变形；修复后长度恒为 200
    expect(dist(moved, { x: moved.x2, y: moved.y2 })).toBe(dist(arrow, { x: arrow.x2, y: arrow.y2 }));
    expect(getElementBounds(moved)!.width).toBe(getElementBounds(arrow)!.width);
  });

  it('line 两端点位移一致（dx/dy 同时作用于 x/y 与 x2/y2）', () => {
    const moved = translateElement(line, -30, 55) as LineElement;
    expect(moved.x).toBe(170);
    expect(moved.y).toBe(355);
    expect(moved.x2).toBe(370);
    expect(moved.y2).toBe(475);
    expect(dist(moved, { x: moved.x2, y: moved.y2 })).toBe(dist(line, { x: line.x2, y: line.y2 }));
  });

  it('line 反向绘制（x2 < x）平移后包围盒尺寸不变', () => {
    const rev: LineElement = { ...base, type: 'line', x: 400, y: 420, x2: 200, y2: 300 };
    const moved = translateElement(rev, 100, -20) as LineElement;
    expect(moved.x2).toBe(300);
    expect(moved.y2).toBe(280);
    const a = getElementBounds(rev)!;
    const b = getElementBounds(moved)!;
    expect(b.width).toBe(a.width);
    expect(b.height).toBe(a.height);
  });

  it('path 所有点同步位移，相邻点间距不变（笔迹形状不变）', () => {
    const moved = translateElement(path, 7, -13) as PathElement;
    expect(moved.points).toHaveLength(path.points.length);
    path.points.forEach((p, i) => {
      expect(moved.points[i].x).toBeCloseTo(p.x + 7);
      expect(moved.points[i].y).toBeCloseTo(p.y - 13);
    });
    for (let i = 0; i < path.points.length - 1; i++) {
      expect(dist(moved.points[i], moved.points[i + 1])).toBeCloseTo(dist(path.points[i], path.points[i + 1]));
    }
  });

  it('外框语义类型（rectangle/circle/text/mathPlot）只动 x/y，尺寸与内容不变', () => {
    const rect: WhiteboardElement = { ...base, type: 'rectangle', x: 5, y: 6, width: 100, height: 50, fillColor: null };
    const circle: WhiteboardElement = { ...base, type: 'circle', x: 5, y: 6, width: 100, height: 50, fillColor: '#fff' };
    const text: WhiteboardElement = { ...base, type: 'text', x: 5, y: 6, content: 'hi', fontSize: 20, fontFamily: 'sans-serif', color: '#000', width: 24, height: 26 };
    const mathPlot: WhiteboardElement = {
      ...base, type: 'mathPlot', x: 5, y: 6, width: 480, height: 360, equation: 'y=sin(x)',
      kind: 'explicit', xAxis: { min: -10, max: 10 }, equalRatio: true, sampleCount: 320,
      showAxis: true, showGrid: true, showLabel: true,
    };
    for (const el of [rect, circle, text, mathPlot]) {
      const moved = translateElement(el, 12, 34) as typeof el & { width: number; height: number };
      expect(moved.x).toBe(17);
      expect(moved.y).toBe(40);
      expect(moved.width).toBe((el as { width: number }).width);
      expect(moved.height).toBe((el as { height: number }).height);
    }
  });

  it('纯函数：不修改原元素（含 path 的 points 数组）', () => {
    const lineSnapshot = { ...line };
    const pathPointsSnapshot = path.points.map((p) => ({ ...p }));
    translateElement(line, 10, 10);
    translateElement(path, 10, 10);
    expect(line).toEqual(lineSnapshot);
    expect(path.points).toEqual(pathPointsSnapshot);
  });
});
