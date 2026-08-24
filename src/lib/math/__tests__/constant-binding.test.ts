/**
 * ZOO-188（T1 常量绑定）单测：
 * - normalize：希腊 / 下标映射（θ→theta、ω→omega、φ→phi、₀-₉→0-9），
 *   常量名归一（normalizeConstantKey）与显示还原（constantDisplayName）互逆；
 * - parse 符号三分法：常量集空 = 现状逐字节一致（既有欠定 / 拦截文案不变）；
 *   常量剔除后恰一自变量 → explicit（求值正确）；部分赋值 → 欠定引导常量文案；
 *   未赋值多字母 → 拼写拦截；自变量与常量同名时自变量优先；
 * - 链路透传：validateEquation / createPreviewPolylines / resolvePlotRender
 *   （渲染 sig 含常量，改值重采样、同内容异键序命中）/ 收敛与元素工厂。
 */
import { describe, expect, it } from 'vitest';
import { constantDisplayName, normalizeConstantKey, normalizeEquation } from '../normalize';
import { parseEquation } from '../parse';
import { validateEquation } from '../validate';
import { createPreviewPolylines, sampleExplicit } from '../sample';
import { resolvePlotRender } from '../plot';
import { ADVANCED_TEMPLATES, EQUATION_TEMPLATES } from '../templates';
import { convergeEquationCommit, createMathPlotElement, mathPlotFieldsFromPayload } from '../../mathplotElement';
import { zhT } from '../../../i18n/lib';
import type { EquationDraftPayload } from '../types';

const explicitFn = (raw: string, constants?: Record<string, number>) => {
  const r = parseEquation(raw, zhT, constants);
  if (r.kind !== 'explicit') throw new Error(`期望 explicit，得到 ${r.kind}: ${r.kind === 'error' ? r.message : JSON.stringify(r)}`);
  return r;
};
const errorMessage = (raw: string, constants?: Record<string, number>) => {
  const r = parseEquation(raw, zhT, constants);
  if (r.kind !== 'error') throw new Error(`期望 error，得到 ${r.kind}`);
  return r.message;
};

describe('normalizeEquation 希腊 / 下标映射（ZOO-188）', () => {
  it('θ/ω/φ → theta/omega/phi（含大写与 ϕ 直立形）', () => {
    expect(normalizeEquation('y=sin(θ)')).toBe('y=sin(theta)');
    expect(normalizeEquation('y=Θ')).toBe('y=theta');
    expect(normalizeEquation('y=φ')).toBe('y=phi');
    expect(normalizeEquation('y=ϕ')).toBe('y=phi');
    expect(normalizeEquation('y=ω')).toBe('y=omega');
    expect(normalizeEquation('y=Ω*t')).toBe('y=omega*t');
  });

  it('模板 y=A·sin(ωx+φ) 归一为 ASCII（ωx 邻接拆 omega*x）', () => {
    expect(normalizeEquation('y=A·sin(ωx+φ)')).toBe('y=a*sin(omega*x+phi)');
    expect(normalizeEquation('x(t)=A*cos(ωt+φ)')).toBe('x(t)=a*cos(omega*t+phi)');
  });

  it('下标数字并入标识符名（v₀ → v0、a₁₂ → a12）', () => {
    expect(normalizeEquation('y=v₀*t')).toBe('y=v0*t');
    expect(normalizeEquation('y=x₂')).toBe('y=x2');
    expect(normalizeEquation('y=a₀+a₁₂')).toBe('y=a0+a12');
  });

  it('既有翻译不受影响（π / 上标 / √ 抽样回归）', () => {
    expect(normalizeEquation('y=2πx')).toBe('y=2pi*x');
    expect(normalizeEquation('y=x²')).toBe('y=x^2');
    expect(normalizeEquation('y=√(x+1)')).toBe('y=sqrt(x+1)');
  });
});

