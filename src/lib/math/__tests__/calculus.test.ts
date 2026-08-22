import { describe, expect, it } from 'vitest';
import { derivativeOf, tangentOf } from '../calculus';
import { parseEquation } from '../parse';
import { zhT } from '../../../i18n/lib';

/**
 * ZOO-189 T2 求导链单测。
 *
 * 覆盖 ZOO-186 报告 §2.1 的 12 类 PoC 表达式（多项式 / 三角复合 / 指数 / 对数 /
 * 根式 / tan / 有理 / 乘积 / 链式 / asin / abs / 常量式）—— 导函数在采样点处
 * 与数值中心差商一致（目视验收的机器化口径）；另覆盖两个 PoC 实证坑的回归：
 * 坑一（链式求导须 simplify 中转）、坑二（tan 导数含 sec，须可回灌解析）。
 */

/** 解析出主函数 f（显式路径），供差商对照。 */
function explicitFn(equation: string, constants?: Record<string, number>): (x: number) => number {
  const r = parseEquation(equation, zhT, constants);
  if (r.kind !== 'explicit') throw new Error(`not explicit: ${equation}`);
  return r.fn;
}

/** 导函数 vs 中心差商（O(h²)，相对容差 1e-3——陡峭函数的浮点噪声余量）。 */
function expectMatchesDifferenceQuotient(
  dfn: (x: number) => number,
  fn: (x: number) => number,
  xs: number[],
): void {
  for (const x of xs) {
    const h = 1e-5 * Math.max(1, Math.abs(x));
    const numeric = (fn(x + h) - fn(x - h)) / (2 * h);
    expect(
      Math.abs(dfn(x) - numeric),
      `d/dx at x=${x}: got ${dfn(x)}, difference quotient ${numeric}`,
    ).toBeLessThan(1e-3 * Math.max(1, Math.abs(numeric)));
  }
}

describe('derivativeOf：12 类 PoC 表达式（vs 数值差商）', () => {
  const cases: { name: string; equation: string; xs: number[] }[] = [
    { name: '多项式', equation: 'x^3-2x+1', xs: [0.7, -1.3, 2.1] },
    { name: '三角复合', equation: 'sin(2x+1)', xs: [0.4, -0.9, 1.6] },
    { name: '指数 exp', equation: 'exp(x)', xs: [0.9, -0.5, 1.4] },
    { name: '指数 e^x', equation: 'e^x', xs: [1.1, -0.7] },
    { name: '对数', equation: 'log(x^2+1)', xs: [1.2, -0.8, 0.3] },
    { name: '根式', equation: 'sqrt(x^2+1)', xs: [0.8, -1.5, 2.2] },
    { name: 'tan（坑二：sec 输出）', equation: 'tan(x)', xs: [0.5, -0.4, 1.2] },
    { name: '有理', equation: '(x^2+1)/(x-1)', xs: [2.5, -1.8, 0.2] },
    { name: '乘积', equation: 'x^2*sin(x)', xs: [0.6, -1.1, 2.4] },
    { name: '链式 sin(x^2)', equation: 'sin(x^2)', xs: [0.9, -0.6, 1.7] },
    { name: '链式 exp(-x^2/2)', equation: 'exp(-x^2/2)', xs: [0.3, -1.2, 2.0] },
    { name: 'asin', equation: 'asin(x)', xs: [0.3, -0.5, 0.75] },
    { name: 'abs', equation: 'abs(x)', xs: [1.7, -2.3] },
  ];

  for (const c of cases) {
    it(`${c.name}：${c.equation}`, () => {
      const d = derivativeOf(c.equation);
      expect(d.ok).toBe(true);
      if (!d.ok) return;
      expectMatchesDifferenceQuotient(d.fn, explicitFn(c.equation), c.xs);
    });
  }

  it('常量式：A·sin(ωx+φ) 常量注入求值（A/ω/φ 视为常数）', () => {
    // 常量键为存储层 ASCII 名（小写——方程归一化小写后与键匹配，T1 口径）
    const constants = { a: 2, omega: 3, phi: 0.5 };
    const d = derivativeOf('A*sin(omega*x+phi)', { constants });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expectMatchesDifferenceQuotient(d.fn, explicitFn('A*sin(omega*x+phi)', constants), [0.8, -0.3, 1.9]);
    // 解析上 d/dx = A·ω·cos(ωx+φ)：抽查一点精确值
    const x = 0.8;
    expect(d.fn(x)).toBeCloseTo(2 * 3 * Math.cos(3 * 0.8 + 0.5), 10);
  });

  it('常量值变化不换编译产物：同表达式不同常量值，求值随值走', () => {
    const d1 = derivativeOf('A*sin(x)', { constants: { a: 1 } });
    const d2 = derivativeOf('A*sin(x)', { constants: { a: 3 } });
    expect(d1.ok && d2.ok).toBe(true);
    if (!d1.ok || !d2.ok) return;
    expect(d1.expr).toBe(d2.expr); // 表达式（缓存键）不变
    expect(d1.fn(0.5)).toBeCloseTo(Math.cos(0.5), 10);
    expect(d2.fn(0.5)).toBeCloseTo(3 * Math.cos(0.5), 10);
  });
});

