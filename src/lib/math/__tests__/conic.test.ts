import { describe, expect, it } from 'vitest';
import {
  buildImplicitExpression,
  classifyImplicit,
  classifyQuadratic,
  ellipseTeachingInfo,
  formatAngle,
  formatCoef,
  formatGeneralForm,
  formatPoint,
  hyperbolaTeachingInfo,
  isLinear,
  isQuadratic,
  linePairTeachingInfo,
  lineTeachingInfo,
  parabolaTeachingInfo,
  pointTeachingInfo,
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

  it('退化相交直线 → linePair（x²−y²=0 → y=±x）', () => {
    expect(classifyQuadratic({ A: 1, B: 0, C: -1, D: 0, E: 0, F: 0 })).toEqual({
      kind: 'linePair',
      params: {
        lines: [
          { a: 1, b: -1, c: 0 },
          { a: 1, b: 1, c: 0 },
        ],
        mode: 'intersecting',
      },
    });
  });

  it('退化相交直线（平移）：(x−1)²−(y+2)²=0 → x−y=3 与 x+y=−1', () => {
    // (x−1)²−(y+2)²=0 展开：x²−y²−2x−4y−3=0
    expect(classifyQuadratic({ A: 1, B: 0, C: -1, D: -2, E: -4, F: -3 })).toEqual({
      kind: 'linePair',
      params: {
        lines: [
          { a: 1, b: -1, c: 3 },
          { a: 1, b: 1, c: -1 },
        ],
        mode: 'intersecting',
      },
    });
  });

  it('退化平行直线 → linePair（x²=4 → x=±2；x²−2x=0 → x=0/x=2；4x²=9 → x=±1.5）', () => {
    expect(classifyQuadratic({ A: 1, B: 0, C: 0, D: 0, E: 0, F: -4 })).toEqual({
      kind: 'linePair',
      params: {
        lines: [
          { a: 1, b: 0, c: -2 },
          { a: 1, b: 0, c: 2 },
        ],
        mode: 'parallel',
      },
    });
    expect(classifyQuadratic({ A: 1, B: 0, C: 0, D: -2, E: 0, F: 0 })).toEqual({
      kind: 'linePair',
      params: {
        lines: [
          { a: 1, b: 0, c: 0 },
          { a: 1, b: 0, c: 2 },
        ],
        mode: 'parallel',
      },
    });
    expect(classifyQuadratic({ A: 4, B: 0, C: 0, D: 0, E: 0, F: -9 })).toEqual({
      kind: 'linePair',
      params: {
        lines: [
          { a: 1, b: 0, c: -1.5 },
          { a: 1, b: 0, c: 1.5 },
        ],
        mode: 'parallel',
      },
    });
  });

  it('退化重合直线 → linePair 单线（(x−1)²=0 → x=1）', () => {
    expect(classifyQuadratic({ A: 1, B: 0, C: 0, D: -2, E: 0, F: 1 })).toEqual({
      kind: 'linePair',
      params: { lines: [{ a: 1, b: 0, c: 1 }], mode: 'coincident' },
    });
  });

  it('退化单点 → point（x²+y²=0 → (0,0)；平移 (x−1)²+(y+2)²=0 → (1,−2)）', () => {
    expect(classifyQuadratic({ A: 1, B: 0, C: 1, D: 0, E: 0, F: 0 })).toEqual({ kind: 'point', params: { x: 0, y: 0 } });
    // (x−1)²+(y+2)²=0 展开：x²+y²−2x+4y+5=0
    expect(classifyQuadratic({ A: 1, B: 0, C: 1, D: -2, E: 4, F: 5 })).toEqual({ kind: 'point', params: { x: 1, y: -2 } });
  });

  it('空集 → degenerate 教学文案（椭圆型 x²+y²=−1 / 抛物线型 x²=−4、y²+4=0）', () => {
    expect(classifyQuadratic({ A: 1, B: 0, C: 1, D: 0, E: 0, F: 1 })).toEqual({
      kind: 'degenerate',
      message: '该方程为空集：左侧恒正（或恒负）、无法等于 0，实数平面内无图像（如 x²+y²=−1）',
    });
    expect(classifyQuadratic({ A: 1, B: 0, C: 0, D: 0, E: 0, F: 4 })).toEqual({
      kind: 'degenerate',
      message: '该方程为空集：x 的二次式判别式小于 0、无实根，实数平面内无图像（如 x²=−4）',
    });
    expect(classifyQuadratic({ A: 0, B: 0, C: 1, D: 0, E: 0, F: 4 }).kind).toBe('degenerate'); // y²+4=0
  });

  it('非退化近邻不误判：x²+y²=1e-8（真单点级小圆）出极小椭圆、x²−y²=1e-8 相交', () => {
    // K = 1e-8，相对 kMag=1 远大于容差 → 椭圆型一般式（真椭圆，仅极小，ZOO-149 直接出图）
    const tiny = classifyQuadratic({ A: 1, B: 0, C: 1, D: 0, E: 0, F: -1e-8 });
    expect(tiny.kind).toBe('ellipse');
    if (tiny.kind === 'ellipse') {
      expect(tiny.params.cx).toBe(0);
      expect(tiny.params.rx).toBeCloseTo(1e-4, 12);
      expect(tiny.params.ry).toBeCloseTo(1e-4, 12);
      expect(tiny.params.rotation).toBeUndefined(); // B=0 轴对齐不带旋转
    }
    // K = −1e-8 双曲线型两支极近 → 仍判双曲线（非退化）
    expect(classifyQuadratic({ A: 1, B: 0, C: -1, D: 0, E: 0, F: -1e-8 }).kind).toBe('hyperbola');
  });

  it('xy 旋转项 → 旋转分类出图（ZOO-149，详见旋转专述 describe）', () => {
    const outcome = classifyQuadratic({ A: 0, B: 1, C: 0, D: 0, E: 0, F: -1 });
    expect(outcome.kind).toBe('hyperbola'); // xy=1
  });

  it('椭圆型一般式 → 直接出椭圆（ZOO-149：2x²+3y²=12 → rx=√6、ry=2）', () => {
    const outcome = classifyQuadratic({ A: 2, B: 0, C: 3, D: 0, E: 0, F: -12 });
    expect(outcome.kind).toBe('ellipse');
    if (outcome.kind === 'ellipse') {
      expect(outcome.params.cx).toBe(0);
      expect(outcome.params.cy).toBe(0);
      expect(outcome.params.rx).toBeCloseTo(Math.sqrt(6), 12);
      expect(outcome.params.ry).toBeCloseTo(2, 12);
    }
  });
});

