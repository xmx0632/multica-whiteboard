/**
 * POI 交互层测试（ZOO-199）：渲染管线 pois 产物 / 交点对 memo / 灰点提示 /
 * 悬停吸附（多曲线择近 + 阈值）/ 点击命中与标注切换补丁 / 序列化与 SVG 导出。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MathPlotElement, WhiteboardElement } from '../types';
import { resolvePlotRender } from '../math/plot';
import { plotTokenFor } from '../math/cache';
import { mathPlotSpecOf } from '../renderer';
import { exportToSvg } from '../export';
import {
  HOVER_SNAP_PX,
  POI_HIT_PX,
  annotationScreen,
  clearPoiPairCache,
  hitTestPoi,
  intersectionsForPair,
  mathPlotMapper,
  nearestCurvePoint,
  poiHintsFor,
  togglePoiAnnotation,
} from '../poi';

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
    equation: 'y=sin(x)',
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

/** 元素卡片中心（屏幕 px）：命中 / 悬停测试的落点基准。 */
function cardCenter(el: MathPlotElement): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

describe('渲染管线 pois 产物（resolvePlotRender）', () => {
  it('显式函数带 zeros + extrema；几何 kind 无 pois', () => {
    const el = makeElement();
    const render = resolvePlotRender(mathPlotSpecOf(el), { width: el.width, height: el.height }, plotTokenFor(el.id));
    expect(render.error).toBeUndefined();
    expect(render.pois).toBeDefined();
    expect(render.pois!.zeros.length).toBeGreaterThan(0);
    expect(render.pois!.extrema.length).toBeGreaterThan(0);
    expect(render.pois!.zeros).toContain(0);

    const geo = makeElement({ id: 'mp-geo', equation: 'x^2+y^2=25', kind: 'circle' });
    const geoRender = resolvePlotRender(mathPlotSpecOf(geo), { width: geo.width, height: geo.height }, plotTokenFor(geo.id));
    expect(geoRender.pois).toBeUndefined();
  });

  it('同签名命中缓存不重算（pois 随缓存返回）', () => {
    const el = makeElement({ id: 'mp-cache' });
    const key = plotTokenFor(el.id);
    const r1 = resolvePlotRender(mathPlotSpecOf(el), { width: el.width, height: el.height }, key);
    const r2 = resolvePlotRender(mathPlotSpecOf(el), { width: el.width, height: el.height }, key);
    expect(r2).toBe(r1); // 同对象——缓存命中
    expect(r2.pois!.zeros).toEqual(r1.pois!.zeros);
  });
});

describe('intersectionsForPair（交点对 memo）', () => {
  beforeEach(() => clearPoiPairCache());

  it('y=sin(x) ∩ y=x/3：三交点（含 x=0）', () => {
    const a = makeElement();
    const b = makeElement({ id: 'mp-2', equation: 'y=x/3' });
    const pts = intersectionsForPair(a, b);
    expect(pts).toHaveLength(3);
    expect(pts.some((p) => Math.abs(p.x) < 1e-6)).toBe(true);
  });

  it('memo 命中：同输入两次调用同引用；改定义域自动失效重算', () => {
    const a = makeElement();
    const b = makeElement({ id: 'mp-2', equation: 'y=x/3' });
    const first = intersectionsForPair(a, b);
    const second = intersectionsForPair(a, b);
    expect(second).toBe(first);

    const narrowed = { ...a, xAxis: { min: 2, max: 10 } };
    const third = intersectionsForPair(narrowed, b);
    expect(third).not.toBe(first); // 键含定义域——失效重算
    expect(third).toHaveLength(1); // [2,10] 内仅 +2.2789 一个交点
  });

  it('定义域无交集 / 非显式 kind 返回空', () => {
    const a = makeElement({ xAxis: { min: -2, max: -1 } });
    const b = makeElement({ id: 'mp-2', equation: 'y=x/3', xAxis: { min: 5, max: 8 } });
    expect(intersectionsForPair(a, b)).toEqual([]);
    const geo = makeElement({ id: 'mp-geo', equation: 'x^2+y^2=25', kind: 'circle' });
    expect(intersectionsForPair(a, geo)).toEqual([]);
  });
});

