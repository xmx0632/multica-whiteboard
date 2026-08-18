/**
 * 运行时态缓存（技术方案 §6.3）。
 *
 * - 编译缓存：Map LRU，容量 100（键 = 归一化表达式串）。
 *   编译一次 ~1ms，同一方程逐键校验 / 重复采样均命中缓存。
 * - 渲染缓存（ZOO-135）：WeakMap<元素对象, {sig, polylines, view, path2d}>，
 *   键为元素对象引用 —— store 不可变更新换引用，旧条目失联自动回收；
 *   同引用 + 同 sig（平移/缩放/改颜色线宽/轴显隐）直接命中，不重采样。
 */
import type { EvalFunction, MathNode } from 'mathjs/number';
import type { MathViewport, Polyline } from './types';

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

/**
 * —— 渲染缓存（技术方案 §6.3 折线/Path2D 层，ZOO-135）——
 *
 * sig 由调用方（plot.ts resolvePlotRender）拼装：equation / kind / 视窗 /
 * 采样档 / 元素尺寸。颜色线宽透明度、轴网显隐**不在 sig 中** —— 改样式只
 * 需对既有 Path2D 重新 stroke；视口平移缩放更不进入 sig（60fps 保证）。
 */
export interface PlotRenderEntry {
  sig: string;
  polylines: Polyline[];
  view: MathViewport;
  error?: string;
  /** 元素局部 px 的矢量路径；Node/单测环境无 Path2D 时为 null（绘制走折线回退） */
  path2d: Path2D | null;
}

const plotCache = new WeakMap<object, PlotRenderEntry>();
let plotCacheWrites = 0;

/**
 * 元素 id → 稳定缓存键（ZOO-136 集成）。渲染缓存若直接以元素对象引用为键，
 * store 不可变更新（拖拽移动 / updateElementTransient 调参 / 撤销重做）每帧换
 * 引用 → 全量 miss，违反 §6.3「平移 / 改颜色线宽透明度不重采样」。改为按 id
 * 取同一 token 对象作 WeakMap 键：引用换、id 不变即命中；LRU 封顶防泄漏
 * （淘汰的 token 失联后 WeakMap 条目自动回收）。
 */
const PLOT_TOKEN_MAX = 256;
const plotTokens = new Map<string, object>();

export function plotTokenFor(id: string): object {
  const hit = plotTokens.get(id);
  if (hit) {
    plotTokens.delete(id);
    plotTokens.set(id, hit);
    return hit;
  }
  const token = {};
  plotTokens.set(id, token);
  while (plotTokens.size > PLOT_TOKEN_MAX) {
    const oldest = plotTokens.keys().next().value;
    if (oldest === undefined) break;
    plotTokens.delete(oldest);
  }
  return token;
}

/** 渲染签名（键序由调用方固定，保证同输入同签名）。 */
export function plotSignature(parts: Record<string, unknown>): string {
  return JSON.stringify(parts);
}

/** 按元素对象引用取渲染缓存；未命中或签名不符由调用方重建。 */
export function getPlotRender(key: object): PlotRenderEntry | undefined {
  return plotCache.get(key);
}

/** 写入渲染缓存（覆盖同引用旧条目；写入即计数，供测试差分观测）。 */
export function setPlotRender(key: object, entry: PlotRenderEntry): void {
  plotCacheWrites++;
  plotCache.set(key, entry);
}

/** 仅供测试：累计写入（set）次数 —— 差分观测「命中不写 / 签名变才重建」。 */
export function plotRenderWriteCount(): number {
  return plotCacheWrites;
}