describe('常量名归一与显示还原（存储层 ASCII ↔ 显示层原貌）', () => {
  it('normalizeConstantKey：希腊 / 下标 / 大小写 / 空白', () => {
    expect(normalizeConstantKey('θ')).toBe('theta');
    expect(normalizeConstantKey('v₀')).toBe('v0');
    expect(normalizeConstantKey('A')).toBe('a');
    expect(normalizeConstantKey('Ω')).toBe('omega');
    expect(normalizeConstantKey(' m ')).toBe('m');
    expect(normalizeConstantKey('k₂')).toBe('k2');
  });

  it('constantDisplayName：theta→θ、v0→v₀、a12→a₁₂；非希腊名原样', () => {
    expect(constantDisplayName('theta')).toBe('θ');
    expect(constantDisplayName('omega')).toBe('ω');
    expect(constantDisplayName('phi')).toBe('φ');
    expect(constantDisplayName('v0')).toBe('v₀');
    expect(constantDisplayName('a12')).toBe('a₁₂');
    expect(constantDisplayName('g')).toBe('g');
    expect(constantDisplayName('m')).toBe('m');
  });
});

describe('parseEquation 符号三分法（ZOO-188）', () => {
  it('常量集空 = 现状逐字节一致（欠定文案不变；空字典 ≡ 缺省）', () => {
    const msg = '方程包含多个自变量（a、w、x、p）——请只保留一个字母作为自变量（如 y=2x）';
    expect(errorMessage('y=A*sin(w*x+p)')).toBe(msg);
    expect(errorMessage('y=A*sin(w*x+p)', {})).toBe(msg);
    expect(parseEquation('y=A*sin(w*x+p)', zhT, {}).kind).toBe('error');
  });

  it('常量补齐 → explicit 且求值正确（scope 多常量注入）', () => {
    // A=1、w=2、p=0 ⟺ y=sin(2x)
    const r = explicitFn('y=A*sin(w*x+p)', { a: 1, w: 2, p: 0 });
    expect(r.variable).toBeUndefined(); // 自变量恰为 x，不携带
    expect(r.fn(0)).toBeCloseTo(0);
    expect(r.fn(Math.PI / 4)).toBeCloseTo(1);
    expect(r.fn(Math.PI / 2)).toBeCloseTo(0);
  });

  it('希腊原文公式绑定常量出图（模板 y=A·sin(ωx+φ)）', () => {
    const r = explicitFn('y=A·sin(ωx+φ)', { a: 2, omega: 1, phi: 0 });
    expect(r.fn(Math.PI / 2)).toBeCloseTo(2);
  });

  it('物理式自变量识别（x(t)=A·cos(ωt+φ) → variable=t）', () => {
    const r = explicitFn('x(t)=A*cos(ωt+φ)', { a: 2, omega: 1, phi: 0 });
    expect(r.variable).toBe('t');
    expect(r.fn(0)).toBeCloseTo(2);
    expect(r.fn(Math.PI)).toBeCloseTo(-2);
  });

  it('部分赋值 → 欠定引导常量文案（列出未赋值符号）', () => {
    const msg = errorMessage('y=A*sin(w*x+p)', { a: 1 });
    expect(msg).toContain('方程仍有未赋值符号（w、x、p）');
    expect(msg).toContain('常量');
  });

  it('未赋值希腊名 → 常量赋值引导（非拼写错误、不抢自变量位）', () => {
    // 模板未赋值初始态：不是「无法识别符号 omega」
    expect(errorMessage('y=A·sin(ωx+φ)')).toContain('方程仍有未赋值符号（a、omega、x、phi）');
    expect(errorMessage('y=A·sin(ωx+φ)').endsWith('常量区为其赋值，或只保留一个字母作为自变量')).toBe(true);
    // 即使希腊名是唯一"多余"符号（自变量位另有 x），同样引导赋值
    expect(errorMessage('y=sin(omega*x)')).toContain('方程仍有未赋值符号（omega、x）');
    // 孤立希腊名不作自变量（y=ω ≠ 恒等线，而是缺常量赋值）
    expect(errorMessage('y=ω')).toContain('方程仍有未赋值符号（omega）');
    expect(errorMessage('y=omega*x', { a: 1 })).toContain('方程仍有未赋值符号（omega、x）');
  });

  it('未赋值非希腊多字母 → 拼写拦截；已赋值多字母（omega/theta）放行', () => {
    expect(errorMessage('y=foo')).toBe('无法识别符号 “foo”——请检查拼写，变量请用单个字母（如 y=2z）');
    expect(errorMessage('y=omega+foo', { omega: 1 })).toBe('无法识别符号 “foo”——请检查拼写，变量请用单个字母（如 y=2z）');
    expect(explicitFn('y=omega*x', { omega: 3 }).fn(2)).toBeCloseTo(6);
    expect(explicitFn('y=theta', { theta: 0.5 }).fn(9)).toBeCloseTo(0.5);
    expect(explicitFn('y=ω*x', { omega: 3 }).fn(2)).toBeCloseTo(6);
  });

  it('全部字母已赋值 → 常数函数；自变量与常量同名 → 自变量优先', () => {
    expect(explicitFn('y=a', { a: 5 }).fn(3)).toBeCloseTo(5);
    // x 既被扫掠又被赋常量：scope 常量先行、自变量后注入覆盖
    expect(explicitFn('y=a*x', { a: 2, x: 99 }).fn(3)).toBeCloseTo(6);
  });

  it('隐式路径不受常量影响（两元方程仍按 x/y 容量裁决）', () => {
    expect(parseEquation('x+t=3').kind).toBe('line');
    expect(parseEquation('x+t=3', zhT, { t: 5 }).kind).toBe('line');
    // 隐式路径不参与常量：希腊名按多字母词拦截（T1 范围外，干净报错优于误分类）
    expect(parseEquation('omega*x+t=3', zhT, { omega: 2 }).kind).toBe('error');
  });
});

