/**
 * 分段函数全链路验收（ZOO-216，评审方案候选 A 语法）。
 *
 * 覆盖：归一化（≤≥ 全半角翻译）→ parsePiecewise（形态识别 / 条件链 /
 * 首个命中 / 默认段仅末位 / 定向报错文案）→ samplePiecewiseMulti（折点并入
 * 网格、跳跃断笔无伪竖线、连续折点连通）→ piecewiseMarksOf（跳跃处实心 /
 * 空心端点标记，连续折点不标记）→ 微积分叠加（逐段符号求导、f′ 折点断笔）→
 * 渲染 / SVG 导出同步。评审边缘场景 1–6 逐条落用例；既有路径零回归由
 * parse.test / sample.test 等既有套件守护（全量跑）。
 */
import { describe, expect, it } from 'vitest';
import { derivativeOf } from '../calculus';
import { piecewiseMarksOf, resolvePlotRender, type PlotFrame, type PlotSpec } from '../plot';
import { parseEquation, piecewiseValueBodies } from '../parse';
import { createPreviewPolylines, samplePiecewiseMulti } from '../sample';
import { validateEquation } from '../validate';
import { EQUATION_TEMPLATES } from '../templates';
import { mathPlotFieldsFromPayload } from '../../mathplotElement';
import { exportToSvg } from '../../export';
import type { MathPlotElement } from '../../types';
import type { MathPlotOverlay } from '../types';

const asPw = (r: ReturnType<typeof parseEquation>) => {
  expect(r.kind).toBe('piecewise');
  return r.kind === 'piecewise' ? r : null;
};

describe('parsePiecewise：形态识别与求值语义', () => {
  it('issue 示例形态：首段条件、末段默认兜底', () => {
    const r = asPw(parseEquation('y={x<0:-x; x}'))!;
    expect(r.fn(-2)).toBe(2);
    expect(r.fn(3)).toBe(3);
    expect(r.fn(0)).toBe(0); // 默认段兜底（x<0 不含 0）
    expect(r.breakpoints).toEqual([0]);
    expect(r.variable).toBeUndefined();
  });

  it('链式条件 + 教材 ≤≥ 原貌书写（归一层翻译）', () => {
    const r = asPw(parseEquation('y={0≤x<2:x²; x≥2:4}'))!;
    expect(r.fn(1)).toBe(1);
    expect(r.fn(2)).toBe(4); // 首个命中：x≥2 段（评审决策 7）
    expect(r.fn(-1)).toBeNaN(); // 条件间隙 = 无定义（评审边缘 6）
    expect(r.breakpoints).toEqual([0, 2]);
  });

  it('q(t)= 物理前缀形态（晶体熔化模板方程）', () => {
    const r = asPw(parseEquation('T(t)={t<2:5t-10; 2≤t<6:0; 2.5t-15}'))!;
    expect(r.variable).toBe('t');
    expect(r.fn(0)).toBe(-10);
    expect(r.fn(2)).toBe(0);
    expect(r.fn(4)).toBe(0);
    expect(r.fn(6)).toBe(0);
    expect(r.fn(10)).toBe(10);
    expect(r.breakpoints).toEqual([2, 6]);
  });

  it('裸 {…} 与 {x} 单段退化形态（评审边缘 4）', () => {
    expect(asPw(parseEquation('{x<0:-x; x}'))!.fn(-1)).toBe(1);
    expect(asPw(parseEquation('y={x}'))!.fn(7)).toBe(7);
  });

  it('段分隔符 ；/,，兼收；末尾多余分隔符容忍（评审决策 2 / 边缘 4）', () => {
    const semi = asPw(parseEquation('y={x<0:-x; x;}'))!;
    const comma = asPw(parseEquation('y={x<0:-x, x}'))!;
    expect(semi.fn(-3)).toBe(3);
    expect(comma.fn(-3)).toBe(3);
    expect(comma.fn(5)).toBe(5);
  });

  it('min(x,1) 参数逗号不被切段（评审边缘 1）', () => {
    const r = asPw(parseEquation('y={x<0:min(x,1); x}'))!;
    expect(r.fn(-5)).toBe(-5);
    expect(r.fn(-0.5)).toBe(-0.5);
    expect(r.fn(2)).toBe(2);
  });

  it('值前置误用 → 定向引导「条件:值」顺序，非笼统格式错（评审边缘 2）', () => {
    const r = parseEquation('y={x<0, -x; x, x≥0}');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.message).toContain('条件:值');
      expect(r.message).not.toContain('无法识别的字符'); // 不是 badChar 兜底
    }
  });

  it('默认段仅允许末位（评审边缘 3）', () => {
    expect(parseEquation('y={x; x<0:-x}').kind).toBe('error');
  });

  it('错误用例三文案：缺右括号 / 条件残缺 / 区间矛盾（验收标准）', () => {
    const unclosed = parseEquation('y={x<0:-x; x');
    expect(unclosed.kind).toBe('error');
    if (unclosed.kind === 'error') expect(unclosed.message).toContain('}');

    const incomplete = parseEquation('y={x<0:}');
    expect(incomplete.kind).toBe('error');
    if (incomplete.kind === 'error') expect(incomplete.message).toContain('第 1 段');

    const condBad = parseEquation('y={x=2:5; x}');
    expect(condBad.kind).toBe('error');
    if (condBad.kind === 'error') expect(condBad.message).toContain('条件');

    const empty = parseEquation('y={2<x<1:x; x}');
    expect(empty.kind).toBe('error');
    if (empty.kind === 'error') expect(empty.message).toContain('矛盾');
  });

  it('常量参与条件与值（阈值型分段）', () => {
    const r = asPw(parseEquation('y={x<k:0; x-k}', undefined, { k: 2 }))!;
    expect(r.fn(1)).toBe(0);
    expect(r.fn(4)).toBe(2);
    expect(r.breakpoints).toEqual([2]);
    // k 未赋值 → 常量区引导（含 missingConstants 可一键建滑块）
    const miss = parseEquation('y={x<k:0; x-k}');
    expect(miss.kind).toBe('error');
    if (miss.kind === 'error') expect(miss.missingConstants).toContain('k');
  });

  it('自由变量裁决口径同显式路径：欠定 / 拼写错误', () => {
    expect(parseEquation('y={x<0:x+y; x}').kind).toBe('error');
    expect(parseEquation('y={x<0:foo; x}').kind).toBe('error');
  });

  it('参数式 / 极坐标分段 v1 不支持：走既有 badChar（评审决策 5）', () => {
    const r = parseEquation('r={θ<1:1; 2}');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toContain('无法识别的字符');
  });

  it('validateEquation 透传（编辑器载荷不带求值函数）', () => {
    const v = validateEquation('T(t)={t<2:t; t}');
    expect(v.kind).toBe('piecewise');
    if (v.kind === 'piecewise') expect(v.variable).toBe('t');
  });

  it('piecewiseValueBodies：逐段值表达式提取（求导链单源）', () => {
    expect(piecewiseValueBodies('y={x<0:-x; x+1}')).toEqual(['-x', 'x+1']);
    expect(piecewiseValueBodies('y=2x+1')).toBeNull();
  });
});

