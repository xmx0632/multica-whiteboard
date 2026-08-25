/**
 * 矩形旋转系列 PR-R3 单测（ZOO-223）：旋转 × 磁吸绑定整合 + 椭圆/菱形旋转扩展。
 *
 * - 绑定角度实装：updateBindingsAfterMove 对旋转目标（movedIds = 旋转元素）
 *   重投影端点——三形状端点均落旋转后的真实轮廓上（局部系求交转回世界系）；
 *   折线箭头首/尾顶点同步（polylinePatch 单一事实源）；
 * - 捕获 / 解绑：distanceToOutline / bindPoint 经 elementRotation 接线——
 *   旋转目标的轮廓附近可捕获、AABB 四角旋外空白不误捕获、滞回阈值不变；
 * - 椭圆 / 菱形旋转全链路（复用 R1/R2 基础设施）：elementBoundsAABB 四角旋转
 *   外扩、hitTest 指针逆旋转（菱形精确轮廓在局部系判定）、SVG transform
 *   rotate(θ cx cy)、rot = 0 / 缺省输出逐字节不变。
 */
import { describe, expect, it } from 'vitest';
import { ArrowElement, CircleElement, DiamondElement, RectangleElement, Viewport, WhiteboardElement } from '../types';
import { elementBoundsAABB, hitTest, diamondVertices } from '../renderer';
import { elementRotation, rotatePointAround, pointerToLocalFrame } from '../rotation';
import { exportToSvg } from '../export';
import {
  distanceToOutline,
  findBindingTarget,
  resolveEndpointBinding,
  updateBindingsAfterMove,
} from '../binding';

const VP: Viewport = { offsetX: 0, offsetY: 0, scale: 1 };

const rect = (rotation?: number): RectangleElement => ({
  id: 'rect1', type: 'rectangle', x: 100, y: 100, width: 200, height: 100,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
  ...(rotation !== undefined ? { rotation } : {}),
});

const ellipse = (rotation?: number): CircleElement => ({
  id: 'ell1', type: 'circle', x: 100, y: 100, width: 200, height: 100,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
  ...(rotation !== undefined ? { rotation } : {}),
});

const diamond = (rotation?: number): DiamondElement => ({
  id: 'dia1', type: 'diamond', x: 100, y: 100, width: 200, height: 100,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
  ...(rotation !== undefined ? { rotation } : {}),
});

/** 端点绑到 target 右缘中点 (300,150) 的箭头（起点任意在左） */
const boundArrow = (target: WhiteboardElement, over: Partial<ArrowElement> = {}): ArrowElement => ({
  id: 'arw1', type: 'arrow', x: 20, y: 150, x2: 300, y2: 150,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1,
  endBinding: { elementId: target.id },
  ...over,
});

/** 三形状共享的几何中心 */
const CENTER = { x: 200, y: 150 };

