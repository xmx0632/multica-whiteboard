/**
 * 常量滑块与动画播放（ZOO-197）——纯函数层，UI（高级公式面板常量区）与
 * 单测共用，不含 React / DOM。
 *
 * - 滑块元数据（min/max/step）是元素可选字段 constantSliders 的成员；缺省
 *   一律回落 DEFAULT_SLIDER（-10~10、步长 0.1）——旧文档零迁移、行为不变。
 * - normalizeSliderMeta：非法输入逐项裁剪（非有限数回默认、step≤0 回默认、
 *   min≥max 整体回默认），任何输入产出可用元数据。
 * - advanceSliderAnimation：播放步进（时间驱动 + 往复边界反射）。单程时长
 *   SLIDER_SWEEP_MS（1x 4s 走满全量程），速度只乘速率。
 */

/** 滑块元数据（元素字段 constantSliders 的成员；序列化纯数据）。 */
export interface ConstantSliderMeta {
  min: number;
  max: number;
  step: number;
}

/** 元素字段形态：键为存储层 ASCII 常量名（与 constants 同键集的子集）。 */
export type ConstantSliderMap = Record<string, ConstantSliderMeta>;

/** 缺省滑块：范围 -10~10、步长 0.1（未自定义元数据的常量一律用它）。 */
export const DEFAULT_SLIDER: ConstantSliderMeta = { min: -10, max: 10, step: 0.1 };

/** 播放速度档（点击循环切换；值为速率倍数）。 */
export const SLIDER_SPEEDS = [0.5, 1, 2] as const;
export type SliderSpeed = (typeof SLIDER_SPEEDS)[number];

/** 单程时长（ms）：1x 速度下走满 min→max 全量程的时间（Desmos 课堂节奏）。 */
export const SLIDER_SWEEP_MS = 4000;

/** rAF 帧间隔上限（ms）：后台标签页恢复 / 掉帧后的一次性大 dt 不追赶。 */
export const SLIDER_DT_CLAMP_MS = 100;

/**
 * 滑块元数据裁剪：逐字段取有限数（非法 / 缺省回 DEFAULT_SLIDER 对应项），
 * step 必须 >0；min ≥ max 视为不可用范围，min/max 整体回默认（step 保留
 * 已裁剪值）。任何输入都产出 min<max、step>0 的可用元数据。
 */
export function normalizeSliderMeta(raw?: Partial<ConstantSliderMeta>): ConstantSliderMeta {
  const min = Number.isFinite(raw?.min) ? raw!.min! : DEFAULT_SLIDER.min;
  const max = Number.isFinite(raw?.max) ? raw!.max! : DEFAULT_SLIDER.max;
  const step = Number.isFinite(raw?.step) && raw!.step! > 0 ? raw!.step! : DEFAULT_SLIDER.step;
  if (min >= max) return { min: DEFAULT_SLIDER.min, max: DEFAULT_SLIDER.max, step };
  return { min, max, step };
}

/** 取某常量的有效滑块元数据（缺省回落 DEFAULT_SLIDER）。 */
export function sliderMetaFor(sliders: ConstantSliderMap | undefined, key: string): ConstantSliderMeta {
  return normalizeSliderMeta(sliders?.[key]);
}

/** 值裁剪进滑块范围（精确贴界：越界值贴 min/max）。 */
export function clampToSlider(value: number, meta: ConstantSliderMeta): number {
  if (!Number.isFinite(value)) return meta.min;
  return Math.min(meta.max, Math.max(meta.min, value));
}

/** 存储值圆整到两位小数（播放逐帧写入的显示精度；拖动/输入路径同用）。 */
export function roundSliderValue(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 播放一步：按真实帧间隔 dtMs 推进常量值，越界反射（往复 ping-pong）。
 *
 * 速率 = 量程 × speed / SLIDER_SWEEP_MS（单位 / ms）——单程恒为
 * SLIDER_SWEEP_MS / speed，与量程无关。dtMs ≤0 或量程非正时原值返回
 *（仅贴界裁剪）。反射最多 64 次（调用方另有 SLIDER_DT_CLAMP_MS 帧间隔
 * 上限，正常每帧至多反射一次），超限贴界兜底。
 */
export function advanceSliderAnimation(
  value: number,
  dir: 1 | -1,
  dtMs: number,
  speed: SliderSpeed,
  meta: ConstantSliderMeta,
): { value: number; dir: 1 | -1 } {
  const range = meta.max - meta.min;
  if (!(range > 0) || !Number.isFinite(dtMs) || dtMs <= 0) {
    return { value: clampToSlider(value, meta), dir };
  }
  const delta = (range * speed * dtMs) / SLIDER_SWEEP_MS;
  let v = value + dir * delta;
  let d = dir;
  let guard = 0;
  while ((v > meta.max || v < meta.min) && guard++ < 64) {
    if (v > meta.max) {
      v = 2 * meta.max - v;
      d = -1;
    } else {
      v = 2 * meta.min - v;
      d = 1;
    }
  }
  if (v > meta.max) v = meta.max;
  if (v < meta.min) v = meta.min;
  // 反射产生的浮点残差贴界（边界值精确等于 min/max，测试可断言）
  if (Math.abs(v - meta.max) < 1e-9) v = meta.max;
  if (Math.abs(v - meta.min) < 1e-9) v = meta.min;
  return { value: v, dir: d };
}

/** 预置常量缺省值（g/θ/ω… 教学惯用值；未知名一律 1）。 */
const PRESET_DEFAULT_VALUES: Record<string, number> = {
  g: 9.8,
  v0: 1,
  theta: Math.PI / 4,
  omega: 1,
  a: 1,
  phi: 0,
};

/** 一键建滑块的初值：预置名取教学惯用值，其余 1。 */
export function constantDefaultValue(key: string): number {
  return PRESET_DEFAULT_VALUES[key] ?? 1;
}

/**
 * 滑块元数据快照清洗（载荷 / 面板全量更新共用）：逐键裁剪元数据，并剔除
 * 未绑定常量的键（常量移除后滑块元数据同步消亡，元素不留悬挂条目）。
 * 空结果返回 undefined（元素无空壳字段，与 constants/overlays 同口径）。
 */
export function cleanSliderMap(
  sliders: ConstantSliderMap | undefined,
  constants: Record<string, number> | undefined,
): ConstantSliderMap | undefined {
  if (!sliders) return undefined;
  const out: ConstantSliderMap = {};
  for (const [key, raw] of Object.entries(sliders)) {
    if (!constants || !(key in constants)) continue;
    out[key] = normalizeSliderMeta(raw);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 下一档播放速度（0.5x → 1x → 2x → 0.5x 循环）。 */
export function nextSliderSpeed(speed: SliderSpeed): SliderSpeed {
  const i = SLIDER_SPEEDS.indexOf(speed);
  return SLIDER_SPEEDS[(i + 1) % SLIDER_SPEEDS.length];
}
