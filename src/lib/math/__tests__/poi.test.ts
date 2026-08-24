/**
 * POI 数值求解测试（ZOO-199）：零点 / 极值 / 交点三类 + 边界口径。
 * 验收基线：y=sin(x) ∩ y=x/3 交点误差 < 1e-3；y=x^2−2x−3 的极值点与两个零点。
 */
import { describe, expect, it } from 'vitest';
import { derivativeOf } from '../calculus';
import {
  extremaOf,
  formatPoiCoord,
  intersectionsOf,
  zerosOf,
} from '../poi';

const sin = (x: number) => Math.sin(x);
const quad = (x: number) => x * x - 2 * x - 3; // 零点 −1 / 3，极小 (1, −4)
const tan = (x: number) => Math.tan(x);

describe('zerosOf（零点：变号 + 二分）', () => {
  it('y=x^2−2x−3 在 [-10,10] 的两个零点（验收：误差远小于 1e-3）', () => {
    const zeros = zerosOf(quad, -10, 10);
    expect(zeros).toHaveLength(2);
    expect(Math.abs(zeros[0] + 1)).toBeLessThan(1e-6);
    expect(Math.abs(zeros[1] - 3)).toBeLessThan(1e-6);
  });

  it('y=sin(x) 在 [-10,10] 收全部 7 个零点（含 0 与 ±π, ±2π, ±3π）', () => {
    const zeros = zerosOf(sin, -10, 10);
    expect(zeros).toHaveLength(7);
    for (const k of [-3, -2, -1, 0, 1, 2, 3]) {
      const expectAt = k * Math.PI;
      expect(zeros.some((z) => Math.abs(z - expectAt) < 1e-6)).toBe(true);
    }
  });

  it('无零点函数返回空（y=x^2+1）', () => {
    expect(zerosOf((x) => x * x + 1, -10, 10)).toEqual([]);
  });

  it('非有限区间跳过（y=1/x 全域无根，渐近线两侧不误报）', () => {
    expect(zerosOf((x) => 1 / x, -10, 10)).toEqual([]);
  });

  it('tan 渐近线不产生假零点（[-4,4] 真根仅 kπ 三个，±π/2 不收）', () => {
    const zeros = zerosOf(tan, -4, 4, 10); // ySpan=10：±π/2 邻域双侧大跳被滤
    expect(zeros).toHaveLength(3); // −π, 0, π（tan 的真零点）
    for (const z of zeros) expect(Math.abs(Math.sin(z))).toBeLessThan(1e-6);
    for (const half of [Math.PI / 2, -Math.PI / 2]) {
      expect(zeros.some((z) => Math.abs(z - half) < 1e-3)).toBe(false);
    }
  });

  it('空域 / 倒序域返回空', () => {
    expect(zerosOf(sin, 5, 5)).toEqual([]);
    expect(zerosOf(sin, 5, -5)).toEqual([]);
  });
});

describe('extremaOf（极值：导函数变号 + 分类）', () => {
  it('y=x^2−2x−3 的极小点 (1, −4)（验收：极值点正确标注）', () => {
    const d = derivativeOf('y=x^2-2x-3');
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const ext = extremaOf(quad, d.fn, -10, 10);
    expect(ext).toHaveLength(1);
    expect(Math.abs(ext[0].x - 1)).toBeLessThan(1e-6);
    expect(Math.abs(ext[0].y + 4)).toBeLessThan(1e-6);
    expect(ext[0].kind).toBe('min');
  });

  it('y=sin(x) 在 [-10,10] 共 6 个极值，min / max 交替', () => {
    const d = derivativeOf('y=sin(x)');
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const ext = extremaOf(sin, d.fn, -10, 10);
    expect(ext).toHaveLength(6);
    for (let i = 0; i < ext.length - 1; i++) {
      expect(ext[i].kind).not.toBe(ext[i + 1].kind);
    }
    // x≈π/2 处为极大 y≈1；x≈−π/2 处为极小 y≈−1
    const nearMax = ext.find((e) => Math.abs(e.x - Math.PI / 2) < 1e-4);
    const nearMin = ext.find((e) => Math.abs(e.x + Math.PI / 2) < 1e-4);
    expect(nearMax?.kind).toBe('max');
    expect(Math.abs(nearMax!.y - 1)).toBeLessThan(1e-6);
    expect(nearMin?.kind).toBe('min');
    expect(Math.abs(nearMin!.y + 1)).toBeLessThan(1e-6);
  });

  it('dfn 为 null（求导不支持）返回空', () => {
    expect(extremaOf(sin, null, -10, 10)).toEqual([]);
  });

  it('驻点非极值（y=x^3 在 0 处 f′ 不变号）不收', () => {
    const d = derivativeOf('y=x^3');
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(extremaOf((x) => x ** 3, d.fn, -10, 10)).toEqual([]);
  });
});