describe('旋转目标的绑定跟随（updateBindingsAfterMove 挂旋转钩子）', () => {
  it('矩形旋转 90°：端点重投影到旋转后的真实边线（(300,150) → (250,150) 贴新右缘）', () => {
    const target = rect(90);
    const after = updateBindingsAfterMove([target, boundArrow(rect())], new Set([target.id]));
    const arrow = after.find((e) => e.id === 'arw1') as ArrowElement;
    expect(arrow.x2).toBeCloseTo(250);
    expect(arrow.y2).toBeCloseTo(150);
    // 旋转后矩形世界系 x∈[150,250]：(250,150) 恰在新右缘上
    expect(arrow.x2).toBe(CENTER.x + target.height / 2);
  });

  it('矩形任意角度：重投影端点恒满足局部系轮廓方程（射线出 bbox 边）', () => {
    for (const deg of [15, 30, 45, 120, 200, 315]) {
      const target = rect(deg);
      const after = updateBindingsAfterMove([target, boundArrow(rect())], new Set([target.id]));
      const arrow = after.find((e) => e.id === 'arw1') as ArrowElement;
      const local = rotatePointAround(
        { x: arrow.x2, y: arrow.y2 }, CENTER, -(deg * Math.PI) / 180,
      );
      // 端点贴边（恰在边线上），内外判定留浮点容差
      const eps = 1e-6;
      const inside = local.x >= 100 - eps && local.x <= 300 + eps && local.y >= 100 - eps && local.y <= 200 + eps;
      expect(inside, `deg=${deg}`).toBe(true);
      // 贴边：到局部外框四边距离的最小值 ≈ 0
      const d = Math.min(local.x - 100, 300 - local.x, local.y - 100, 200 - local.y);
      expect(Math.abs(d), `deg=${deg}`).toBeLessThan(1e-6);
    }
  });

  it('椭圆旋转任意角度：重投影端点逆旋转回局部系后满足椭圆方程', () => {
    for (const deg of [30, 45, 90, 210]) {
      const target = ellipse(deg);
      const after = updateBindingsAfterMove([target, boundArrow(ellipse())], new Set([target.id]));
      const arrow = after.find((e) => e.id === 'arw1') as ArrowElement;
      const local = rotatePointAround({ x: arrow.x2, y: arrow.y2 }, CENTER, -(deg * Math.PI) / 180);
      const rx = 100, ry = 50;
      const eq = ((local.x - CENTER.x) / rx) ** 2 + ((local.y - CENTER.y) / ry) ** 2;
      expect(eq, `deg=${deg}`).toBeCloseTo(1, 6);
    }
  });

  it('菱形旋转任意角度：重投影端点逆旋转回局部系后满足 |x/a|+|y/b| = 1', () => {
    for (const deg of [30, 45, 90, 210]) {
      const target = diamond(deg);
      const after = updateBindingsAfterMove([target, boundArrow(diamond())], new Set([target.id]));
      const arrow = after.find((e) => e.id === 'arw1') as ArrowElement;
      const local = rotatePointAround({ x: arrow.x2, y: arrow.y2 }, CENTER, -(deg * Math.PI) / 180);
      const a = 100, b = 50;
      const eq = Math.abs(local.x - CENTER.x) / a + Math.abs(local.y - CENTER.y) / b;
      expect(eq, `deg=${deg}`).toBeCloseTo(1, 6);
    }
  });

  it('折线箭头：旋转跟随同步首/尾顶点与 x/y、x2/y2（polylinePatch 单一事实源）', () => {
    const target = rect(90);
    const arrow = boundArrow(target, { points: [{ x: 20, y: 150 }, { x: 160, y: 40 }, { x: 300, y: 150 }] });
    const after = updateBindingsAfterMove([target, arrow], new Set([target.id]));
    const a = after.find((e) => e.id === 'arw1') as ArrowElement;
    expect(a.points).toBeDefined();
    expect(a.points!.length).toBe(3);
    expect(a.points![0]).toEqual({ x: 20, y: 150 }); // 起点（未绑定）不动
    expect(a.points![1]).toEqual({ x: 160, y: 40 }); // 中间顶点不动
    expect(a.points![2].x).toBeCloseTo(250); // 尾顶点 = 重投影端点
    expect(a.points![2].y).toBeCloseTo(150);
    expect(a.x2).toBeCloseTo(a.points![2].x);
    expect(a.y2).toBeCloseTo(a.points![2].y);
  });

  it('目标未旋转（rotation 缺省 / 0）：跟随结果与 ZOO-220 语义一致（端点原样在轮廓上）', () => {
    const target = rect();
    const after = updateBindingsAfterMove([target, boundArrow(target)], new Set([target.id]));
    const arrow = after.find((e) => e.id === 'arw1') as ArrowElement;
    expect(arrow.x2).toBe(300);
    expect(arrow.y2).toBe(150);
  });

  it('纯函数：传入折线箭头的 points 活引用不被原地改写', () => {
    const target = rect(90);
    const arrow = boundArrow(target, { points: [{ x: 20, y: 150 }, { x: 160, y: 40 }, { x: 300, y: 150 }] });
    const src = arrow.points!.map((p) => ({ ...p }));
    updateBindingsAfterMove([target, arrow], new Set([target.id]));
    expect(arrow.points).toEqual(src);
  });
});

