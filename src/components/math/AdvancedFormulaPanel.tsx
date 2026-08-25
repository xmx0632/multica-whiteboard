'use client';

/**
 * 高级公式二级面板（ZOO-194 T0：框架与四分区；ZOO-188 T1：常量分区落地）。
 *
 * UI 分层（ZOO-186 报告 v1.1 §四）：微积分 / 物理能力独立入口 + 二级面板，
 * 现有 EquationEditor / MathPlotParams 的既有控件零改动。两个入口共用本组件：
 * - 入口 1（创建侧）：EquationEditor 模板分组区底部「微积分 / 物理公式…」；
 * - 入口 2（编辑侧）：MathPlotParams 条件出现的「公式设置」按钮。
 *
 * - 经 portal 挂 document.body：不进入侧面板的 transform 定位上下文，
 *   也不挤占既有面板布局（空间独立）；
 * - 开合是纯 UI 态（调用方 useState），不入元素数据、不入撤销历史；
 * - T1 常量区（constants 绑定非空时渲染，缺省保持 T0 占位）：预置槽
 *   （g/v₀/θ/ω/A/φ）+ 自定义项，值变更走「静默直改 + 提交一条」调参历史
 *   （技术方案 D5，onChange 实时预览 / onBlur·离散点击 onCommit 压快照）；
 *   存储层键为 ASCII 名（theta/v0），显示层经 constantDisplayName 还原原貌；
 * - ZOO-197 常量滑块：已绑定常量各带滑杆（默认 -10~10、步长 0.1，均可改）+
 *   精确数值输入；播放按钮驱动常量在 [min,max] 内往复（速度 0.5x/1x/2x，
 *   rAF 时间步进，math/slider.ts 纯函数）。播放 / 拖动全程走 D5「静默直改 +
 *   收尾提交一条」——撤销栈不被逐帧写入刷爆；欠定 / 缺赋值引导错误旁提供
 *   「一键建滑块」chips（parse 层 missingConstants）。
 * - T2 微积分区（ZOO-189，calculus 绑定时渲染）：f′ 叠加开关 + 切线演示开关
 *   与 x₀ 数值输入。求导惰性——渲染管线仅 overlays 非空时求导（勿逐键求导）；
 *   x₀ 输入 onChange 实时预览 / onBlur 提交一条（D5 同款）；非显式函数时控件
 *   禁用并提示（叠加数据保留，方程改回显式即恢复生效）；
 * - T3 积分区（ZOO-190，同微积分区）：定积分开关 + a/b 数值输入（a<b 且在
 *   定义域内校验，编辑侧经 binding.domain 传入；区间内无定义点由渲染层
 *   奇点防护报错 chip 兜底）；
 * - T4 参数式区（ZOO-191，parametric 绑定时渲染）：参数圆 / 心形线 / 摆线 /
 *   李萨如模板行（点选回填方程输入）+ t/θ 取值范围数值输入（当前方程是
 *   参数式 / 极坐标时激活，直改实时预览、失焦提交一条，D5 同款）；
 * - T5 物理区（ZOO-192，physics 绑定时渲染）：抛体 / 简谐 / 圆周模板行（点选
 *   回填方程 + 常量预置 + t 域预置 + 标注预置，插入即出图）+ 落地/峰值标注
 *   开关（仅参数式轨迹生效，标注数值随常量改值实时联动）+ 常量单位显示行
 *   （单位仅显示，不做量纲运算）；
 * - T6 极限邻域放大（ZOO-193，微积分区尾部）：中心数值输入（缺省取定义域
 *   中心）+ ×10 预设按钮，经 zoomNeighborhood 换算后一次 onChange + 一次
 *   onCommit（离散变更，D5）；仅显式函数可用（非显式沿既有禁用态，不做
 *   特殊分支）；创建侧无元素域（缺 onDomainChange）不渲染本控件。
 * - ZOO-204 方案 A（不适用控件组自动折叠）：真相源保持唯一（方程形态），
 *   「选择显示」由适用性自动完成——微积分区在非显式方程下整区折叠为一行
 *   原因；物理区 R·H 行 / 参数式区 t/θ 域行在各自不适用时折叠为原因行。
 *   折叠的是「死控件组」而非整区：模板行（模式切换入口）常显。四个分区
 *   标题均可点击折叠（教学聚焦）；手动开合为会话级纯 UI 态
 *   （advancedPanelCollapse.ts，刷新复位），禁用但数据保留的语义不变——
 *   展开后控件仍是禁用态，方程改回生效形态自动恢复。
 * - ZOO-204 后续（选中态与联动展开）：模板按钮在当前方程与模板方程一致时
 *   呈选中态（蓝边框 / 底色 / ✓ + aria-pressed，TemplateButton）；点击展开
 *   微积分分区联动展开关联的基础公式——常量区 + 基础方程面板的显式函数
 *   模板组（expandTemplateGroups，只增不减）；互斥面（参数式 / 物理分区、
 *   几何曲线 / 直线与方程组）不触碰。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n/I18nProvider';
import { PHYSICS_CONSTANT_UNITS } from '@/lib/math/physics';
import { PLOT_COLORS } from '@/lib/math/plot';
import { constantDisplayName, normalizeConstantKey, parseConstantValue } from '@/lib/math/normalize';
import { zoomNeighborhood } from '@/lib/advancedFormula';
import {
  advancedCollapseOpen,
  getAdvancedCollapseOverrides,
  setAdvancedCollapseOpen,
  subscribeAdvancedCollapse,
  type AdvancedCollapseKey,
} from '@/lib/advancedPanelCollapse';
import { expandTemplateGroups } from '@/lib/templateGroupCollapse';
import { addDragPoint, removeDragPoint } from '@/lib/math/dragPoint';
import type { DraggablePoint, MathPlotOverlay } from '@/lib/math/types';
import { validateEquation } from '@/lib/math/validate';
import {
  ADVANCED_TEMPLATES,
  EXPLICIT_FUNCTION_GROUP_IDS,
  PARAMETRIC_TEMPLATES,
  PHYSICS_TEMPLATES,
  advancedTemplateNameKey,
  physicsTemplateNameKey,
  type PhysicsTemplate,
} from '@/lib/math/templates';
import {
  advanceSliderAnimation,
  clampToSlider,
  constantDefaultValue,
  nextSliderSpeed,
  roundSliderValue,
  SLIDER_DT_CLAMP_MS,
  sliderMetaFor,
  type ConstantSliderMap,
  type ConstantSliderMeta,
  type SliderSpeed,
} from '@/lib/math/slider';

/**
 * T1 常量编辑区绑定（两入口共用）：创建侧由 EquationEditor 持草稿态，
 * 编辑侧由 MathPlotParams 直连元素（onChange → updateElementTransient 直改、
 * onCommit → 提交一条历史）。onApplyTemplate 供模板点选回填方程输入。
 * onChange 为函数式更新（prev → next）：同一批次内多次离散变更（连点预置槽）
 * 不受渲染闭包过期影响，逐次叠加而非相互覆盖。
 * ZOO-197：sliders / onSlidersChange 透传滑块元数据（仅存自定义条目，缺省
 * 回落 DEFAULT_SLIDER；常量移除时调用方同步剔除对应键）。
 * ZOO-201：points / onPointsChange 透传可拖点条目（仅显式函数方程渲染——
 * 面板增删区同口径只在显式态出现；绑定常量移除时条目同步剔除）。
 */