describe('intersectionsOf（两曲线交点：差函数变号 + 二分）', () => {
  it('y=sin(x) ∩ y=x/3 三交点，误差 < 1e-3（验收：视觉不可辨）', () => {
    const pts = intersectionsOf(sin, (x) => x / 3, -10, 10);
    expect(pts).toHaveLength(3);
    const xs = pts.map((p) => p.x).sort((a, b) => a - b);
    expect(Math.abs(xs[0] + 2.2788627)).toBeLessThan(1e-3);
    expect(Math.abs(xs[1])).toBeLessThan(1e-3);
    expect(Math.abs(xs[2] - 2.2788627)).toBeLessThan(1e-3);
    // 交点 y 与两曲线一致（落在两条曲线上）
    for (const p of pts) {
      expect(Math.abs(sin(p.x) - p.y)).toBeLessThan(1e-9);
    }
  });

  it('定义域交集外不相交（y=x 与 y=x+2 平行；y=x² 与 y=−x² 仅切点不收）', () => {
    expect(intersectionsOf((x) => x, (x) => x + 2, -10, 10)).toEqual([]);
    expect(intersectionsOf((x) => x * x, (x) => -(x * x), -10, 10)).toEqual([]);
  });

  it('一次交会 + 部分重叠（y=0 与 y=sin(x) 就是零点问题，7 个）', () => {
    const pts = intersectionsOf(sin, () => 0, -10, 10);
    expect(pts).toHaveLength(7);
  });

  it('完全重合的两条曲线（同方程求交）不产生伪交点（ZOO-199 修复）', () => {
    // 重合：diff ≡ 0——每个采样点 |f|≤eps，全跳过
    expect(intersectionsOf(sin, (x) => Math.sin(x), -10, 10)).toEqual([]);
    expect(intersectionsOf(quad, (x) => x * x - 2 * x - 3, -10, 10)).toEqual([]);
    // 噪声级重合（浮点噪声 ~1e-16 被零簇吸收，不当变号）
    const noisy = (x: number) => Math.sin(x) + (x * 1e-16);
    expect(intersectionsOf(sin, noisy, -10, 10)).toEqual([]);
  });

  it('孤立切零仍收：y=x³ 在 0 处与 y=0 相切（单点 |f|≤eps 的对称情形不误杀变号根）', () => {
    // x³ 与 0 的差 = x³：变号根 0（fa·fb<0 二分路径，非零簇路径）
    const pts = intersectionsOf((x) => x ** 3, () => 0, -1, 1);
    expect(pts).toHaveLength(1);
    expect(Math.abs(pts[0].x)).toBeLessThan(1e-6);
  });

  it('域无交集返回空', () => {
    expect(intersectionsOf(sin, (x) => x / 3, 5, 5)).toEqual([]);
  });
});

describe('formatPoiCoord（标注文本：canvas / SVG / 悬停共用）', () => {
  it('≤2 位小数去尾零、−0 归 0', () => {
    expect(formatPoiCoord(1, -4)).toBe('(1, -4)');
    expect(formatPoiCoord(2.2788627, 0.7596208)).toBe('(2.28, 0.76)');
    expect(formatPoiCoord(-0.0001, -0)).toBe('(0, 0)');
    expect(formatPoiCoord(0.5, 1.5)).toBe('(0.5, 1.5)');
  });
});