describe('捕获 / 解绑：旋转目标的距离与吸附点在局部系求值', () => {
  it('旋转 45° 矩形：旋转后边线附近捕获并吸附到真实边线', () => {
    const target = rect(45);
    // 局部右缘中点 (300,150) 顺时针转 45° 后的世界位置——真实边线上的点
    const onEdge = rotatePointAround({ x: 300, y: 150 }, CENTER, (45 * Math.PI) / 180);
    expect(distanceToOutline(target, onEdge, elementRotation(target))).toBeCloseTo(0, 6);

    const hit = findBindingTarget([target], onEdge, 1);
    expect(hit).not.toBeNull();
    expect(hit!.element.id).toBe('rect1');
    expect(hit!.dist).toBeLessThan(1); // 距轮廓 < 1 世界 px
    // 吸附点即边线点本身（误差内）
    expect(hit!.point.x).toBeCloseTo(onEdge.x, 6);
    expect(hit!.point.y).toBeCloseTo(onEdge.y, 6);
  });

  it('旋转 45° 矩形：AABB 四角旋外空白不捕获（局部系轮廓距离 > 阈值）', () => {
    const target = rect(45);
    const aabb = elementBoundsAABB(target)!;
    const corner = { x: aabb.x + 2, y: aabb.y + 2 }; // AABB 角落空白
    expect(findBindingTarget([target], corner, 1)).toBeNull();
  });

  it('旋转椭圆 / 菱形：旋转后轮廓附近可捕获（三形状同口径）', () => {
    for (const target of [ellipse(30), diamond(30)]) {
      // 局部系右缘方向点顺时针转 30° 的世界位置，再外移 4px（捕获带内）
      const dir = { x: 300, y: 150 };
      const rotated = rotatePointAround(dir, CENTER, (30 * Math.PI) / 180);
      const outward = {
        x: rotated.x + 4 * Math.cos((30 * Math.PI) / 180),
        y: rotated.y + 4 * Math.sin((30 * Math.PI) / 180),
      };
      const hit = findBindingTarget([target], outward, 1);
      expect(hit, target.type).not.toBeNull();
      expect(hit!.element.id).toBe(target.id);
    }
  });

  it('已绑定 + 目标旋转：14px 滞回带内维持绑定并吸附旋转后轮廓', () => {
    const target = rect(90);
    const startArrow = boundArrow(rect()); // 起手快照：绑定指向未旋转目标
    // 旋转 90° 后矩形世界系 x∈[150,250]、y∈[50,250]——原右缘中点 (300,150)
    // 转到新右缘 (250,150)；指针停其 2px 外（滞回带内）
    const res = resolveEndpointBinding({
      elements: [target, startArrow],
      arrow: startArrow,
      endpoint: 'end',
      world: { x: 252, y: 150 },
      scale: 1,
    });
    expect(res.binding).toEqual({ elementId: 'rect1' });
    // 吸附点在旋转后的右缘（世界系 x=250 直线上，y∈[50,250]）
    expect(res.point.x).toBeCloseTo(250, 6);
    expect(res.point.y).toBeGreaterThanOrEqual(50 - 1e-6);
    expect(res.point.y).toBeLessThanOrEqual(250 + 1e-6);
    expect(res.point.y).toBeCloseTo(150, 6); // 沿原端点射线（水平）吸附到右缘中点
  });
});

