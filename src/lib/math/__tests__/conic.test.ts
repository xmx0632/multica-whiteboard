import { describe, expect, it } from 'vitest';
import {
  buildImplicitExpression,
  classifyImplicit,
  classifyQuadratic,
  formatCoef,
  formatGeneralForm,
  formatPoint,
  hyperbolaTeachingInfo,
  isLinear,
  isQuadratic,
  lineTeachingInfo,
  parabolaTeachingInfo,
  probeLinear,
  probeQuadratic,
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

  it('非多项式 → nonlinear（sin / 三次 / |x| 伪装均不进二次分类）', () => {
    expect(classifyImplicit(fnOf((x, y) => Math.sin(x) - y))).toEqual({ kind: 'nonlinear' });
    expect(classifyImplicit(fnOf((x, y) => x * x * x - y))).toEqual({ kind: 'nonlinear' });
    expect(classifyImplicit(fnOf((x, y) => Math.abs(x) + y - 1))).toEqual({ kind: 'nonlinear' });
  });
});

describe('二次探针与校验（研究报告 §3，ZOO-147）', () => {
  it('9 点探针精确恢复系数：标准形 / 系数前置 / 变序 / 平移展开', () => {
    expect(probeQuadratic(fnOf((x, y) => 9 * x * x - 16 * y * y - 144))).toEqual({ A: 9, B: 0, C: -16, D: 0, E: 0, F: -144 });
    expect(probeQuadratic(fnOf((x, y) => 16 * y * y - 9 * x * x + 144))).toEqual({ A: -9, B: 0, C: 16, D: 0, E: 0, F: 144 });
    // (x−1)²/4−(y+2)²/9=1 通分展开：9x²−4y²−18x−16y−43=0
    expect(probeQuadratic(fnOf((x, y) => 9 * x * x - 4 * y * y - 18 * x - 16 * y - 43))).toEqual({
      A: 9, B: 0, C: -4, D: -18, E: -16, F: -43,
    });
    expect(probeQuadratic(fnOf((x, y) => x * y - 1))).toEqual({ A: 0, B: 1, C: 0, D: 0, E: 0, F: -1 });
  });

  it('探针点非有限 → null（NaN/±Inf 按非线性处理）', () => {
    expect(probeQuadratic(fnOf(() => NaN))).toBeNull();
    expect(probeQuadratic(fnOf((x, y) => (x === 1 && y === 1 ? Infinity : x * x + y - 1)))).toBeNull();
  });

  it('二次校验：多项式通过；三次 / |x| 伪装立即拆穿', () => {
    const q = probeQuadratic(fnOf((x, y) => 9 * x * x - 16 * y * y - 144))!;
    expect(isQuadratic(fnOf((x, y) => 9 * x * x - 16 * y * y - 144), q)).toBe(true);
    expect(isQuadratic(fnOf((x, y) => x * x * x + y * y - 1), { A: 0, B: 0, C: 1, D: 0, E: 0, F: -1 })).toBe(false);
    expect(isQuadratic(fnOf((x, y) => Math.abs(x) + y * y - 1), { A: 0, B: 0, C: 1, D: 0, E: 0, F: -1 })).toBe(false);
  });
});

