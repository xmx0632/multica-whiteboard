/**
 * 方程模板与插入符号（交互原型基线 1:1 平移）。
 * ZOO-213 起面板模板共 42 条 + ZOO-215 增 1 条（开普勒椭圆轨道）= 43 条：
 * 19 条存量（PRD §5.2 P0/P1 方程族，含二元一次 → 直线 D7、抛物线/双曲线
 * ZOO-147、退化两直线 ZOO-148、xy 交叉项旋转圆锥曲线 ZOO-149）+ 23 条学段
 * 新模板（小学 3 / 初中数学 4 / 初中物理 6 / 高中数学 7 / 高中物理 3）+
 * 开普勒轨道 1（高中·物理，带 conic 标注叠加）；6 个符号按钮在光标处插入
 * 对应文本。
 *
 * ZOO-164：模板分组（TEMPLATE_GROUPS）供面板分组折叠渲染；EQUATION_TEMPLATES
 * 仍为唯一数据源，插入路径不变。ZOO-213 分组演进为「学段·学科」视图（常用
 * 置顶 + 小学·数学 / 初中·数学 / 初中·物理 / 高中·数学 / 高中·物理）——
 * 存量 19 条方程与插入行为不变、归位到对应学段组；「常用」组交叉引用高频
 * 模板（同一模板可同时出现在常用组与一个学段组，学段组仍两两不交）。
 * ZOO-176 i18n：模板 / 分组 / 符号只存稳定 id，显示名经资源键
 * （equation.tpl<Id> / equation.group<Id> / equation.symbol<Id>）按语言渲染，
 * 新增语言无需改本文件。
 * ZOO-188/197/192（T5）：带常量的新模板自带「常量预置 + 滑块元数据」载荷
 * （PHYSICS_TEMPLATES 的「常量+域+标注整包回填」机制推广到面板模板）——
 * 点选即回填草稿，任何模板不允许出现「插入后报欠定/缺常量错误」（一键出图
 * 硬约束）；显式函数的 domain 预置落元素 xAxis（自变量定义域，如自由落体
 * 的落地截断 t∈[0,2.02]）。
 */

import type { ConstantSliderMap } from './slider';
import type { MathPlotOverlay } from './types';

export interface EquationTemplate {
  /** 模板 id（显示名资源键后缀，见 templateNameKey） */
  id: string;
  /** 填入输入框的方程原文 */
  equation: string;
  /**
   * ZOO-213：常量预置（存储层 ASCII 键 → 值）。点选模板即回填常量草稿——
   * 含符号常量的公式（y=k·x+b）绑定后即时合法并出预览，不出现欠定报错。
   * 缺省（存量 19 条）不触碰常量草稿（零回归）。
   */
  constants?: Record<string, number>;
  /**
   * ZOO-213：滑块元数据预置（键集 ⊆ constants）。带常量模板默认可玩——
   * 教师插入后立即可拖滑块看变化；缺省条目渲染时回落 DEFAULT_SLIDER。
   */
  constantSliders?: ConstantSliderMap;
  /**
   * ZOO-213：自变量 / 参数域预置。显式函数落元素 xAxis（自变量定义域——
   * 物理模板的时间窗 / 落地截断、机械波的三波长窗口）；参数式 / 极坐标为
   * t/θ 域（与 PHYSICS_TEMPLATES.domain 同口径）。缺省不携带（落默认）。
   */
  domain?: { min: number; max: number };
  /**
   * ZOO-213：叠加预置（确认载荷 overlays 全量快照）。导数切线案例（切线
   * x₀=1）、简谐+速度同屏（f′ 叠加）等教学整包；缺省不触碰叠加草稿。
   */
  overlays?: MathPlotOverlay[];
}

