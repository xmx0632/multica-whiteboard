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
