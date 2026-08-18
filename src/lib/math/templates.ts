/**
 * 方程模板与插入符号（交互原型基线 1:1 平移）。
 * 13 个模板覆盖 PRD §5.2 P0/P1 方程族；6 个符号按钮在光标处插入对应文本。
 */

export interface EquationTemplate {
  /** 模板名（按钮小字） */
  name: string;
  /** 填入输入框的方程原文 */
  equation: string;
}

export const EQUATION_TEMPLATES: EquationTemplate[] = [
  { name: '一次函数', equation: 'y=2x+1' },
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
];

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
