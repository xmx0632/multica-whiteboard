/**
 * 箭头磁吸绑定单测（ZOO-218，绑定系列 PR2）：
 * - bindPoint 三形状精确轮廓：rectangle bbox 边交、ellipse 射线闭式解、
 *   diamond L1 闭式解——菱形对角（尖角间）方向与圆 45° 方向不悬空
 *   （bbox 近似分别悬空 ~70px / ~41px，ZOO-208 §2.1 量化）；
 * - 极端纵横比（扁平 / 窄高）下吸附点仍在真实轮廓上；
 * - distanceToOutline：三类形状内外点距离口径（rect / diamond 精确，ellipse 径向近似）；
 * - 捕获 / 解绑阈值：屏幕 px → 世界 px 按 scale 换算（同 hitTest 的 8/scale 口径），
 *   10px 捕获 / 14px 解绑滞回不抖动；深入另一元素改绑、10–14px 过渡带维持原绑定；
 * - 角度参数（PR-R3 预留）：外部点逆旋转进局部系求值、交点正旋转回世界系；
 * - endpointHandleSide / arrowBindingEquals：端点语义手柄与绑定引用判等。
 */
import { describe, expect, it } from 'vitest';
import { ArrowElement, CircleElement, DiamondElement, RectangleElement, WhiteboardElement } from '../types';
import {
  BIND_CAPTURE_PX,
  BIND_RELEASE_PX,
  bindPoint,
  distanceToOutline,
  findBindingTarget,
  resolveEndpointBinding,
  endpointHandleSide,
  arrowBindingEquals,
  isBindableElement,
  updateBindingsAfterMove,
  clearBindingsOfDeletedElements,
} from '../binding';