export const EQUATION_TEMPLATES: EquationTemplate[] = [
  // —— 存量 19 条（方程与插入行为不变，ZOO-213 归位学段组）——
  { id: 'linear', equation: 'y=2x+1' },
  { id: 'linear2var', equation: '3x+2y=6' },
  { id: 'quadratic', equation: 'y=x²-2x-3' },
  { id: 'cubic', equation: 'y=x³-2x' },
  { id: 'sine', equation: 'y=sin(x)' },
  { id: 'sineTransform', equation: 'y=2sin(2x+π/3)' },
  { id: 'tangent', equation: 'y=tan(x)' },
  { id: 'radical', equation: 'y=√x' },
  { id: 'inverse', equation: 'y=1/x' },
  { id: 'exponent', equation: 'y=2ˣ' },
  { id: 'log', equation: 'y=ln(x)' },
  { id: 'absolute', equation: 'y=|x-1|' },
  { id: 'circle', equation: '(x-1)²+(y-2)²=9' },
  { id: 'ellipse', equation: 'x²/9+y²/4=1' },
  { id: 'parabola', equation: 'y²=4x' },
  { id: 'hyperbola', equation: 'x²/9-y²/4=1' },
  { id: 'degenerateLines', equation: 'x²-y²=0' },
  { id: 'rotatedHyperbola', equation: 'xy=1' },
  { id: 'rotatedEllipse', equation: '5x²-6xy+5y²=8' },
  // —— ZOO-213 新增 23 条（方程原文逐条经真实解析器实测验证）——
  // 小学·数学
  { id: 'proportional', equation: 'y=2x' },
  { id: 'inverseProp', equation: 'y=6/x' },
  { id: 'letterCoeff', equation: 'y=a·x', constants: { a: 2 }, constantSliders: { a: { min: -5, max: 5, step: 0.1 } } },
  // 初中·数学（带参函数族：常量 + 滑块整包）
  {
    id: 'linearKb',
    equation: 'y=k·x+b',
    constants: { k: 2, b: 1 },
    constantSliders: { k: { min: -10, max: 10, step: 0.1 }, b: { min: -10, max: 10, step: 0.1 } },
  },
  {
    id: 'vertexQuadratic',
    equation: 'y=a·(x-h)²+k',
    constants: { a: 1, h: 1, k: 2 },
    constantSliders: { a: { min: -5, max: 5, step: 0.1 }, h: { min: -10, max: 10, step: 0.1 }, k: { min: -10, max: 10, step: 0.1 } },
  },
  {
    id: 'generalQuadratic',
    equation: 'y=a·x²+b·x+c',
    constants: { a: 1, b: -2, c: -3 },
    constantSliders: { a: { min: -5, max: 5, step: 0.1 }, b: { min: -10, max: 10, step: 0.1 }, c: { min: -10, max: 10, step: 0.1 } },
  },
  { id: 'inverseK', equation: 'y=k/x', constants: { k: 6 }, constantSliders: { k: { min: -20, max: 20, step: 0.5 } } },
  // 初中·物理（物理模板包机制：常量 + 域整包回填；方程形态为显式函数，
  // 自变量即物理自变量 t/u/v——domain 落元素 xAxis 作自变量定义域）
  { id: 'uniformMotion', equation: 'x(t)=v·t', constants: { v: 10 }, constantSliders: { v: { min: 0, max: 30, step: 0.5 } }, domain: { min: 0, max: 10 } },
  { id: 'accelVt', equation: 'v(t)=a·t', constants: { a: 2 }, constantSliders: { a: { min: 0, max: 10, step: 0.5 } }, domain: { min: 0, max: 10 } },
  { id: 'accelXt', equation: 'x(t)=0.5·a·t²', constants: { a: 2 }, constantSliders: { a: { min: 0, max: 10, step: 0.5 } }, domain: { min: 0, max: 10 } },
  // 自由落体：t 域预置到落地时刻（v₀=0、下落 20m 落地 T=√(2·20/9.8)≈2.02s）
  { id: 'freeFall', equation: 'h(t)=0.5·g·t²', constants: { g: 9.8 }, constantSliders: { g: { min: 1, max: 20, step: 0.1 } }, domain: { min: 0, max: 2.02 } },
  // 欧姆定律 I-U：y 轴表 I、自变量 u 表 U（模板显示名注明轴语义）
  { id: 'ohmIU', equation: 'y=u/r', constants: { r: 10 }, constantSliders: { r: { min: 1, max: 100, step: 1 } }, domain: { min: 0, max: 10 } },
  // 密度 m-V：ρ 不可书写（希腊归一表仅 θ/ω/φ），以 d 规避（模板显示名注明）
  { id: 'densityMV', equation: 'm(v)=d·v', constants: { d: 2 }, constantSliders: { d: { min: 0.1, max: 20, step: 0.1 } }, domain: { min: 0, max: 10 } },
  // 高中·数学
  { id: 'cosine', equation: 'y=cos(x)' },
  {
    id: 'cosineTransform',
    equation: 'y=A·cos(ωx+φ)',
    constants: { a: 1, omega: 1, phi: 0 },
    constantSliders: { a: { min: -5, max: 5, step: 0.1 }, omega: { min: 0, max: 10, step: 0.1 }, phi: { min: -3.14, max: 3.14, step: 0.01 } },
  },
  { id: 'expDecay', equation: 'y=(1/2)ˣ' },
  // 幂函数族：步进 0.5 覆盖教学惯用指数 0.5/1/2/3/-1（负指数即反比例）
  { id: 'powerFunc', equation: 'y=x^a', constants: { a: 2 }, constantSliders: { a: { min: -3, max: 3, step: 0.5 } } },
  // 指数带参：底数范围限正（a≤0 时实数域无定义，滑块拖到负值只会得到空图）
  { id: 'expParam', equation: 'y=aˣ', constants: { a: 2 }, constantSliders: { a: { min: 0.5, max: 5, step: 0.5 } } },
  { id: 'logBase2', equation: 'y=log(x,2)' },
  // 导数切线案例：预置切线叠加（切点 x₀=1，f′(1)=0 处的切线随方程联动）
  { id: 'derivTangent', equation: 'y=x³-3x', overlays: [{ type: 'tangent', x0: 1 }] },
  // 高中·物理
  // 简谐+速度同屏：f′ 叠加即 v-t 虚线（-Aω·sin 与位移相位差 π/2 的教学演示）
  {
    id: 'shmVelocity',
    equation: 'x(t)=A·cos(ωt+φ)',
    constants: { a: 2, omega: 1, phi: 0 },
    constantSliders: { a: { min: -5, max: 5, step: 0.1 }, omega: { min: 0, max: 10, step: 0.1 }, phi: { min: -3.14, max: 3.14, step: 0.01 } },
    domain: { min: 0, max: Math.PI * 4 },
    overlays: [{ type: 'derivative' }],
  },
  // 机械波波形图：x∈[0,12] 恰好三个波长（T=4）；周期 T 的存储键为 t（归一化小写）
  {
    id: 'mechWave',
    equation: 'y=A·sin(2π·x/T)',
    constants: { a: 1, t: 4 },
    constantSliders: { a: { min: -5, max: 5, step: 0.1 }, t: { min: 0.5, max: 20, step: 0.5 } },
    domain: { min: 0, max: 12 },
  },
  // 交变电流：ω=2 时周期 π，t∈[0,2π] 即两个完整周期
  {
    id: 'acCurrent',
    equation: 'e(t)=E₀·sin(ω·t)',
    constants: { e0: 5, omega: 2 },
    constantSliders: { e0: { min: -10, max: 10, step: 0.1 }, omega: { min: 0, max: 10, step: 0.1 } },
    domain: { min: 0, max: Math.PI * 2 },
  },
  // —— ZOO-215（高中·物理）——
  // 开普勒第一定律（椭圆轨道定律）：a=5、b=4 → c=3、e=c/a=0.6（彗星级偏心率，
  // 焦点分离清晰可见），太阳位于焦点 F₁——插入即带焦点标注（conic 叠加），
  // F₁F₂ 点标记 + 标签随方程常量改值实时联动
  { id: 'keplerOrbit', equation: 'x²/25+y²/16=1', overlays: [{ type: 'conic' }] },
];

