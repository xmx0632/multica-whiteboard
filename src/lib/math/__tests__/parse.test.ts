import { describe, expect, it } from 'vitest';
import { parseEquation } from '../parse';
import { validateEquation } from '../validate';
import { EQUATION_TEMPLATES } from '../templates';

const asExplicit = (raw: string) => {
  const r = parseEquation(raw);
  if (r.kind !== 'explicit') throw new Error(`期望 explicit，得到 ${r.kind}: ${JSON.stringify(r)}`);
  return r.fn;
};
const errorMessage = (raw: string) => {
  const r = parseEquation(raw);
  if (r.kind !== 'error') throw new Error(`期望 error，得到 ${r.kind}`);
  return r.message;
};

describe('parseEquation 分类：14 模板 + PRD 方程族', () => {
  it('全部 17 个模板可解析', () => {
    for (const tpl of EQUATION_TEMPLATES) {
      const r = parseEquation(tpl.equation);
      expect(r.kind, `模板「${tpl.id}」${tpl.equation}`).not.toBe('error');
    }
  });

  it('显式函数（P0：一次/多项式/三角/幂根/反比例）', () => {
    for (const eq of ['y=2x+1', 'y=x^2-2x-3', 'y=x^3-2x', 'y=sin(x)', 'y=tan(x)', 'y=1/x', 'y=x', 'sin(x)']) {
      expect(parseEquation(eq).kind, eq).toBe('explicit');
    }
  });

  it('显式函数（P1：指数/对数/绝对值 + Unicode 原文）', () => {
    for (const eq of ['y=2ˣ', 'y=eˣ', 'y=ln(x)', 'y=|x-1|', 'y=√x', 'y=2sin(2x+π/3)']) {
      expect(parseEquation(eq).kind, eq).toBe('explicit');
    }
  });

  it('y= 前缀可省略；f(x)= 前缀同样剥离', () => {
    expect(parseEquation('2x+1').kind).toBe('explicit');
    expect(parseEquation('f(x)=sin(x)').kind).toBe('explicit');
  });

  it('圆：标准形参数提取', () => {
    const a = parseEquation('(x-1)²+(y-2)²=9');
    expect(a).toEqual({ kind: 'circle', params: { cx: 1, cy: 2, r: 3 } });
    const b = parseEquation('x²+y²=4');
    expect(b).toEqual({ kind: 'circle', params: { cx: 0, cy: 0, r: 2 } });
    const c = parseEquation('(x+1)²+y²=2.25');
    expect(c).toEqual({ kind: 'circle', params: { cx: -1, cy: 0, r: 1.5 } });
  });

  it('椭圆：标准形参数提取', () => {
    const a = parseEquation('x²/9+y²/4=1');
    expect(a).toEqual({ kind: 'ellipse', params: { cx: 0, cy: 0, rx: 3, ry: 2 } });
    const b = parseEquation('(x-1)²/4+(y+2)²/16=1');
    expect(b).toEqual({ kind: 'ellipse', params: { cx: 1, cy: -2, rx: 2, ry: 4 } });
  });

  it('圆半径/椭圆参数非正 → 明确报错；r=0 交回分类器出退化点（ZOO-148）', () => {
    expect(parseEquation('x²+y²=0')).toEqual({ kind: 'point', params: { x: 0, y: 0 } });
    expect(parseEquation('x²/0+y²/4=1')).toEqual({ kind: 'error', message: '椭圆参数必须为正' });
  });
});

