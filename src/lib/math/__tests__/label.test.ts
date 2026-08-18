import { describe, expect, it } from 'vitest';
import { beautifyEquation } from '../label';

describe('beautifyEquation（方程 chip 的 Unicode 美化）', () => {
  it('pi → π（词边界，大小写不敏感）', () => {
    expect(beautifyEquation('y=2sin(2x+pi/3)')).toBe('y=2sin(2x+π/3)');
    expect(beautifyEquation('y=PI')).toBe('y=π');
    expect(beautifyEquation('y=spin(x)')).toBe('y=spin(x)'); // pi 嵌在词中不动
  });

  it('^2 / ^3 → 上标（后随数字时保留防歧义）', () => {
    expect(beautifyEquation('y=x^2-2x-3')).toBe('y=x²-2x-3');
    expect(beautifyEquation('y=x^3-2x')).toBe('y=x³-2x');
    expect(beautifyEquation('y=x^23')).toBe('y=x^23'); // ^23 不是平方，保留
    expect(beautifyEquation('y=x^2.5')).toBe('y=x^2.5');
  });

  it('sqrt( → √(；显式乘号 * → ·', () => {
    expect(beautifyEquation('y=sqrt(x)')).toBe('y=√(x)');
    expect(beautifyEquation('y=2*x+1')).toBe('y=2·x+1');
  });

  it('原文已是 Unicode 则保持不变', () => {
    expect(beautifyEquation('y=x²-2x-3')).toBe('y=x²-2x-3');
    expect(beautifyEquation('y=√x')).toBe('y=√x');
    expect(beautifyEquation('y=2sin(2x+π/3)')).toBe('y=2sin(2x+π/3)');
  });
});