export interface AdvancedConstantsBinding {
  /** 当前方程文本（常量赋值后的解析状态行反馈） */
  equation: string;
  /** 常量绑定值（存储层 ASCII 键名） */
  values: Record<string, number>;
  /** 滑块元数据（存储层键名；未自定义的常量缺省条目） */
  sliders?: ConstantSliderMap;
  /**
   * 可拖点条目（ZOO-201）：直连元素 draggablePoints（同为真实字段）。增删为
   * 离散变更——本组件的增删处理自带一次 onCommit；常量移除时的同步剔除由
   * removeConstant 附带（同批一次提交，不双压历史）。
   */
  points?: DraggablePoint[];
  /** 值变更（函数式更新：入参为当前值，返回下一值；直改实时预览，不上历史） */
  onChange: (update: (prev: Record<string, number>) => Record<string, number>) => void;
  /** 滑块元数据变更（函数式更新；直改实时生效，离散变更 / 失焦时 onCommit 收口） */
  onSlidersChange?: (update: (prev: ConstantSliderMap) => ConstantSliderMap) => void;
  /** 可拖点变更（函数式更新；离散语义——提交由调用时机收口） */
  onPointsChange?: (update: (prev: DraggablePoint[]) => DraggablePoint[]) => void;
  /** 一次可撤销操作边界（离散变更即时 / 输入失焦时）；创建侧可缺省 */
  onCommit?: () => void;
  /** 模板点选出口（回填方程输入）；缺省（无方程输入侧）不渲染模板行 */
  onApplyTemplate?: (equation: string) => void;
}

export interface AdvancedFormulaPanelProps {
  /** 关闭出口（背板点击 / Esc / 标题栏 ✕，三路同源） */
  onClose: () => void;
  /** T1 常量编辑区绑定；缺省时常量分区保持 T0 占位（coming soon） */
  constants?: AdvancedConstantsBinding;
  /** T2 微积分编辑区绑定（ZOO-189）；缺省时微积分分区保持 T0 占位 */
  calculus?: AdvancedCalculusBinding;
  /** T4 参数式编辑区绑定（ZOO-191）；缺省时参数式分区保持 T0 占位 */
  parametric?: AdvancedParametricBinding;
  /** T5 物理编辑区绑定（ZOO-192）；缺省时物理分区保持 T0 占位 */
  physics?: AdvancedPhysicsBinding;
}

/**
 * T5 物理编辑区绑定（ZOO-192，两入口共用）：标注开关读写元素 overlays 的
 * physics 条目（与微积分区共用同一数组——双方过滤各自类型、互不覆盖）；
 * 编辑侧直连元素（onChange → 直改实时重绘、onCommit → 提交一条历史），创建侧
 * 由 EquationEditor 持草稿态。模板点选出口携带「方程 + 常量预置 + t 域预置 +
 * 标注预置」整包（onApplyTemplate），由调用侧落各草稿位——插入即出图。
 */
export interface AdvancedPhysicsBinding {
  /** 当前方程文本（判定参数式轨迹态——标注仅对 x=f(t),y=g(t) 生效） */
  equation: string;
  /** 常量绑定（裁决参与；单位行显示数据源） */
  constants?: Record<string, number>;
  /** 当前叠加列表（physics 条目读写） */
  values: readonly MathPlotOverlay[];
  /** 叠加变更（开关离散变更即时提交） */
  onChange: (next: MathPlotOverlay[]) => void;
  /** 一次可撤销操作边界（编辑侧传入；创建侧缺省） */
  onCommit?: () => void;
  /** 模板点选出口（整包预置回填）；缺省不渲染模板行 */
  onApplyTemplate?: (template: PhysicsTemplate) => void;
}

/**
 * T4 参数式编辑区绑定（ZOO-191，两入口共用）：编辑侧直连元素 xAxis（t/θ 域，
 * 元素真实字段），创建侧连编辑器参数域草稿（确认载荷 payload.domain 带出）。
 * 模板行（参数圆 / 心形线 / 摆线 / 李萨如）点选回填方程输入——方程转为
 * 参数式 / 极坐标后 t/θ 域输入随之激活。
 */
export interface AdvancedParametricBinding {
  /** 当前方程文本（判定参数式 / 极坐标态与参数字母） */
  equation: string;
  /** 常量绑定（裁决参与——x=v0·cos(θ)·t 配常量才是合法参数式） */
  constants?: Record<string, number>;
  /** 当前 t/θ 取值范围（编辑侧 = 元素 xAxis；创建侧 = 草稿，缺省 [0,2π]） */
  domain: { min: number; max: number };
  /** 域变更（数值输入实时预览，不上历史） */
  onDomainChange: (domain: { min: number; max: number }) => void;
  /** 一次可撤销操作边界（输入失焦时）；创建侧可缺省 */
  onCommit?: () => void;
  /** 模板点选出口（回填方程输入并重置参数域为缺省）；缺省不渲染模板行 */
  onApplyTemplate?: (equation: string) => void;
}

/**
 * T2 微积分编辑区绑定（ZOO-189，两入口共用）：编辑侧由 MathPlotParams 直连
 * 元素 overlays（元素真实字段，onChange → updateElementTransient 直改、onCommit
 * → 提交一条历史）；创建侧由 EquationEditor 持草稿态、确认载荷全量带出。
 * 求导本身惰性——由渲染管线按 overlays 内容触发，面板只读写叠加开关。
 * ZOO-190 T3：domain 供积分 a/b 的定义域内校验（编辑侧传元素 xAxis；创建侧
 * 元素未建立、缺省只校验 a<b）。
 */
export interface AdvancedCalculusBinding {
  /** 当前叠加列表（存储层形态） */
  values: readonly MathPlotOverlay[];
  /** 叠加变更（开关离散变更即时提交；x₀ / a/b 输入实时预览） */
  onChange: (next: MathPlotOverlay[]) => void;
  /** 一次可撤销操作边界（编辑侧传入；创建侧缺省） */
  onCommit?: () => void;
  /** 是否显式函数（仅 y=f(x) 可叠加；false 时控件禁用并提示） */
  applicable: boolean;
  /** x 定义域（a/b 越界校验；创建侧缺省 = 不校验定义域） */
  domain?: { min: number; max: number };
  /**
   * T6 邻域放大（ZOO-193）：定义域变更出口——×10 预设为离散变更，面板内
   * 一次 onChange + 一次 onCommit。缺省（创建侧无元素域）不渲染放大控件。
   */
  onDomainChange?: (domain: { min: number; max: number }) => void;
}

/** 四分区骨架（组序即面板展示序）：字形为语言无关数学记号，名称 / 描述走资源键 */
const SECTIONS: readonly { id: 'calculus' | 'physics' | 'constants' | 'parametric'; glyph: string; nameKey: string; descKey: string }[] = [
  { id: 'calculus', glyph: '∫', nameKey: 'advFormula.sectionCalculus', descKey: 'advFormula.sectionCalculusDesc' },
  { id: 'physics', glyph: '⚛', nameKey: 'advFormula.sectionPhysics', descKey: 'advFormula.sectionPhysicsDesc' },
  { id: 'constants', glyph: 'A', nameKey: 'advFormula.sectionConstants', descKey: 'advFormula.sectionConstantsDesc' },
  { id: 'parametric', glyph: 't', nameKey: 'advFormula.sectionParametric', descKey: 'advFormula.sectionParametricDesc' },
];