describe('derivativeOf：PoC 两坑回归', () => {
  it('坑一：链式求导（二阶）安全——expr 为 simplify 产物，可回灌再求导', () => {
    for (const eq of ['sin(x^2)', 'x^2*sin(x)', '(x^2+1)/(x-1)', 'tan(x)']) {
      const d1 = derivativeOf(eq);
      expect(d1.ok, `d1 of ${eq}`).toBe(true);
      if (!d1.ok) continue;
      // 二阶：对简化产物回灌求导链（坑一要求 simplify 中转——本模块恒简化）
      const d2 = derivativeOf(d1.expr);
      expect(d2.ok, `d2 of ${eq}`).toBe(true);
      if (!d2.ok) continue;
      // 二阶导与数值二阶差商一致（一阶差商对 d1.fn）
      for (const x of [0.7, -0.4, 1.3]) {
        const h = 1e-4 * Math.max(1, Math.abs(x));
        const numeric2 = (d1.fn(x + h) - d1.fn(x - h)) / (2 * h);
        expect(Math.abs(d2.fn(x) - numeric2)).toBeLessThan(5e-3 * Math.max(1, Math.abs(numeric2)));
      }
    }
  });

  it('坑二：tan 导数表达式含 sec 且可回灌项目解析管线（白名单已扩）', () => {
    const d = derivativeOf('tan(x)');
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.expr).toContain('sec');
    // sec/csc/cot 直接输入也可解析（mathjs 原生可求值，白名单不再拦截）
    for (const eq of ['sec(x)', 'csc(x)', 'cot(x)', 'y=sec(x)^2']) {
      const r = parseEquation(eq);
      expect(r.kind, `${eq} should parse explicit`).toBe('explicit');
    }
  });
});

describe('derivativeOf：失败分支与不可导点', () => {
  it('非显式函数（几何 / 隐式 / 欠定）→ notExplicit', () => {
    for (const eq of ['x^2+y^2=4', '3x+2y=6', 'x^2=4p', 'A*sin(x)']) {
      const d = derivativeOf(eq, { constants: {} });
      expect(d).toEqual({ ok: false, reason: 'notExplicit' });
    }
  });

  it('abs 不可导点 x=0 → NaN（采样断笔天然处理，无特殊逻辑）', () => {
    const d = derivativeOf('abs(x)');
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(Number.isNaN(d.fn(0))).toBe(true);
    expect(d.fn(2)).toBe(1);
    expect(d.fn(-2)).toBe(-1);
  });
});

describe('tangentOf：切线演示数据', () => {
  const f = (x: number) => x * x;
  const df = (x: number) => 2 * x;

  it('域内切点：直线过 (x₀, f(x₀))、斜率 f′(x₀)、两端贯穿定义域', () => {
    const tg = tangentOf(f, df, 1.5, -10, 10);
    expect(tg).not.toBeNull();
    if (!tg) return;
    expect(tg.x0).toBe(1.5);
    expect(tg.y0).toBe(2.25);
    expect(tg.slope).toBe(3);
    // 折线是直线：中点也满足 y = y₀ + k(x−x₀)
    const [a, b] = tg.polyline;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    expect(my).toBeCloseTo(2.25 + 3 * (mx - 1.5), 10);
    // 两端越出定义域（贯穿边缘，卡片裁剪）
    expect(a.x).toBeLessThan(-10);
    expect(b.x).toBeGreaterThan(10);
  });

  it('x₀ 越出定义域 / 非有限切点 → null（不绘制、不报错）', () => {
    expect(tangentOf(f, df, 11, -10, 10)).toBeNull();
    expect(tangentOf(f, df, -10.5, -10, 10)).toBeNull();
    expect(tangentOf(f, () => NaN, 1, -10, 10)).toBeNull();
    expect(tangentOf(() => NaN, df, 1, -10, 10)).toBeNull();
  });
});