describe('poiHintsFor（灰点提示目标）', () => {
  beforeEach(() => clearPoiPairCache());

  it('含零点 / 极值 / 与另一曲线的交点；交点带配对 id；屏幕坐标在卡片内', () => {
    const a = makeElement();
    const b = makeElement({ id: 'mp-2', x: 700, equation: 'y=x/3' }); // 卡片不重叠：命中无歧义
    const hints = poiHintsFor(a, [a, b], VP);
    const kinds = new Set(hints.map((h) => h.kind));
    expect(kinds.has('zero')).toBe(true);
    expect(kinds.has('extremum')).toBe(true);
    expect(kinds.has('intersection')).toBe(true);
    for (const h of hints.filter((x) => x.kind === 'intersection')) {
      expect(h.withId).toBe('mp-2');
    }
    for (const h of hints) {
      expect(h.screen.x).toBeGreaterThanOrEqual(a.x);
      expect(h.screen.x).toBeLessThanOrEqual(a.x + a.width);
      expect(h.screen.y).toBeGreaterThanOrEqual(a.y);
      expect(h.screen.y).toBeLessThanOrEqual(a.y + a.height);
    }
  });

  it('错误态 / 非显式元素无提示', () => {
    const bad = makeElement({ kind: 'error', error: 'oops' });
    expect(poiHintsFor(bad, [bad], VP)).toEqual([]);
    const geo = makeElement({ equation: 'x^2+y^2=25', kind: 'circle' });
    expect(poiHintsFor(geo, [geo], VP)).toEqual([]);
  });
});

describe('nearestCurvePoint（悬停坐标追踪）', () => {
  it('光标近曲线时吸附最近采样点；远离返回 null', () => {
    const a = makeElement();
    const center = cardCenter(a); // 卡片中心 ≈ 原点附近（sin 过原点）
    const trace = nearestCurvePoint([a], center, VP);
    expect(trace).not.toBeNull();
    expect(trace!.elementId).toBe('mp-1');
    // 中心即数学 (≈0, 0) 邻域——吸附点离原点不远
    expect(Math.abs(trace!.x)).toBeLessThan(1);

    const far = { x: center.x + 400, y: center.y - 300 };
    expect(nearestCurvePoint([a], far, VP)).toBeNull();
  });

  it('多曲线优先吸附最近曲线（验收口径）', () => {
    const a = makeElement({ id: 'mp-a', x: 100 }); // sin 卡片
    const b = makeElement({ id: 'mp-b', x: 100, y: 700, equation: 'y=x/3' }); // 下方远处卡片
    const cursorInA = cardCenter(a);
    const trace = nearestCurvePoint([a, b], cursorInA, VP);
    expect(trace!.elementId).toBe('mp-a');
  });

  it('阈值可调：收紧后同位置不再吸附', () => {
    const a = makeElement();
    const center = cardCenter(a);
    // 原点在卡片中心：把光标放到离曲线 ~12px 处（y 上移 12px）
    const nearish = { x: center.x, y: center.y - 12 };
    expect(nearestCurvePoint([a], nearish, VP, HOVER_SNAP_PX)).not.toBeNull();
    expect(nearestCurvePoint([a], nearish, VP, 6)).toBeNull();
  });
});