describe('parseEquation 二元一次方程 → 直线（ZOO-146 / D7）', () => {
  const asLine = (raw: string) => {
    const r = parseEquation(raw);
    if (r.kind !== 'line') throw new Error(`期望 line，得到 ${r.kind}: ${JSON.stringify(r)}`);
    return r.params;
  };
  const expectLine = (raw: string, a: number, b: number, c: number) => {
    const p = asLine(raw);
    expect(Math.abs(p.a - a), `${raw} a`).toBeLessThan(1e-9);
    expect(Math.abs(p.b - b), `${raw} b`).toBeLessThan(1e-9);
    expect(Math.abs(p.c - c), `${raw} c`).toBeLessThan(1e-9);
  };

  it('标准一般式与等价书写全覆盖（探针提取系数）', () => {
    expectLine('3x+2y=6', 3, 2, 6);
    expectLine('x/2-y=1', 0.5, -1, 1); // 分数系数
    expectLine('2y=x+4', -1, 2, 4); // 变序（y 侧在左）
    expectLine('6=3x+2y', -3, -2, -6); // 常数侧在左（F=6−(3x+2y)，与 3x+2y=6 同一直线）
    expectLine('2(x+y)=3x-4', -1, 2, -4); // 括号展开
    expectLine('x+y=1', 1, 1, 1);
    expectLine('x=y', 1, -1, 0);
    expectLine('y=x+y', -1, 0, 0); // y=x+y ⟺ x=0
  });

  it('竖线 x=k（b=0）与水平线（a=0）', () => {
    expectLine('x=3', 1, 0, 3);
    expectLine('2x=6', 2, 0, 6); // 无 y 项
    expectLine('2y=4', 0, 2, 4); // 无 x 项：水平线 y=2
  });

  it('系数数量级鲁棒（风险 R1：1e-6 / 1e+6 不误判）', () => {
    expectLine('0.000001x+y=1', 1e-6, 1, 1);
    expectLine('1000000x+2000000y=3000000', 1e6, 2e6, 3e6);
  });

  it('Unicode 原文（·× 隐式乘法）同样命中', () => {
    expectLine('2·y=x+4', -1, 2, 4);
    expectLine('3×x+2y=6', 3, 2, 6);
  });

  it('validateEquation 消费契约：line 携带 params（面板教学参数来源）', () => {
    expect(validateEquation('3x+2y=6')).toEqual({ kind: 'line', params: { a: 3, b: 2, c: 6 } });
  });

  it('隐式路径安全性：注入载荷在 AST / 字符白名单即失败', () => {
    expect(parseEquation('y.constructor=x').kind).toBe('error'); // AccessorNode
    expect(parseEquation('x#1=2').kind).toBe('error'); // 字符白名单前置拦截
    expect(parseEquation('f(x)=x+y').kind).toBe('error'); // f 非白名单函数
  });
});

describe('parseEquation 二元二次 → 抛物线 / 双曲线（ZOO-147 / D7）', () => {
  type ConicParams = { h: number; k: number; p?: number; a?: number; b?: number; axis: 'x' | 'y' };
  const asConic = (raw: string, kind: 'parabola' | 'hyperbola') => {
    const r = parseEquation(raw);
    if (r.kind !== kind) throw new Error(`期望 ${kind}，得到 ${r.kind}: ${JSON.stringify(r)}`);
    return r.params as unknown as ConicParams;
  };
  const close = (actual: number, expected: number, what: string) =>
    expect(Math.abs(actual - expected), what).toBeLessThan(1e-9);

  it('抛物线：y²=4x / x²=2y / 开口向左 y²=−4x / 平移 (y−1)²=8(x+2)', () => {
    const p1 = asConic('y²=4x', 'parabola');
    close(p1.h, 0, 'h'); close(p1.k, 0, 'k'); close(p1.p!, 1, 'p');
    expect(p1.axis).toBe('x');

    const p2 = asConic('x²=2y', 'parabola');
    close(p2.p!, 0.5, 'p');
    expect(p2.axis).toBe('y');

    const p3 = asConic('y²=-4x', 'parabola');
    close(p3.p!, -1, 'p');

    const p4 = asConic('(y-1)²=8(x+2)', 'parabola');
    close(p4.h, -2, 'h'); close(p4.k, 1, 'k'); close(p4.p!, 2, 'p');
  });

  it('双曲线：9x²−16y²=144（系数前置）/ −y²+x²=1（变序）/ 平移形 / 实轴 y', () => {
    const h1 = asConic('9x²-16y²=144', 'hyperbola');
    close(h1.h, 0, 'h'); close(h1.a!, 4, 'a'); close(h1.b!, 3, 'b');
    expect(h1.axis).toBe('x');

    const h2 = asConic('-y²+x²=1', 'hyperbola');
    close(h2.a!, 1, 'a'); close(h2.b!, 1, 'b');

    const h3 = asConic('(x-1)²/4-(y+2)²/9=1', 'hyperbola');
    close(h3.h, 1, 'h'); close(h3.k, -2, 'k'); close(h3.a!, 2, 'a'); close(h3.b!, 3, 'b');

    const h4 = asConic('y²/9-x²/4=1', 'hyperbola');
    close(h4.a!, 3, 'a'); close(h4.b!, 2, 'b');
    expect(h4.axis).toBe('y');
  });

  it('等价书写：两侧同乘 / 因式分解形 / 除法系数', () => {
    const h = asConic('16y²-9x²=-144', 'hyperbola'); // 9x²−16y²=144 移项变序
    close(h.a!, 4, 'a'); close(h.b!, 3, 'b');
    const h2 = asConic('x²/4-y²/9=1', 'hyperbola');
    close(h2.a!, 2, 'a'); close(h2.b!, 3, 'b');
  });

  it('validateEquation 消费契约：parabola / hyperbola 携带 params（面板教学参数来源）', () => {
    expect(validateEquation('y²=4x')).toEqual({ kind: 'parabola', params: { h: 0, k: 0, p: 1, axis: 'x' } });
    expect(validateEquation('9x²-16y²=144')).toEqual({ kind: 'hyperbola', params: { h: 0, k: 0, a: 4, b: 3, axis: 'x' } });
  });
});