describe('samplePiecewiseMulti：折点与断笔', () => {
  it('熔化曲线：折点在网格上、单一连通折线（连续折点不断笔）', () => {
    const parsed = asPw(parseEquation('T(t)={t<2:5t-10; 2≤t<6:0; 2.5t-15}'))!;
    const r = samplePiecewiseMulti([parsed.fn], parsed.breakpoints, { xMin: 0, xMax: 10 }, 320);
    expect('error' in r && r.error).toBeFalsy();
    if ('error' in r) return;
    expect(r.series[0].length).toBe(1); // 连续折线：升温-平台-升温连通
    const xs = r.series[0][0].map((p) => p.x);
    for (const b of [2, 6]) expect(xs).toContain(b); // 折点精确落网格
    // 平台段水平为 0：t∈(2,6) 采样点全部为 0
    const plateau = r.series[0][0].filter((p) => p.x > 2.01 && p.x < 5.99);
    expect(plateau.length).toBeGreaterThan(10);
    for (const p of plateau) expect(p.y).toBe(0);
  });

  it('sign 型跳跃：两段折线、无跨接竖线（验收「无伪竖线」）', () => {
    const parsed = asPw(parseEquation('y={x<0:-1; x>0:1}'))!;
    const r = samplePiecewiseMulti([parsed.fn], parsed.breakpoints, { xMin: -5, xMax: 5 }, 320);
    if ('error' in r) return;
    const pls = r.series[0];
    expect(pls.length).toBe(2);
    for (const pl of pls) {
      const ys = new Set(pl.map((p) => p.y));
      expect(ys.size).toBe(1); // 每段折线 y 恒定 —— 不存在 -1→1 的跨接点
    }
    expect(pls.some((pl) => pl.every((p) => p.y === -1))).toBe(true);
    expect(pls.some((pl) => pl.every((p) => p.y === 1))).toBe(true);
  });

  it('跳跃归属：b 点函数值归取值侧（{x≤2:8; 20} → (2,8) 在左支）', () => {
    const parsed = asPw(parseEquation('y={x≤2:8; 20}'))!;
    const r = samplePiecewiseMulti([parsed.fn], parsed.breakpoints, { xMin: 0, xMax: 5 }, 320);
    if ('error' in r) return;
    const all = r.series[0].flat();
    const at2 = all.filter((p) => p.x === 2);
    expect(at2.length).toBe(1);
    expect(at2[0].y).toBe(8);
    // 两支不连通：左支全 8、右支全 20
    expect(r.series[0].length).toBe(2);
  });

  it('f′ 序列在连续但不可导的折点处断笔（微积分口径，评审决策 6）', () => {
    const parsed = asPw(parseEquation('T(t)={t<2:5t-10; 2≤t<6:0; 2.5t-15}'))!;
    const d = derivativeOf('T(t)={t<2:5t-10; 2≤t<6:0; 2.5t-15}');
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.fn(1)).toBeCloseTo(5);
    expect(d.fn(4)).toBeCloseTo(0);
    expect(d.fn(8)).toBeCloseTo(2.5);
    const r = samplePiecewiseMulti([d.fn], parsed.breakpoints, { xMin: 0, xMax: 10 }, 320);
    if ('error' in r) return;
    expect(r.series[0].length).toBe(3); // 5 / 0 / 2.5 三支（导数跳跃即断笔）
  });

  it('条件间隙：域内无有效值 → noValidValues 既有文案', () => {
    const parsed = asPw(parseEquation('y={x<0:-x}'))!; // 无默认段：x>0 全无定义
    const r = samplePiecewiseMulti([parsed.fn], parsed.breakpoints, { xMin: 1, xMax: 2 }, 32);
    expect('error' in r && r.error).toBeTruthy();
  });
});

