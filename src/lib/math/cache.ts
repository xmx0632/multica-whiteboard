/**
 * 运行时态缓存（技术方案 §6.3）—— 编译缓存：Map LRU，容量 100。
 *
 * 仅缓存 mathjs compile 产物（键 = 归一化表达式串）；采样折线 / Path2D 的
 * WeakMap 元素级缓存随 ZOO-135（渲染）扩展到本模块。
 * 编译一次 ~1ms，同一方程逐键校验 / 重复采样均命中缓存。
 */
import type { EvalFunction, MathNode } from 'mathjs/number';

const COMPILE_CACHE_MAX = 100;

const compiledCache = new Map<string, EvalFunction>();

/** 取编译产物；命中时刷新 LRU 新鲜度。未命中返回 undefined。 */
export function getCompiled(expr: string): EvalFunction | undefined {
  const hit = compiledCache.get(expr);
  if (hit !== undefined) {
    compiledCache.delete(expr);
    compiledCache.set(expr, hit);
  }
  return hit;
}

/** 写入编译产物；超容量时淘汰最旧条目。 */
export function setCompiled(expr: string, compiled: EvalFunction): void {
  if (compiledCache.has(expr)) compiledCache.delete(expr);
  compiledCache.set(expr, compiled);
  while (compiledCache.size > COMPILE_CACHE_MAX) {
    const oldest = compiledCache.keys().next().value;
    if (oldest === undefined) break;
    compiledCache.delete(oldest);
  }
}

/** 编译（带 LRU 缓存）。表达式字符串不变则不重复 compile。 */
export function compileCached(expr: string, node: MathNode): EvalFunction {
  const hit = getCompiled(expr);
  if (hit) return hit;
  const compiled = node.compile();
  setCompiled(expr, compiled);
  return compiled;
}

/** 仅供测试：当前缓存条目数。 */
export function compiledCacheSize(): number {
  return compiledCache.size;
}

/** 仅供测试：清空缓存。 */
export function clearCompiledCache(): void {
  compiledCache.clear();
}