describe('classifyQuadratic 含 xy 交叉项：坐标旋转分类（ZOO-149 / D7 续章三）', () => {
  it('xy=1 → 旋转双曲线：中心 (0,0)、a=b=√2、实轴 45°；xy=−1 实轴 −45°', () => {
    const pos = classifyQuadratic({ A: 0, B: 1, C: 0, D: 0, E: 0, F: -1 });
    expect(pos.kind).toBe('hyperbola');
    if (pos.kind === 'hyperbola') {
      expect(pos.params.h).toBeCloseTo(0, 12);
      expect(pos.params.k).toBeCloseTo(0, 12);
      expect(pos.params.a).toBeCloseTo(Math.SQRT2, 12);
      expect(pos.params.b).toBeCloseTo(Math.SQRT2, 12);
      expect(pos.params.rotation).toBeCloseTo(Math.PI / 4, 12);
      expect(pos.params.axis).toBe('x'); // 实轴最接近 x 轴
    }
    const neg = classifyQuadratic({ A: 0, B: 1, C: 0, D: 0, E: 0, F: 1 }); // xy=−1
    expect(neg.kind).toBe('hyperbola');
    if (neg.kind === 'hyperbola') expect(neg.params.rotation).toBeCloseTo(-Math.PI / 4, 12);
  });

  it('5x²−6xy+5y²=8 → 旋转椭圆：中心 (0,0)、rx=1、ry=2、旋转 −45°', () => {
    const outcome = classifyQuadratic({ A: 5, B: -6, C: 5, D: 0, E: 0, F: -8 });
    expect(outcome.kind).toBe('ellipse');
    if (outcome.kind === 'ellipse') {
      expect(outcome.params.cx).toBeCloseTo(0, 12);
      expect(outcome.params.cy).toBeCloseTo(0, 12);
      expect(outcome.params.rx).toBeCloseTo(1, 12);
      expect(outcome.params.ry).toBeCloseTo(2, 12);
      expect(outcome.params.rotation).toBeCloseTo(-Math.PI / 4, 12);
    }
  });

  it('(x−1)(y−2)=3 → 旋转双曲线：中心 (1,2)、a=b=√6、旋转 45°', () => {
    // 展开：xy−2x−y−1=0
    const outcome = classifyQuadratic({ A: 0, B: 1, C: 0, D: -2, E: -1, F: -1 });
    expect(outcome.kind).toBe('hyperbola');
    if (outcome.kind === 'hyperbola') {
      expect(outcome.params.h).toBeCloseTo(1, 10);
      expect(outcome.params.k).toBeCloseTo(2, 10);
      expect(outcome.params.a).toBeCloseTo(Math.sqrt(6), 10);
      expect(outcome.params.b).toBeCloseTo(Math.sqrt(6), 10);
      expect(outcome.params.rotation).toBeCloseTo(Math.PI / 4, 12);
    }
  });

  it('(x+y)²=2(x−y)+4 → 旋转抛物线：顶点 (−1,1)、p=√2/4、对称轴 −45°', () => {
    // 展开：x²+2xy+y²−2x+2y−4=0（δ=0 抛物线型）
    const outcome = classifyQuadratic({ A: 1, B: 2, C: 1, D: -2, E: 2, F: -4 });
    expect(outcome.kind).toBe('parabola');
    if (outcome.kind === 'parabola') {
      expect(outcome.params.h).toBeCloseTo(-1, 9);
      expect(outcome.params.k).toBeCloseTo(1, 9);
      expect(outcome.params.p).toBeCloseTo(Math.SQRT2 / 4, 9);
      expect(outcome.params.rotation).toBeCloseTo(-Math.PI / 4, 12);
    }
  });

  it('旋转退化：xy=0 → 相交直线对 x=0 与 y=0（系数整形无浮点尘埃）', () => {
    const outcome = classifyQuadratic({ A: 0, B: 1, C: 0, D: 0, E: 0, F: 0 });
    expect(outcome).toEqual({
      kind: 'linePair',
      params: {
        lines: [
          { a: 1, b: 0, c: 0 },
          { a: 0, b: 1, c: 0 },
        ],
        mode: 'intersecting',
      },
    });
  });

  it('旋转退化：(x+y)²=2 → 平行直线对 x+y=±√2；(x+y)²=0 → 重合直线 x+y=0', () => {
    const par = classifyQuadratic({ A: 1, B: 2, C: 1, D: 0, E: 0, F: -2 });
    expect(par.kind).toBe('linePair');
    if (par.kind === 'linePair') {
      expect(par.params.mode).toBe('parallel');
      for (const [i, sign] of [0, 1].map((v) => [v, v === 0 ? -1 : 1] as const)) {
        expect(par.params.lines[i].a).toBeCloseTo(1, 12);
        expect(par.params.lines[i].b).toBeCloseTo(1, 12);
        expect(par.params.lines[i].c).toBeCloseTo(sign * Math.SQRT2, 12);
      }
    }
    const coin = classifyQuadratic({ A: 1, B: 2, C: 1, D: 0, E: 0, F: 0 });
    expect(coin.kind).toBe('linePair');
    if (coin.kind === 'linePair') {
      expect(coin.params.mode).toBe('coincident');
      expect(coin.params.lines[0].a).toBeCloseTo(1, 12);
      expect(coin.params.lines[0].b).toBeCloseTo(1, 12);
      expect(coin.params.lines[0].c).toBeCloseTo(0, 12);
    }
  });

  it('旋转退化：单点 x²+2xy+2y²=0 → (0,0)；空集 (x+y)²+2=0 / x²+xy+y²+1=0', () => {
    expect(classifyQuadratic({ A: 1, B: 2, C: 2, D: 0, E: 0, F: 0 })).toEqual({
      kind: 'point',
      params: { x: 0, y: 0 },
    });
    const emptyRot = classifyQuadratic({ A: 1, B: 2, C: 1, D: 0, E: 0, F: 2 });
    expect(emptyRot).toEqual({
      kind: 'degenerate',
      message: '该方程为空集：旋转坐标 u 的二次式判别式小于 0、无实根，实数平面内无图像',
    });
    expect(classifyQuadratic({ A: 1, B: 1, C: 1, D: 0, E: 0, F: 1 }).kind).toBe('degenerate');
  });

  it('等价书写全覆盖（探针路径）：×(−1) / 移项变序 / ×0.5 浮点缩放 / 展开形', () => {
    const rot = (f: BinaryFn) => classifyImplicit(f);
    // 同一椭圆的两种主轴表示：(rx=1,ry=2)@−45° 与 (rx=2,ry=1)@+45°（×(−1) 使
    // atan2 主轴角差 90°，半轴随轴对调——曲线完全一致）
    const expectSameEllipse = (f: BinaryFn) => {
      const o = rot(f);
      expect(o.kind).toBe('ellipse');
      if (o.kind !== 'ellipse') return;
      expect(o.params.cx).toBeCloseTo(0, 9);
      expect(o.params.cy).toBeCloseTo(0, 9);
      expect(Math.min(o.params.rx, o.params.ry)).toBeCloseTo(1, 9);
      expect(Math.max(o.params.rx, o.params.ry)).toBeCloseTo(2, 9);
      expect(Math.abs(o.params.rotation ?? 0)).toBeCloseTo(Math.PI / 4, 9);
    };
    expectSameEllipse((x, y) => 5 * x * x - 6 * x * y + 5 * y * y - 8); // 基准
    expectSameEllipse((x, y) => -(5 * x * x - 6 * x * y + 5 * y * y - 8)); // ×(−1) 全体
    expectSameEllipse((x, y) => 8 - 5 * x * x + 6 * x * y - 5 * y * y); // 移项变序
    expectSameEllipse((x, y) => 2.5 * x * x - 3 * x * y + 2.5 * y * y - 4); // ×0.5 浮点缩放
    // 展开形：((x+y)²)/2+((x−y)²)/8=1 ⟺ 5x²+6xy+5y²=8（B>0 旋转反向 +45°）
    const twin = rot((x, y) => 5 * x * x + 6 * x * y + 5 * y * y - 8);
    expect(twin.kind).toBe('ellipse');
    if (twin.kind === 'ellipse') {
      expect(twin.params.rotation).toBeCloseTo(Math.PI / 4, 6); // B>0 旋转反向
      expect(twin.params.rx).toBeCloseTo(1, 6);
      expect(twin.params.ry).toBeCloseTo(2, 6);
    }
  });
});

