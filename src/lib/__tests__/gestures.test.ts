import { describe, it, expect } from 'vitest';
import {
  MIN_SCALE,
  MAX_SCALE,
  clampScale,
  distance,
  midpoint,
  pinchViewport,
  shouldPromoteToPinch,
  zoomAt,
} from '../gestures';

const vp = (offsetX = 0, offsetY = 0, scale = 1) => ({ offsetX, offsetY, scale });

describe('clampScale', () => {
  it('夹取到 [0.1, 5]（与 wheel 缩放边界一致）', () => {
    expect(clampScale(0.01)).toBe(0.1);
    expect(clampScale(100)).toBe(5);
    expect(clampScale(2)).toBe(2);
  });
});

describe('shouldPromoteToPinch（单指/双指判定）', () => {
  it('单指（0/1）不提升 —— 维持当前工具操作', () => {
    expect(shouldPromoteToPinch(0)).toBe(false);
    expect(shouldPromoteToPinch(1)).toBe(false);
  });
  it('双指及以上提升为画布平移缩放', () => {
    expect(shouldPromoteToPinch(2)).toBe(true);
    expect(shouldPromoteToPinch(3)).toBe(true);
  });
});

describe('zoomAt（缩放中心锚定，wheel / pinch 共用）', () => {
  it('锚点下的世界点在缩放后保持不动', () => {
    const start = vp(30, -20, 1);
    const anchor = { x: 120, y: 80 };
    const before = { x: (anchor.x - start.offsetX) / start.scale, y: (anchor.y - start.offsetY) / start.scale };
    const next = zoomAt(start, anchor, 2.5);
    const after = { x: (anchor.x - next.offsetX) / next.scale, y: (anchor.y - next.offsetY) / next.scale };
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  it('与原 wheel 缩放公式代数等价（桌面回归保护）', () => {
    const start = vp(17, 9, 1.3);
    const mx = 200;
    const my = 150;
    const factor = 1.1;
    const newScale = Math.max(0.1, Math.min(5, start.scale * factor));
    const legacy = {
      offsetX: mx - (mx - start.offsetX) * (newScale / start.scale),
      offsetY: my - (my - start.offsetY) * (newScale / start.scale),
      scale: newScale,
    };
    expect(zoomAt(start, { x: mx, y: my }, start.scale * factor)).toEqual(legacy);
  });

  it('scale 夹取到边界', () => {
    expect(zoomAt(vp(0, 0, 1), { x: 0, y: 0 }, 99).scale).toBe(MAX_SCALE);
    expect(zoomAt(vp(0, 0, 1), { x: 0, y: 0 }, 0.001).scale).toBe(MIN_SCALE);
  });
});

describe('pinchViewport（双指平移 + 捏合缩放）', () => {
  // 基线快照：两指 (100,300)–(300,300)，距离 200，中点 (200,300)
  const snap = (viewport = vp(40, 20, 1)) => ({ viewport, a: { x: 100, y: 300 }, b: { x: 300, y: 300 } });

  it('等距平移：scale 不变，offset 平移中点位移', () => {
    const next = pinchViewport(snap(), { x: 120, y: 380 }, { x: 320, y: 380 });
    expect(next.scale).toBeCloseTo(1, 10);
    expect(next.offsetX).toBeCloseTo(40 + 20, 10); // 40 + (中点 x 位移 20)
    expect(next.offsetY).toBeCloseTo(20 + 80, 10); // 20 + (中点 y 位移 80)
  });

  it('中点不动的捏合缩放：scale 随距离比例，中点下世界点不动', () => {
    const start = snap(vp(10, 5, 1));
    const next = pinchViewport(start, { x: 150, y: 300 }, { x: 250, y: 300 }); // 200 → 100
    expect(next.scale).toBeCloseTo(0.5, 10);
    const worldBefore = { x: (200 - start.viewport.offsetX) / start.viewport.scale, y: (300 - start.viewport.offsetY) / start.viewport.scale };
    const worldAfter = { x: (200 - next.offsetX) / next.scale, y: (300 - next.offsetY) / next.scale };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 8);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 8);
  });

  it('平移与缩放合成：起点中点下的世界点落在当前中点下（缩放中心跟随双指中点）', () => {
    const start = snap(vp(-15, 33, 1.7));
    const a = { x: 90, y: 210 };
    const b = { x: 410, y: 290 };
    const next = pinchViewport(start, a, b);
    const midStart = midpoint(start.a, start.b);
    const mid = midpoint(a, b);
    expect(next.scale).toBeCloseTo(start.viewport.scale * (distance(a, b) / 200), 10);
    const w0 = { x: (midStart.x - start.viewport.offsetX) / start.viewport.scale, y: (midStart.y - start.viewport.offsetY) / start.viewport.scale };
    const w1 = { x: (mid.x - next.offsetX) / next.scale, y: (mid.y - next.offsetY) / next.scale };
    expect(w1.x).toBeCloseTo(w0.x, 8);
    expect(w1.y).toBeCloseTo(w0.y, 8);
  });

  it('捏合过度夹取到 scale 边界', () => {
    const next = pinchViewport(snap(vp(0, 0, 4.9)), { x: 199, y: 300 }, { x: 201, y: 300 }); // 200 → 2
    expect(next.scale).toBe(MIN_SCALE);
    const out = pinchViewport(snap(vp(0, 0, 4)), { x: -300, y: 300 }, { x: 700, y: 300 }); // 200 → 1000（4×5=20 → 夹到 5）
    expect(out.scale).toBe(MAX_SCALE);
  });

  it('双指起点重合的退化输入不产生 NaN', () => {
    const start = { viewport: vp(5, 5, 1), a: { x: 100, y: 100 }, b: { x: 100, y: 100 } };
    const next = pinchViewport(start, { x: 90, y: 100 }, { x: 110, y: 100 });
    expect(Number.isFinite(next.offsetX)).toBe(true);
    expect(Number.isFinite(next.offsetY)).toBe(true);
    expect(Number.isFinite(next.scale)).toBe(true);
  });
});
