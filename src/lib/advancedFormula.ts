/**
 * 高级公式入口判定（ZOO-194 T0）。
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
