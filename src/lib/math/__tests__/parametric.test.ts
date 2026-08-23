import { describe, expect, it } from 'vitest';
import { parseEquation } from '../parse';
import { validateEquation } from '../validate';
import { createPreviewPolylines, sampleEquation, sampleParametric, samplePolar } from '../sample';
import { PARAMETRIC_TEMPLATES } from '../templates';
import { advancedFormulaState } from '../../advancedFormula';
import { createMathPlotElement, mathPlotFieldsFromPayload } from '../../mathplotElement';
import { resolvePlotRender } from '../plot';
import { zhT } from '../../../i18n/lib';
import type { EquationDraftPayload, Polyline } from '../types';

const parametricOf = (raw: string, constants?: Record<string, number>) => {
  const r = parseEquation(raw, zhT, constants);
  if (r.kind !== 'parametric') throw new Error(`期望 parametric，得到 ${r.kind}${r.kind === 'error' ? `: ${r.message}` : ''}`);
  return r;
};

const polarOf = (raw: string, constants?: Record<string, number>) => {
  const r = parseEquation(raw, zhT, constants);
  if (r.kind !== 'polar') throw new Error(`期望 polar，得到 ${r.kind}${r.kind === 'error' ? `: ${r.message}` : ''}`);
  return r;
};

const bboxOf = (polylines: Polyline[]) => {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pl of polylines) {
    for (const p of pl) {
      xMin = Math.min(xMin, p.x);
      xMax = Math.max(xMax, p.x);
      yMin = Math.min(yMin, p.y);
      yMax = Math.max(yMax, p.y);
    }
  }
  return { xMin, xMax, yMin, yMax };
};

describe('dispatch 前置分支：parametric（ZOO-191 T4）', () => {
  it('x=cos(t),y=sin(t) → parametric，fx/fy 求值正确', () => {
    const r = parametricOf('x=cos(t),y=sin(t)');
    expect(r.fx(0)).toBeCloseTo(1, 12);
    expect(r.fy(0)).toBeCloseTo(0, 12);
    expect(r.fx(Math.PI / 2)).toBeCloseTo(0, 12);
    expect(r.fy(Math.PI / 2)).toBeCloseTo(1, 12);
    expect(r.variable).toBeUndefined(); // 参数恰为 t 时不携带（缺省约定）
  });

  it('y= 侧在前同样识别（顺序不限）；x=2,y=t 竖线段（单侧无字母）合法', () => {
    const r1 = parametricOf('y=sin(t),x=cos(t)');
    expect(r1.fx(Math.PI)).toBeCloseTo(-1, 12);
    expect(r1.fy(Math.PI)).toBeCloseTo(0, 12);
    const r2 = parametricOf('x=2,y=t');
    expect(r2.fx(5)).toBe(2);
    expect(r2.fy(5)).toBe(5);
  });

  it('任意单字母可作参数（方案 A 哲学），variable 透传', () => {
    const r = parametricOf('x=cos(u),y=sin(u)');
    expect(r.variable).toBe('u');
    expect(r.fx(0)).toBeCloseTo(1, 12);
  });

  it('常量配参数式（T1 scope 注入路径）：抛体 x=v0·cos(θ)·t', () => {
    const constants = { v0: 10, theta: Math.PI / 4, g: 9.8 };
    const r = parametricOf('x=v0*cos(theta)*t,y=v0*sin(theta)*t-0.5*g*t^2', constants);
    expect(r.fx(1)).toBeCloseTo(10 * Math.cos(Math.PI / 4), 12);
    expect(r.fy(1)).toBeCloseTo(10 * Math.sin(Math.PI / 4) - 4.9, 12);
  });

  it('未赋值希腊名 → 常量区赋值引导（不抢参数位）', () => {
    const r = parseEquation('x=cos(theta)*t,y=sin(theta)*t', zhT);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toContain('常量');
  });

  it('两侧参数字母不同 / 无参数字母 / 多字母词 → 报错', () => {
    const diff = parseEquation('x=cos(t),y=sin(u)', zhT);
    expect(diff.kind).toBe('error');
    if (diff.kind === 'error') expect(diff.message).toContain('t');

    const none = parseEquation('x=1,y=2', zhT);
    expect(none.kind).toBe('error');
    if (none.kind === 'error') expect(none.message).toContain('参数');

    const typo = parseEquation('x=cos(tt),y=sin(t)', zhT);
    expect(typo.kind).toBe('error');
    if (typo.kind === 'error') expect(typo.message).toContain('tt');
  });

  it('三段逗号 / LHS 非 x=、y= → 不进参数式分支，交回既有路径', () => {
    expect(parseEquation('x=cos(t),y=sin(t),z=t', zhT).kind).toBe('error');
    // 形不符不误伤：u=cos(t),v=sin(t) 走既有隐式路径报错（原行为不变）
    const r = parseEquation('u=cos(t),v=sin(t)', zhT);
    expect(r.kind).toBe('error');
  });

  it('括号内逗号不算顶层（log(t,2) 合法）', () => {
    const r = parametricOf('x=log(t,2),y=t');
    expect(r.fx(4)).toBeCloseTo(2, 12);
  });
});