describe('parseEquation 含 xy 交叉项一般二次 → 旋转圆锥曲线（ZOO-149 / D7 续章三）', () => {
  it('xy=1 → 旋转双曲线（a=b=√2、实轴 45°）；2xy=4 / xy*2=4 等价命中', () => {
    const r = parseEquation('xy=1');
    expect(r.kind).toBe('hyperbola');
    if (r.kind === 'hyperbola') {
      expect(r.params.a).toBeCloseTo(Math.SQRT2, 10);
      expect(r.params.b).toBeCloseTo(Math.SQRT2, 10);
      expect(r.params.rotation).toBeCloseTo(Math.PI / 4, 10);
    }
    const scaled = parseEquation('2xy=4'); // ⟂ xy=2：a=b=2
    expect(scaled.kind).toBe('hyperbola');
    if (scaled.kind === 'hyperbola') {
      expect(scaled.params.a).toBeCloseTo(2, 10);
      expect(scaled.params.rotation).toBeCloseTo(Math.PI / 4, 10);
    }
  });

  it('5x²−6xy+5y²=8 → 旋转椭圆；Unicode 减号 / 变序 / ×(−1) 等价书写', () => {
    for (const eq of ['5x²-6xy+5y²=8', '5x²−6xy+5y²=8', '8=5x²-6xy+5y²', '-5x²+6xy-5y²=-8', '5.0x²-6.0xy+5.0y²=8.0']) {
      const r = parseEquation(eq);
      expect(r.kind).toBe('ellipse');
      if (r.kind !== 'ellipse') continue;
      expect(r.params.cx).toBeCloseTo(0, 9);
      expect(r.params.cy).toBeCloseTo(0, 9);
      expect(Math.min(r.params.rx, r.params.ry)).toBeCloseTo(1, 9);
      expect(Math.max(r.params.rx, r.params.ry)).toBeCloseTo(2, 9);
      expect(Math.abs(r.params.rotation ?? 0)).toBeCloseTo(Math.PI / 4, 9);
    }
  });

  it('(x−1)(y−2)=3 → 中心 (1,2) 旋转双曲线；(x+y)²=2(x−y)+4 → 旋转抛物线', () => {
    const h = parseEquation('(x-1)(y-2)=3');
    expect(h.kind).toBe('hyperbola');
    if (h.kind === 'hyperbola') {
      expect(h.params.h).toBeCloseTo(1, 9);
      expect(h.params.k).toBeCloseTo(2, 9);
    }
    const p = parseEquation('(x+y)²=2(x-y)+4');
    expect(p.kind).toBe('parabola');
    if (p.kind === 'parabola') {
      expect(p.params.h).toBeCloseTo(-1, 8);
      expect(p.params.k).toBeCloseTo(1, 8);
      expect(p.params.p).toBeCloseTo(Math.SQRT2 / 4, 8);
      expect(p.params.rotation).toBeCloseTo(-Math.PI / 4, 10);
    }
  });

  it('椭圆型一般式（B=0）直接出图：9x²+16y²=144 → rx=4、ry=3（无旋转）', () => {
    const r = parseEquation('9x²+16y²=144');
    expect(r.kind).toBe('ellipse');
    if (r.kind === 'ellipse') {
      expect(r.params.cx).toBeCloseTo(0, 12);
      expect(r.params.cy).toBeCloseTo(0, 12);
      expect(r.params.rx).toBeCloseTo(4, 12);
      expect(r.params.ry).toBeCloseTo(3, 12);
      expect(r.params.rotation).toBeUndefined();
    }
    // 平移形：(x−1)²/4+(y+2)²/9=1 展开为 9x²+4y²−18x+16y−11=0
    const moved = parseEquation('9x²+4y²-18x+16y-11=0');
    expect(moved.kind).toBe('ellipse');
    if (moved.kind === 'ellipse') {
      expect(moved.params.cx).toBeCloseTo(1, 9);
      expect(moved.params.cy).toBeCloseTo(-2, 9);
      expect(moved.params.rx).toBeCloseTo(2, 9);
      expect(moved.params.ry).toBeCloseTo(3, 9);
    }
  });

  it('旋转退化出图：xy=0 相交对 / (x+y)²=2 平行对 / x²+2xy+2y²=0 单点', () => {
    expect(parseEquation('xy=0').kind).toBe('linePair');
    expect(parseEquation('(x+y)²=2').kind).toBe('linePair');
    expect(parseEquation('x²+2xy+2y²=0').kind).toBe('point');
    expect(parseEquation('(x+y)²+2=0').kind).toBe('error');
  });
});

