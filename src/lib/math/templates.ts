/**
 * 方程模板与插入符号（交互原型基线 1:1 平移）。
 * 19 个模板覆盖 PRD §5.2 P0/P1 方程族（含二元一次 → 直线 D7、抛物线/双曲线 ZOO-147、退化两直线 ZOO-148、xy 交叉项旋转圆锥曲线 ZOO-149）；6 个符号按钮在光标处插入对应文本。
 *
 * ZOO-164：模板按方程族分组（TEMPLATE_GROUPS）供面板分组折叠渲染；
 * EQUATION_TEMPLATES 仍为唯一数据源，插入路径不变。
 */

export interface EquationTemplate {
  /** 模板名（按钮小字） */
  name: string;
  /** 填入输入框的方程原文 */
  equation: string;
}

export const EQUATION_TEMPLATES: EquationTemplate[] = [
  { name: '一次函数', equation: 'y=2x+1' },
  { name: '二元一次', equation: '3x+2y=6' },
  { name: '二次函数', equation: 'y=x²-2x-3' },
  { name: '三次函数', equation: 'y=x³-2x' },
  { name: '正弦', equation: 'y=sin(x)' },
  { name: '正弦变换', equation: 'y=2sin(2x+π/3)' },
  { name: '正切', equation: 'y=tan(x)' },
  { name: '根式', equation: 'y=√x' },
  { name: '反比例', equation: 'y=1/x' },
  { name: '指数', equation: 'y=2ˣ' },
  { name: '对数', equation: 'y=ln(x)' },
  { name: '绝对值', equation: 'y=|x-1|' },
  { name: '圆', equation: '(x-1)²+(y-2)²=9' },
  { name: '椭圆', equation: 'x²/9+y²/4=1' },
  { name: '抛物线', equation: 'y²=4x' },
  { name: '双曲线', equation: 'x²/9-y²/4=1' },
  { name: '退化两直线', equation: 'x²-y²=0' },
  { name: '旋转双曲线', equation: 'xy=1' },
  { name: '旋转椭圆', equation: '5x²-6xy+5y²=8' },
];

export interface TemplateGroup {
  /** 分组 id（折叠状态记忆的键） */
  id: string;
  /** 组头行显示的组名（PRD 方程族对齐） */
  name: string;
  /** 组内模板名（引用 EQUATION_TEMPLATES 的 name；分组渲染解析，插入路径不变） */
  templateNames: readonly string[];
}

/** 模板分组（ZOO-164）：按 PRD §5.2 方程族归类，组序即面板展示序 */
export const TEMPLATE_GROUPS: readonly TemplateGroup[] = [
  { id: 'basic', name: '基本函数', templateNames: ['一次函数', '二次函数', '三次函数', '根式', '反比例', '绝对值'] },
  { id: 'trig', name: '三角函数', templateNames: ['正弦', '正弦变换', '正切'] },
  { id: 'explog', name: '指数对数', templateNames: ['指数', '对数'] },
  { id: 'conic', name: '几何曲线', templateNames: ['圆', '椭圆', '抛物线', '双曲线', '旋转双曲线', '旋转椭圆'] },
  { id: 'line', name: '直线与方程', templateNames: ['二元一次', '退化两直线'] },
];

export interface ResolvedTemplateGroup extends TemplateGroup {
  /** 组内模板对象（按 templateNames 声明序） */
  templates: EquationTemplate[];
}

/**
 * 分组渲染数据：组定义解析为带模板对象的组列表。
 * 保证每个模板恰好归属一组（单测校验全覆盖 / 无重复），插入行为与平铺版一致。
 */
export function groupTemplates(): ResolvedTemplateGroup[] {
  return TEMPLATE_GROUPS.map((g) => ({
    ...g,
    templates: g.templateNames.map((name) => {
      const t = EQUATION_TEMPLATES.find((tpl) => tpl.name === name);
      if (!t) throw new Error(`模板分组引用了不存在的模板名：${name}`);
      return t;
    }),
  }));
}

export interface SymbolButton {
  /** 按钮显示 */
  label: string;
  /** 插入输入框光标处的文本 */
  insert: string;
  title: string;
}

export const SYMBOL_BUTTONS: SymbolButton[] = [
  { label: 'π', insert: 'π', title: '圆周率 π' },
  { label: '√', insert: '√(', title: '根号 √(' },
  { label: '²', insert: '²', title: '平方 ²' },
  { label: '³', insert: '³', title: '立方 ³' },
  { label: '^', insert: '^', title: '幂 ^' },
  { label: '|x|', insert: '|x-1|', title: '绝对值 |x-1|' },
];