const rect = (): RectangleElement => ({
  id: 'r1', type: 'rectangle', x: 100, y: 100, width: 200, height: 100,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

const circle = (): CircleElement => ({
  id: 'c1', type: 'circle', x: 100, y: 100, width: 200, height: 200,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

const diamond = (): DiamondElement => ({
  id: 'd1', type: 'diamond', x: 100, y: 100, width: 200, height: 200,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

const arrow = (over: Partial<ArrowElement> = {}): ArrowElement => ({
  id: 'a1', type: 'arrow', x: 0, y: 0, x2: 50, y2: 50,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, ...over,
});

const almost = (actual: number, expected: number, eps = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThan(eps);

describe('bindPoint（三形状精确轮廓吸附）', () => {
  it('rectangle：中心射线出 bbox 边——轴向贴边中点、对角先碰较近的边', () => {
    // 右轴向：终点吸附右边缘中点
    const p = bindPoint(rect(), { x: 500, y: 150 });
    expect(p).toEqual({ x: 300, y: 150 });
    // 对角方向（宽 200 < 高…不，宽 200 / 高 100：dx=2, dy=1 同比 → 先出右边缘）
    const q = bindPoint(rect(), { x: 300, y: 200 }); // 方向 (200,100) → t 由 x 主导
    expect(q.x).toBe(300);
    almost(q.y, 150 + 100 * (100 / 200)); // 200
  });

  it('rectangle：端点在元素内部时沿同向射线穿出到轮廓', () => {
    const p = bindPoint(rect(), { x: 150, y: 120 }); // 中心 (200,150)，方向 (-50,-30)
    almost(p.y, 100, 1e-9); // ty = 50/30 < tx = 100/50 → 先出上边缘
    almost(p.x, 200 - 50 * (50 / 30), 1e-9); // = 350/3
  });

  it('circle：45° 方向落在真实圆周上（bbox 近似悬空 (√2−1)·r ≈ 41px 消除）', () => {
    // 中心 (200,200)，r=100；对角方向圆周点 = (200+100/√2, 200+100/√2)
    const p = bindPoint(circle(), { x: 400, y: 400 });
    almost(p.x, 200 + 100 / Math.SQRT2, 1e-9);
    almost(p.y, 200 + 100 / Math.SQRT2, 1e-9);
    // 距中心恰为 r（在圆周上），而 bbox 角距中心为 r√2 ≈ 141.4
    const dc = Math.hypot(p.x - 200, p.y - 200);
    almost(dc, 100, 1e-9);
  });

  it('circle：轴向与任意方向均满足椭圆方程（闭式解逐方向成立）', () => {
    const el: CircleElement = { ...circle(), width: 300, height: 160 }; // rx=150, ry=80
    for (const [dx, dy] of [[1, 0], [0, -1], [3, 1], [-2, 5], [1, -1]] as const) {
      const p = bindPoint(el, { x: 250 + dx * 500, y: 180 + dy * 500 });
      almost(((p.x - 250) / 150) ** 2 + ((p.y - 180) / 80) ** 2, 1, 1e-9);
    }
  });

  it('diamond：对角（尖角间）方向吸附轮廓点，距中心 a·b/√(a²+b²)，不悬空到 bbox 角（ZOO-208 §2.1）', () => {
    // a=b=100：对角方向轮廓点 (250,250)，距中心 100/√2 ≈ 70.7（bbox 角距中心 141.4
    // → bbox 近似路线在对角方向悬空 ~70px）
    const p = bindPoint(diamond(), { x: 400, y: 400 });
    almost(p.x, 250, 1e-9);
    almost(p.y, 250, 1e-9);
    almost(Math.hypot(p.x - 200, p.y - 200), 100 / Math.SQRT2, 1e-9);
    almost(Math.abs(p.x - 200) / 100 + Math.abs(p.y - 200) / 100, 1, 1e-9); // L1 轮廓方程
  });

  it('diamond：轴向吸附四边中点（顶点方向）', () => {
    expect(bindPoint(diamond(), { x: 500, y: 200 })).toEqual({ x: 300, y: 200 });
    expect(bindPoint(diamond(), { x: 200, y: -100 })).toEqual({ x: 200, y: 100 });
    expect(bindPoint(diamond(), { x: -50, y: 200 })).toEqual({ x: 100, y: 200 });
    expect(bindPoint(diamond(), { x: 200, y: 500 })).toEqual({ x: 200, y: 300 });
  });

  it('极端纵横比：扁平菱形（200×8）斜向吸附仍在窄轮廓上', () => {
    const el: DiamondElement = { ...diamond(), width: 200, height: 8 };
    const p = bindPoint(el, { x: 300, y: 150 }); // 中心 (200,104)，方向 (100,46)
    almost(Math.abs(p.x - 200) / 100 + Math.abs(p.y - 104) / 4, 1, 1e-9);
    expect(Math.abs(p.y - 104)).toBeLessThanOrEqual(4); // 半高仅 4：绝无 bbox 角悬空
  });

  it('极端纵横比：窄高矩形（10×300）斜向吸附出侧边', () => {
    const el = { ...rect(), width: 10, height: 300 };
    const p = bindPoint(el, { x: 400, y: 400 }); // 中心 (105,250)，方向宽主导
    expect(p.x).toBeGreaterThanOrEqual(100);
    expect(p.x).toBeLessThanOrEqual(110);
    expect(p.y).toBeGreaterThanOrEqual(100);
    expect(p.y).toBeLessThanOrEqual(400);
    expect(p.x === 100 || p.x === 110).toBe(true); // 恰在左或右边缘
  });
});

describe('distanceToOutline（捕获 / 解绑距离口径）', () => {
  it('rectangle：外部点 = 到边线欧氏距离（含角部）；内部点 = 到最近边', () => {
    expect(distanceToOutline(rect(), { x: 330, y: 150 })).toBe(30); // 右侧外 30px
    expect(distanceToOutline(rect(), { x: 350, y: 250 })).toBeCloseTo(Math.hypot(50, 50), 9); // 角外
    expect(distanceToOutline(rect(), { x: 200, y: 150 })).toBe(50); // 中心到上下边（高 100 一半）
    expect(distanceToOutline(rect(), { x: 110, y: 105 })).toBe(5); // 内部近上边
  });

  it('diamond：到四边折线最近距离（精确）——尖角外空白距轮廓 > 0', () => {
    // bbox 角 (105,105) 在菱形外：沿对角射线到轮廓 (155,155) 的距离 = 45√2 ≈ 63.6
    expect(distanceToOutline(diamond(), { x: 105, y: 105 })).toBeCloseTo(45 * Math.SQRT2, 6);
    // 边上点距离 0
    expect(distanceToOutline(diamond(), { x: 250, y: 150 })).toBeCloseTo(0, 9);
    // 中心（内部）到最近边 = 100/√2
    expect(distanceToOutline(diamond(), { x: 200, y: 200 })).toBeCloseTo(100 / Math.SQRT2, 6);
  });

  it('ellipse：径向近似——圆周上 0、径向外 d、圆心处 = r（近似口径）', () => {
    expect(distanceToOutline(circle(), { x: 300, y: 200 })).toBeCloseTo(0, 9); // 圆周上
    expect(distanceToOutline(circle(), { x: 320, y: 200 })).toBeCloseTo(20, 9); // 径向外 20
    expect(distanceToOutline(circle(), { x: 200, y: 200 })).toBeCloseTo(100, 9); // 圆心 → 半径
  });
});

describe('findBindingTarget（捕获阈值 + scale 换算）', () => {
  const elements: WhiteboardElement[] = [rect(), circle(), diamond(), arrow()];

  it('≤10 屏幕px 捕获最近目标；path/line/arrow/text 非绑定目标', () => {
    // (330,150) 距 rect 轮廓 30（scale 1 超阈值）；scale 3 → 世界阈值 10/3 ≈ 3.3 仍超
    expect(findBindingTarget(elements, { x: 330, y: 150 }, 1)).toBeNull();
    // (315,150)：距 rect 15 —— scale 1 无捕获（>10）
    expect(findBindingTarget(elements, { x: 315, y: 150 }, 1)).toBeNull();
    // scale 0.5：世界阈值 10/0.5 = 20 → 捕获
    const hit = findBindingTarget(elements, { x: 315, y: 150 }, 0.5);
    expect(hit?.element.id).toBe('r1');
    expect(hit?.point).toEqual({ x: 300, y: 150 });
    expect(hit?.dist).toBeCloseTo(15, 9);
  });

  it('缩小视口阈值放大、放大视口阈值收紧（同 hitTest 的 /scale 口径）', () => {
    const p = { x: 312, y: 150 }; // 距 rect 轮廓 12
    expect(findBindingTarget(elements, p, 0.5)?.element.id).toBe('r1'); // 阈值 20
    expect(findBindingTarget(elements, p, 1)).toBeNull(); // 阈值 10
    expect(findBindingTarget(elements, p, 2)).toBeNull(); // 阈值 5
    const q = { x: 305, y: 150 }; // 距 5
    expect(findBindingTarget(elements, q, 2)?.element.id).toBe('r1'); // 阈值 5 ≤ 捕获
    expect(findBindingTarget(elements, q, 4)).toBeNull(); // 阈值 2.5
  });

  it('多目标取轮廓距离最近者；excludeIds 剔除目标', () => {
    // 相离布局：ra 右边缘 x=100，cb 圆心 (300,50) r=50——(245,50) 距 cb 圆周 5、距 ra 145
    const spread: WhiteboardElement[] = [
      { ...rect(), id: 'ra', x: 0, y: 0, width: 100, height: 100 },
      { ...circle(), id: 'cb', x: 250, y: 0, width: 100, height: 100 },
    ];
    const hit = findBindingTarget(spread, { x: 245, y: 50 }, 1);
    expect(hit?.element.id).toBe('cb');
    expect(hit?.dist).toBeCloseTo(5, 9);
    expect(findBindingTarget(spread, { x: 245, y: 50 }, 1, { excludeIds: ['cb'] })).toBeNull(); // 145 ≫ 10
  });

  it('isBindableElement：仅 rectangle / circle / diamond', () => {
    for (const el of elements) {
      expect(isBindableElement(el)).toBe(el.type === 'rectangle' || el.type === 'circle' || el.type === 'diamond');
    }
  });
});

describe('resolveEndpointBinding（10px 捕获 / 14px 解绑滞回）', () => {
  const elements = (): WhiteboardElement[] => [rect(), diamond()];

  it('未绑定：轮廓 10px 内捕获并吸附，10–14px 过渡带不捕获', () => {
    const r = resolveEndpointBinding({ elements: elements(), arrow: arrow(), endpoint: 'end', world: { x: 308, y: 150 }, scale: 1 });
    expect(r.binding).toEqual({ elementId: 'r1' });
    expect(r.point).toEqual({ x: 300, y: 150 }); // 吸附到轮廓

    const far = resolveEndpointBinding({ elements: elements(), arrow: arrow(), endpoint: 'end', world: { x: 312, y: 150 }, scale: 1 });
    expect(far.binding).toBeNull();
    expect(far.point).toEqual({ x: 312, y: 150 }); // 未捕获原样返回
  });

  it('已绑定：14px 内维持（10–14px 过渡带不抖动），超出解绑', () => {
    const bound = arrow({ endBinding: { elementId: 'r1' } });
    // 12px：介于 10 与 14 之间——已绑定维持、未绑定不捕获（滞回）
    const hold = resolveEndpointBinding({ elements: elements(), arrow: bound, endpoint: 'end', world: { x: 312, y: 150 }, scale: 1 });
    expect(hold.binding).toEqual({ elementId: 'r1' });
    expect(hold.point).toEqual({ x: 300, y: 150 });
    // 15px：超出解绑阈值 → 解绑、端点不吸附
    const drop = resolveEndpointBinding({ elements: elements(), arrow: bound, endpoint: 'end', world: { x: 315, y: 150 }, scale: 1 });
    expect(drop.binding).toBeNull();
    expect(drop.point).toEqual({ x: 315, y: 150 });
  });

  it('深入另一元素捕获带内即时改绑（近者胜），原绑定超 14px 不维持', () => {
    // 起手绑 rect（右边缘 x=300）；小菱形 (400,100,100,100) 右顶点 (500,150)——
    // 指针 (508,150) 距菱形轮廓 8px（≤10 捕获）、距 rect 208px（>14 不维持）→ 改绑
    const spread = (): WhiteboardElement[] => [rect(), { ...diamond(), x: 400, y: 100, width: 100, height: 100 }];
    const bound = arrow({ endBinding: { elementId: 'r1' } });
    const r = resolveEndpointBinding({ elements: spread(), arrow: bound, endpoint: 'end', world: { x: 508, y: 150 }, scale: 1 });
    expect(r.binding).toEqual({ elementId: 'd1' });
    expect(r.point).toEqual({ x: 500, y: 150 }); // 吸附到右顶点（轴向轮廓点）
  });

  it('绑定目标被删除：维持项失效，按捕获规则重新解析', () => {
    const bound = arrow({ startBinding: { elementId: 'gone' } });
    const r = resolveEndpointBinding({ elements: elements(), arrow: bound, endpoint: 'start', world: { x: 295, y: 150 }, scale: 1 });
    expect(r.binding).toEqual({ elementId: 'r1' }); // 5px 内捕获现存元素
  });

  it('箭头自身不作为绑定目标（excludeIds）；scale 换算下滞回带同步缩放', () => {
    const selfOnly: WhiteboardElement[] = [arrow()];
    expect(resolveEndpointBinding({ elements: selfOnly, arrow: arrow(), endpoint: 'end', world: { x: 50, y: 50 }, scale: 1 }).binding).toBeNull();
    // scale 0.5：世界阈值 ×2 —— 12 世界px 处已绑定目标仍维持
    const bound = arrow({ endBinding: { elementId: 'r1' } });
    const hold = resolveEndpointBinding({ elements: elements(), arrow: bound, endpoint: 'end', world: { x: 324, y: 150 }, scale: 0.5 });
    expect(hold.binding).toEqual({ elementId: 'r1' }); // 24 世界px ≤ 14/0.5 = 28
    const drop = resolveEndpointBinding({ elements: elements(), arrow: bound, endpoint: 'end', world: { x: 330, y: 150 }, scale: 0.5 });
    expect(drop.binding).toBeNull(); // 30 世界px > 28
  });

  it('阈值常量：10 捕获 / 14 解绑（ZOO-153 语义）', () => {
    expect(BIND_CAPTURE_PX).toBe(10);
    expect(BIND_RELEASE_PX).toBe(14);
  });
});

describe('bindPoint / distanceToOutline 角度参数（PR-R3 预留）', () => {
  it('angle=0 与缺省一致；矩形旋转 90° 后吸附点随轮廓旋转（PR-R1 顺时针语义）', () => {
    const el = rect(); // 中心 (200,150)，宽 200 高 100
    expect(bindPoint(el, { x: 500, y: 150 }, 0)).toEqual(bindPoint(el, { x: 500, y: 150 }));
    // 顺时针 90°：局部上边朝向世界右侧。外部点 (500,150)（右侧轴向）→ 局部上方
    // → 吸附局部上边中点 (200,100) → 世界 (250,150)（右侧面中点）
    const p = bindPoint(el, { x: 500, y: 150 }, 90);
    almost(p.x, 250, 1e-9);
    almost(p.y, 150, 1e-9);
    // 非对称验证：外部点 (400,300)（右下方向）逆旋转进局部 (350,-50)（局部系右上）→
    // 局部上边交点 (237.5,100) → 正旋转回世界 (250,187.5)（右侧面下段）
    const q = bindPoint(el, { x: 400, y: 300 }, 90);
    almost(q.x, 250, 1e-9);
    almost(q.y, 187.5, 1e-9);
  });

  it('旋转下距离与未旋转局部系一致（等距变换）', () => {
    const el = circle(); // 圆旋转不变，距离应与 angle=0 相同
    const p = { x: 320, y: 200 };
    almost(distanceToOutline(el, p, 137), distanceToOutline(el, p, 0), 1e-9);
  });
});

describe('endpointHandleSide / arrowBindingEquals', () => {
  it('p1/p2 与折线首尾顶点为端点语义；中间顶点 null', () => {
    const two = arrow();
    expect(endpointHandleSide('p1', two)).toBe('start');
    expect(endpointHandleSide('p2', two)).toBe('end');
    const poly = arrow({ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }] });
    expect(endpointHandleSide('v0', poly)).toBe('start');
    expect(endpointHandleSide('v3', poly)).toBe('end');
    expect(endpointHandleSide('v1', poly)).toBeNull();
    expect(endpointHandleSide('v2', poly)).toBeNull();
    expect(endpointHandleSide('nw', two)).toBeNull();
  });

  it('绑定判等：同元素 id 相等；undefined / null / 异 id 不等', () => {
    expect(arrowBindingEquals({ elementId: 'r1' }, { elementId: 'r1' })).toBe(true);
    expect(arrowBindingEquals(undefined, undefined)).toBe(true);
    expect(arrowBindingEquals(null, undefined)).toBe(true);
    expect(arrowBindingEquals({ elementId: 'r1' }, undefined)).toBe(false);
    expect(arrowBindingEquals({ elementId: 'r1' }, { elementId: 'd1' })).toBe(false);
  });
});

describe('updateBindingsAfterMove（组拖 / 帧拖 / 单拖的绑定跟随，ZOO-220）', () => {
  it('目标移动后端点重投影到新轮廓：矩形下移后终点贴新上边缘', () => {
    // 箭头终点吸附在 rect 右边缘中点 (300,150)；rect 下移 200 → (100,300,200,100)，
    // 中心 (200,350)，旧端点方向 (100,-200) → t=min(100/100, 50/200)=0.25 → (225,300)
    const moved = { ...rect(), y: 300 };
    const a = arrow({ x2: 300, y2: 150, endBinding: { elementId: 'r1' } });
    const out = updateBindingsAfterMove([moved, a], new Set(['r1']));
    const updated = out[1] as ArrowElement;
    expect(updated.x2).toBeCloseTo(225, 6);
    expect(updated.y2).toBeCloseTo(300, 6);
    // 起点未绑定不动
    expect(updated.x).toBe(0);
    expect(updated.y).toBe(0);
    // 绑定引用保持
    expect(updated.endBinding).toEqual({ elementId: 'r1' });
  });

  it('折线箭头：首尾顶点与 x/y、x2/y2 同步（polylinePatch 单一事实源）', () => {
    const moved = { ...rect(), y: 300 };
    const a = arrow({
      x2: 300, y2: 150,
      points: [{ x: 0, y: 0 }, { x: 150, y: 150 }, { x: 300, y: 150 }],
      endBinding: { elementId: 'r1' },
    });
    const out = updateBindingsAfterMove([moved, a], new Set(['r1']));
    const updated = out[1] as ArrowElement;
    const pts = updated.points!;
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: 0, y: 0 }); // 未绑定端不动
    expect(pts[2].x).toBeCloseTo(225, 6);
    expect(pts[2].y).toBeCloseTo(300, 6);
    // 不变量：x/y = 首顶点，x2/y2 = 尾顶点
    expect(updated.x).toBe(pts[0].x);
    expect(updated.y).toBe(pts[0].y);
    expect(updated.x2).toBeCloseTo(pts[2].x, 9);
    expect(updated.y2).toBeCloseTo(pts[2].y, 9);
  });

  it('纯函数：传入箭头的 points 活引用不被原地改写（快照 / undo 数据源安全）', () => {
    const moved = { ...rect(), y: 300 };
    const a = arrow({
      x2: 300, y2: 150,
      points: [{ x: 0, y: 0 }, { x: 150, y: 150 }, { x: 300, y: 150 }],
      endBinding: { elementId: 'r1' },
    });
    const before = a.points!.map((p) => ({ ...p }));
    updateBindingsAfterMove([moved, a], new Set(['r1']));
    expect(a.points).toEqual(before);
    expect(a.x2).toBe(300);
    expect(a.y2).toBe(150);
  });

  it('目标不在 movedIds（组外箭头不指向组内元素）与未绑定箭头：原样同引用返回', () => {
    const a1 = arrow({ endBinding: { elementId: 'r1' } });
    const a2 = arrow();
    const out = updateBindingsAfterMove([rect(), a1, a2], new Set(['d1']));
    expect(out[1]).toBe(a1); // 绑定目标未移动
    expect(out[2]).toBe(a2); // 无绑定
  });

  it('绑定目标已被删除（movedIds 含 id 但元素不在场）：原样返回——解绑归删除时序处理', () => {
    const a = arrow({ endBinding: { elementId: 'gone' } });
    const out = updateBindingsAfterMove([rect(), a], new Set(['gone']));
    expect(out[1]).toBe(a);
  });

  it('目标缩放后端点重投影到新轮廓：矩形拉宽后终点贴新右边缘（ZOO-219 PR3 缩放跟随）', () => {
    // 箭头终点吸附在 rect 右边缘中点 (300,150)；rect 宽 200→400（右缘 500），
    // 中心 (300,150)，旧端点方向 (0,0) 退化——终点恰在旧右缘中点即新中心线上，
    // 中心射线 dx=0, dy=0 退化。改用非对称场景验证：终点 (300,150)、
    // rect 缩为 (100,100,100,100)（中心 (150,150)），方向 (150,0) → 贴新右缘 (200,150)
    const resized = { ...rect(), width: 100 };
    const a = arrow({ x2: 300, y2: 150, endBinding: { elementId: 'r1' } });
    const out = updateBindingsAfterMove([resized, a], new Set(['r1']));
    const updated = out[1] as ArrowElement;
    expect(updated.x2).toBeCloseTo(200, 6); // 新右边缘
    expect(updated.y2).toBeCloseTo(150, 6);
  });
});

describe('clearBindingsOfDeletedElements（删除被绑元素 → 绑定解除、端点冻结，ZOO-220）', () => {
  it('指向被删元素的 start/end 绑定被清除，端点坐标冻结不动', () => {
    const a = arrow({
      x: 12, y: 34, x2: 300, y2: 150,
      startBinding: { elementId: 'r1' },
      endBinding: { elementId: 'd1' },
    });
    const out = clearBindingsOfDeletedElements([rect(), diamond(), a], new Set(['r1', 'd1']));
    const updated = out[2] as ArrowElement;
    expect(updated.startBinding).toBeUndefined();
    expect(updated.endBinding).toBeUndefined();
    // 端点冻结：坐标逐字节不变
    expect(updated.x).toBe(12);
    expect(updated.y).toBe(34);
    expect(updated.x2).toBe(300);
    expect(updated.y2).toBe(150);
  });

  it('未指向被删元素的箭头与非箭头元素：原样同引用返回（无多余快照对象）', () => {
    const a = arrow({ endBinding: { elementId: 'r1' } });
    const r = rect();
    const out = clearBindingsOfDeletedElements([r, a], new Set(['d1']));
    expect(out[0]).toBe(r);
    expect(out[1]).toBe(a);
  });

  it('仅一端指向被删元素：只清该端，另一端绑定保留', () => {
    const a = arrow({ startBinding: { elementId: 'r1' }, endBinding: { elementId: 'd1' } });
    const out = clearBindingsOfDeletedElements([rect(), diamond(), a], new Set(['d1']));
    const updated = out[2] as ArrowElement;
    expect(updated.startBinding).toEqual({ elementId: 'r1' });
    expect(updated.endBinding).toBeUndefined();
  });
});