/** id → 资源键后缀（首字母大写驼峰）：'linear2var' → 'tplLinear2var'。 */
const keySuffix = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/** 模板显示名资源键（equation.tpl<Id>）。 */
export const templateNameKey = (id: string) => `equation.tpl${keySuffix(id)}`;

export interface TemplateGroup {
  /** 分组 id（折叠状态记忆的键） */
  id: string;
  /** 组内模板 id（引用 EQUATION_TEMPLATES 的 id；分组渲染解析，插入路径不变） */
  templateIds: readonly string[];
}

/**
 * 模板分组（ZOO-164 起 / ZOO-213 演进为学段·学科视图）：「常用」置顶组交叉
 * 引用高频模板（一次 / 二次 / 正弦 / 圆——老用户不迷失），五个学段组按教学
 * 阶段归类全部模板（每个模板恰属一个学段组；新用户按学段直达）。组序即
 * 面板展示序（首组「常用」默认展开，教学最高频）。
 */
export const TEMPLATE_GROUPS: readonly TemplateGroup[] = [
  { id: 'common', templateIds: ['linear', 'quadratic', 'sine', 'circle'] },
  { id: 'primaryMath', templateIds: ['proportional', 'inverseProp', 'letterCoeff'] },
  {
    id: 'juniorMath',
    templateIds: ['linear', 'linearKb', 'vertexQuadratic', 'generalQuadratic', 'quadratic', 'inverseK', 'linear2var', 'inverse', 'radical', 'absolute'],
  },
  { id: 'juniorPhysics', templateIds: ['uniformMotion', 'accelVt', 'accelXt', 'freeFall', 'ohmIU', 'densityMV'] },
  {
    id: 'seniorMath',
    templateIds: [
      'cosine',
      'cosineTransform',
      'expDecay',
      'powerFunc',
      'expParam',
      'logBase2',
      'derivTangent',
      'sine',
      'sineTransform',
      'tangent',
      'exponent',
      'log',
      'cubic',
      'circle',
      'ellipse',
      'parabola',
      'hyperbola',
      'degenerateLines',
      'rotatedHyperbola',
      'rotatedEllipse',
    ],
  },
  { id: 'seniorPhysics', templateIds: ['shmVelocity', 'mechWave', 'acCurrent', 'keplerOrbit'] },
];

