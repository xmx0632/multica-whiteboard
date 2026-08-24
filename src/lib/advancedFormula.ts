/**
 * 高级公式入口判定（ZOO-194 T0）与「×10 邻域放大」预设换算（ZOO-193 T6）。
 *
 * 编辑侧（MathPlotParams）「公式设置」按钮的显隐与徽标数：仅当元素带
 * overlays（T2 叠加）/ constants（T1 常量）/ 基础 kind 之外的新 kind
 * （T4 parametric / polar）时出现；普通元素 visible=false —— 属性面板
 * 不出现任何新控件，创建 / 编辑全流程与现状一致（零回归硬约束）。
 *
 * 输入为结构化最小形状：字段未上线时缺省即「无高级能力」，T1/T2/T4 给
 * MathPlotElement 增补可选字段后无需改此处即可自动透出。判定口径为
 * 「有实际生效内容」——overlays 数组、constants 字典均非空才计数，
 * 被 T2/T3 清空的旧高级元素回到普通元素表现（后续任务如改存空壳字段，
 * 在各自任务里调整本口径即可）。
 */
import { MIN_DOMAIN_WIDTH } from './math/sample';

/** 基础 kind 集合：当前已上线方程分类，之外的新 kind（T4 起增补）视为高级能力信号 */
const BASIC_KINDS: ReadonlySet<string> = new Set([
  'explicit',
  'line',
  'linePair',
  'point',
  'parabola',
  'hyperbola',
  'circle',
  'ellipse',
  'error',
]);

/**
 * 判定输入的最小结构（MathPlotElement 现状与 T1/T2/T4 增补字段后均满足）。
 * kind 缺省按「非新 kind」处理（保守：仅 overlays/constants 信号可点亮入口）。
 */
export interface AdvancedFormulaSignal {
  kind?: string;
  /** T2 起的叠加列表（derivative / tangent / integral …） */
  overlays?: readonly unknown[];
  /** T1 起的符号常量绑定（v0 / theta / omega …） */
  constants?: Record<string, number>;
}

export interface AdvancedFormulaState {
  /** 「公式设置」入口是否出现 */
  visible: boolean;
  /** 已开启叠加数（入口徽标；非 overlays 信号为 0） */
  overlayCount: number;
}

/** 元素 → 高级公式入口状态（PropertyPanel 据此填充 MathPlotParamsValue.advanced）。 */
export function advancedFormulaState(el: AdvancedFormulaSignal): AdvancedFormulaState {
  const overlayCount = Array.isArray(el.overlays) ? el.overlays.length : 0;
  const hasConstants = el.constants !== undefined && Object.keys(el.constants).length > 0;
  const isNewKind = el.kind !== undefined && !BASIC_KINDS.has(el.kind);
  return {
    visible: overlayCount > 0 || hasConstants || isNewKind,
    overlayCount,
  };
}

/** 12 位有效数字舍入：剥掉「中心 ± 半宽」换算的浮点尾噪（面板数值输入直显）。 */
const round12 = (v: number) => Number(v.toPrecision(12));

/**
 * 「×10 邻域放大」预设换算（ZOO-193 T6）——以 center（缺省取当前域中心）为心
 * 把定义域收窄 10 倍，加速 tan(x)、1/x 等极限 / 渐近行为的演示（配采样档 640）。
 *
 * 换算规则（单测覆盖）：
 * - 中心：缺省取当前域中心；显式传入时钳制在当前域内（域外取最近边界）；
 * - 宽度：目标 = 当前宽度 / 10，地板对齐采样层 MIN_DOMAIN_WIDTH（0.1——更窄
 *   的域采样层直接报错）；已到地板（新宽 ≥ 当前宽）时原样返回，连续点击幂等，
 *   不会把域压进采样非法区间；
 * - 边界钳制：新窗口整体平移回当前域内（越左界右移贴边 / 越右界左移贴边），
 *   不产生域外采样段；
 * - 非法域（倒序 / 非有限）原样返回——预设只做换算，不修复数据。
 */
export function zoomNeighborhood(
  domain: { min: number; max: number },
  center?: number,
): { min: number; max: number } {
  const { min, max } = domain;
  const width = max - min;
  if (!Number.isFinite(width) || width <= 0) return { min, max };
  const newWidth = Math.max(width / 10, MIN_DOMAIN_WIDTH);
  if (newWidth >= width) return { min, max };
  const c =
    center !== undefined && Number.isFinite(center)
      ? Math.min(Math.max(center, min), max)
      : (min + max) / 2;
  let lo = c - newWidth / 2;
  let hi = lo + newWidth;
  if (lo < min) {
    lo = min;
    hi = min + newWidth;
  }
  if (hi > max) {
    hi = max;
    lo = max - newWidth;
  }
  return { min: round12(lo), max: round12(hi) };
}