describe('parseEquation 求值正确性（mathjs number 构建）', () => {
  it('多项式与隐式乘法', () => {
    expect(asExplicit('y=x^2')(3)).toBe(9);
    expect(asExplicit('y=x²-2x-3')(4)).toBe(5);
    expect(asExplicit('y=2x+1')(0)).toBe(1);
    expect(asExplicit('y=2πx')(1)).toBeCloseTo(2 * Math.PI, 12);
    expect(asExplicit('y=2pix')(1)).toBeCloseTo(2 * Math.PI, 12); // 4a 兼容：字母连写等价
    expect(asExplicit('y=xsin(x)')(2)).toBeCloseTo(2 * Math.sin(2), 12);
  });

  it('三角（含相位）与反三角', () => {
    expect(asExplicit('y=2sin(2x+π/3)')(0)).toBeCloseTo(Math.sqrt(3), 12);
    expect(asExplicit('y=cos(x)')(0)).toBe(1);
    expect(asExplicit('y=asin(0.5)')(0)).toBeCloseTo(Math.PI / 6, 12);
  });

  it('指数 / 对数（ln→log 自然对数；log 支持带底）', () => {
    expect(asExplicit('y=2ˣ')(3)).toBe(8);
    expect(asExplicit('y=eˣ')(1)).toBeCloseTo(Math.E, 12);
    expect(asExplicit('y=ln(x)')(Math.E)).toBeCloseTo(1, 12);
    expect(asExplicit('y=log(x,2)')(8)).toBe(3);
  });

  it('根式 / 绝对值 / 反比例', () => {
    expect(asExplicit('y=√x')(9)).toBe(3);
    expect(asExplicit('y=|x-1|')(-1)).toBe(2);
    expect(asExplicit('y=1/x')(4)).toBe(0.25);
  });

  it('求值域外返回 NaN（采样期按断笔处理），不抛异常', () => {
    expect(asExplicit('y=√x')(-1)).toBeNaN();
    expect(asExplicit('y=ln(x)')(-1)).toBeNaN();
  });
});