/** 「常用」置顶组 id（ZOO-213：交叉引用组——不参与学段组划分的单射约束）。 */
export const COMMON_GROUP_ID = 'common';

/** 分组显示名资源键（equation.group<Id>）。 */
export const templateGroupNameKey = (id: string) => `equation.group${keySuffix(id)}`;

/**
 * 显式函数 y=f(x) 模板组（ZOO-204 后续）：高级公式面板选中微积分分区时
 * 联动展开这些「关联的基础公式」组。ZOO-213 分组演进后取三条数学学段线
 * （显式函数教学的主阵地；高中组内混排的圆锥曲线同为微积分教学的关联基础，
 * 展开是提示不是精确分类）；物理组与微积分叠加互斥面（x(t)=f(t) 形态可用
 * 但非联动对象），不参与联动。
 */
export const EXPLICIT_FUNCTION_GROUP_IDS: readonly string[] = ['primaryMath', 'juniorMath', 'seniorMath'];

export interface ResolvedTemplateGroup extends TemplateGroup {
  /** 组内模板对象（按 templateIds 声明序） */
  templates: EquationTemplate[];
}

/**
 * 分组渲染数据：组定义解析为带模板对象的组列表。
 * ZOO-213 起保证每个模板恰属一个学段组、可在「常用」组额外交叉出现一次
 * （单测校验全覆盖 / 学段组无重复），插入行为与平铺版一致。
 */
export function groupTemplates(): ResolvedTemplateGroup[] {
  return TEMPLATE_GROUPS.map((g) => ({
    ...g,
    templates: g.templateIds.map((id) => {
      const t = EQUATION_TEMPLATES.find((tpl) => tpl.id === id);
      if (!t) throw new Error(`模板分组引用了不存在的模板 id：${id}`);
      return t;
    }),
  }));
}

export interface SymbolButton {
  /** 按钮显示（符号本身，语言无关） */
  label: string;
  /** 插入输入框光标处的文本 */
  insert: string;
  /** 悬停提示资源键后缀 id（见 symbolTitleKey） */
  id: string;
}

/**
 * 高级公式面板模板（ZOO-188 T1）：只进 AdvancedFormulaPanel，不进
 * EQUATION_TEMPLATES / TEMPLATE_GROUPS——19 模板面板零改动（零回归硬约束）。
 * 方程原文保留书写原貌（希腊字母 / 下标），归一化层负责翻译（normalize.ts）。
 */
export const ADVANCED_TEMPLATES: EquationTemplate[] = [
  { id: 'sineConstants', equation: 'y=A·sin(ωx+φ)' },
];