describe('旋转 / 椭圆教学参数（ZOO-149，面板只读展示）', () => {
  it('formatAngle：π/4 → 45°、−π/6 → −30°、π/2 → 90°、−0 归 0°', () => {
    expect(formatAngle(Math.PI / 4)).toBe('45°');
    expect(formatAngle(-Math.PI / 6)).toBe('-30°');
    expect(formatAngle(Math.PI / 2)).toBe('90°');
    expect(formatAngle(0)).toBe('0°');
  });

  it('椭圆（轴对齐一般形）：标准形 / 中心 / 半轴 / 焦点 / 离心率，无旋转行', () => {
    const info = ellipseTeachingInfo({ cx: 1, cy: -2, rx: 2, ry: 3 });
    expect(info).toEqual({
      standardForm: '(x-1)²/4+(y+2)²/9=1',
      center: '(1, -2)',
      axes: 'a = 3, b = 2, c = 2.23607',
      foci: '(1, -4.23607) 与 (1, 0.236068)',
      eccentricity: '0.745356',
      rotation: undefined,
    });
  });

  it('旋转椭圆 5x²−6xy+5y²=8：X' + "'²" + '标准形 / 焦点沿长轴（Y' + "'）" + ' / 旋转角 −45°', () => {
    const info = ellipseTeachingInfo({ cx: 0, cy: 0, rx: 1, ry: 2, rotation: -Math.PI / 4 });
    expect(info.standardForm).toBe("X'²+Y'²/4=1");
    expect(info.center).toBe('(0, 0)');
    expect(info.axes).toBe('a = 2, b = 1, c = 1.73205');
    expect(info.foci).toBe('(-1.22474, -1.22474) 与 (1.22474, 1.22474)'); // 长轴 ry 沿 Y'（+45° 方向）
    expect(info.eccentricity).toBe('0.866025');
    expect(info.rotation).toBe('-45°');
  });

  it('旋转双曲线 xy=1：X' + "'²" + '/2−Y' + "'²" + '/2=1、渐近线即坐标轴、准线一般式、旋转 45°', () => {
    const info = hyperbolaTeachingInfo({ h: 0, k: 0, a: Math.SQRT2, b: Math.SQRT2, axis: 'x', rotation: Math.PI / 4 });
    expect(info.standardForm).toBe("X'²/2-Y'²/2=1");
    expect(info.center).toBe('(0, 0)');
    expect(info.foci).toBe('(-1.41421, -1.41421) 与 (1.41421, 1.41421)');
    expect(info.asymptotes).toBe('x=0 与 y=0');
    expect(info.directrices).toBe('x+y=-1.41421 与 x+y=1.41421');
    expect(info.eccentricity).toBe('1.41421');
    expect(info.rotation).toBe('45°');
  });

  it('旋转抛物线 (x+y)²=2(x−y)+4：顶点 / 焦点 / 准线一般式 / 开口角 / 旋转 −45°', () => {
    const info = parabolaTeachingInfo({ h: -1, k: 1, p: Math.SQRT2 / 4, axis: 'x', rotation: -Math.PI / 4 });
    expect(info.standardForm).toBe("Y'²=1.41421X'");
    expect(info.vertex).toBe('(-1, 1)');
    expect(info.focus).toBe('(-0.75, 0.75)');
    expect(info.directrix).toBe('x-y=-2.5');
    expect(info.opening).toBe('沿 -45° 方向');
    expect(info.rotation).toBe('-45°');
  });

  it('旋转直线对教学参数：(x+y)²=2 平行对给间距、xy=0 相交对给交点', () => {
    expect(
      linePairTeachingInfo({
        lines: [
          { a: 1, b: 1, c: -Math.SQRT2 },
          { a: 1, b: 1, c: Math.SQRT2 },
        ],
        mode: 'parallel',
      }),
    ).toEqual({ label: '两条平行直线', equations: ['x+y=-1.41421', 'x+y=1.41421'], detail: '间距 d = 2' });
    expect(
      linePairTeachingInfo({
        lines: [
          { a: 1, b: 0, c: 0 },
          { a: 0, b: 1, c: 0 },
        ],
        mode: 'intersecting',
      }).detail,
    ).toBe('交点 (0, 0)');
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

  it('退化形探针接入：求值函数路径命中 linePair / point / 空集（ZOO-148）', () => {
    expect(classifyImplicit(fnOf((x, y) => x * x - y * y))).toEqual({
      kind: 'linePair',
      params: {
        lines: [
          { a: 1, b: -1, c: 0 },
          { a: 1, b: 1, c: 0 },
        ],
        mode: 'intersecting',
      },
    });
    // (x−0.5)²=0 展开：x²−x+0.25（浮点重根）
    const coincident = classifyImplicit(fnOf((x) => x * x - x + 0.25));
    expect(coincident.kind).toBe('linePair');
    if (coincident.kind === 'linePair') {
      expect(coincident.params.mode).toBe('coincident');
      expect(coincident.params.lines).toHaveLength(1);
      expect(coincident.params.lines[0].c).toBeCloseTo(0.5, 9);
    }
    // (x−0.1)²+(y+0.2)²=0 展开（浮点单点）
    const pt = classifyImplicit(fnOf((x, y) => (x - 0.1) ** 2 + (y + 0.2) ** 2));
    expect(pt.kind).toBe('point');
    if (pt.kind === 'point') {
      expect(pt.params.x).toBeCloseTo(0.1, 9);
      expect(pt.params.y).toBeCloseTo(-0.2, 9);
    }
    // 因式分解书写的平行直线：(2x-3)(x+1)=0 → x=1.5 与 x=−1
    // （非轴对齐直线对展开必含 xy 项 → 旋转形，属 ZOO-149 范围）
    const factored = classifyImplicit(fnOf((x) => (2 * x - 3) * (x + 1)));
    expect(factored.kind).toBe('linePair');
    if (factored.kind === 'linePair') expect(factored.params.mode).toBe('parallel');
    // 空集
    expect(classifyImplicit(fnOf((x, y) => x * x + y * y + 1)).kind).toBe('degenerate');
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

describe('退化形教学参数（ZOO-148，面板只读展示）', () => {
  it('相交直线对：标签 / 两线一般式 / 交点', () => {
    expect(
      linePairTeachingInfo({
        lines: [
          { a: 1, b: -1, c: 0 },
          { a: 1, b: 1, c: 0 },
        ],
        mode: 'intersecting',
      }),
    ).toEqual({ label: '两条相交直线', equations: ['x-y=0', 'x+y=0'], detail: '交点 (0, 0)' });
    // 平移形：交点即退化前中心 (1, −2)
    expect(
      linePairTeachingInfo({
        lines: [
          { a: 1, b: -1, c: 3 },
          { a: 1, b: 1, c: -1 },
        ],
        mode: 'intersecting',
      }).detail,
    ).toBe('交点 (1, -2)');
  });

  it('平行 / 重合直线对：间距 / 重合说明', () => {
    expect(
      linePairTeachingInfo({
        lines: [
          { a: 1, b: 0, c: -2 },
          { a: 1, b: 0, c: 2 },
        ],
        mode: 'parallel',
      }),
    ).toEqual({ label: '两条平行直线', equations: ['x=-2', 'x=2'], detail: '间距 d = 4' });
    expect(linePairTeachingInfo({ lines: [{ a: 1, b: 0, c: 1 }], mode: 'coincident' })).toEqual({
      label: '一对重合直线',
      equations: ['x=1'],
      detail: '判别式为 0，两根重合于同一条直线',
    });
  });

  it('退化单点：坐标与唯一解表述', () => {
    expect(pointTeachingInfo({ x: 1, y: -2 })).toEqual({ point: '(1, -2)', solution: 'x = 1, y = -2' });
    expect(pointTeachingInfo({ x: 0, y: 0 }).point).toBe('(0, 0)');
  });
});