/** 预置常量槽（ZOO-188）：label 为显示原貌，key 为存储层 ASCII 名；初值与
 *  一键建滑块同源（constantDefaultValue，教学惯用值）。 */
const PRESET_CONSTANTS: readonly { key: string; label: string; def: number }[] = [
  { key: 'g', label: 'g', def: constantDefaultValue('g') },
  { key: 'v0', label: 'v₀', def: constantDefaultValue('v0') },
  { key: 'theta', label: 'θ', def: constantDefaultValue('theta') },
  { key: 'omega', label: 'ω', def: constantDefaultValue('omega') },
  { key: 'a', label: 'A', def: constantDefaultValue('a') },
  { key: 'phi', label: 'φ', def: constantDefaultValue('phi') },
];

/** 保留名：x/y 是自变量、e/π 是数学常数（parse 层不视为自由符号，赋值无意义）。 */
const RESERVED_CONSTANT_KEYS = new Set(['x', 'y', 'e', 'pi']);
/** 常量键合法形（归一化后）：字母开头、字母数字、至多 8 字符。 */
const CONSTANT_KEY_RE = /^[a-z][a-z0-9]{0,7}$/;

/** 面板内订阅（ZOO-204）：折叠覆盖变更时重渲染；第三参 getServerSnapshot 供
 *  SSG 预渲染（mathplot-demo 静态导出），快照确定无 hydration 问题。 */
function useAdvancedCollapseOverrides() {
  return useSyncExternalStore(
    subscribeAdvancedCollapse,
    getAdvancedCollapseOverrides,
    getAdvancedCollapseOverrides,
  );
}

/**
 * 死控件内组的折叠原因行（ZOO-204）：整行可点展开 / 收起，文案复用既有
 * 「不适用」提示——折叠行本身就是原因说明（零新资源键）。收起时只此一行，
 * 展开后渲染原禁用控件（数据保留语义不变）。
 */
function InapplicableHintLine({ open, collapseKey, reason }: { open: boolean; collapseKey: AdvancedCollapseKey; reason: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setAdvancedCollapseOpen(collapseKey, !open)}
      className="touch-target w-full flex items-start gap-1 border-none bg-transparent text-left cursor-pointer rounded-md hover:bg-gray-50 active:bg-gray-100 transition-colors"
    >
      <span
        className={`text-gray-400 text-[11px] leading-relaxed transition-transform duration-150 ${open ? 'rotate-0' : '-rotate-90'}`}
        aria-hidden="true"
      >
        ⌄
      </span>
      <span className="text-[11px] text-gray-400 leading-relaxed">{reason}</span>
    </button>
  );
}

/**
 * 高级面板模板按钮（ZOO-204 后续）：当前方程与模板方程一致时呈**选中态**——
 * 蓝色边框 + 底色 + 名称行 ✓ 前缀 + `aria-pressed`，点选回填后一眼可见
 * 「已选中」，再点其他模板 / 手改方程即切换。
 */