describe('piecewiseMarksOf：端点标记（教材图规范）', () => {
  it('sign 型全开端点：两侧均空心（无段含 0）', () => {
    const parsed = asPw(parseEquation('y={x<0:-1; x>0:1}'))!;
    const marks = piecewiseMarksOf(parsed, -5, 5);
    expect(marks).toHaveLength(2);
    expect(marks.every((m) => !m.filled)).toBe(true);
    expect(marks.map((m) => m.y).sort()).toEqual([-1, 1]);
  });

  it('跳跃取值归属：实心 = 函数值，空心 = 未取到的一侧极限', () => {
    const parsed = asPw(parseEquation('y={x≤2:8; 20}'))!;
    const marks = piecewiseMarksOf(parsed, 0, 5);
    expect(marks).toHaveLength(2);
    const filled = marks.find((m) => m.filled)!;
    const hollow = marks.find((m) => !m.filled)!;
    expect(filled.x).toBe(2);
    expect(filled.y).toBe(8);
    expect(hollow.y).toBe(20);
  });

  it('默认段取值：{x<1:0; 1} → (1,1) 实心 + (1,0) 空心', () => {
    const parsed = asPw(parseEquation('y={x<1:0; 1}'))!;
    const marks = piecewiseMarksOf(parsed, -2, 2);
    expect(marks.find((m) => m.filled)?.y).toBe(1);
    expect(marks.find((m) => !m.filled)?.y).toBe(0);
  });

  it('连续折点不标记（熔化 / 计费的衔接点）', () => {
    const melt = asPw(parseEquation('T(t)={t<2:5t-10; 2≤t<6:0; 2.5t-15}'))!;
    expect(piecewiseMarksOf(melt, 0, 10)).toHaveLength(0);
    const taxi = asPw(parseEquation('y={x≤2:8; 2x+4}'))!;
    expect(piecewiseMarksOf(taxi, 0, 10)).toHaveLength(0);
  });
});