/** 高级面板模板显示名资源键（advFormula.tpl<Id>）。 */
export const advancedTemplateNameKey = (id: string) => `advFormula.tpl${keySuffix(id)}`;

/**
 * 参数式模板（ZOO-191 T4）：落高级公式面板参数式分区（复用 T1 的
 * advancedTemplateNameKey 机制），不进 EQUATION_TEMPLATES / TEMPLATE_GROUPS
 * ——19 模板面板零改动（零回归硬约束）。方程原文保留书写原貌（θ 归一化层
 * 翻译 theta），默认参数域 [0,2π] 即参数圆 / 心形线 / 李萨如的整周期
 * （摆线出一段完整拱）。
 */
export const PARAMETRIC_TEMPLATES: EquationTemplate[] = [
  { id: 'parametricCircle', equation: 'x=cos(t),y=sin(t)' },
  { id: 'cardioid', equation: 'r=1+cos(θ)' },
  { id: 'cycloid', equation: 'x=t-sin(t),y=1-cos(t)' },
  { id: 'lissajous', equation: 'x=sin(3t),y=sin(5t)' },
];

/**
 * 物理模板（ZOO-192 T5）：落高级公式面板物理分区，不进 EQUATION_TEMPLATES /
 * TEMPLATE_GROUPS（零回归硬约束）。与常量 / 参数式模板的差异：模板自带
 * 「常量预置 + 参数域预置 + 标注预置」三件载荷——点选即回填全部草稿，插入即
 * 出图（抛体 t 域预置到落地时间 T≈2.04s，θ 预置 30° 的弧度值 π/6——存储层
 * 弧度口径与 T1 预置槽 θ=π/4 一致）。
 */
export interface PhysicsTemplate extends EquationTemplate {
  /** 常量预置（存储层 ASCII 键 → 值）：点选即绑定，出图即生效 */
  constants: Record<string, number>;
  /** 参数 / 自变量域预置（元素 xAxis；抛体取落地时间、圆周取整圈、简谐取两个周期） */
  domain: { min: number; max: number };
  /** 插入即带落地/峰值标注（physics 叠加条目；仅抛体模板为 true） */
  marks: boolean;
}

/** 抛体预置（PoC 基准：v₀=20、θ=30°、g=9.8 → T≈2.04s、R≈35.35、H≈5.1）。 */
const PROJECTILE_V0 = 20;
const PROJECTILE_THETA = Math.PI / 6; // 30°（弧度存储，显示层由常量区呈现原值）
const PROJECTILE_G = 9.8;

export const PHYSICS_TEMPLATES: PhysicsTemplate[] = [
  {
    id: 'projectile',
    equation: 'x=v₀·cos(θ)·t,y=v₀·sin(θ)·t-0.5·g·t²',
    constants: { v0: PROJECTILE_V0, theta: PROJECTILE_THETA, g: PROJECTILE_G },
    domain: { min: 0, max: (2 * PROJECTILE_V0 * Math.sin(PROJECTILE_THETA)) / PROJECTILE_G },
    marks: true,
  },
  {
    id: 'shm',
    equation: 'x(t)=A·cos(ωt+φ)',
    constants: { a: 2, omega: 1, phi: 0 },
    domain: { min: 0, max: Math.PI * 4 },
    marks: false,
  },
  {
    id: 'circular',
    equation: 'x=A·cos(ωt),y=A·sin(ωt)',
    constants: { a: 2, omega: 1 },
    domain: { min: 0, max: Math.PI * 2 },
    marks: false,
  },
];

/** 物理模板显示名资源键（phys.tpl<Id>——独立命名空间，避免与他区新增键冲突）。 */
export const physicsTemplateNameKey = (id: string) => `phys.tpl${keySuffix(id)}`;

/** 符号悬停提示资源键（equation.symbol<Id>）。 */
export const symbolTitleKey = (id: string) => `equation.symbol${keySuffix(id)}`;

export const SYMBOL_BUTTONS: SymbolButton[] = [
  { id: 'pi', label: 'π', insert: 'π' },
  { id: 'sqrt', label: '√', insert: '√(' },
  { id: 'sq', label: '²', insert: '²' },
  { id: 'cube', label: '³', insert: '³' },
  { id: 'pow', label: '^', insert: '^' },
  { id: 'abs', label: '|x|', insert: '|x-1|' },
];