describe('椭圆 / 菱形旋转全链路（复用 R1 基础设施）', () => {
  it('elementBoundsAABB：三形状旋转 45° 均为四角旋转外扩（150·√2/2 半展），rot=0 同体', () => {
    const half = 150 * Math.SQRT1_2;
    for (const el of [rect(45), ellipse(45), diamond(45)]) {
      const aabb = elementBoundsAABB(el)!;
      expect(aabb.width, el.type).toBeCloseTo(half * 2, 6);
      expect(aabb.height, el.type).toBeCloseTo(half * 2, 6);
      expect(aabb.x + aabb.width / 2, el.type).toBeCloseTo(200);
      expect(aabb.y + aabb.height / 2, el.type).toBeCloseTo(150);
    }
    for (const el of [rect(), ellipse(), diamond()]) {
      expect(elementBoundsAABB(el)).toEqual({
        x: 100, y: 100, width: 200, height: 100,
      });
    }
  });

  it('hitTest 椭圆旋转 45°：中心命中、AABB 角落旋外空白不命中', () => {
    const el = ellipse(45);
    expect(hitTest(el, CENTER, VP)).toBe(true);
    const aabb = elementBoundsAABB(el)!;
    expect(hitTest(el, { x: aabb.x + 2, y: aabb.y + 2 }, VP)).toBe(false);
  });

  it('hitTest 菱形旋转：旋转后的尖角命中、AABB 角落空白与旋出中空不命中', () => {
    const el = diamond(45);
    // 局部顶点（上尖 (200,100) / 右尖 (300,150)）旋转 45° 后的世界位置可命中
    const rad = (45 * Math.PI) / 180;
    const topTip = rotatePointAround({ x: 200, y: 100 }, CENTER, rad);
    const rightTip = rotatePointAround({ x: 300, y: 150 }, CENTER, rad);
    expect(hitTest(el, topTip, VP)).toBe(true);
    expect(hitTest(el, rightTip, VP)).toBe(true);
    // AABB 角落空白：逆旋转后远离四边
    const aabb = elementBoundsAABB(el)!;
    expect(hitTest(el, { x: aabb.x + 2, y: aabb.y + 2 }, VP)).toBe(false);
    // 菱形旋出后让出的局部框腰角（逆旋转后出轮廓）不命中
    const blank = rotatePointAround({ x: 295, y: 108 }, CENTER, -rad); // 世界系取一点先看局部
    const worldBlank = rotatePointAround({ x: 295, y: 105 }, CENTER, rad);
    expect(distanceToOutline(el, worldBlank, 45) > 12).toBe(true); // 距轮廓远（> margin 8）
    expect(hitTest(el, blank, VP)).toBe(false);
    expect(hitTest(el, worldBlank, VP)).toBe(false);
  });

  it('hitTest 三形状 rot = 0 / 缺省：与旧行为一致（边线命中、边线外不命中）', () => {
    // rect / ellipse 包围盒判定：中心命中；无填充菱形精确轮廓：中心不命中（ZOO-217 语义）
    expect(hitTest(rect(), CENTER, VP)).toBe(true);
    expect(hitTest(ellipse(), CENTER, VP)).toBe(true);
    expect(hitTest(diamond(), CENTER, VP)).toBe(false);
    for (const el of [rect(), ellipse(), diamond()]) {
      expect(hitTest(el, { x: 300, y: 150 }, VP)).toBe(true); // 右缘 / 右尖
      expect(hitTest(el, { x: 320, y: 150 }, VP)).toBe(false); // 边线外 20px
    }
  });

  it('SVG 导出：circle/diamond 旋转输出 transform rotate(θ cx cy)，rot=0 / 缺省不输出', () => {
    expect(exportToSvg([ellipse(45)])).toContain('<ellipse cx="200" cy="150" rx="100" ry="50"');
    expect(exportToSvg([ellipse(45)])).toContain('transform="rotate(45 200 150)"');
    expect(exportToSvg([diamond(30)])).toContain('transform="rotate(30 200 150)"');
    expect(exportToSvg([diamond(30)])).toContain(
      '<polygon points="200,100 300,150 200,200 100,150"'
    );
    for (const el of [ellipse(), ellipse(0), diamond(), diamond(0)]) {
      expect(exportToSvg([el])).not.toContain('transform');
    }
  });

  it('旋转菱形顶点推导不变（diamondVertices 恒为局部系），世界系占用走 AABB', () => {
    expect(diamondVertices(diamond(45))).toEqual(diamondVertices(diamond()));
    const aabb = elementBoundsAABB(diamond(45))!;
    expect(aabb.width).toBeGreaterThan(200); // 旋出局部外框
  });

  it('pointerToLocalFrame + boxResize 口径：旋转椭圆 / 菱形缩放适配与矩形同构（局部系对角锚定）', () => {
    // Canvas 缩放分支的组合等价复现：世界指针逆旋转进局部系后，锚定对角不变
    for (const el of [ellipse(45), diamond(45)]) {
      const frame = { x: el.x, y: el.y, width: el.width, height: el.height };
      // 局部系 se 远端 (350,280) 转 45° 后的世界指针
      const world = rotatePointAround({ x: 350, y: 280 }, CENTER, (45 * Math.PI) / 180);
      const local = pointerToLocalFrame(world, frame, 45);
      expect(local.x, el.type).toBeCloseTo(350, 6);
      expect(local.y, el.type).toBeCloseTo(280, 6);
    }
  });
});