describe('hitTestPoi + togglePoiAnnotation（点击命中与标注切换）', () => {
  beforeEach(() => clearPoiPairCache());

  function setup(annotations?: MathPlotElement['poiAnnotations']) {
    const a = makeElement({ ...(annotations ? { poiAnnotations: annotations } : {}) });
    const b = makeElement({ id: 'mp-2', equation: 'y=x/3' });
    return { a, b, elements: [a, b] as WhiteboardElement[] };
  }

  it('点中零点灰点 → add 命中；toggle 补丁追加标注（uuid / kind / 坐标）', () => {
    const { a, elements } = setup();
    // 零点 (0,0) 的屏幕位置：经 mapper 精确取点，保证命中
    const mapper = mathPlotMapper(a, VP)!;
    const zero = mapper.toScreen(0, 0);
    const hit = hitTestPoi(elements, zero, VP);
    expect(hit).toMatchObject({ action: 'add', kind: 'zero', x: 0, y: 0 });
    const patch = togglePoiAnnotation(a, hit!);
    expect(patch?.poiAnnotations).toHaveLength(1);
    const annot = patch!.poiAnnotations![0];
    expect(annot.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(annot.kind).toBe('zero');
    expect(annot.x).toBe(0);
    expect(annot.y).toBe(0);
  });

  it('点中交点灰点 → add 携带配对元素 id（验收：交点标注）', () => {
    const { a, elements } = setup();
    const b = elements.find((e) => e.id === 'mp-2') as MathPlotElement;
    b.x = 700; // 卡片错开：点击落点只在 a 卡上，无跨卡命中歧义
    const mapper = mathPlotMapper(a, VP)!;
    const X = 2.2788627; // sin(x)=x/3 的正根
    const pt = mapper.toScreen(X, Math.sin(X));
    const hit = hitTestPoi(elements, pt, VP);
    expect(hit?.action).toBe('add');
    if (hit?.action !== 'add') return;
    expect(hit.kind).toBe('intersection');
    expect(hit.withId).toBe('mp-2');
    expect(Math.abs(hit.x - X)).toBeLessThan(1e-3); // 验收：< 1e-3
    const patch = togglePoiAnnotation(a, hit);
    expect(patch?.poiAnnotations![0].withId).toBe('mp-2');
  });

  it('已持久化标注恒可点（hintVisible 屏蔽也不影响）→ remove；同点优先删', () => {
    const { a, elements } = setup([
      { id: 'annot-1', kind: 'zero', x: 0, y: 0 },
    ]);
    const p = annotationScreen(a, { id: 'annot-1', kind: 'zero', x: 0, y: 0 }, VP)!;
    const hit = hitTestPoi(elements, p, VP, { hintVisible: () => false });
    expect(hit).toEqual({ action: 'remove', elementId: 'mp-1', annotationId: 'annot-1' });
    const patch = togglePoiAnnotation(a, hit!);
    expect(patch?.poiAnnotations).toEqual([]);
  });

  it('重复添加同位标注返回 null；删除不存在的标注返回 null', () => {
    const a = makeElement({ poiAnnotations: [{ id: 'annot-1', kind: 'zero', x: 0, y: 0 }] });
    expect(
      togglePoiAnnotation(a, { action: 'add', elementId: a.id, kind: 'zero', x: 0, y: 0 }),
    ).toBeNull();
    expect(
      togglePoiAnnotation(a, { action: 'remove', elementId: a.id, annotationId: 'nope' }),
    ).toBeNull();
  });

  it('hintVisible 屏蔽未选中的元素——灰点不可点', () => {
    const { a, elements } = setup();
    const mapper = mathPlotMapper(a, VP)!;
    const zero = mapper.toScreen(0, 0);
    const hit = hitTestPoi(elements, zero, VP, { hintVisible: () => false });
    expect(hit).toBeNull();
  });

  it('命中半径可调（POI_HIT_PX 内 / 外）', () => {
    const { a, elements } = setup();
    const mapper = mathPlotMapper(a, VP)!;
    const zero = mapper.toScreen(0, 0);
    const edge = { x: zero.x + (POI_HIT_PX - 2), y: zero.y };
    expect(hitTestPoi(elements, edge, VP)).not.toBeNull();
    const outside = { x: zero.x + POI_HIT_PX + 4, y: zero.y };
    expect(hitTestPoi(elements, outside, VP)).toBeNull();
  });
});

describe('标注持久化：序列化 + SVG 导出 + 视图外收拢', () => {
  it('poiAnnotations 随元素 JSON 往返；缺省字段不落（旧文档零迁移）', () => {
    const a = makeElement({
      poiAnnotations: [
        { id: 'annot-1', kind: 'extremum', x: Math.PI / 2, y: 1 },
        { id: 'annot-2', kind: 'intersection', x: 2.2788627, y: 0.7596, withId: 'mp-2' },
      ],
    });
    const restored = JSON.parse(JSON.stringify(a)) as MathPlotElement;
    expect(restored.poiAnnotations).toEqual(a.poiAnnotations);

    const legacy = makeElement();
    expect('poiAnnotations' in legacy).toBe(false); // 工厂不落空壳字段
    const legacyRestored = JSON.parse(JSON.stringify(legacy)) as MathPlotElement;
    expect(legacyRestored.poiAnnotations).toBeUndefined();
  });

  it('SVG 导出包含已持久化标注（灰点 circle + 坐标文本，验收）', () => {
    const a = makeElement({
      poiAnnotations: [{ id: 'annot-1', kind: 'extremum', x: Math.PI / 2, y: 1 }],
    });
    const svg = exportToSvg([a]);
    expect(svg).toContain('fill="#6b7280" stroke="#ffffff" stroke-width="1.5"'); // 灰点白边圆
    expect(svg).toContain('(1.57, 1)'); // 坐标文本（formatPoiCoord）
    // 无标注元素导出不含 POI 标注层（灰点圆 + 白边组合不出现）
    const bare = exportToSvg([makeElement({ id: 'mp-bare' })]);
    expect(bare).not.toContain('fill="#6b7280" stroke="#ffffff"');
  });

  it('视图外标注的命中位置收拢回卡片内缘（所见即所点）', () => {
    // y=100 远超 sin 卡片视窗（ySpan≈7.5）：标注画在内缘，命中点也在卡片内
    const a = makeElement({ poiAnnotations: [{ id: 'annot-far', kind: 'zero', x: 0, y: 100 }] });
    const p = annotationScreen(a, a.poiAnnotations![0], VP)!;
    expect(p.x).toBeGreaterThanOrEqual(a.x);
    expect(p.x).toBeLessThanOrEqual(a.x + a.width);
    expect(p.y).toBeGreaterThanOrEqual(a.y);
    expect(p.y).toBeLessThanOrEqual(a.y + a.height);
  });
});