describe('dispatch 前置分支：polar（ZOO-191 T4）', () => {
  it('r=1+cos(θ) → polar，θ 归一 theta 作参数（常量命名空间让位）', () => {
    const r = polarOf('r=1+cos(θ)');
    expect(r.fn(0)).toBeCloseTo(2, 12);
    expect(r.fn(Math.PI)).toBeCloseTo(0, 12);
    expect(r.variable).toBeUndefined(); // 缺省 theta 不携带
  });

  it('r=2 常量 → 圆（默认参数 theta）；任意单字母参数亦认可', () => {
    const circle = polarOf('r=2');
    expect(circle.fn(1.234)).toBe(2);
    const spiral = polarOf('r=1+cos(u)');
    expect(spiral.variable).toBe('u');
    expect(spiral.fn(0)).toBeCloseTo(2, 12);
  });

  it('r= 前缀外的字母 r 不受影响（回归：y=r 仍是显式函数）', () => {
    const explicit = parseEquation('y=r', zhT);
    expect(explicit.kind).toBe('explicit');
    if (explicit.kind === 'explicit') expect(explicit.variable).toBe('r');
    // x²+y²=r² 不以 r= 开头 → 既有隐式路径（三自由字母报错，原行为不变）
    expect(parseEquation('x²+y²=r²', zhT).kind).toBe('error');
  });

  it('polar 中未赋值 omega/phi / 其余字母 → 常量区赋值引导', () => {
    const greek = parseEquation('r=1+cos(ω)', zhT);
    expect(greek.kind).toBe('error');
    if (greek.kind === 'error') expect(greek.message).toContain('常量');
    const letter = parseEquation('r=1+a*cos(θ)', zhT);
    expect(letter.kind).toBe('error');
    if (letter.kind === 'error') expect(letter.message).toContain('常量');
  });

  it('常量配极坐标：r=a(1+cos(θ)) 绑定 a 后出图', () => {
    const r = polarOf('r=a*(1+cos(θ))', { a: 0.5 });
    expect(r.fn(0)).toBeCloseTo(1, 12);
    expect(r.fn(Math.PI)).toBeCloseTo(0, 12);
  });

  it('r= 空右端 → missingRhs', () => {
    const r = parseEquation('r=', zhT);
    expect(r.kind).toBe('error');
  });
});

describe('回归零变化：普通单方程不被前置分支干扰', () => {
  it('显式 / 几何 / 隐式既有分类逐字不变', () => {
    expect(parseEquation('y=x²-2x-3', zhT).kind).toBe('explicit');
    expect(parseEquation('(x-1)²+(y-2)²=9', zhT).kind).toBe('circle');
    expect(parseEquation('3x+2y=6', zhT).kind).toBe('line');
    expect(parseEquation('xy=1', zhT).kind).toBe('hyperbola');
    const explicit = parseEquation('y=4z', zhT);
    expect(explicit.kind === 'explicit' && explicit.variable).toBe('z');
    // 自由 y 按隐式整体分类：x·y−y=0 退化两直线（原行为）
    expect(parseEquation('y=xy', zhT).kind).toBe('linePair');
  });

  it('validateEquation 剥离求值函数：parametric / polar 透传参数字母', () => {
    const p = validateEquation('x=cos(u),y=sin(u)', zhT);
    expect(p).toEqual({ kind: 'parametric', variable: 'u' });
    const q = validateEquation('r=1+cos(θ)', zhT);
    expect(q).toEqual({ kind: 'polar' });
    const plain = validateEquation('r=1+cos(u)', zhT);
    expect(plain).toEqual({ kind: 'polar', variable: 'u' });
  });
});

