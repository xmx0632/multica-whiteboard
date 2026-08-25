/**
 * 矩形旋转单测（ZOO-221 矩形旋转系列 PR-R1）：
 * - rotation.ts 原语：normalizeRotation 归一 [0,360)、elementRotation 缺省 0、
 *   rotatePointAround 屏幕系顺时针（与 canvas/SVG rotate 同向）；
 * - 命名分叉：elementLocalFrame（存储外框，选中/缩放）vs elementBoundsAABB
 *   （旋转四角世界系 AABB，culling/zoom-fit/导出边界）——旋转 ≠ 0 时两套分离、
 *   其余类型同体；AABB 覆盖全部旋转角点（只增不裁）；
 * - hitTest：指针逆旋转后判局部外框——旋出局部框的角命中、AABB 四角旋外空白
 *   不命中；rotation = 0 与旧行为一致；
 * - SVG 导出：transform="rotate(θ cx cy)" 属性（0/缺省不输出，旧文档逐字节不变）；
 * - culling / zoom-fit：AABB 语义（旋出局部框的部分不裁剪）；
 * - translateElement：旋转随元素平移保持；autosave 指纹含 rotation。
 */
import { describe, expect, it } from 'vitest';
import { RectangleElement, CircleElement, Viewport } from '../types';
import {
  elementLocalFrame,
  elementBoundsAABB,
  elementIntersectsView,
  getAllElementsBounds,
  hitTest,
  translateElement,
} from '../renderer';
import { normalizeRotation, elementRotation, rotatePointAround } from '../rotation';
import { exportToSvg } from '../export';
import { elementSignature } from '../autosave';

const VP: Viewport = { offsetX: 0, offsetY: 0, scale: 1 };

const rect = (rotation?: number): RectangleElement => ({
  id: 'r1', type: 'rectangle', x: 100, y: 100, width: 200, height: 100,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
  ...(rotation !== undefined ? { rotation } : {}),
});