describe('classifyQuadratic 判别式分类（B=0 轴对齐，ZOO-147）', () => {
  it('抛物线：y²=4x → 顶点原点 p=1 开口向右（axis=x）', () => {
    expect(classifyQuadratic({ A: 0, B: 0, C: 1, D: -4, E: 0, F: 0 })).toEqual({
      kind: 'parabola',
      params: { h: 0, k: 0, p: 1, axis: 'x' },
    });
  });

  it('抛物线四方向 + 平移：(y−1)²=8(x+2) → 顶点 (−2,1) p=2；x²=−4y → p=−1 开口向下', () => {
    expect(classifyQuadratic({ A: 0, B: 0, C: 1, D: -8, E: -2, F: -15 })).toEqual({
      kind: 'parabola',
      params: { h: -2, k: 1, p: 2, axis: 'x' },
    });
    expect(classifyQuadratic({ A: 1, B: 0, C: 0, D: 0, E: 4, F: 0 })).toEqual({
      kind: 'parabola',
      params: { h: 0, k: 0, p: -1, axis: 'y' },
    });
  });

  it('双曲线：9x²−16y²=144 → a=4 b=3 axis=x；等价变序 −y²+x²=1 同参', () => {
    expect(classifyQuadratic({ A: 9, B: 0, C: -16, D: 0, E: 0, F: -144 })).toEqual({
      kind: 'hyperbola',
      params: { h: 0, k: 0, a: 4, b: 3, axis: 'x' },
    });
    expect(classifyQuadratic({ A: 1, B: 0, C: -1, D: 0, E: 0, F: -1 })).toEqual({
      kind: 'hyperbola',
      params: { h: 0, k: 0, a: 1, b: 1, axis: 'x' },
    });
  });

  it('双曲线 K<0 翻转实轴：−x²+4y²=4 → y²−x²/4=1，a=1 b=2 axis=y', () => {
    expect(classifyQuadratic({ A: -1, B: 0, C: 4, D: 0, E: 0, F: -4 })).toEqual({
      kind: 'hyperbola',
      params: { h: 0, k: 0, a: 1, b: 2, axis: 'y' },
    });
  });

  it('双曲线平移：9x²−4y²−18x−16y−43=0（(x−1)²/4−(y+2)²/9=1）→ 中心 (1,−2) a=2 b=3', () => {
    expect(classifyQuadratic({ A: 9, B: 0, C: -4, D: -18, E: -16, F: -43 })).toEqual({
      kind: 'hyperbola',
      params: { h: 1, k: -2, a: 2, b: 3, axis: 'x' },
    });
  });

  it('退化形 → degenerate（相交直线 x²−y²=0 / 平行直线 x²=4 / 抛物线型缺轴向项）', () => {
    expect(classifyQuadratic({ A: 1, B: 0, C: -1, D: 0, E: 0, F: 0 })).toEqual({
      kind: 'degenerate',
      message: '该二次方程为退化曲线（如两条平行/相交直线、单点或空集），暂不支持出图',
    });
    expect(classifyQuadratic({ A: 1, B: 0, C: 0, D: 0, E: 0, F: -4 }).kind).toBe('degenerate');
    expect(classifyQuadratic({ A: 1, B: 0, C: 0, D: -2, E: 0, F: 0 }).kind).toBe('degenerate'); // x²−2x=0 → x=0/x=2
  });

  it('xy 旋转项 → unsupported（ZOO-149）', () => {
    expect(classifyQuadratic({ A: 0, B: 1, C: 0, D: 0, E: 0, F: -1 })).toEqual({
      kind: 'unsupported',
      message: '该方程含 xy 交叉项（旋转圆锥曲线），暂不支持出图',
    });
  });

  it('椭圆型一般式 → unsupported 引导标准形（ZOO-149 随旋转覆盖）', () => {
    expect(classifyQuadratic({ A: 2, B: 0, C: 3, D: 0, E: 0, F: -12 })).toEqual({
      kind: 'unsupported',
      message: '该方程为椭圆型二次方程：请改用椭圆标准形（如 x²/9+y²/4=1）后再输入',
    });
  });
});

