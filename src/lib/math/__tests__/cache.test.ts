import { describe, expect, it } from 'vitest';
import { parse } from 'mathjs/number';
import {
  clearCompiledCache,
  compileCached,
  compiledCacheSize,
  getCompiled,
  setCompiled,
} from '../cache';

describe('编译缓存（Map LRU，容量 100，技术方案 §6.3）', () => {
  it('同表达式复用同一编译产物', () => {
    clearCompiledCache();
    const c1 = compileCached('x^2', parse('x^2'));
    const c2 = compileCached('x^2', parse('x^2'));
    expect(c1).toBe(c2);
    expect(compiledCacheSize()).toBe(1);
  });

  it('超容量淘汰最旧条目', () => {
    clearCompiledCache();
    for (let i = 0; i < 105; i++) {
      const expr = `x+${i}`;
      setCompiled(expr, parse(expr).compile());
    }
    expect(compiledCacheSize()).toBe(100);
    expect(getCompiled('x+0')).toBeUndefined(); // 最旧被淘汰
    expect(getCompiled('x+104')).toBeDefined(); // 最新仍在
  });

  it('读取刷新新鲜度（不被中途淘汰）', () => {
    clearCompiledCache();
    setCompiled('keep', parse('1').compile());
    for (let i = 0; i < 100; i++) {
      const expr = `y${i}`;
      setCompiled(expr, parse('2').compile()); // 值无关，仅占位
      getCompiled('keep'); // 每轮刷新
    }
    expect(compiledCacheSize()).toBe(100);
    expect(getCompiled('keep')).toBeDefined();
  });
});