describe('parseEquation 错误处理（文案与 4a 结构校验对齐）', () => {
  it('空输入 / 缺右侧（ZOO-166：附「怎么办」指引）', () => {
    expect(errorMessage('')).toBe('请输入方程');
    expect(errorMessage('   ')).toBe('请输入方程');
    expect(errorMessage('y=')).toBe('方程缺少右侧表达式——请输入 y=f(x) 形式，如 y=2x+1');
  });

  it('不可识别的函数（AST 白名单拒绝，ZOO-166 指引）', () => {
    expect(errorMessage('y=foo(x)')).toBe('无法识别的函数 “foo”——支持 sin、cos、tan、sqrt、abs、log、exp、asin、acos、atan');
    // 注：未知单字母不再报错（ZOO-166 方案 A 自由变量）；多字母 / 双自由字母见对应 describe
  });

  it('不可识别的字符（mathjs 会把 # 吞成 undefined 常量，须前置拦截）', () => {
    expect(errorMessage('#')).toBe('无法识别的字符 “#”——仅支持数字、字母与 + − × ÷ ^ ( ) 等字符');
    expect(errorMessage('y=2#3')).toBe('无法识别的字符 “#”——仅支持数字、字母与 + − × ÷ ^ ( ) 等字符');
    expect(errorMessage("y=x);require('fs')")).toBe('无法识别的字符 “;”——仅支持数字、字母与 + − × ÷ ^ ( ) 等字符');
  });

  it('括号 / 绝对值未闭合', () => {
    expect(errorMessage('y=sin(x')).toBe('括号或绝对值符号未闭合——请补全右括号，如 y=sin(x)');
    expect(errorMessage('y=abs(x-1')).toBe('括号或绝对值符号未闭合——请补全右括号，如 y=sin(x)');
    expect(errorMessage('y=|x-1')).toBe('括号或绝对值符号未闭合——请补全右括号，如 y=sin(x)');
    expect(errorMessage('y=(x+1')).toBe('括号或绝对值符号未闭合——请补全右括号，如 y=sin(x)');
  });

  it('表达式不完整 / 函数参数 / 数字格式', () => {
    expect(errorMessage('y=2+')).toBe('表达式不完整——请补全公式，如 y=2x+1');
    expect(errorMessage('y=sin()')).toBe('函数参数个数有误——请检查括号内的参数（如 sin(x)、log(8,2)）'); // 函数零参（arity 白名单）
    expect(errorMessage('2..5')).toBe('数字格式有误——请检查数字写法，如 1.5');
    expect(errorMessage('y=2.5.3')).toBe('数字格式有误——请检查数字写法，如 1.5');
  });

  it('隐式方程：非多项式仍明确拒绝（不白屏）', () => {
    const msg =
      '暂不支持该隐式方程：目前支持 y=f(x)、圆/椭圆标准形与一般形、二元一次、二元二次方程（抛物线 / 双曲线 / 含 xy 交叉项的旋转圆锥曲线 / 退化两直线与单点，如 y²=4x、xy=1、5x²−6xy+5y²=8、x²−y²=0）';
    expect(errorMessage('sin(x)=y')).toBe(msg); // 非多项式隐式
    expect(errorMessage('x³+y=1')).toBe(msg); // 三次
  });

  it('隐式方程：xy 旋转项 / 椭圆型一般式直接出图（ZOO-149）', () => {
    expect(parseEquation('x*y=1').kind).toBe('hyperbola'); // 旋转双曲线
    expect(parseEquation('2x²+3y²=12').kind).toBe('ellipse'); // 椭圆型一般式
  });

  it('退化二次方程出图：两直线 / 单点（ZOO-148）', () => {
    expect(parseEquation('x²-y²=0')).toEqual({
      kind: 'linePair',
      params: {
        lines: [
          { a: 1, b: -1, c: 0 },
          { a: 1, b: 1, c: 0 },
        ],
        mode: 'intersecting',
      },
    });
    expect(parseEquation('x²=4')).toEqual({
      kind: 'linePair',
      params: {
        lines: [
          { a: 1, b: 0, c: -2 },
          { a: 1, b: 0, c: 2 },
        ],
        mode: 'parallel',
      },
    });
    // 等价书写：变序 / 全体 ×(−1) / 因式分解形均命中
    expect(parseEquation('0=x²-y²')).toEqual(parseEquation('x²-y²=0'));
    expect(parseEquation('y²-x²=0')).toEqual(parseEquation('x²-y²=0'));
    expect(parseEquation('(x-y)(x+y)=0')).toEqual(parseEquation('x²-y²=0'));
    expect(parseEquation('y²-9=0')).toEqual({
      kind: 'linePair',
      params: {
        lines: [
          { a: 0, b: 1, c: -3 },
          { a: 0, b: 1, c: 3 },
        ],
        mode: 'parallel',
      },
    });
    expect(parseEquation('(x-1)²=0')).toEqual({ kind: 'linePair', params: { lines: [{ a: 1, b: 0, c: 1 }], mode: 'coincident' } });
    expect(parseEquation('x²+y²=0')).toEqual({ kind: 'point', params: { x: 0, y: 0 } });
    expect(parseEquation('(x-1)²+(y+2)²=0')).toEqual({ kind: 'point', params: { x: 1, y: -2 } });
  });

  it('退化空集：错误占位承载教学文案（ZOO-148）', () => {
    expect(errorMessage('x²+y²=-1')).toBe('该方程为空集：左侧恒正（或恒负）、无法等于 0，实数平面内无图像（如 x²+y²=−1）');
    expect(errorMessage('x²=-4')).toBe('该方程为空集：x 的二次式判别式小于 0、无实根，实数平面内无图像（如 x²=−4）');
    expect(errorMessage('y²+4=0').startsWith('该方程为空集：y 的二次式判别式小于 0')).toBe(true);
    // 平移空集：(x−1)²+(y+2)²=−4
    expect(errorMessage('(x-1)²+(y+2)²=-4').startsWith('该方程为空集：')).toBe(true);
  });

  it('隐式方程：常数等式 / 等号异常的友好文案', () => {
    expect(errorMessage('x-x=0')).toBe('该等式恒成立（化简后为 0=0），不表示任何曲线');
    expect(errorMessage('0=1')).toBe('该等式恒不成立（化简后左右两侧不相等），无图像');
    expect(errorMessage('x==3')).toBe('方程只能包含一个等号');
    expect(errorMessage('2y')).toBe('方程缺少等号：请输入 y=f(x) 或二元一次方程（如 3x+2y=6）');
    // 注：a=2 不再报错（ZOO-166 方案 A：a 补 x 位 ⟺ x=2），见自由变量绑定 describe
  });
});