describe('rotation 原语', () => {
  it('normalizeRotation：归一到 [0,360)', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(370)).toBeCloseTo(10);
    expect(normalizeRotation(-90)).toBeCloseTo(270);
    expect(normalizeRotation(720)).toBeCloseTo(0);
    expect(normalizeRotation(-360)).toBeCloseTo(0);
  });

  it('elementRotation：字段缺省 = 0（旧文档零迁移），读值归一', () => {
    expect(elementRotation({})).toBe(0);
    expect(elementRotation({ rotation: -90 })).toBeCloseTo(270);
    expect(elementRotation({ rotation: 45 })).toBeCloseTo(45);
  });

  it('rotatePointAround：屏幕系顺时针正角（y 向下，(1,0)→(0,1) @90°）；负角逆旋转', () => {
    const r1 = rotatePointAround({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(r1.x).toBeCloseTo(0);
    expect(r1.y).toBeCloseTo(1);
    const r2 = rotatePointAround({ x: 0, y: 1 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(r2.x).toBeCloseTo(-1);
    expect(r2.y).toBeCloseTo(0);
    const p = { x: 37, y: -11 };
    const cw = rotatePointAround(p, { x: 5, y: 5 }, Math.PI / 3);
    const back = rotatePointAround(cw, { x: 5, y: 5 }, -Math.PI / 3);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
});

describe('elementLocalFrame vs elementBoundsAABB（命名分叉）', () => {
  it('rotation 缺省 / 0：两套包围盒同体（旧文档零 diff）', () => {
    for (const el of [rect(), rect(0)]) {
      expect(elementBoundsAABB(el)).toEqual(elementLocalFrame(el));
      expect(elementLocalFrame(el)).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    }
  });

  it('旋转 45°：localFrame 恒为存储外框，AABB = 四角旋转后的世界系外扩', () => {
    const el = rect(45);
    expect(elementLocalFrame(el)).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    const aabb = elementBoundsAABB(el)!;
    // 半展：|w/2·cos45| + |h/2·sin45| = (100+50)·√2/2
    const half = 150 * Math.SQRT1_2;
    expect(aabb.x).toBeCloseTo(200 - half);
    expect(aabb.y).toBeCloseTo(150 - half);
    expect(aabb.width).toBeCloseTo(half * 2);
    expect(aabb.height).toBeCloseTo(half * 2);
    expect(aabb.width).toBeGreaterThan(200);
  });

  it('旋转 90°：AABB = 外框转置（200×100 → 100×200，中心不变）', () => {
    const aabb = elementBoundsAABB(rect(90))!;
    expect(aabb.x).toBeCloseTo(150);
    expect(aabb.y).toBeCloseTo(50);
    expect(aabb.width).toBeCloseTo(100);
    expect(aabb.height).toBeCloseTo(200);
  });

  it('AABB 覆盖全部旋转角点（只增不裁）；角度按 mod 360 归一读取', () => {
    for (const deg of [30, 45, 120, 200, 315, 405, -45]) {
      const el = rect(deg);
      const center = { x: 200, y: 150 };
      const rad = (elementRotation(el) * Math.PI) / 180;
      const aabb = elementBoundsAABB(el)!;
      for (const c of [
        { x: 100, y: 100 }, { x: 300, y: 100 },
        { x: 300, y: 200 }, { x: 100, y: 200 },
      ]) {
        const p = rotatePointAround(c, center, rad);
        expect(p.x, `deg=${deg}`).toBeGreaterThanOrEqual(aabb.x - 1e-9);
        expect(p.x, `deg=${deg}`).toBeLessThanOrEqual(aabb.x + aabb.width + 1e-9);
        expect(p.y, `deg=${deg}`).toBeGreaterThanOrEqual(aabb.y - 1e-9);
        expect(p.y, `deg=${deg}`).toBeLessThanOrEqual(aabb.y + aabb.height + 1e-9);
      }
    }
  });

  it('非旋转类型：两套同体（circle/diamond/mathPlot 沿外框语义）', () => {
    const circle: CircleElement = {
      id: 'c', type: 'circle', x: 0, y: 0, width: 10, height: 10,
      strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
    };
    expect(elementBoundsAABB(circle)).toEqual(elementLocalFrame(circle));
    expect(elementLocalFrame(circle)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
});

describe('hitTest（指针逆旋转 → 局部外框 + margin）', () => {
  it('旋转 45°：中心命中、旋转后的角尖命中、AABB 四角空白不命中、局部框内旋外空白不命中', () => {
    const el = rect(45);
    expect(hitTest(el, { x: 200, y: 150 }, VP)).toBe(true); // 几何中心
    // 局部角 (100,100) 旋转 45° 后的世界位置（角尖旋出局部框）
    const tip = rotatePointAround({ x: 100, y: 100 }, { x: 200, y: 150 }, Math.PI / 4);
    expect(hitTest(el, tip, VP)).toBe(true);
    // AABB 角落（≈(94,44)）：逆旋转后落在局部框外远端 → 空白
    expect(hitTest(el, { x: 95, y: 45 }, VP)).toBe(false);
    expect(hitTest(el, { x: 305, y: 255 }, VP)).toBe(false);
    // 局部框内、旋转后空出的腰角（如 (295,105)：局部系内但逆旋转后出框）
    expect(hitTest(el, { x: 295, y: 105 }, VP)).toBe(false);
  });

  it('旋转 90°：旋出局部框的上下端命中（逆旋转回局部框内）', () => {
    const el = rect(90);
    expect(hitTest(el, { x: 200, y: 60 }, VP)).toBe(true); // 局部框上方、旋转体内
    expect(hitTest(el, { x: 200, y: 240 }, VP)).toBe(true);
    expect(hitTest(el, { x: 110, y: 110 }, VP)).toBe(false); // 局部框左上角、旋外空白
  });

  it('rotation 缺省 / 0：与旧 AABB+margin 行为一致（框内框边均命中）', () => {
    for (const el of [rect(), rect(0)]) {
      expect(hitTest(el, { x: 150, y: 150 }, VP)).toBe(true);
      expect(hitTest(el, { x: 100, y: 100 }, VP)).toBe(true); // 角点（含 margin）
      expect(hitTest(el, { x: 95, y: 95 }, VP)).toBe(true); // margin 带内（margin=8）
      expect(hitTest(el, { x: 85, y: 85 }, VP)).toBe(false); // margin 带外
    }
  });

  it('非 1 缩放：margin 按世界系换算（8/scale），中心仍命中', () => {
    const vp2: Viewport = { offsetX: 0, offsetY: 0, scale: 2 };
    expect(hitTest(rect(45), { x: 200, y: 150 }, vp2)).toBe(true);
    expect(hitTest(rect(90), { x: 200, y: 60 }, vp2)).toBe(true); // 旋出局部框的端部
  });
});

describe('SVG 导出（transform rotate）', () => {
  it('rotation ≠ 0：输出 transform="rotate(θ cx cy)"（绕几何中心）', () => {
    const svg = exportToSvg([rect(45)]);
    expect(svg).toContain('<rect x="100" y="100" width="200" height="100"');
    expect(svg).toContain('transform="rotate(45 200 150)"');
  });

  it('rotation 归一后读取：405 与 45 输出同一 transform', () => {
    expect(exportToSvg([rect(405)])).toContain('transform="rotate(45 200 150)"');
  });

  it('rotation 缺省 / 0：不输出 transform，与旧输出逐字节一致', () => {
    for (const el of [rect(), rect(0)]) {
      const svg = exportToSvg([el]);
      expect(svg).not.toContain('transform');
      expect(svg).toContain(
        '<rect x="100" y="100" width="200" height="100" stroke="#000000" stroke-width="2" fill="none"/>'
      );
    }
  });
});

describe('culling / zoom-fit（AABB 语义）', () => {
  it('旋转 45°：仅与旋出局部框的 AABB 上沿相交的视口不剔除（局部框会误裁）', () => {
    const el = rect(45);
    // 视口屏幕区 y∈[44,60]：AABB 顶 ≈43.93 相交；局部框顶 = 100 不相交
    const vp: Viewport = { offsetX: 0, offsetY: -40, scale: 1 };
    expect(elementIntersectsView(el, vp, 400, 20)).toBe(true);
    expect(elementIntersectsView(rect(), vp, 400, 20)).toBe(false); // 未旋转同视口被裁（对照）
  });

  it('zoom-fit 包围盒（getAllElementsBounds）取 AABB：旋转元素不被导出边界裁剪', () => {
    const b = getAllElementsBounds([rect(45)])!;
    const half = 150 * Math.SQRT1_2;
    expect(b.width).toBeCloseTo(half * 2);
    expect(b.height).toBeCloseTo(half * 2);
  });
});

describe('平移 / 指纹', () => {
  it('translateElement：旋转角与 AABB 随元素整体平移保持', () => {
    const el = rect(45);
    const moved = translateElement(el, 50, 30) as RectangleElement;
    expect(moved.rotation).toBe(45);
    expect(elementRotation(moved)).toBe(45);
    const aabb = elementBoundsAABB(moved)!;
    expect(aabb.x + aabb.width / 2).toBeCloseTo(250);
    expect(aabb.y + aabb.height / 2).toBeCloseTo(180);
  });

  it('autosave 指纹含 rotation：改角度触发脏检测；缺省与现状同段', () => {
    expect(elementSignature(rect(45))).toContain('|r:45');
    expect(elementSignature(rect())).toContain('|r:0');
    expect(elementSignature(rect(45))).not.toBe(elementSignature(rect(60)));
  });
});
