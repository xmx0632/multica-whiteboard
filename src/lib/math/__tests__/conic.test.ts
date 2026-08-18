import { describe, expect, it } from 'vitest';
import {
  buildImplicitExpression,
  classifyImplicit,
  formatCoef,
  formatGeneralForm,
  isLinear,
  lineTeachingInfo,
  probeLinear,
  splitTopLevelEquals,
  type BinaryFn,
} from '../conic';

describe('splitTopLevelEquals（顶层等号切分）', () => {
  it('恰一个顶层等号 → 两侧', () => {
    expect(splitTopLevelEquals('x/2-y=1')).toEqual({ lhs: 'x/2-y', rhs: '1' });
    expect(splitTopLevelEquals('6=3x+2y')).toEqual({ lhs: '6', rhs: '3x+2y' });
    expect(splitTopLevelEquals('(x)=1')).toEqual({ lhs: '(x)', rhs: '1' });
  });

  it('括号内等号不算顶层 → 零个顶层等号 → null', () => {
    expect(splitTopLevelEquals('2*y')).toBeNull();
    expect(splitTopLevelEquals('(x=1)')).toBeNull();
  });

  it('多个顶层等号 / 某侧为空 → null', () => {
    expect(splitTopLevelEquals('x==3')).toBeNull();
    expect(splitTopLevelEquals('=3')).toBeNull();
    expect(splitTopLevelEquals('3=')).toBeNull();
    expect(splitTopLevelEquals('sin(x)=y=(x)')).toBeNull();
  });

  it('F 表达式构造：两侧括号包裹防优先级错位', () => {
    expect(buildImplicitExpression('x+1', '2')).toBe('(x+1)-(2)');
  });
});

// 探针测试用纯 JS 求值器（conic.ts 不依赖 mathjs 的契约由本文件固化）
const fnOf = (expr: (x: number, y: number) => number): BinaryFn => expr;

describe('线性探针与校验（研究报告 §2.1）', () => {
  it('3x+2y=6 → a=3,b=2,c=6；x/2−y=1 → 分数系数精确恢复', () => {
    expect(probeLinear(fnOf((x, y) => 3 * x + 2 * y - 6))).toEqual({ a: 3, b: 2, c: 6 });
    expect(probeLinear(fnOf((x, y) => x / 2 - y - 1))).toEqual({ a: 0.5, b: -1, c: 1 });
  });

  it('线性校验通过；二次 / 非线性立即拆穿', () => {
    const line = probeLinear(fnOf((x, y) => 2 * (x + y) - (3 * x - 4)));
    expect(isLinear(fnOf((x, y) => 2 * (x + y) - (3 * x - 4)), line)).toBe(true);
    expect(isLinear(fnOf((x, y) => x * x + y * y - 9), probeLinear(fnOf((x, y) => x * x + y * y - 9)))).toBe(false);
    expect(isLinear(fnOf((x, y) => Math.sin(x) - y), probeLinear(fnOf((x, y) => Math.sin(x) - y)))).toBe(false);
  });

  it('|x| 型伪装被负象限校验点拆穿', () => {
    const f = fnOf((x, y) => Math.abs(x) + y - 1); // 正校验点可过、(−2,−3) 必露馅
    expect(isLinear(f, probeLinear(f))).toBe(false);
  });

  it('极端系数（R1：1e-6 / 1e+6）浮点噪声不误判', () => {
    const tiny = fnOf((x, y) => 1e-6 * x + y - 1);
    expect(isLinear(tiny, probeLinear(tiny))).toBe(true);
    const huge = fnOf((x, y) => 1e6 * x + 2e6 * y - 3e6);
    expect(isLinear(huge, probeLinear(huge))).toBe(true);
  });

  it('求值非有限（NaN/±Inf）判非线性', () => {
    expect(isLinear(fnOf(() => NaN), { a: 1, b: 1, c: 1 })).toBe(false);
    expect(isLinear(fnOf((x, y) => (x === 2 ? Infinity : x + y)), { a: 1, b: 1, c: 0 })).toBe(false);
  });
});

describe('classifyImplicit（分类分流）', () => {
  it('线性 → line（竖线 b=0 并入 line）', () => {
    expect(classifyImplicit(fnOf((x, y) => 3 * x + 2 * y - 6))).toEqual({ kind: 'line', params: { a: 3, b: 2, c: 6 } });
    expect(classifyImplicit(fnOf((x) => x - 3))).toEqual({ kind: 'line', params: { a: 1, b: 0, c: 3 } });
  });

  it('a=b=0 常数等式：恒真 / 恒假分别给出教学文案', () => {
    expect(classifyImplicit(fnOf(() => 0))).toEqual({ kind: 'degenerate', message: '该等式恒成立（化简后为 0=0），不表示任何曲线' });
    expect(classifyImplicit(fnOf(() => -1))).toEqual({ kind: 'degenerate', message: '该等式恒不成立（化简后左右两侧不相等），无图像' });
  });

  it('非线性 → nonlinear（ZOO-147 二次分类器的接入位）', () => {
    expect(classifyImplicit(fnOf((x, y) => x * x - y * y - 1))).toEqual({ kind: 'nonlinear' });
    expect(classifyImplicit(fnOf((x, y) => y * y - 4 * x))).toEqual({ kind: 'nonlinear' });
  });
});

describe('直线教学参数（面板展示）', () => {
  it('斜率 / 截距：3x+2y=6 → k=−1.5、y 截距 3、x 截距 2', () => {
    expect(lineTeachingInfo({ a: 3, b: 2, c: 6 })).toEqual({ slope: -1.5, yIntercept: 3, xIntercept: 2, verticalX: null });
  });

  it('竖线：斜率不存在，verticalX=c/a', () => {
    expect(lineTeachingInfo({ a: 1, b: 0, c: 3 })).toEqual({ slope: null, yIntercept: null, xIntercept: 3, verticalX: 3 });
    expect(lineTeachingInfo({ a: 2, b: 0, c: 6 })?.verticalX).toBe(3);
  });

  it('水平线：k=0、y 截距 c/b、x 截距不存在', () => {
    expect(lineTeachingInfo({ a: 0, b: 2, c: 4 })).toEqual({ slope: 0, yIntercept: 2, xIntercept: null, verticalX: null });
  });

  it('formatCoef：有效数字 / 去尾零 / −0 归 0', () => {
    expect(formatCoef(3)).toBe('3');
    expect(formatCoef(-1.5)).toBe('-1.5');
    expect(formatCoef(1 / 3)).toBe('0.333333');
    expect(formatCoef(0.1 + 0.2)).toBe('0.3');
    expect(formatCoef(-0)).toBe('0');
    expect(formatCoef(1000000)).toBe('1000000');
  });

  it('formatGeneralForm：首项转正 / ±1 省略 / 竖线水平线特形', () => {
    expect(formatGeneralForm({ a: 3, b: 2, c: 6 })).toBe('3x+2y=6');
    expect(formatGeneralForm({ a: -1, b: 2, c: -4 })).toBe('x-2y=4'); // −x+2y=−4 全体 ×(−1)
    expect(formatGeneralForm({ a: 0.5, b: -1, c: 1 })).toBe('0.5x-y=1');
    expect(formatGeneralForm({ a: 1, b: 0, c: 3 })).toBe('x=3');
    expect(formatGeneralForm({ a: 2, b: 0, c: 6 })).toBe('x=3');
    expect(formatGeneralForm({ a: 0, b: 2, c: 4 })).toBe('y=2');
    expect(formatGeneralForm({ a: 1, b: 1, c: 0 })).toBe('x+y=0');
  });
});