describe('parseEquation 安全性（PRD §8 禁 eval / 公式注入）', () => {
  it('属性访问 / 赋值 / 条件 / 块节点一律拒绝', () => {
    expect(errorMessage('y=x.constructor')).toBe('无法识别的表达式——请检查输入格式（如 y=sin(x)）'); // AccessorNode（字符白名单放行，AST 白名单拒绝）
    expect(errorMessage('y=__proto__.x')).toBe('无法识别的字符 “_”——仅支持数字、字母与 + − × ÷ ^ ( ) 等字符'); // 字符白名单前置拦截
    expect(errorMessage('y=x?1:2')).toBe('无法识别的字符 “?”——仅支持数字、字母与 + − × ÷ ^ ( ) 等字符');
    expect(errorMessage('y=x;1')).toBe('无法识别的字符 “;”——仅支持数字、字母与 + − × ÷ ^ ( ) 等字符');
  });

  it('注入载荷在 parse/白名单阶段即失败，不产生求值函数', () => {
    for (const payload of [
      "x);require('fs')",
      'x);process.exit(1)',
      '__proto__[polluted]',
      'constructor.constructor("return 1")()',
      'x=2',
    ]) {
      const r = parseEquation(`y=${payload}`);
      expect(r.kind, payload).toBe('error');
    }
  });

  it('求值 scope 只含 x：白名单外的符号根本到不了求值', () => {
    // 已由「无法识别的符号」覆盖；此处固化：globalThis 属性名不可达
    expect(parseEquation('y=globalThis').kind).toBe('error');
    expect(parseEquation('y=Infinity').kind).toBe('error'); // 常量仅白名单 pi/e + 数字
  });
});

