/**
 * 可拖点测试（ZOO-201）：绑定解析（坐标派生 / 失效跳过 / 条目清洗）、常量写回
 * （只触碰绑定键、滑块元数据裁剪与圆整、沿曲线吸附）、历史提交语义（静默直改 +
 * 松手一条快照，撤销一次回拖动前）、屏幕层命中与坐标反解、序列化与 SVG 导出。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { MathPlotElement, WhiteboardElement } from '../types';
import type { DraggablePoint } from '../math/types';
import {
  addDragPoint,
  constantsEqual,
  dragConstantsPatch,
  pruneDragPoints,
  removeDragPoint,
  resolveDragPoints,
  snapXOnCurve,
} from '../math/dragPoint';
import { DRAG_POINT_HIT_PX, dragPointSpots, dragStepPatch, hitTestDragPoint } from '../dragPoints';
import { mathPlotMapper } from '../poi';
import { exportToSvg } from '../export';

const VP = { offsetX: 0, offsetY: 0, scale: 1 };

function makeElement(overrides: Partial<MathPlotElement> = {}): MathPlotElement {
  return {
    id: 'mp-1',
    type: 'mathPlot',
    x: 100,
    y: 80,
    width: 480,
    height: 360,
    strokeColor: '#3B82F6',
    strokeWidth: 2,
    opacity: 1,
    equation: 'y=a*x+b',
    kind: 'explicit',
    error: null,
    xAxis: { min: -10, max: 10 },
    equalRatio: true,
    sampleCount: 320,
    showAxis: true,
    showGrid: true,
    showLabel: true,
    ...overrides,
  };
}

beforeEach(() => {
  useStore.setState({
    elements: [],
    selectedId: null,
    activeTool: 'pen',
    undoStack: [],
    redoStack: [],
    isDirty: false,
    pendingMathPlot: null,
  });
});

// —— 绑定解析 ——

describe('绑定解析（resolveDragPoints）', () => {
  it('自由点 (a, b)：坐标 = 两绑定常量当前值', () => {
    const el = makeElement({
      constants: { a: 2, b: -3 },
      draggablePoints: [{ id: 'p1', mode: 'free', xKey: 'a', yKey: 'b' }],
    });
    expect(resolveDragPoints(el)).toEqual([{ id: 'p1', mode: 'free', x: 2, y: -3 }]);
  });

  it('沿曲线点 (a, f(a))：y 按当前常量 scope 求值——y=a*x+b 在 a=1 时为 (1, 1)', () => {
    const el = makeElement({
      constants: { a: 1, b: 0 },
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }],
    });
    expect(resolveDragPoints(el)).toEqual([{ id: 'p1', mode: 'onCurve', x: 1, y: 1 }]);
  });

  it('多常量式 y=A*sin(w*x+p)：点位随常量联动（存储层键 a/w/p，A 经归一小写）', () => {
    const el = makeElement({
      equation: 'y=A*sin(w*x+p)',
      constants: { a: 2, w: 3, p: 0.5 },
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }],
    });
    const r = resolveDragPoints(el)[0];
    expect(r.x).toBe(2);
    expect(r.y).toBeCloseTo(2 * Math.sin(3 * 2 + 0.5), 9);
  });

  it('绑定常量缺失的条目静默跳过（数据保留，不生效）', () => {
    const el = makeElement({
      equation: 'y=a*x',
      constants: { a: 1 },
      draggablePoints: [
        { id: 'free-dead', mode: 'free', xKey: 'a', yKey: 'b' },
        { id: 'curve-dead', mode: 'onCurve', xKey: 'c' },
        { id: 'alive', mode: 'onCurve', xKey: 'a' },
      ],
    });
    expect(resolveDragPoints(el).map((r) => r.id)).toEqual(['alive']);
  });

  it('非显式 kind / 错误态：沿曲线点不解析（渲染与命中间口径）', () => {
    const circle = makeElement({
      equation: 'x^2+y^2=4',
      kind: 'circle',
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }],
      constants: { a: 1 },
    });
    expect(resolveDragPoints(circle)).toEqual([]);
    const err = makeElement({ kind: 'error', error: 'bad', constants: { a: 1 }, draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }] });
    expect(resolveDragPoints(err)).toEqual([]);
  });

  it('pruneDragPoints：绑定常量消亡的条目剔除，空结果归一 undefined', () => {
    const points: DraggablePoint[] = [
      { id: 'p1', mode: 'free', xKey: 'a', yKey: 'b' },
      { id: 'p2', mode: 'onCurve', xKey: 'c' },
    ];
    expect(pruneDragPoints(points, { a: 1, b: 2, c: 3 })).toHaveLength(2);
    expect(pruneDragPoints(points, { a: 1, c: 2 })).toEqual([{ id: 'p2', mode: 'onCurve', xKey: 'c' }]);
    expect(pruneDragPoints(points, { a: 1 })).toBeUndefined();
    expect(pruneDragPoints(undefined, { a: 1 })).toBeUndefined();
  });

  it('addDragPoint 同型去重返回 null；removeDragPoint 移空归一 undefined', () => {
    const points: DraggablePoint[] = [{ id: 'p1', mode: 'onCurve', xKey: 'a' }];
    expect(addDragPoint(points, { mode: 'onCurve', xKey: 'a' })).toBeNull();
    const added = addDragPoint(points, { mode: 'free', xKey: 'a', yKey: 'b' });
    expect(added).toHaveLength(2);
    expect(added![1].mode).toBe('free');
    expect(removeDragPoint(points, 'p1')).toBeUndefined();
    expect(removeDragPoint(points, 'nope')).toBeNull();
  });
});

// —— 常量写回 ——

describe('常量写回（dragConstantsPatch）', () => {
  it('自由点拖动：x/y 各写各的绑定键', () => {
    const el = makeElement({
      constants: { a: 1, b: 0 },
      constantSliders: { a: { min: -20, max: 20, step: 0.1 }, b: { min: -20, max: 20, step: 0.1 } },
      draggablePoints: [{ id: 'p1', mode: 'free', xKey: 'a', yKey: 'b' }],
    });
    const patch = dragConstantsPatch(el, el.draggablePoints![0], { x: 3.456, y: -7.654 })!;
    expect(patch.a).toBeCloseTo(3.46, 9); // 两位圆整（滑杆同口径）
    expect(patch.b).toBeCloseTo(-7.65, 9);
  });

  it('沿曲线点拖动：只写 x 绑定键，y 不落常量', () => {
    const el = makeElement({
      equation: 'y=A*sin(w*x+p)',
      constants: { A: 2, w: 3, p: 0.5 },
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'A' }],
    });
    const patch = dragConstantsPatch(el, el.draggablePoints![0], { x: 1.234, y: 999 })!;
    expect(patch.A).toBeCloseTo(1.23, 9);
  });

  it('多常量式只改绑定常量，其余常量原样保留（验收口径）', () => {
    const el = makeElement({
      equation: 'y=A*sin(w*x+p)',
      constants: { A: 2, w: 3, p: 0.5 },
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'A' }],
    });
    const patch = dragConstantsPatch(el, el.draggablePoints![0], { x: -4, y: 0 })!;
    expect(patch.w).toBe(3);
    expect(patch.p).toBe(0.5);
    expect(patch.A).toBe(-4);
  });

  it('值裁剪进滑块元数据范围：自定义 min/max 生效，缺省回落 -10~10', () => {
    const el = makeElement({
      constants: { a: 1 },
      constantSliders: { a: { min: 0, max: 5, step: 0.1 } },
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }],
    });
    const point = el.draggablePoints![0];
    expect(dragConstantsPatch(el, point, { x: 9, y: 0 })!.a).toBe(5);
    expect(dragConstantsPatch(el, point, { x: -3, y: 0 })!.a).toBe(0);

    const def = makeElement({
      constants: { a: 1 },
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }],
    });
    expect(dragConstantsPatch(def, def.draggablePoints![0], { x: 15, y: 0 })!.a).toBe(10);
  });

  it('绑定失效（常量已删）返回 null，不动元素', () => {
    const el = makeElement({
      constants: { a: 1 },
      draggablePoints: [{ id: 'p1', mode: 'free', xKey: 'a', yKey: 'gone' }],
    });
    expect(dragConstantsPatch(el, el.draggablePoints![0], { x: 1, y: 1 })).toBeNull();
  });

  it('snapXOnCurve：折线采样上取最近点 x；无采样回落目标 x', () => {
    const pl = [{ x: 0, y: 0 }, { x: 1, y: 10 }, { x: 2, y: 0 }];
    expect(snapXOnCurve([pl], { x: 0.1, y: 9 })).toBe(1); // 离 (1,10) 最近
    expect(snapXOnCurve([[]], { x: 3.5, y: 0 })).toBe(3.5);
  });
});

// —— 历史提交语义 ——

describe('历史提交语义（拖动 = 静默直改 + 松手一条快照）', () => {
  it('拖动全程不入栈；松手压一条 update；撤销一次回拖动前、重做恢复', () => {
    const el = makeElement({
      id: 'mp-drag',
      constants: { a: 1, b: 0 },
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }],
    });
    useStore.getState().addElement(el);
    expect(useStore.getState().undoStack).toHaveLength(1); // 仅 create

    // 手势起手快照（Canvas pointDragRef.before 同构）
    const st = useStore.getState();
    const cur0 = st.elements.find((e) => e.id === 'mp-drag') as MathPlotElement;
    const before: MathPlotElement = { ...cur0 };
    const point = cur0.draggablePoints![0];

    // 拖动多步：直改不入栈
    for (const x of [1.5, 2.4, 4.567]) {
      const cur = useStore.getState().elements.find((e) => e.id === 'mp-drag') as MathPlotElement;
      const patch = dragConstantsPatch(cur, point, { x, y: 0 })!;
      useStore.getState().updateElementTransient('mp-drag', { constants: patch });
    }
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect((useStore.getState().elements[0] as MathPlotElement).constants!.a).toBeCloseTo(4.57, 9);

    // 松手：常量有实效变化 → 压一条快照
    const cur1 = useStore.getState().elements.find((e) => e.id === 'mp-drag') as MathPlotElement;
    useStore.getState().pushOperations([{ type: 'update', elementId: 'mp-drag', before, after: { ...cur1 } }]);
    expect(useStore.getState().undoStack).toHaveLength(2);

    // 撤销一次：回到拖动前（a=1）
    useStore.getState().undo();
    expect((useStore.getState().elements[0] as MathPlotElement).constants!.a).toBe(1);
    // 重做：恢复拖动后
    useStore.getState().redo();
    expect((useStore.getState().elements[0] as MathPlotElement).constants!.a).toBeCloseTo(4.57, 9);
  });

  it('无实效拖动（constantsEqual）不压快照', () => {
    const el = makeElement({
      id: 'mp-noop',
      constants: { a: 1 },
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }],
    });
    useStore.getState().addElement(el);
    const cur = useStore.getState().elements[0] as MathPlotElement;
    // 拖回原位：补丁产出与起手逐键相等 → Canvas 收口判变跳过 pushOperations
    const patch = dragConstantsPatch(cur, cur.draggablePoints![0], { x: 1, y: 0 })!;
    expect(constantsEqual(patch, cur.constants)).toBe(true);
    expect(constantsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(constantsEqual(undefined, undefined)).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});

// —— 屏幕层：命中 / 坐标反解 / 拖动一步 ——

describe('屏幕层（dragPoints）', () => {
  const elements = (overrides: Partial<MathPlotElement> = {}): WhiteboardElement[] => [
    makeElement({ id: 'mp-1', constants: { a: 1, b: 0 }, ...overrides }),
  ];

  it('点位屏幕坐标命中：命中半径内取最近，半径外无命中', () => {
    const els = elements({
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }],
    });
    const el = els[0] as MathPlotElement;
    const spot = dragPointSpots(el, VP)[0];
    expect(spot.pointId).toBe('p1');
    // 命中半径内
    const hit = hitTestDragPoint(els, { x: spot.screen.x + 4, y: spot.screen.y + 4 }, VP);
    expect(hit?.pointId).toBe('p1');
    // 半径外
    expect(hitTestDragPoint(els, { x: spot.screen.x + DRAG_POINT_HIT_PX + 8, y: spot.screen.y }, VP)).toBeNull();
  });

  it('错误态 / 非显式元素无点位；无常量绑定点位不生效', () => {
    const err = elements({ kind: 'error', error: 'bad', draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }] });
    expect(dragPointSpots(err[0] as MathPlotElement, VP)).toEqual([]);
    const dead = elements({ constants: {}, draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }] });
    expect(dragPointSpots(dead[0] as MathPlotElement, VP)).toEqual([]);
  });

  it('mapper 逆映射 toMath(toScreen(x,y)) ≈ (x,y)', () => {
    const el = elements()[0] as MathPlotElement;
    const mapper = mathPlotMapper(el, VP)!;
    const s = mapper.toScreen(3.25, -4.5);
    const back = mapper.toMath(s.x, s.y);
    expect(back.x).toBeCloseTo(3.25, 9);
    expect(back.y).toBeCloseTo(-4.5, 9);
  });

  it('dragStepPatch 自由点：屏幕位 → 两常量写回', () => {
    const els = elements({
      constantSliders: { a: { min: -20, max: 20, step: 0.1 }, b: { min: -20, max: 20, step: 0.1 } },
      draggablePoints: [{ id: 'p1', mode: 'free', xKey: 'a', yKey: 'b' }],
    });
    const el = els[0] as MathPlotElement;
    const mapper = mathPlotMapper(el, VP)!;
    const screen = mapper.toScreen(5, -2);
    const patch = dragStepPatch(el, 'p1', screen, VP)!;
    expect(patch.constants.a).toBeCloseTo(5, 6);
    expect(patch.constants.b).toBeCloseTo(-2, 6);
  });

  it('dragStepPatch 沿曲线点：吸附到采样折线最近点（y=x 上 (2.3,5) 投影到 x≈3.65）', () => {
    const els = elements({
      equation: 'y=x',
      constants: { a: 0 },
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }],
    });
    const el = els[0] as MathPlotElement;
    const mapper = mathPlotMapper(el, VP)!;
    // 拖向 (2.3, 5)：最近点在直线 y=x 上的正交投影 t=(2.3+5)/2=3.65（跟手吸附，
    // 非仅 x 投影）；写回值落在最近采样点（采样步长 20/320 = 0.0625 内）
    const screen = mapper.toScreen(2.3, 5);
    const patch = dragStepPatch(el, 'p1', screen, VP)!;
    expect(Math.abs(patch.constants.a - 3.65)).toBeLessThan(0.07);
    // 移除的条目 / 错误 id 无动作
    expect(dragStepPatch(el, 'gone', screen, VP)).toBeNull();
  });
});

// —— 持久化与导出 ——

describe('持久化与 SVG 导出', () => {
  it('draggablePoints 随元素 JSON 序列化往返；旧文档（无字段）零迁移', () => {
    const el = makeElement({
      constants: { a: 1, b: 0 },
      draggablePoints: [
        { id: 'p1', mode: 'onCurve', xKey: 'a' },
        { id: 'p2', mode: 'free', xKey: 'a', yKey: 'b' },
      ],
    });
    const round = JSON.parse(JSON.stringify(el)) as MathPlotElement;
    expect(round.draggablePoints).toHaveLength(2);
    expect(resolveDragPoints(round).map((r) => r.id).sort()).toEqual(['p1', 'p2']);

    const old = JSON.parse(JSON.stringify(makeElement())) as MathPlotElement;
    expect(old.draggablePoints).toBeUndefined();
    expect(resolveDragPoints(old)).toEqual([]);
  });

  it('SVG 导出含可拖点圆点（沿曲线点带吸附外圈）', () => {
    const el = makeElement({
      constants: { a: 1, b: 0 },
      draggablePoints: [{ id: 'p1', mode: 'onCurve', xKey: 'a' }],
    });
    const svg = exportToSvg([el]);
    expect(svg).toContain('r="7.5"'); // 沿曲线点外圈
    expect(svg).toContain('r="4"'); // 点本体
    const free = makeElement({
      constants: { a: 1, b: 0 },
      draggablePoints: [{ id: 'p1', mode: 'free', xKey: 'a', yKey: 'b' }],
    });
    expect(exportToSvg([free])).not.toContain('r="7.5"');
  });
});