describe('渲染与导出同步', () => {
  const frame: PlotFrame = { width: 480, height: 360 };
  const spec = (equation: string, overlays?: readonly MathPlotOverlay[], xAxis?: { min: number; max: number }): PlotSpec => ({
    equation,
    kind: 'piecewise',
    xAxis: xAxis ?? { min: -5, max: 5 },
    equalRatio: false,
    sampleCount: 320,
    ...(overlays ? { overlays } : {}),
  });

  it('resolvePlotRender：分段主曲线 + 端点标记产出', () => {
    const r = resolvePlotRender(spec('y={x<0:-1; x>0:1}'), frame, {});
    expect(r.error).toBeUndefined();
    expect(r.polylines.length).toBe(2);
    expect(r.piecewiseMarks).toHaveLength(2);
  });

  it('f′ 叠加对分段生效：逐段导数 + 共用断笔网格（评审决策 6）', () => {
    const r = resolvePlotRender(spec('y={x<0:-x; x}', [{ type: 'derivative' }]), frame, {});
    const d = r.overlays?.derivative;
    expect(d).toBeDefined();
    if (!d) return;
    const left = d.polylines.flat().filter((p) => p.x < -0.1);
    const right = d.polylines.flat().filter((p) => p.x > 0.1);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    for (const p of left) expect(p.y).toBeCloseTo(-1);
    for (const p of right) expect(p.y).toBeCloseTo(1);
    expect(d.polylines.length).toBe(2); // 0 点不可导 → 断笔（abs 先例口径）
  });

  it('SVG 导出：端点标记 circle 与主曲线 path 同步产出（验收补充 3）', () => {
    const el: MathPlotElement = {
      id: 'mp-pw-1',
      type: 'mathPlot',
      x: 0,
      y: 0,
      width: 480,
      height: 360,
      strokeColor: '#3B82F6',
      strokeWidth: 2,
      opacity: 1,
      equation: 'y={x<0:-1; x>0:1}',
      kind: 'piecewise',
      error: null,
      xAxis: { min: -5, max: 5 },
      equalRatio: false,
      sampleCount: 320,
      showAxis: true,
      showGrid: true,
      showLabel: true,
    };
    const svg = exportToSvg([el]);
    const circles = svg.match(/<circle[^>]*stroke="#3B82F6"[^>]*>/g) ?? [];
    expect(circles.length).toBe(2);
    expect(circles.some((c) => c.includes('fill="#ffffff"'))).toBe(true); // 空心白底
  });

  it('编辑器预览：分段方程出预览折线（模板链路）', () => {
    const p = createPreviewPolylines('y={x<0:-x; x}', validateEquation('y={x<0:-x; x}'));
    expect(p).not.toBeNull();
    expect(p!.polylines.length).toBe(1);
    const melt = createPreviewPolylines(
      'T(t)={t<2:5t-10; 2≤t<6:0; 2.5t-15}',
      validateEquation('T(t)={t<2:5t-10; 2≤t<6:0; 2.5t-15}'),
      undefined,
      { min: 0, max: 10 },
    );
    expect(melt).not.toBeNull();
    expect(melt!.polylines.length).toBe(1); // 平台段连通
  });
});

describe('预置模板（硬性验收 1）', () => {
  it('三条模板落位学段分组，插入链路零错误', () => {
    const ids = ['crystalMelt', 'taxiFare', 'piecewiseIntro'];
    for (const id of ids) {
      const tpl = EQUATION_TEMPLATES.find((t) => t.id === id);
      expect(tpl).toBeDefined();
      if (!tpl) continue;
      const v = validateEquation(tpl.equation);
      expect(v.kind).toBe('piecewise');
      const preview = createPreviewPolylines(tpl.equation, v, tpl.constants, tpl.domain);
      expect(preview).not.toBeNull();
      expect(preview!.polylines.length).toBeGreaterThan(0);
    }
  });

  it('熔化平台段水平（形状与教材图一致）', () => {
    const tpl = EQUATION_TEMPLATES.find((t) => t.id === 'crystalMelt')!;
    const v = validateEquation(tpl.equation);
    const preview = createPreviewPolylines(tpl.equation, v, undefined, tpl.domain)!;
    const plateau = preview.polylines.flat().filter((p) => p.x > 2.05 && p.x < 5.95);
    expect(plateau.length).toBeGreaterThan(10);
    for (const p of plateau) expect(p.y).toBe(0);
  });

  it('模板 domain 落元素 xAxis（piecewise 同 explicit 口径，ZOO-216）', () => {
    const tpl = EQUATION_TEMPLATES.find((t) => t.id === 'crystalMelt')!;
    const patch = mathPlotFieldsFromPayload({
      equation: tpl.equation,
      outcome: validateEquation(tpl.equation),
      ...(tpl.constants ? { constants: tpl.constants } : {}),
      domain: tpl.domain,
    });
    expect(patch.kind).toBe('piecewise');
    expect(patch.xAxis).toEqual({ min: 0, max: 10 });
  });
});