describe('validateEquation（编辑器每键调用的薄适配）', () => {
  it('消费结构与 4a 契约一致（kind/message/params，无 fn）', () => {
    expect(validateEquation('y=sin(x)')).toEqual({ kind: 'explicit' });
    expect(validateEquation('(x-1)²+(y-2)²=9')).toEqual({ kind: 'circle', params: { cx: 1, cy: 2, r: 3 } });
    expect(validateEquation('y=2+')).toEqual({ kind: 'error', message: '表达式不完整——请补全公式，如 y=2x+1' });
    expect(validateEquation('')).toEqual({ kind: 'error', message: '请输入方程' });
  });
});

describe('自由变量绑定（ZOO-166 方案 A）', () => {
  it('任意单字母可作自变量：y=4z / y=4t 直接出图', () => {
    const r = parseEquation('y=4z');
    expect(r.kind).toBe('explicit');
    if (r.kind === 'explicit') {
      expect(r.variable).toBe('z');
      expect(r.fn(2)).toBe(8);
    }
    const t = parseEquation('y=sin(t)');
    expect(t.kind).toBe('explicit');
    if (t.kind === 'explicit') {
      expect(t.variable).toBe('t');
      expect(t.fn(0)).toBe(0);
    }
    const poly = parseEquation('y=z²+2z');
    expect(poly.kind).toBe('explicit');
    if (poly.kind === 'explicit') {
      expect(poly.variable).toBe('z');
      expect(poly.fn(3)).toBe(15);
    }
    const prefixed = parseEquation('f(t)=t²-1');
    expect(prefixed.kind).toBe('explicit'); // 求值函数前缀放宽为任意单字母
    if (prefixed.kind === 'explicit') {
      expect(prefixed.variable).toBe('t');
      expect(prefixed.fn(2)).toBe(3);
    }
  });

  it('x 为自变量时不携带 variable 字段（既有行为零变化）', () => {
    const r = parseEquation('y=sin(x)');
    expect(r.kind).toBe('explicit');
    if (r.kind === 'explicit') expect(r.variable).toBeUndefined();
  });

  it('pi / e 保留常数语义，不抢作变量', () => {
    const e = parseEquation('y=e');
    expect(e.kind).toBe('explicit');
    if (e.kind === 'explicit') {
      expect(e.variable).toBeUndefined();
      expect(e.fn(5)).toBeCloseTo(Math.E);
    }
    const pi = parseEquation('y=2pi+x');
    expect(pi.kind).toBe('explicit');
    if (pi.kind === 'explicit') expect(pi.fn(0)).toBeCloseTo(2 * Math.PI);
  });

  it('两个及以上自由字母报错（数学上欠定）', () => {
    expect(errorMessage('y=x+z')).toBe('方程包含多个自变量（x、z）——请只保留一个字母作为自变量（如 y=2x）');
    expect(errorMessage('y=z+t')).toBe('方程包含多个自变量（z、t）——请只保留一个字母作为自变量（如 y=2x）');
    expect(errorMessage('x+y+z=3')).toBe('二元方程最多两个变量字母（当前 x、y、z）——请化简后重试');
  });

  it('多字母词仍拦截（拼写 / 未知名）', () => {
    expect(errorMessage('y=foo')).toBe('无法识别符号 “foo”——请检查拼写，变量请用单个字母（如 y=2z）');
    expect(parseEquation('y=globalThis').kind).toBe('error'); // 安全：多字母名不可达
  });

  it('隐式路径：未知字母按出现顺序补进 x/y 空缺位', () => {
    expect(parseEquation('z=4x').kind).toBe('line'); // z 补 y 位 ⟺ y=4x
    expect(parseEquation('a=2').kind).toBe('line'); // a 补 x 位 ⟺ x=2
    expect(parseEquation('x+t=3').kind).toBe('line'); // t 补 y 位
    const geo = parseEquation('w²+z²=4'); // 双未知走一般形探针 → 圆/椭圆
    expect(geo.kind === 'circle' || geo.kind === 'ellipse').toBe(true);
  });

  it('validateEquation 透传 variable（缺省 x 不携带，旧消费方零感知）', () => {
    expect(validateEquation('y=sin(x)')).toEqual({ kind: 'explicit' });
    expect(validateEquation('y=4z')).toEqual({ kind: 'explicit', variable: 'z' });
  });
});
