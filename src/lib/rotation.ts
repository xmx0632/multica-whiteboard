import type { Point } from './types';

/**
 * 旋转几何原语（ZOO-221 矩形旋转系列 PR-R1）：归一化 / 读值 / 点旋转——
 * renderer（绘制 / AABB / 命中逆旋转）与后续交互 PR 共用一份角度口径。
 * 全部为屏幕系（y 向下）：正角 = 顺时针，与 canvas ctx.rotate、
 * SVG transform="rotate(θ)" 同向，画布与导出天然一致。
 */

/** 归一到 [0, 360)：存储口径——负角 / ≥360 的输入均落到同一代表元 */
export function normalizeRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 元素当前旋转角（度）：字段缺省 = 0（旧文档零迁移），读值统一归一 */
export function elementRotation(el: { rotation?: number }): number {
  return el.rotation === undefined ? 0 : normalizeRotation(el.rotation);
}

/** 点绕中心旋转 rad 弧度（屏幕系顺时针正）；逆旋转传 -rad */
export function rotatePointAround(p: Point, center: Point, rad: number): Point {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/**
 * 步进吸附（ZOO-222 交互层）：拖转按住 Shift → 角度取整到 step 网格（默认 15°，
 * Excalidraw/Miro 惯例），结果仍归一 [0,360)。
 */
export function stepRotation(deg: number, step = 15): number {
  return normalizeRotation(Math.round(deg / step) * step);
}

/**
 * 指针（或任一点）从世界系映射进旋转元素的局部系（ZOO-222）：绕外框几何中心
 * 逆旋转 rotDeg——rotDeg = 0 原样返回（与旧代码逐字节等价）。选中框控点命中与
 * boxResizePatch 缩放适配共用：刚体变换下局部系的对角锚定 / Shift 等比语义零改动。
 */
export function pointerToLocalFrame(
  world: Point,
  frame: { x: number; y: number; width: number; height: number },
  rotDeg: number,
): Point {
  if (rotDeg === 0) return world;
  return rotatePointAround(
    world,
    { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
    -(rotDeg * Math.PI) / 180,
  );
}
