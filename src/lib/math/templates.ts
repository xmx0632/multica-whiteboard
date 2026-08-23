/**
 * 方程模板与插入符号（交互原型基线 1:1 平移）。
 * 19 个模板覆盖 PRD §5.2 P0/P1 方程族（含二元一次 → 直线 D7、抛物线/双曲线 ZOO-147、退化两直线 ZOO-148、xy 交叉项旋转圆锥曲线 ZOO-149）；6 个符号按钮在光标处插入对应文本。
 *
 * ZOO-164：模板按方程族分组（TEMPLATE_GROUPS）供面板分组折叠渲染；
 * EQUATION_TEMPLATES 仍为唯一数据源，插入路径不变。
 * ZOO-176 i18n：模板 / 分组 / 符号只存稳定 id，显示名经资源键
 * （equation.tpl<Id> / equation.group<Id> / equation.symbol<Id>）按语言渲染，
 * 新增语言无需改本文件。
 */

export interface EquationTemplate {
  /** 模板 id（显示名资源键后缀，见 templateNameKey） */
  id: string;
  /** 填入输入框的方程原文 */
  equation: string;
}

export const EQUATION_TEMPLATES: EquationTemplate[] = [
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

/** 模板分组（ZOO-164）：按 PRD §5.2 方程族归类，组序即面板展示序 */
export const TEMPLATE_GROUPS: readonly TemplateGroup[] = [
  { id: 'basic', templateIds: ['linear', 'quadratic', 'cubic', 'radical', 'inverse', 'absolute'] },
  { id: 'trig', templateIds: ['sine', 'sineTransform', 'tangent'] },
  { id: 'explog', templateIds: ['exponent', 'log'] },
  { id: 'conic', templateIds: ['circle', 'ellipse', 'parabola', 'hyperbola', 'rotatedHyperbola', 'rotatedEllipse'] },
  { id: 'line', templateIds: ['linear2var', 'degenerateLines'] },
];

/** 分组显示名资源键（equation.group<Id>）。 */
export const templateGroupNameKey = (id: string) => `equation.group${keySuffix(id)}`;

export interface ResolvedTemplateGroup extends TemplateGroup {
  /** 组内模板对象（按 templateIds 声明序） */
  templates: EquationTemplate[];
}

/**
 * 分组渲染数据：组定义解析为带模板对象的组列表。
 * 保证每个模板恰好归属一组（单测校验全覆盖 / 无重复），插入行为与平铺版一致。
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
