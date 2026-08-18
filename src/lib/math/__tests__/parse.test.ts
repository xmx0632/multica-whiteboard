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

describe('parseEquation 分类：13 模板 + PRD 方程族', () => {
  it('全部 13 个模板可解析', () => {
    for (const t of EQUATION_TEMPLATES) {
      const r = parseEquation(t.equation);
      expect(r.kind, `模板「${t.name}」${t.equation}`).not.toBe('error');
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

  it('圆半径/椭圆参数非正 → 明确报错', () => {
    expect(parseEquation('x²+y²=0')).toEqual({ kind: 'error', message: '圆的半径必须为正' });
    expect(parseEquation('x²/0+y²/4=1')).toEqual({ kind: 'error', message: '椭圆参数必须为正' });
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
  it('空输入 / 缺右侧', () => {
    expect(errorMessage('')).toBe('请输入方程');
    expect(errorMessage('   ')).toBe('请输入方程');
    expect(errorMessage('y=')).toBe('方程缺少右侧表达式');
  });

  it('不可识别的符号（AST 白名单拒绝）', () => {
    expect(errorMessage('y=foo(x)')).toBe('无法识别的符号 “foo”');
    expect(errorMessage('y=x+t')).toBe('无法识别的符号 “t”');
  });

  it('不可识别的字符（mathjs 会把 # 吞成 undefined 常量，须前置拦截）', () => {
    expect(errorMessage('#')).toBe('无法识别的字符 “#”');
    expect(errorMessage('y=2#3')).toBe('无法识别的字符 “#”');
    expect(errorMessage("y=x);require('fs')")).toBe('无法识别的字符 “;”');
  });

  it('括号 / 绝对值未闭合', () => {
    expect(errorMessage('y=sin(x')).toBe('括号或绝对值符号未闭合');
    expect(errorMessage('y=abs(x-1')).toBe('括号或绝对值符号未闭合');
    expect(errorMessage('y=|x-1')).toBe('括号或绝对值符号未闭合');
    expect(errorMessage('y=(x+1')).toBe('括号或绝对值符号未闭合');
  });

  it('表达式不完整 / 数字格式', () => {
    expect(errorMessage('y=2+')).toBe('表达式不完整');
    expect(errorMessage('y=sin()')).toBe('无法识别的表达式'); // 函数零参（arity 白名单）
    expect(errorMessage('2..5')).toBe('数字格式有误');
    expect(errorMessage('y=2.5.3')).toBe('数字格式有误');
  });

  it('隐式方程：仅支持圆/椭圆标准形（其余明确拒绝，不白屏）', () => {
    const msg = '暂不支持该隐式方程：请使用 y=f(x) 形式（圆/椭圆除外）';
    expect(errorMessage('x+y=1')).toBe(msg);
    expect(errorMessage('y=x+y')).toBe(msg);
    expect(errorMessage('x²-y²=1')).toBe(msg); // 双曲线（P2）
    expect(errorMessage('x²=2y')).toBe(msg); // 抛物线（P2）
    expect(errorMessage('a=2')).toBe(msg);
  });
});

describe('parseEquation 安全性（PRD §8 禁 eval / 公式注入）', () => {
  it('属性访问 / 赋值 / 条件 / 块节点一律拒绝', () => {
    expect(errorMessage('y=x.constructor')).toBe('无法识别的表达式'); // AccessorNode（字符白名单放行，AST 白名单拒绝）
    expect(errorMessage('y=__proto__.x')).toBe('无法识别的字符 “_”'); // 字符白名单前置拦截
    expect(errorMessage('y=x?1:2')).toBe('无法识别的字符 “?”');
    expect(errorMessage('y=x;1')).toBe('无法识别的字符 “;”');
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
    expect(validateEquation('y=2+')).toEqual({ kind: 'error', message: '表达式不完整' });
    expect(validateEquation('')).toEqual({ kind: 'error', message: '请输入方程' });
  });
});