function TemplateButton({
  selected,
  name,
  equation,
  onApply,
}: {
  selected: boolean;
  name: string;
  equation: string;
  onApply: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={equation}
      onClick={onApply}
      className={`touch-target flex-1 border rounded-md px-1.5 py-1 text-left cursor-pointer active:bg-blue-100 transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-100 ring-1 ring-blue-400'
          : 'border-blue-200 bg-blue-50/50 hover:border-blue-500 hover:bg-blue-50'
      }`}
    >
      <span className={`block text-[10px] leading-tight ${selected ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
        {selected ? '✓ ' : ''}
        {name}
      </span>
      <span className="block font-serif text-xs text-gray-800 whitespace-nowrap overflow-hidden text-ellipsis">{equation}</span>
    </button>
  );
}

/** T1 常量编辑区：模板行 + 预置槽 + 已绑定行（ZOO-197 各带滑块 / 播放）+ 自定义项 + 解析状态行。 */
function ConstantsArea({ binding }: { binding: AdvancedConstantsBinding }) {
  const t = useT();
  const [customName, setCustomName] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  // —— ZOO-197 播放态（纯 UI，不入元素数据）：playKey 为正在动画的常量键 ——
  const [playKey, setPlayKey] = useState<string | null>(null);
  const [speed, setSpeed] = useState<SliderSpeed>(1);
  // 帧循环读活引用：binding 每渲染换新闭包（values 常新），dir / value / speed
  // 由循环自身持有，避免 effect 依赖 values 逐帧重启。引用只在 effect 内读写
  //（渲染期同步为 react-hooks/refs 禁止形态），每次提交后刷新至最新 props
  const bindingRef = useRef(binding);
  const speedRef = useRef(speed);
  const dirRef = useRef<1 | -1>(1);
  const animValueRef = useRef(0);
  useEffect(() => {
    bindingRef.current = binding;
  });
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // 赋值后的解析反馈：欠定报错引导补常量，合法则报自变量字母
  const outcome = validateEquation(binding.equation, t, binding.values);
  const entries = Object.entries(binding.values);

  /** 离散变更（点选预置 / 移除 / 自定义添加）：一次 onChange + 一次 onCommit（函数式更新） */
  const applyDiscrete = (update: (prev: Record<string, number>) => Record<string, number>) => {
    binding.onChange(update);
    binding.onCommit?.();
  };

  /** 常量移除：值 + 滑块元数据 + 可拖点绑定同批剔除（元素不留悬挂键，一次提交） */
  const removeConstant = (key: string) => {
    if (playKey === key) setPlayKey(null);
    applyDiscrete((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    binding.onSlidersChange?.((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    // ZOO-201：引用该常量的可拖点条目一并剔除（applyDiscrete 已收口提交，不双压）
    if (binding.points?.some((p) => p.xKey === key || p.yKey === key)) {
      binding.onPointsChange?.((prev) => prev.filter((p) => p.xKey !== key && p.yKey !== key));
    }
  };

  const togglePreset = (key: string, def: number) => {
    if (key in binding.values) {
      removeConstant(key);
      return;
    }
    applyDiscrete((prev) => ({ ...prev, [key]: def }));
  };

  const addCustom = () => {
    const key = normalizeConstantKey(customName);
    // ZOO-192 T5：值输入容忍单位后缀（'9.8 m/s²' → 9.8）——单位仅显示、不参与
    // 运算，存储恒为纯数值（见 normalize.ts parseConstantValue）
    const parsed = parseConstantValue(customValue);
    if (!CONSTANT_KEY_RE.test(key) || RESERVED_CONSTANT_KEYS.has(key) || key in binding.values) {
      setNameError(t('advFormula.constantsInvalidName'));
      return;
    }
    if (!parsed) return;
    applyDiscrete((prev) => ({ ...prev, [key]: parsed.value }));
    setCustomName('');
    setCustomValue('');
    setNameError(null);
  };

  /** 停止播放（playKey → null 触发帧循环 cleanup 收口提交一条调参历史） */
  const stopPlay = () => {
    if (playKey !== null) setPlayKey(null);
  };

  /** 起播（同屏仅一个动画：切换目标时上一个的 cleanup 先提交一条再起新循环） */
  const startPlay = (key: string) => {
    setPlayKey(key);
  };

  // 帧循环：rAF 时间步进（dt 截顶防后台恢复大跳），值直改（D5 不上历史）。
  // cleanup 三路同源收口——暂停（playKey → null）/ 面板关闭（卸载）/ 切换动画
  // 目标（换 key 重跑 effect）——各提交且仅提交一条调参历史快照
  useEffect(() => {
    if (!playKey) return;
    const key = playKey;
    const b0 = bindingRef.current;
    const meta0 = sliderMetaFor(b0.sliders, key);
    animValueRef.current = b0.values[key] ?? meta0.min;
    // 起手方向：贴上界则向下，其余向上（从中值附近向远处先走）
    dirRef.current = animValueRef.current >= meta0.max - meta0.step ? -1 : 1;
    let raf = 0;
    let last = performance.now();
    const tick = (ts: number) => {
      const b = bindingRef.current;
      if (!(key in b.values)) {
        setPlayKey(null); // 常量被外部移除：停循环即可，移除流程自会提交
        return;
      }
      const dt = Math.min(Math.max(ts - last, 0), SLIDER_DT_CLAMP_MS);
      last = ts;
      const meta = sliderMetaFor(b.sliders, key);
      const step = advanceSliderAnimation(animValueRef.current, dirRef.current, dt, speedRef.current, meta);
      dirRef.current = step.dir;
      animValueRef.current = roundSliderValue(clampToSlider(step.value, meta));
      b.onChange((prev) => ({ ...prev, [key]: animValueRef.current }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      bindingRef.current.onCommit?.();
    };
    // 值 / 元数据 / 速度经 ref 活引用读取，依赖仅 playKey（起停边界）
  }, [playKey]);

  const missing = outcome.kind === 'error' ? outcome.missingConstants : undefined;

  // —— ZOO-201 可拖点增删（离散变更：一次 onChange + 一次 onCommit）——
  /** 添加：同型重复（mode + 绑定键一致）无变化，不落键不提交 */
  const addPoint = (cand: Omit<DraggablePoint, 'id'>) => {
    const next = addDragPoint(binding.points, cand);
    if (!next) return;
    binding.onPointsChange?.(() => next);
    binding.onCommit?.();
  };
  /** 移除：目标不存在无变化；移空归一由调用方（MathPlotParams 落 undefined） */
  const removePoint = (id: string) => {
    const next = removeDragPoint(binding.points, id);
    if (next === null) return;
    binding.onPointsChange?.(() => next ?? []);
    binding.onCommit?.();
  };
  // 下拉草稿（纯 UI 态）：null = 未选，回落首个（第二个）常量；常量集变化自动跟从
  const [onCurvePick, setOnCurvePick] = useState<string | null>(null);
  const [freeXPick, setFreeXPick] = useState<string | null>(null);
  const [freeYPick, setFreeYPick] = useState<string | null>(null);
  const keys = entries.map(([k]) => k);
  const effOnCurveKey = onCurvePick != null && keys.includes(onCurvePick) ? onCurvePick : keys[0];
  const effFreeXKey = freeXPick != null && keys.includes(freeXPick) ? freeXPick : keys[0];
  const effFreeYKey = freeYPick != null && keys.includes(freeYPick) ? freeYPick : keys[1] ?? keys[0];

  return (
    <div className="flex flex-col gap-1.5">
      {/* 示例模板：点选回填方程输入（三角变换联动教学，ZOO-188）；当前方程
          与模板一致时呈选中态（ZOO-204 后续） */}
      {binding.onApplyTemplate && (
        <div className="flex flex-wrap gap-1">
          {ADVANCED_TEMPLATES.map((tpl) => (
            <TemplateButton
              key={tpl.id}
              selected={binding.equation.trim() === tpl.equation}
              name={t(advancedTemplateNameKey(tpl.id))}
              equation={tpl.equation}
              onApply={() => binding.onApplyTemplate?.(tpl.equation)}
            />
          ))}
        </div>
      )}

      {/* 预置槽：点选添加（缺省值）/ 再点移除 */}
      <div className="flex flex-wrap gap-1">
        {PRESET_CONSTANTS.map((p) => {
          const active = p.key in binding.values;
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              aria-label={t('advFormula.constantsPresetAria', { name: p.label })}
              onClick={() => togglePreset(p.key, p.def)}
              className={`touch-target min-w-8 h-6 px-1.5 border rounded-md font-serif text-[13px] cursor-pointer transition-colors ${
                active ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 bg-white text-gray-600 hover:border-blue-500 hover:text-blue-500'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* 已绑定行（ZOO-197 各带滑块 / 播放 / 范围步长编辑）：数值输入直改实时预览（D5），失焦提交一条 */}
      {entries.length === 0 ? (
        <div className="text-[11px] text-gray-400 leading-relaxed">{t('advFormula.constantsEmpty')}</div>
      ) : (
        entries.map(([key, value]) => (
          <ConstantSliderRow
            key={key}
            binding={binding}
            constantKey={key}
            value={value}
            meta={sliderMetaFor(binding.sliders, key)}
            playing={playKey === key}
            speed={speed}
            onTogglePlay={() => (playKey === key ? stopPlay() : startPlay(key))}
            onCycleSpeed={() => setSpeed((s) => nextSliderSpeed(s))}
            onRemove={() => removeConstant(key)}
          />
        ))
      )}

      {/* ZOO-201 可拖点：常量绑定的具象化——仅显式方程且有常量可配；沿曲线点
          (a, f(a)) 拖动只写回 a，自由点 (a, b) 拖动写回 a、b，画布拖动全图联动 */}
      {outcome.kind === 'explicit' && entries.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-gray-100 pt-1.5">
          <span className="text-[10px] font-medium text-gray-500">{t('advFormula.pointsTitle')}</span>
          {(binding.points ?? []).map((p) => {
            const label = p.mode === 'onCurve'
              ? `(${constantDisplayName(p.xKey)}, f(${constantDisplayName(p.xKey)}))`
              : `(${constantDisplayName(p.xKey)}, ${constantDisplayName(p.yKey ?? '')})`;
            return (
              <div key={p.id} className="flex items-center gap-1.5">
                <span className="font-serif italic text-[12px] text-blue-600 leading-none whitespace-nowrap">{label}</span>
                <span className="text-[10px] text-gray-400">
                  {t(p.mode === 'onCurve' ? 'advFormula.pointsOnCurve' : 'advFormula.pointsFree')}
                </span>
                <button
                  type="button"
                  onClick={() => removePoint(p.id)}
                  aria-label={t('advFormula.pointsRemoveAria', { name: label })}
                  className="touch-target ml-auto border-none bg-transparent text-gray-400 text-base leading-none cursor-pointer hover:text-red-500 active:text-red-600 transition-colors"
                >
                  ×
                </button>
              </div>
            );
          })}
          <div className="flex items-center gap-1">
            <select
              value={effOnCurveKey ?? ''}
              onChange={(e) => setOnCurvePick(e.target.value)}
              aria-label={t('advFormula.pointsPickAria')}
              className="touch-target flex-1 min-w-0 px-1 py-1 border border-gray-200 rounded-md font-serif text-[11px] text-gray-700 outline-none focus:border-blue-500"
            >
              {keys.map((k) => (
                <option key={k} value={k}>{constantDisplayName(k)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => effOnCurveKey && addPoint({ mode: 'onCurve', xKey: effOnCurveKey })}
              disabled={!effOnCurveKey}
              className="touch-target h-6 px-1.5 border border-blue-300 bg-blue-50/60 rounded-md text-[11px] text-blue-600 cursor-pointer hover:bg-blue-100 active:bg-blue-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('advFormula.pointsAddOnCurve')}
            </button>
          </div>
          {entries.length >= 2 && (
            <div className="flex items-center gap-1">
              <select
                value={effFreeXKey ?? ''}
                onChange={(e) => setFreeXPick(e.target.value)}
                aria-label={t('advFormula.pointsFreeXAria')}
                className="touch-target flex-1 min-w-0 px-1 py-1 border border-gray-200 rounded-md font-serif text-[11px] text-gray-700 outline-none focus:border-blue-500"
              >
                {keys.map((k) => (
                  <option key={k} value={k}>{constantDisplayName(k)}</option>
                ))}
              </select>
              <select
                value={effFreeYKey ?? ''}
                onChange={(e) => setFreeYPick(e.target.value)}
                aria-label={t('advFormula.pointsFreeYAria')}
                className="touch-target flex-1 min-w-0 px-1 py-1 border border-gray-200 rounded-md font-serif text-[11px] text-gray-700 outline-none focus:border-blue-500"
              >
                {keys.map((k) => (
                  <option key={k} value={k}>{constantDisplayName(k)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => effFreeXKey && effFreeYKey && addPoint({ mode: 'free', xKey: effFreeXKey, yKey: effFreeYKey })}
                disabled={!effFreeXKey || !effFreeYKey}
                className="touch-target h-6 px-1.5 border border-blue-300 bg-blue-50/60 rounded-md text-[11px] text-blue-600 cursor-pointer hover:bg-blue-100 active:bg-blue-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('advFormula.pointsAddFree')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 自定义项：符号（支持 θ/v₀ 等书写原貌，归一化为存储键）+ 数值 */}
      <div className="flex items-center gap-1.5">
        <input
          value={customName}
          onChange={(e) => {
            setCustomName(e.target.value);
            setNameError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={t('advFormula.constantsNamePh')}
          autoComplete="off"
          spellCheck={false}
          aria-label={t('advFormula.constantsNamePh')}
          className="touch-target w-[92px] px-1.5 py-1 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500"
        />
        <input
          value={customValue}
          onChange={(e) => {
            setCustomValue(e.target.value);
            setNameError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={t('advFormula.constantsValuePh')}
          inputMode="decimal"
          autoComplete="off"
          aria-label={t('advFormula.constantsValuePh')}
          className="touch-target flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!customName.trim() || !parseConstantValue(customValue)}
          className="touch-target px-2.5 py-1 border border-blue-200 rounded-md bg-blue-50/60 text-[11px] font-medium text-blue-600 cursor-pointer hover:bg-blue-50 active:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {t('advFormula.constantsAdd')}
        </button>
      </div>
      {nameError && (
        <div className="text-[11px] text-red-500 leading-relaxed" role="alert">
          {nameError}
        </div>
      )}

      {/* 解析状态行：合法（显式函数）报自变量字母；欠定引导补常量（旁附一键建滑块 chips，ZOO-197） */}
      {(outcome.kind === 'error' || outcome.kind === 'explicit') && (
        <div className={outcome.kind === 'error' ? 'text-red-500' : 'text-green-600'}>
          <div className="text-[11px] leading-relaxed break-all">
            {outcome.kind === 'error'
              ? `⚠ ${outcome.message}`
              : t('equation.recognized', { kind: t('equation.kindExplicit', { v: outcome.variable ?? 'x' }) })}
          </div>
          {missing && missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mt-1">
              <span className="text-[10px] text-gray-400">{t('equation.sliderHint')}</span>
              {missing.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => applyDiscrete((prev) => ({ ...prev, [k]: constantDefaultValue(k) }))}
                  aria-label={t('equation.sliderChipAria', { name: constantDisplayName(k) })}
                  title={t('equation.sliderChipAria', { name: constantDisplayName(k) })}
                  className="touch-target h-5 px-1.5 border border-blue-300 bg-blue-50/60 rounded-md font-serif text-[11px] text-blue-600 cursor-pointer hover:bg-blue-100 active:bg-blue-200 transition-colors"
                >
                  +{constantDisplayName(k)}
                </button>
              ))}
              {missing.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    applyDiscrete((prev) => {
                      const next = { ...prev };
                      for (const k of missing) if (!(k in next)) next[k] = constantDefaultValue(k);
                      return next;
                    })
                  }
                  className="touch-target h-5 px-1.5 border border-blue-500 bg-blue-500 rounded-md text-[11px] font-medium text-white cursor-pointer hover:bg-[#2f7ae5] active:bg-[#2564c4] transition-colors"
                >
                  {t('equation.sliderAll')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 已绑定常量行（ZOO-197）：数值输入（精确）+ 播放 / 速度 + 移除，滑杆拖动
 * 连续调参（onChange 直改实时重采样 / 抬杆提交一条），min/max/step 可改
 * （改范围时值裁剪进新范围）。播放中数值输入与滑杆禁用（值由动画驱动）。
 */
function ConstantSliderRow({
  binding,
  constantKey,
  value,
  meta,
  playing,
  speed,
  onTogglePlay,
  onCycleSpeed,
  onRemove,
}: {
  binding: AdvancedConstantsBinding;
  constantKey: string;
  value: number;
  meta: ConstantSliderMeta;
  playing: boolean;
  speed: SliderSpeed;
  onTogglePlay: () => void;
  onCycleSpeed: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const name = constantDisplayName(constantKey);

  /** 滑杆拖动：直改实时预览（值圆整到滑杆步进显示精度），抬杆 / 键抬提交一条 */
  const dragTo = (v: number) => {
    binding.onChange((prev) => ({ ...prev, [constantKey]: roundSliderValue(v) }));
  };

  /** 范围 / 步长编辑：元数据裁剪落键，值同步裁进新范围（实时预览，失焦收口） */
  const editMeta = (part: Partial<ConstantSliderMeta>) => {
    const next = sliderMetaFor({ ...binding.sliders, [constantKey]: { ...meta, ...part } }, constantKey);
    binding.onSlidersChange?.((prev) => ({ ...prev, [constantKey]: next }));
    const clamped = clampToSlider(value, next);
    if (clamped !== value) binding.onChange((prev) => ({ ...prev, [constantKey]: clamped }));
  };

  const metaInput = (field: 'min' | 'max' | 'step', labelKey: string, w: string) => (
    <input
      type="number"
      step="any"
      value={String(meta[field])}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) editMeta({ [field]: v } as Partial<ConstantSliderMeta>);
      }}
      onBlur={binding.onCommit}
      aria-label={t(labelKey, { name })}
      autoComplete="off"
      className={`touch-target ${w} min-w-0 px-1 py-0.5 border border-gray-200 rounded-md font-serif text-[11px] text-gray-600 outline-none select-text focus:border-blue-500`}
    />
  );

  return (
    <div className="flex flex-col gap-1 border border-gray-100 rounded-md px-1.5 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="font-serif italic text-[13px] text-gray-800 w-6 text-center leading-none">{name}</span>
        <span className="text-gray-400 text-[11px]" aria-hidden="true">
          =
        </span>
        <input
          type="number"
          step="any"
          value={String(value)}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) binding.onChange((prev) => ({ ...prev, [constantKey]: v }));
          }}
          onBlur={binding.onCommit}
          disabled={playing}
          aria-label={t('advFormula.constantsValueAria', { name })}
          autoComplete="off"
          className="touch-target flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
        />
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={t(playing ? 'advFormula.constantsPauseAria' : 'advFormula.constantsPlayAria', { name })}
          className={`touch-target w-6 h-6 border rounded-md text-[11px] leading-none cursor-pointer transition-colors ${
            playing
              ? 'border-blue-500 bg-blue-500 text-white hover:bg-[#2f7ae5]'
              : 'border-gray-200 bg-white text-blue-500 hover:border-blue-500 hover:bg-blue-50'
          }`}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          onClick={onCycleSpeed}
          aria-label={t('advFormula.constantsSpeedAria', { speed })}
          className={`touch-target h-6 px-1 border rounded-md text-[10px] font-medium cursor-pointer transition-colors ${
            playing ? 'border-blue-500 text-blue-600 hover:bg-blue-50' : 'border-gray-200 text-gray-500 hover:border-blue-500 hover:text-blue-500'
          }`}
        >
          {speed}x
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('advFormula.constantsRemoveAria', { name })}
          className="touch-target border-none bg-transparent text-gray-400 text-base leading-none cursor-pointer hover:text-red-500 active:text-red-600 transition-colors"
        >
          ×
        </button>
      </div>
      <input
        type="range"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={clampToSlider(value, meta)}
        onChange={(e) => dragTo(Number(e.target.value))}
        onPointerUp={binding.onCommit}
        onKeyUp={binding.onCommit}
        disabled={playing}
        aria-label={t('advFormula.constantsSliderAria', { name })}
        className="touch-target w-full accent-blue-500"
      />
      <div className="flex items-center gap-1 text-[10px] text-gray-400">
        {metaInput('min', 'advFormula.constantsMinAria', 'w-11')}
        <span aria-hidden="true">~</span>
        {metaInput('max', 'advFormula.constantsMaxAria', 'w-11')}
        <span className="ml-auto" aria-hidden="true">
          {t('advFormula.constantsStepLabel')}
        </span>
        {metaInput('step', 'advFormula.constantsStepAria', 'w-10')}
      </div>
    </div>
  );
}

/** T2 微积分编辑区（ZOO-189）：f′ 叠加开关 + 切线演示（开关 + x₀ 数值输入）；
 *  T3 积分区（ZOO-190）：定积分开关 + a/b 数值输入（a<b 且定义域内校验）；
 *  T6 邻域放大（ZOO-193）：中心数值输入（缺省取定义域中心）+ ×10 预设。 */
function CalculusArea({ binding }: { binding: AdvancedCalculusBinding }) {
  const t = useT();
  // T6 中心输入草稿（纯 UI 态）：只在点 ×10 时参与换算，本身不改定义域
  const [centerDraft, setCenterDraft] = useState('');
  const hasDerivative = binding.values.some((o) => o.type === 'derivative');
  const tangent = binding.values.find((o): o is { type: 'tangent'; x0: number } => o.type === 'tangent');
  const integral = binding.values.find((o): o is { type: 'integral'; a: number; b: number } => o.type === 'integral');
  const disabled = !binding.applicable;

  /** 离散变更（开关切换）：一次 onChange + 一次 onCommit */
  const applyDiscrete = (next: MathPlotOverlay[]) => {
    binding.onChange(next);
    binding.onCommit?.();
  };

  const toggleDerivative = () => {
    const rest = binding.values.filter((o) => o.type !== 'derivative');
    applyDiscrete(hasDerivative ? rest : [...rest, { type: 'derivative' }]);
  };

  const toggleTangent = () => {
    const rest = binding.values.filter((o) => o.type !== 'tangent');
    applyDiscrete(tangent ? rest : [...rest, { type: 'tangent', x0: 0 }]);
  };

  const toggleIntegral = () => {
    const rest = binding.values.filter((o) => o.type !== 'integral');
    applyDiscrete(integral ? rest : [...rest, { type: 'integral', a: 0, b: 1 }]);
  };

  /** x₀ / a/b 直改实时预览（叠加随输入实时更新），失焦提交一条 */
  const setX0 = (x0: number) => {
    binding.onChange(binding.values.map((o) => (o.type === 'tangent' ? { type: 'tangent', x0 } : o)));
  };

  const setIntegralBounds = (patch: Partial<{ a: number; b: number }>) => {
    binding.onChange(
      binding.values.map((o) => (o.type === 'integral' ? { type: 'integral' as const, a: o.a, b: o.b, ...patch } : o)),
    );
  };

  /** T6 ×10 邻域放大（ZOO-193）：离散变更一次 onChange + 一次 onCommit（D5）；
   *  中心输入空 / 非法时取定义域中心（zoomNeighborhood 内缺省口径） */
  const applyZoom = () => {
    if (disabled || !binding.domain || !binding.onDomainChange) return;
    const center = parseFloat(centerDraft);
    binding.onDomainChange(zoomNeighborhood(binding.domain, Number.isFinite(center) ? center : undefined));
    binding.onCommit?.();
  };

  // T3 校验（ZOO-190）：a<b 必检；编辑侧带定义域时加越界检查（渲染层另有
  // 奇点防护兜底——区间内无定义点画报错 chip，不产出错误区域）
  const integralInvalid =
    integral !== undefined &&
    (!(integral.a < integral.b) ||
      (binding.domain !== undefined &&
        (integral.a < binding.domain.min - 1e-9 || integral.b > binding.domain.max + 1e-9)));

  return (
    <div className="flex flex-col gap-1.5">
      {disabled && (
        <div className="text-[11px] text-gray-400 leading-relaxed">{t('advFormula.calcNotApplicable')}</div>
      )}

      {/* f′ 叠加开关 */}
      <label className={`touch-target text-xs flex items-center gap-1.5 ${disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={hasDerivative}
          onChange={toggleDerivative}
          disabled={disabled}
          className="accent-blue-500"
        />
        <span className="font-serif italic text-[13px] leading-none">f′(x)</span>
        <span className="text-[11px] text-gray-500">{t('advFormula.calcDerivDesc')}</span>
      </label>

      {/* 切线演示开关 + x₀ 数值输入 */}
      <div className="flex items-center gap-1.5">
        <label className={`touch-target text-xs flex items-center gap-1.5 ${disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={Boolean(tangent)}
            onChange={toggleTangent}
            disabled={disabled}
            className="accent-blue-500"
          />
          <span className="text-[11px] text-gray-500">{t('advFormula.calcTangentDesc')}</span>
        </label>
        {tangent && !disabled && (
          <span className="ml-auto flex items-center gap-1">
            <span className="font-serif italic text-[12px] text-gray-700 leading-none">x₀</span>
            <input
              type="number"
              step="any"
              value={String(tangent.x0)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) setX0(v);
              }}
              onBlur={binding.onCommit}
              aria-label={t('advFormula.calcTangentX0')}
              autoComplete="off"
              className="touch-target w-16 px-1.5 py-0.5 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500"
            />
          </span>
        )}
      </div>

      {/* 定积分区域着色开关（ZOO-190 T3） */}
      <label className={`touch-target text-xs flex items-center gap-1.5 ${disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={Boolean(integral)}
          onChange={toggleIntegral}
          disabled={disabled}
          className="accent-blue-500"
        />
        <span className="font-serif italic text-[13px] text-blue-500 leading-none">∫</span>
        <span className="text-[11px] text-gray-500">{t('advFormula.calcIntegralDesc')}</span>
      </label>

      {/* a/b 数值输入（积分开启时）：下限 a / 上限 b，实时预览、失焦提交 */}
      {integral && !disabled && (
        <div className="flex flex-col gap-1 pl-5">
          <div className="flex items-center gap-1.5">
            <span className="font-serif italic text-[12px] text-gray-700 w-3 text-center leading-none">a</span>
            <input
              type="number"
              step="any"
              value={String(integral.a)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) setIntegralBounds({ a: v });
              }}
              onBlur={binding.onCommit}
              aria-label={t('advFormula.calcIntegralLower')}
              autoComplete="off"
              className="touch-target flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500"
            />
            <span className="font-serif italic text-[12px] text-gray-700 w-3 text-center leading-none">b</span>
            <input
              type="number"
              step="any"
              value={String(integral.b)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) setIntegralBounds({ b: v });
              }}
              onBlur={binding.onCommit}
              aria-label={t('advFormula.calcIntegralUpper')}
              autoComplete="off"
              className="touch-target flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500"
            />
          </div>
          {integralInvalid && (
            <div className="text-[11px] text-red-500 leading-relaxed" role="alert">
              ⚠ {t('advFormula.calcIntegralRange')}
            </div>
          )}
        </div>
      )}

      {/* T6 极限邻域放大（ZOO-193）：中心数值输入（缺省取定义域中心）+ ×10 预设；
          非显式函数沿既有禁用态；创建侧无元素域（缺 onDomainChange / domain）不渲染 */}
      {binding.domain && binding.onDomainChange && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-500">{t('advFormula.calcLimitZoom')}</span>
          <input
            type="number"
            step="any"
            value={centerDraft}
            disabled={disabled}
            onChange={(e) => setCenterDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyZoom();
              }
            }}
            placeholder={String((binding.domain.min + binding.domain.max) / 2)}
            aria-label={t('advFormula.calcLimitCenter')}
            autoComplete="off"
            className="touch-target flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={applyZoom}
            disabled={disabled}
            aria-label={t('advFormula.calcLimitZoomAria')}
            className="touch-target px-2.5 py-0.5 border border-blue-200 rounded-md bg-blue-50/60 font-serif text-[11px] font-medium text-blue-600 cursor-pointer hover:bg-blue-50 active:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ×10
          </button>
        </div>
      )}
    </div>
  );
}

/** T4 参数式编辑区（ZOO-191）：模板行 + t/θ 取值范围数值输入（当前方程
 *  是参数式 / 极坐标时激活；否则提示并保留模板行引导点选）。 */
function ParametricArea({ binding }: { binding: AdvancedParametricBinding }) {
  const t = useT();
  useAdvancedCollapseOverrides();
  const outcome = validateEquation(binding.equation, t, binding.constants);
  const active = outcome.kind === 'parametric' || outcome.kind === 'polar';
  // ZOO-204：t/θ 域死控件内组——非参数式 / 极坐标方程时默认折叠为一行原因
  // （可展开看禁用输入）；模板行常显（点选即切参数式，是模式切换入口）
  const domainOpen = advancedCollapseOpen('parametric.domain', active);
  const variable = active
    ? outcome.kind === 'polar'
      ? constantDisplayName(outcome.variable ?? 'theta')
      : outcome.variable ?? 't'
    : null;
  const orderInvalid = !(binding.domain.min < binding.domain.max);

  return (
    <div className="flex flex-col gap-1.5">
      {/* 模板行：点选回填方程输入并重置参数域为缺省（四类模板整周期 [0,2π]）；
          当前方程与模板一致时呈选中态（ZOO-204 后续） */}
      {binding.onApplyTemplate && (
        <div className="flex flex-wrap gap-1">
          {PARAMETRIC_TEMPLATES.map((tpl) => (
            <TemplateButton
              key={tpl.id}
              selected={binding.equation.trim() === tpl.equation}
              name={t(advancedTemplateNameKey(tpl.id))}
              equation={tpl.equation}
              onApply={() => binding.onApplyTemplate?.(tpl.equation)}
            />
          ))}
        </div>
      )}

      {/* t/θ 取值范围：直改实时预览（D5），失焦提交一条；非参数式方程禁用并提示。
          ZOO-204：不适用且未手动展开时折叠为一行原因（InapplicableHintLine） */}
      {!active && !domainOpen ? (
        <InapplicableHintLine open={false} collapseKey="parametric.domain" reason={t('advFormula.parametricInactive')} />
      ) : (
        <>
          <div className={`flex items-center gap-1.5 ${active ? '' : 'opacity-50'}`}>
        <span className="font-serif italic text-[13px] text-gray-800 leading-none w-4 text-center">{variable ?? 't'}</span>
        <span className="text-gray-400 text-[11px]" aria-hidden="true">
          ∈
        </span>
        <input
          type="number"
          step="any"
          value={String(binding.domain.min)}
          disabled={!active}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) binding.onDomainChange({ ...binding.domain, min: v });
          }}
          onBlur={binding.onCommit}
          aria-label={t('advFormula.paramDomainMin')}
          autoComplete="off"
          className="touch-target flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
        />
        <span className="text-gray-400">~</span>
        <input
          type="number"
          step="any"
          value={String(binding.domain.max)}
          disabled={!active}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) binding.onDomainChange({ ...binding.domain, max: v });
          }}
          onBlur={binding.onCommit}
          aria-label={t('advFormula.paramDomainMax')}
          autoComplete="off"
          className="touch-target flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
        />
          </div>

          {!active && (
            <InapplicableHintLine open collapseKey="parametric.domain" reason={t('advFormula.parametricInactive')} />
          )}
          {active && orderInvalid && (
            <div className="text-[11px] text-red-500 leading-relaxed" role="alert">
              ⚠ {t('advFormula.paramDomainOrder')}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** T5 物理编辑区（ZOO-192）：物理模板行（抛体/简谐/圆周——点选整包回填：
 *  方程 + 常量预置 + t 域预置 + 标注预置）+ 落地/峰值标注开关（仅参数式轨迹
 *  生效；标注数值随常量改值经渲染签名失效实时联动）+ 常量单位显示行。 */
function PhysicsArea({ binding }: { binding: AdvancedPhysicsBinding }) {
  const t = useT();
  useAdvancedCollapseOverrides();
  const outcome = validateEquation(binding.equation, t, binding.constants);
  // 标注仅对参数式轨迹（x=f(t),y=g(t)）生效：简谐振动走显式渲染（零新渲染），
  // 极坐标 / 几何 / 错误态同口径静默禁用（叠加数据保留，方程换回参数式即恢复）
  const applicable = outcome.kind === 'parametric';
  const hasMarks = binding.values.some((o) => o.type === 'physics');
  const disabled = !applicable;
  // ZOO-204：R·H 死控件内组——非参数式轨迹时默认折叠为一行原因（可展开看
  // 禁用开关）；模板行与单位行常显（模板点选是切参数式的入口）
  const marksOpen = advancedCollapseOpen('physics.marks', applicable);

  /** 离散变更（开关切换 / 模板点选）：一次 onChange + 一次 onCommit */
  const applyDiscrete = (next: MathPlotOverlay[]) => {
    binding.onChange(next);
    binding.onCommit?.();
  };

  const toggleMarks = () => {
    const rest = binding.values.filter((o) => o.type !== 'physics');
    applyDiscrete(hasMarks ? rest : [...rest, { type: 'physics' }]);
  };

  // 单位显示行（只读）：当前绑定常量 × 物理单位表——单位字符串仅作显示，
  // 不参与运算（数值恒以纯数存储与求值）；无已绑定物理常量时不渲染
  const unitEntries = Object.entries(binding.constants ?? {}).flatMap(([key, value]) => {
    const unit = PHYSICS_CONSTANT_UNITS[key];
    return unit ? [{ label: `${constantDisplayName(key)} = ${value} ${unit}` }] : [];
  });

  return (
    <div className="flex flex-col gap-1.5">
      {/* 物理模板行：点选整包回填（方程 + 常量预置 + t 域预置 + 标注预置）；
          当前方程与模板一致时呈选中态（ZOO-204 后续，常量改值不影响选中判定） */}
      {binding.onApplyTemplate && (
        <div className="flex flex-wrap gap-1">
          {PHYSICS_TEMPLATES.map((tpl) => (
            <TemplateButton
              key={tpl.id}
              selected={binding.equation.trim() === tpl.equation}
              name={t(physicsTemplateNameKey(tpl.id))}
              equation={tpl.equation}
              onApply={() => binding.onApplyTemplate?.(tpl)}
            />
          ))}
        </div>
      )}

      {/* 落地/峰值标注开关：数值（射程 R / 峰高 H）由渲染管线随常量重算。
          ZOO-204：不适用且未手动展开时整组折叠为一行原因（InapplicableHintLine） */}
      {marksOpen ? (
        <>
          <label className={`touch-target text-xs flex items-center gap-1.5 ${disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={hasMarks}
              onChange={toggleMarks}
              disabled={disabled}
              className="accent-blue-500"
            />
            <span className="font-serif italic text-[13px] leading-none" style={{ color: disabled ? undefined : PLOT_COLORS.overlayPhysics }}>
              R·H
            </span>
            <span className="text-[11px] text-gray-500">{t('phys.marksDesc')}</span>
          </label>

          {disabled && (
            <InapplicableHintLine open collapseKey="physics.marks" reason={t('phys.marksNotApplicable')} />
          )}
        </>
      ) : (
        <InapplicableHintLine open={false} collapseKey="physics.marks" reason={t('phys.marksNotApplicable')} />
      )}

      {/* 常量单位显示行：随常量改值实时更新（数值来自常量绑定，单位仅显示） */}
      {unitEntries.length > 0 && (
        <div className="font-serif text-[11px] text-gray-500 leading-relaxed break-all">
          {unitEntries.map((e) => e.label).join(' · ')}
        </div>
      )}
    </div>
  );
}

export default function AdvancedFormulaPanel({ onClose, constants, calculus, parametric, physics }: AdvancedFormulaPanelProps) {
  const t = useT();
  useAdvancedCollapseOverrides();

  /**
   * 选中微积分分区（点击标题展开时，ZOO-204 后续）：联动展开**关联的基础
   * 公式**——常量区（地基，显式函数的符号常量都靠它）与基础方程面板的
   * 显式函数模板组（基本 / 三角 / 指数对数）。**互斥面不触碰**：参数式 /
   * 物理分区保持各自自动缺省（不适用即折叠），几何曲线 / 直线与方程组
   * 不在展开清单。
   */
  const engageCalculus = () => {
    setAdvancedCollapseOpen('constants', true);
    expandTemplateGroups(EXPLICIT_FUNCTION_GROUP_IDS);
  };

  // Esc 关闭（窗口级监听，LanguageSwitch 同款）。T1 起面板含文本输入（常量名/数值），
  // 输入中 Esc 关面板是模态标准行为；画布快捷键守卫按事件目标判定，不受本监听影响
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // SSG 防御（mathplot-demo 静态导出）：面板仅由用户交互在客户端拉起，服务端一律不渲染
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="whiteboard-chrome fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('advFormula.title')}
        className="touch-panel touch-modal bg-white rounded-2xl shadow-2xl w-[340px] max-w-[calc(100vw-1.5rem)] max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 p-3.5 border-b">
          <span className="font-serif italic text-blue-500 text-base leading-none">ƒ</span>
          <h2 className="text-[15px] font-semibold text-gray-700">{t('advFormula.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('advFormula.closeAria')}
            className="touch-target ml-auto border-none bg-transparent text-gray-400 text-xl leading-none cursor-pointer hover:text-gray-600 active:text-gray-800 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          <div className="text-[11px] text-gray-400 leading-relaxed">{t('advFormula.hint')}</div>
          {SECTIONS.map((s) => {
            // T1/T2/T4/T5：常量、微积分、参数式、物理分区带绑定时渲染编辑区（不再显示 coming soon）；其余分区维持占位
            const constantsLive = s.id === 'constants' && constants;
            const calculusLive = s.id === 'calculus' && calculus;
            const parametricLive = s.id === 'parametric' && parametric;
            const physicsLive = s.id === 'physics' && physics;
            const live = constantsLive || calculusLive || parametricLive || physicsLive;
            // ZOO-204 方案 A：不适用分区默认折叠——微积分区仅显式函数可用（非显式
            // 收起为一行原因，方程改回显式自动展开）；其余分区默认展开（模板行是
            // 模式切换入口，常显）。任何分区都可手动折叠 / 展开（会话内记住）
            const defaultOpen = s.id === 'calculus' ? Boolean(calculus?.applicable) : true;
            const open = advancedCollapseOpen(s.id, defaultOpen);
            const bodyId = `adv-section-${s.id}`;
            const inapplicableReason = calculusLive && calculus && !calculus.applicable ? t('advFormula.calcNotApplicable') : null;
            return (
              <section key={s.id} className="border border-gray-200 rounded-lg p-2.5 flex flex-col gap-1">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => {
                    setAdvancedCollapseOpen(s.id, !open);
                    // ZOO-204 后续：选中（展开）微积分分区 → 联动展开关联的基础公式；
                    // 收起与其他分区开合不触发
                    if (s.id === 'calculus' && !open) engageCalculus();
                  }}
                  className="touch-target w-full flex items-center gap-1.5 border-none bg-transparent text-left cursor-pointer rounded-md hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <span className="font-serif italic text-blue-500 text-sm leading-none">{s.glyph}</span>
                  <span className="text-[13px] font-semibold text-gray-700">{t(s.nameKey)}</span>
                  {!live && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 font-medium">
                      {t('advFormula.comingSoon')}
                    </span>
                  )}
                  <span
                    className={`${live ? 'ml-auto' : ''} text-gray-400 text-[11px] leading-none transition-transform duration-150 ${
                      open ? 'rotate-0' : '-rotate-90'
                    }`}
                    aria-hidden="true"
                  >
                    ⌄
                  </span>
                </button>
                {open ? (
                  <div id={bodyId} className="flex flex-col gap-1">
                    <div className="text-[11px] text-gray-500 leading-relaxed">{t(s.descKey)}</div>
                    {constantsLive ? (
                      <ConstantsArea binding={constants} />
                    ) : calculusLive ? (
                      <CalculusArea binding={calculus} />
                    ) : parametricLive ? (
                      <ParametricArea binding={parametric} />
                    ) : physicsLive ? (
                      <PhysicsArea binding={physics} />
                    ) : (
                      // T0 占位：分区控件由后续任务填充
                      <div className="text-[11px] text-gray-300 leading-relaxed select-none" aria-hidden="true">
                        ▢ ▢ ▢
                      </div>
                    )}
                  </div>
                ) : (
                  // 折叠态一行：不适用原因（微积分区）或分区描述
                  <div id={bodyId} className="text-[11px] text-gray-400 leading-relaxed">
                    {inapplicableReason ?? t(s.descKey)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