describe('classifyImplicit 二次接入（探针 → 校验 → 判别式）', () => {
  it('等价书写全覆盖：系数前置 / 变序 / 平移形均命中同参数', () => {
    const expect916 = (f: BinaryFn) =>
      expect(classifyImplicit(f)).toEqual({ kind: 'hyperbola', params: { h: 0, k: 0, a: 4, b: 3, axis: 'x' } });
    expect916(fnOf((x, y) => 9 * x * x - 16 * y * y - 144));
    expect916(fnOf((x, y) => 144 - 9 * x * x + 16 * y * y)); // 全体 ×(−1)
    expect916(fnOf((x, y) => (3 * x / 4 + y) * (3 * x / 4 - y) - 9)); // 因式分解形
  });

  it('浮点平移展开（除不尽的分数系数）不误判', () => {
    // (x−0.5)²/4−(y+1.5)²/9=1 展开含小数系数
    const f = fnOf((x, y) => (x - 0.5) ** 2 / 4 - (y + 1.5) ** 2 / 9 - 1);
    const out = classifyImplicit(f);
    expect(out.kind).toBe('hyperbola');
    if (out.kind === 'hyperbola') {
      expect(out.params.h).toBeCloseTo(0.5, 9);
      expect(out.params.k).toBeCloseTo(-1.5, 9);
      expect(out.params.a).toBeCloseTo(2, 9);
      expect(out.params.b).toBeCloseTo(3, 9);
    }
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

describe('抛物线 / 双曲线教学参数（ZOO-147，面板只读展示）', () => {
  it('formatPoint：(1, -2) / −0 归 0', () => {
    expect(formatPoint(1, -2)).toBe('(1, -2)');
    expect(formatPoint(-0, 0.5)).toBe('(0, 0.5)');
  });

  it('抛物线 y²=4x：标准形 / 顶点 / 焦点 / 准线 / 开口', () => {
    expect(parabolaTeachingInfo({ h: 0, k: 0, p: 1, axis: 'x' })).toEqual({
      standardForm: 'y²=4x',
      vertex: '(0, 0)',
      focus: '(1, 0)',
      directrix: 'x = -1',
      opening: '向右',
    });
  });

  it('抛物线平移 + 开口向左 + 系数 ±1 省略：(y−1)²=8(x+2) / (x+3)²=−(y−0.5)', () => {
    expect(parabolaTeachingInfo({ h: -2, k: 1, p: 2, axis: 'x' })).toEqual({
      standardForm: '(y-1)²=8(x+2)',
      vertex: '(-2, 1)',
      focus: '(0, 1)',
      directrix: 'x = -4',
      opening: '向右',
    });
    const info = parabolaTeachingInfo({ h: -3, k: 0.5, p: -0.25, axis: 'y' });
    expect(info.standardForm).toBe('(x+3)²=-(y-0.5)');
    expect(info.focus).toBe('(-3, 0.25)');
    expect(info.directrix).toBe('y = 0.75');
    expect(info.opening).toBe('向下');
  });

  it('双曲线 x²/16−y²/9=1：中心 / 半轴 / 焦点 / 渐近线 / 准线 / 离心率', () => {
    expect(hyperbolaTeachingInfo({ h: 0, k: 0, a: 4, b: 3, axis: 'x' })).toEqual({
      standardForm: 'x²/16-y²/9=1',
      center: '(0, 0)',
      axes: 'a = 4, b = 3, c = 5',
      foci: '(-5, 0) 与 (5, 0)',
      asymptotes: 'y = ±0.75x',
      directrices: 'x = ±3.2',
      eccentricity: '1.25',
    });
  });

  it('双曲线平移 + 实轴 y：(y+2)²/4−(x−1)²/9=1', () => {
    const info = hyperbolaTeachingInfo({ h: 1, k: -2, a: 2, b: 3, axis: 'y' });
    expect(info.standardForm).toBe('(y+2)²/4-(x-1)²/9=1');
    expect(info.center).toBe('(1, -2)');
    expect(info.asymptotes).toBe('(x-1) = ±1.5(y+2)'); // 渐近线斜率 = a/b（对 y 解）
    expect(info.directrices).toBe('y = -2±1.1094'); // a²/c = 4/3.60555 ≈ 1.1094
    expect(info.eccentricity).toBe('1.80278');
  });

  it('双曲线 a=1 分母省略：x²−y²/4=1', () => {
    expect(hyperbolaTeachingInfo({ h: 0, k: 0, a: 1, b: 2, axis: 'x' }).standardForm).toBe('x²-y²/4=1');
  });
});