describe('求值与采样链路（scope 注入）', () => {
  it('sampleExplicit 对常量公式采样正确（y=A·sin(w·x+p) ⟺ sin(2x)）', () => {
    const { fn } = explicitFn('y=A*sin(w*x+p)', { a: 1, w: 2, p: 0 });
    const sampled = sampleExplicit(fn, { xMin: 0, xMax: Math.PI }, 5);
    expect('error' in sampled).toBe(false);
    if (!('error' in sampled)) {
      // 5 点采样 x = 0, π/4, π/2, 3π/4, π → sin(2x) = 0, 1, 0, −1, 0
      const ys = sampled.polylines[0].map((p) => p.y);
      expect(ys[0]).toBeCloseTo(0);
      expect(ys[1]).toBeCloseTo(1);
      expect(ys[2]).toBeCloseTo(0);
      expect(ys[3]).toBeCloseTo(-1);
      expect(ys[4]).toBeCloseTo(0);
    }
  });

  it('validateEquation 透传 constants（variable 随常量解析）', () => {
    expect(validateEquation('y=A*sin(w*x+p)', zhT, { a: 1, w: 2, p: 0 }).kind).toBe('explicit');
    expect(validateEquation('y=A*sin(w*x+p)', zhT, { a: 1 }).kind).toBe('error');
    const r = validateEquation('x(t)=a*cos(omega*t+phi)', zhT, { a: 1, omega: 1, phi: 0 });
    expect(r).toEqual({ kind: 'explicit', variable: 't' });
  });

  it('createPreviewPolylines：无常量为 null，绑定常量后出折线', () => {
    const noConst = validateEquation('y=A*sin(w*x+p)', zhT, {});
    expect(createPreviewPolylines('y=A*sin(w*x+p)', noConst, {})).toBeNull();
    const withConst = validateEquation('y=A*sin(w*x+p)', zhT, { a: 1, w: 2, p: 0 });
    const preview = createPreviewPolylines('y=A*sin(w*x+p)', withConst, { a: 1, w: 2, p: 0 });
    expect(preview).not.toBeNull();
    expect(preview?.polylines.length).toBeGreaterThan(0);
  });
});