describe('sampleParametric / samplePolar 参数域采样', () => {
  it('参数圆 x=cos(t),y=sin(t)：闭合折线，数据包围盒 ≈ [-1,1]²', () => {
    const r = sampleParametric(Math.cos, Math.sin, { xMin: 0, xMax: Math.PI * 2 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polylines.length).toBe(1);
    const bbox = bboxOf(r.polylines);
    expect(bbox.xMin).toBeCloseTo(-1, 2);
    expect(bbox.xMax).toBeCloseTo(1, 2);
    expect(bbox.yMin).toBeCloseTo(-1, 2);
    expect(bbox.yMax).toBeCloseTo(1, 2);
    // 闭合：首尾点重合
    const pl = r.polylines[0];
    expect(pl[0].x).toBeCloseTo(pl[pl.length - 1].x, 6);
    expect(pl[0].y).toBeCloseTo(pl[pl.length - 1].y, 6);
  });

  it('心形线 r=1+cos(θ)：数据包围盒 x∈[-0.25,2]、y∈[-1.299,1.299]（验收参考）', () => {
    const r = samplePolar((theta) => 1 + Math.cos(theta), { xMin: 0, xMax: Math.PI * 2 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    const bbox = bboxOf(r.polylines);
    expect(bbox.xMin).toBeCloseTo(-0.25, 2);
    expect(bbox.xMax).toBeCloseTo(2, 6);
    expect(bbox.yMin).toBeCloseTo(-1.299, 2);
    expect(bbox.yMax).toBeCloseTo(1.299, 2);
  });

  it('摆线一段完整拱：单折线不断笔，y ∈ [0,2]', () => {
    const r = sampleParametric((t) => t - Math.sin(t), (t) => 1 - Math.cos(t), { xMin: 0, xMax: Math.PI * 2 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polylines.length).toBe(1); // 尖点邻域相邻点距有限——不误杀
    const bbox = bboxOf(r.polylines);
    expect(bbox.yMin).toBeCloseTo(0, 6); // t=0 端点恰在拱底
    expect(bbox.yMax).toBeCloseTo(2, 3); // 峰值在 t=π 附近采样（离格点 ≤ 半步长）
  });

  it('李萨如 x=sin(3t),y=sin(5t)：自交曲线单折线（断笔不误杀交叉）', () => {
    const r = sampleParametric((t) => Math.sin(3 * t), (t) => Math.sin(5 * t), { xMin: 0, xMax: Math.PI * 2 }, 640);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polylines.length).toBe(1);
  });

  it('渐近线断笔：x=1/t 在 t=0 非有限断笔', () => {
    const r = sampleParametric((t) => 1 / t, (t) => t, { xMin: -1, xMax: 1 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polylines.length).toBeGreaterThanOrEqual(2);
  });

  it('域校验与显式路径同款：逆序 / 超宽 / 全无效', () => {
    expect(sampleParametric(Math.cos, Math.sin, { xMin: 5, xMax: 5 }, 320)).toEqual({ error: '定义域无效：xmin 需小于 xmax' });
    expect(sampleParametric(Math.cos, Math.sin, { xMin: 0, xMax: 2000 }, 320)).toEqual({
      error: '定义域无效：宽度需在 0.1–1000 之间',
    });
    const allInvalid = samplePolar(() => NaN, { xMin: 0, xMax: Math.PI * 2 }, 320);
    expect('error' in allInvalid).toBe(true);
  });
});

describe('视窗 xy 双向自适应（ZOO-191 T4）', () => {
  it('心形线视窗包含数据包围盒，且纵横比与卡片一致（aspect=0.75）', () => {
    const r = samplePolar((theta) => 1 + Math.cos(theta), { xMin: 0, xMax: Math.PI * 2 }, 320, 0.75);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    const bbox = bboxOf(r.polylines);
    expect(r.xMin! - 1e-9).toBeLessThanOrEqual(bbox.xMin);
    expect(r.xMax! + 1e-9).toBeGreaterThanOrEqual(bbox.xMax);
    expect(r.yMin! - 1e-9).toBeLessThanOrEqual(bbox.yMin);
    expect(r.yMax! + 1e-9).toBeGreaterThanOrEqual(bbox.yMax);
    expect((r.yMax! - r.yMin!) / (r.xMax! - r.xMin!)).toBeCloseTo(0.75, 6);
  });

  it('x 主导曲线（x=t,y=t/1000）：x 跨度主导视窗，y 仍见坐标轴上下文', () => {
    const r = sampleParametric((t) => t, (t) => t / 1000, { xMin: -10, xMax: 10 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.xMax! - r.xMin!).toBeGreaterThan(19);
    expect(r.yMin!).toBeLessThan(0);
    expect(r.yMax!).toBeGreaterThan(0);
    // aspect 修正后 y 半宽 = 0.75 × x 半宽（窄 y 数据被撑到等比视窗）
    expect((r.yMax! - r.yMin!) / (r.xMax! - r.xMin!)).toBeCloseTo(0.75, 6);
  });

  it('y 主导曲线（x=sin(t)/1000,y=t）：y 撑大视窗，aspect 一致', () => {
    const r = sampleParametric((t) => Math.sin(t) / 1000, (t) => t, { xMin: 0, xMax: Math.PI * 2 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.yMax! - r.yMin!).toBeGreaterThan(5);
    expect((r.yMax! - r.yMin!) / (r.xMax! - r.xMin!)).toBeCloseTo(0.75, 6);
  });

  it('退化常值轴（x=2,y=sin(t)）：x 轴回退最小视窗不塌缩', () => {
    const r = sampleParametric(() => 2, Math.sin, { xMin: 0, xMax: Math.PI * 2 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.xMin!).toBeLessThan(2);
    expect(r.xMax!).toBeGreaterThan(2);
  });
});

describe('管线集成：sampleEquation / 预览 / 元素工厂 / 渲染', () => {
  it('sampleEquation 分发 parametric / polar（xAxis 复用为 t/θ 域）', () => {
    const p = sampleEquation(parametricOf('x=cos(t),y=sin(t)'), { xMin: 0, xMax: Math.PI * 2, sampleCount: 320 });
    expect('error' in p).toBe(false);
    const q = sampleEquation(polarOf('r=1'), { xMin: 0, xMax: Math.PI * 2, sampleCount: 320 });
    expect('error' in q).toBe(false);
    if ('error' in q) return;
    const bbox = bboxOf(q.polylines);
    expect(bbox.xMin).toBeCloseTo(-1, 2);
    expect(bbox.xMax).toBeCloseTo(1, 2);
  });

  it('createPreviewPolylines：四类模板默认域 [0,2π] 全部出预览折线', () => {
    for (const tpl of PARAMETRIC_TEMPLATES) {
      const outcome = validateEquation(tpl.equation, zhT);
      expect(['parametric', 'polar']).toContain(outcome.kind);
      const preview = createPreviewPolylines(tpl.equation, outcome);
      expect(preview).not.toBeNull();
      expect(preview!.polylines.length).toBeGreaterThan(0);
      expect(preview!.xMin).toBeDefined();
      expect(preview!.yMax).toBeDefined();
    }
  });

  it('mathPlotFieldsFromPayload：parametric 落默认域 [0,2π] + equalRatio；payload.domain 优先', () => {
    const outcome = validateEquation('r=1+cos(θ)', zhT);
    const payload: EquationDraftPayload = { equation: 'r=1+cos(θ)', outcome };
    const fields = mathPlotFieldsFromPayload(payload);
    expect(fields.kind).toBe('polar');
    expect(fields.equalRatio).toBe(true);
    expect(fields.xAxis!.min).toBeCloseTo(0, 12);
    expect(fields.xAxis!.max).toBeCloseTo(Math.PI * 2, 12);

    const custom = mathPlotFieldsFromPayload({ ...payload, domain: { min: 0, max: Math.PI * 4 } });
    expect(custom.xAxis).toEqual({ min: 0, max: Math.PI * 4 });

    // 原位替换兜底：载荷未携带域时保持元素现值（方程微调不重置 t/θ 域）
    const fallback = mathPlotFieldsFromPayload(payload, { min: 0, max: 12.5 });
    expect(fallback.xAxis).toEqual({ min: 0, max: 12.5 });
  });

  it('createMathPlotElement：parametric 元素带默认域与常量', () => {
    const outcome = validateEquation('x=v0*t,y=0', zhT, { v0: 3 });
    const el = createMathPlotElement(
      { equation: 'x=v0*t,y=0', outcome, constants: { v0: 3 } },
      { centerX: 100, centerY: 100 },
    );
    expect(el.kind).toBe('parametric');
    expect(el.equalRatio).toBe(true);
    expect(el.xAxis.max).toBeCloseTo(Math.PI * 2, 12);
    expect(el.constants).toEqual({ v0: 3 });
  });

  it('advancedFormulaState：新 kind 点亮「公式设置」入口（T0 设计承诺）', () => {
    expect(advancedFormulaState({ kind: 'parametric' }).visible).toBe(true);
    expect(advancedFormulaState({ kind: 'polar', overlays: [] }).visible).toBe(true);
    expect(advancedFormulaState({ kind: 'explicit' }).visible).toBe(false);
  });

  it('resolvePlotRender：parametric 元素携带叠加数据时静默忽略（仅显式函数生效），主曲线照常', () => {
    const render = resolvePlotRender(
      {
        equation: 'r=1+cos(θ)',
        kind: 'polar',
        xAxis: { min: 0, max: Math.PI * 2 },
        equalRatio: true,
        sampleCount: 320,
        overlays: [{ type: 'derivative' }],
      },
      { width: 480, height: 360 },
      {},
    );
    expect(render.error).toBeUndefined();
    expect(render.polylines.length).toBeGreaterThan(0);
    expect(render.overlays).toBeUndefined();
    const bbox = bboxOf(render.polylines);
    expect(bbox.xMax).toBeCloseTo(2, 2);
  });
});
