import { describe, expect, it } from 'vitest';
import { normalizeEquation } from '../normalize';

describe('normalizeEquation 符号翻译', () => {
  it('空白与大小写归一', () => {
    expect(normalizeEquation(' y = SIN( X ) ')).toBe('y=sin(x)');
    expect(normalizeEquation('Y=2X+1')).toBe('y=2x+1');
  });

  it('π → pi', () => {
    expect(normalizeEquation('y=π')).toBe('y=pi');
    expect(normalizeEquation('y=2π')).toBe('y=2pi');
  });

  it('上标 → ^n', () => {
    expect(normalizeEquation('y=x²')).toBe('y=x^2');
    expect(normalizeEquation('y=x³-2x')).toBe('y=x^3-2x');
    expect(normalizeEquation('y=2ˣ')).toBe('y=2^x');
    expect(normalizeEquation('y=x⁵')).toBe('y=x^5');
  });

  it('√ → sqrt（裸 token / 括号 / 嵌套括号）', () => {
    expect(normalizeEquation('y=√x')).toBe('y=sqrt(x)');
    expect(normalizeEquation('y=√2')).toBe('y=sqrt(2)');
    expect(normalizeEquation('y=√(x+1)')).toBe('y=sqrt(x+1)');
    expect(normalizeEquation('y=√(sin(x)+1)')).toBe('y=sqrt(sin(x)+1)');
    expect(normalizeEquation('y=2√3')).toBe('y=2sqrt(3)');
  });

  it('|…| → abs(…)', () => {
    expect(normalizeEquation('y=|x-1|')).toBe('y=abs(x-1)');
    expect(normalizeEquation('y=|x|')).toBe('y=abs(x)');
    expect(normalizeEquation('y=sin(|x-1|)+1')).toBe('y=sin(abs(x-1))+1');
  });

  it('运算符与全角符号', () => {
    expect(normalizeEquation('y=2·x')).toBe('y=2*x');
    expect(normalizeEquation('y=2×x')).toBe('y=2*x');
    expect(normalizeEquation('y=6÷2')).toBe('y=6/2');
    expect(normalizeEquation('y=1−x')).toBe('y=1-x');
    expect(normalizeEquation('y=f（x）')).toBe('y=f(x)');
    expect(normalizeEquation('log(x，2)')).toBe('log(x,2)');
  });

  it('ln → log（mathjs 无 ln，自然对数记号统一）', () => {
    expect(normalizeEquation('y=ln(x)')).toBe('y=log(x)');
    expect(normalizeEquation('y=ln(x)+1')).toBe('y=log(x)+1');
  });
});

describe('normalizeEquation 字母连写隐式乘法（拆已知标识符，未知整段保留）', () => {
  it('2πx / 2pix → 2·pi·x（原型承诺形态）', () => {
    expect(normalizeEquation('y=2πx')).toBe('y=2pi*x');
    expect(normalizeEquation('y=2pix')).toBe('y=2pi*x');
  });

  it('xsin(x) → x*sin(x)', () => {
    expect(normalizeEquation('y=xsin(x)')).toBe('y=x*sin(x)');
  });

  it('asin 贪心优先于 sin（长名在前）', () => {
    expect(normalizeEquation('y=asin(x)')).toBe('y=asin(x)');
    expect(normalizeEquation('y=asinx')).toBe('y=asin*x');
  });

  it('未知字母段不拆分，保留整段供错误提示', () => {
    expect(normalizeEquation('y=foo(x)')).toBe('y=foo(x)');
    expect(normalizeEquation('y=xyz')).toBe('y=xyz');
  });

  it('已知函数名保持完整（sqrt/abs 转换产物不受拆分影响）', () => {
    expect(normalizeEquation('y=2sin(2x+π/3)')).toBe('y=2sin(2x+pi/3)');
    expect(normalizeEquation('y=abs(x-1)')).toBe('y=abs(x-1)');
  });

  it('y 进入切分表（ZOO-146 / D7：字母连写含 y 可拆）', () => {
    // 数字-字母邻接（2y）由 mathjs 原生隐式乘法处理，不进切分；字母-字母（xy/yx）必须拆
    expect(normalizeEquation('2y')).toBe('2y');
    expect(normalizeEquation('3xy+2y=6')).toBe('3x*y+2y=6');
    expect(normalizeEquation('yx')).toBe('y*x');
  });
});