describe('渲染缓存签名含常量（resolvePlotRender）', () => {
  const frame = { width: 480, height: 360 };
  const specOf = (constants: Record<string, number> | undefined, equation = 'y=a*x') => ({
    equation,
    kind: 'explicit' as const,
    xAxis: { min: -1, max: 1 },
    equalRatio: false,
    sampleCount: 160,
    ...(constants !== undefined ? { constants } : {}),
  });

  it('常量改值 → 签名变 → 重采样出不同折线；同输入命中缓存', () => {
    const key = {};
    const r1 = resolvePlotRender(specOf({ a: 1 }), frame, key);
    expect(resolvePlotRender(specOf({ a: 1 }), frame, key)).toBe(r1); // 同输入命中缓存条目
    const r2 = resolvePlotRender(specOf({ a: 2 }), frame, key);
    expect(r2).not.toBe(r1);
    expect(r1.polylines).not.toEqual(r2.polylines);
  });

  it('同内容异键序 → 同签名命中缓存（键序规范化）', () => {
    const key = {};
    const r1 = resolvePlotRender(specOf({ a: 1, w: 5 }), frame, key);
    const r2 = resolvePlotRender(specOf({ w: 5, a: 1 }), frame, key);
    expect(r2).toBe(r1);
  });

  it('常量缺省 → 与现状同路径（无 constants 键不报错）', () => {
    const r = resolvePlotRender(specOf(undefined, 'y=2*x'), frame, {});
    expect(r.error).toBeUndefined();
    expect(r.polylines.length).toBeGreaterThan(0);
  });
});

describe('高级面板模板与元素链路（ZOO-188）', () => {
  it('新模板只进高级面板、不与 19 模板重叠', () => {
    const ids = new Set(EQUATION_TEMPLATES.map((t) => t.id));
    const eqs = new Set(EQUATION_TEMPLATES.map((t) => t.equation));
    for (const tpl of ADVANCED_TEMPLATES) {
      expect(ids.has(tpl.id), tpl.id).toBe(false);
      expect(eqs.has(tpl.equation), tpl.equation).toBe(false);
    }
    expect(ADVANCED_TEMPLATES.some((t) => t.equation === 'y=A·sin(ωx+φ)')).toBe(true);
  });

  it('模板方程：无常量欠定，绑定常量后 explicit', () => {
    const tpl = ADVANCED_TEMPLATES[0];
    expect(validateEquation(tpl.equation, zhT, {}).kind).toBe('error');
    expect(validateEquation(tpl.equation, zhT, { a: 1, omega: 2, phi: 0 }).kind).toBe('explicit');
  });

  it('mathPlotFieldsFromPayload：常量全量快照 / 空字典显式清空 / 缺省不触碰', () => {
    const payload = (constants?: Record<string, number>): EquationDraftPayload => ({
      equation: 'y=A*sin(w*x+p)',
      outcome: { kind: 'explicit' },
      ...(constants !== undefined ? { constants } : {}),
    });
    const withConst = mathPlotFieldsFromPayload(payload({ a: 1, omega: 2 }));
    expect(withConst.constants).toEqual({ a: 1, omega: 2 });
    expect(withConst.constants).not.toBe(payload({ a: 1, omega: 2 }).constants); // 拷贝非引用
    expect(mathPlotFieldsFromPayload(payload({})).constants).toEqual({});
    expect(mathPlotFieldsFromPayload(payload()).constants).toBeUndefined();
  });

  it('createMathPlotElement：常量落元素；无常量不落空壳键', () => {
    const place = { centerX: 0, centerY: 0 };
    const withConst = createMathPlotElement(
      { equation: 'y=A*sin(w*x+p)', outcome: { kind: 'explicit' }, constants: { a: 1, w: 2, p: 0 } },
      place,
    );
    expect(withConst.constants).toEqual({ a: 1, w: 2, p: 0 });
    const without = createMathPlotElement({ equation: 'y=sin(x)', outcome: { kind: 'explicit' } }, place);
    expect('constants' in without).toBe(false);
  });

  it('convergeEquationCommit：按元素常量收敛（不误判回滚）', () => {
    const converged = convergeEquationCommit('y=A*sin(w*x+p)', zhT, { a: 1, w: 2, p: 0 });
    expect(converged.fields?.kind).toBe('explicit');
    const rejected = convergeEquationCommit('y=A*sin(w*x+p)');
    expect(rejected.fields).toBeNull();
    expect(rejected.error).toContain('多个自变量');
  });
});
