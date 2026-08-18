/**
 * 方程安全解析（ZOO-134，技术方案 §7 / D2）—— mathjs number 构建 parse→compile，
 * 禁 eval / new Function（PRD §8 硬约束）。
 *
 * 流程：normalize → 圆/椭圆标准形识别 → 剥离 y= / f(x)= 前缀 → 字符白名单 →
 * mathjs parse → AST 节点白名单 → compile（LRU 缓存）→ { kind, fn }。
 *
 * ZOO-146（D7）：显式路径之外新增隐式二元方程分类分支（parseImplicit）——
 * 二元一次方程（含竖线）经数值探针提取系数 → kind='line'。
 *
 * 分类与错误文案逐条对齐交互原型五类（无法识别的符号 / 括号未闭合 /
 * 表达式不完整 / 定义域内无有效值〔采样期报〕/ 暂不支持隐式方程），
 * 与 4a 结构校验（validate.ts）的既有文案保持一致。
 */
import { parse } from 'mathjs/number';
import type { MathNode } from 'mathjs/number';
import { normalizeEquation } from './normalize';
import { buildImplicitExpression, classifyImplicit, splitTopLevelEquals, type BinaryFn } from './conic';
import { compileCached } from './cache';
import type { CircleParams, EllipseParams, ParseResult } from './types';

const err = (message: string): ParseResult => ({ kind: 'error', message });

/** 圆 (x-a)²+(y-b)²=r² / 椭圆 x²/A+(y-b)²/B=1 标准形识别（原型 detectGeometry 平移）。 */
function detectGeometry(src: string): ParseResult | null {
  let m = src.match(/^\(?x([+-][\d.]+)?\)?\^2\+\(?y([+-][\d.]+)?\)?\^2=([\d.]+)$/);
  if (m) {
    const r = Math.sqrt(parseFloat(m[3]));
    // r=0（如 x²+y²=0）是退化单点：交回隐式分类器出 kind='point'（ZOO-148）
    if (r === 0) return null;
    if (!(r > 0)) return err('圆的半径必须为正');
    const params: CircleParams = {
      cx: m[1] ? -parseFloat(m[1]) : 0,
      cy: m[2] ? -parseFloat(m[2]) : 0,
      r,
    };
    return { kind: 'circle', params };
  }
  m = src.match(/^\(?x([+-][\d.]+)?\)?\^2\/([\d.]+)\+\(?y([+-][\d.]+)?\)?\^2\/([\d.]+)=1$/);
  if (m) {
    const rx = Math.sqrt(parseFloat(m[2]));
    const ry = Math.sqrt(parseFloat(m[4]));
    if (!(rx > 0 && ry > 0)) return err('椭圆参数必须为正');
    const params: EllipseParams = {
      cx: m[1] ? -parseFloat(m[1]) : 0,
      cy: m[3] ? -parseFloat(m[3]) : 0,
      rx,
      ry,
    };
    return { kind: 'ellipse', params };
  }
  return null;
}

/** AST 符号白名单：显式函数路径（scope 只含 x）。 */
const ALLOWED_SYMBOLS = new Set(['x', 'pi', 'e']);
/** 隐式二元方程路径（D7）：F(x,y) 两端自由变量 x / y。 */
const IMPLICIT_SYMBOLS = new Set(['x', 'y', 'pi', 'e']);
/** AST 函数白名单（原型 §6 函数族）。 */
const ALLOWED_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sqrt', 'abs', 'log', 'exp', 'asin', 'acos', 'atan']);
/** 各函数允许的参数个数（log 支持带底 two-arg）。 */
const FUNCTION_ARITY: Record<string, [number, number]> = {
  log: [1, 2],
};
for (const name of ALLOWED_FUNCTIONS) {
  if (!FUNCTION_ARITY[name]) FUNCTION_ARITY[name] = [1, 1];
}

/**
 * AST 节点白名单巡检（安全防线之二，PRD §8 禁公式注入）：
 * 只放行 Constant / 白名单 Symbol / 白名单 Function / Operator / Parenthesis；
 * Assignment / Accessor / Conditional / Block 等一律拒绝。
 * 返回 null 表示通过，否则为用户可读错误文案。
 */
function checkNode(node: MathNode, symbols: Set<string> = ALLOWED_SYMBOLS): string | null {
  switch (node.type) {
    case 'ConstantNode':
      return null;
    case 'ParenthesisNode': {
      const content = (node as unknown as { content?: MathNode }).content;
      return content ? checkNode(content, symbols) : '无法识别的表达式';
    }
    case 'OperatorNode': {
      const args = (node as unknown as { args?: MathNode[] }).args ?? [];
      if (args.length === 0) return '无法识别的表达式';
      for (const arg of args) {
        const problem = checkNode(arg, symbols);
        if (problem) return problem;
      }
      return null;
    }
    case 'SymbolNode': {
      const name = (node as unknown as { name?: string }).name ?? '';
      return symbols.has(name) ? null : `无法识别的符号 “${name}”`;
    }
    case 'FunctionNode': {
      const fn = (node as unknown as { fn?: { name?: string } }).fn;
      const name = fn?.name ?? '';
      if (!ALLOWED_FUNCTIONS.has(name)) return `无法识别的符号 “${name}”`;
      const [min, max] = FUNCTION_ARITY[name];
      const args = (node as unknown as { args?: MathNode[] }).args ?? [];
      if (args.length < min || args.length > max) return '无法识别的表达式';
      for (const arg of args) {
        const problem = checkNode(arg, symbols);
        if (problem) return problem;
      }
      return null;
    }
    default:
      // AssignmentNode / AccessorNode / ConditionalNode / BlockNode / RangeNode …
      return '无法识别的表达式';
  }
}

/** mathjs SyntaxError → 原型五类文案映射。 */
function mapSyntaxError(message: string): string {
  if (/parenthesis/i.test(message)) return '括号或绝对值符号未闭合';
  if (/unexpected end/i.test(message)) return '表达式不完整';
  if (/unexpected part/i.test(message)) return '数字格式有误';
  return '无法识别的表达式';
}

/** 隐式方程不支持文案（D7 引导式：非多项式隐式；空集 / 旋转 / 椭圆型另有专用文案）。 */
const UNSUPPORTED_IMPLICIT =
  '暂不支持该隐式方程：目前支持 y=f(x)、圆/椭圆标准形、二元一次与二元二次方程（抛物线 / 双曲线 / 退化两直线与单点，如 y²=4x、9x²−16y²=144、x²−y²=0）';

/**
 * 隐式二元方程分类（D7，ZOO-146/147/148）：顶层 split `=` → F=lhs−rhs → 复用
 * 本文件安全管线（字符白名单 / AST 白名单含 y / compile LRU）→ conic.ts 数值探针。
 * 二元一次 → kind='line'（含竖线）；二次判别式 → 'parabola' / 'hyperbola'
 * （B=0 轴对齐含平移）；退化形 → 'linePair'（两直线）/ 'point'（单点）出图、
 * 空集友好报错；旋转项 / 椭圆型 / 非多项式 → 引导文案。
 */
function parseImplicit(src: string): ParseResult {
  const split = splitTopLevelEquals(src);
  if (!split) return err(src.includes('=') ? '方程只能包含一个等号' : '方程缺少等号：请输入 y=f(x) 或二元一次方程（如 3x+2y=6）');
  const expr = buildImplicitExpression(split.lhs, split.rhs);

  // 字符白名单（与显式路径同款， '#' 等必须在 parse 前拦截）
  const badChar = expr.match(/[^a-z0-9+\-*/^().,]/);
  if (badChar) return err(`无法识别的字符 “${badChar[0]}”`);

  let node: MathNode;
  try {
    node = parse(expr);
  } catch (e) {
    return err(mapSyntaxError(e instanceof Error ? e.message : String(e)));
  }

  const problem = checkNode(node, IMPLICIT_SYMBOLS);
  if (problem) return err(problem);

  try {
    const compiled = compileCached(expr, node);
    // F(x,y)：scope 只含 x/y；异常与非 number 结果一律 NaN（探针按非线性处理）
    const fn: BinaryFn = (x, y) => {
      try {
        const v = compiled.evaluate({ x, y });
        return typeof v === 'number' ? v : NaN;
      } catch {
        return NaN;
      }
    };
    const outcome = classifyImplicit(fn);
    if (outcome.kind === 'line') return { kind: 'line', params: outcome.params };
    if (outcome.kind === 'linePair') return { kind: 'linePair', params: outcome.params };
    if (outcome.kind === 'point') return { kind: 'point', params: outcome.params };
    if (outcome.kind === 'parabola') return { kind: 'parabola', params: outcome.params };
    if (outcome.kind === 'hyperbola') return { kind: 'hyperbola', params: outcome.params };
    if (outcome.kind === 'degenerate' || outcome.kind === 'unsupported') return err(outcome.message);
    return err(UNSUPPORTED_IMPLICIT);
  } catch {
    return err('无法识别的表达式');
  }
}

/**
 * 方程解析入口（编辑器每键调用 / 确认出图共用）。
 *
 * 分类：explicit（含求值函数）/ line（二元一次，D7）/ circle / ellipse / error。
 * 安全：AST 白名单 + scope 只注入 x（显式）或 x/y（隐式），无 eval，无属性访问。
 */
export function parseEquation(raw: string): ParseResult {
  const src = normalizeEquation(raw);
  if (!src) return err('请输入方程');

  // 未配对的 | / √ 在归一化中保留原样，统一在此报未闭合
  if (src.includes('|') || src.includes('√')) return err('括号或绝对值符号未闭合');

  const geo = detectGeometry(src);
  if (geo) return geo;

  // 剥离 y= / f(x)= 前缀
  const body = src.replace(/^y=/, '').replace(/^f\(x\)=/, '');
  if (!body) return err('方程缺少右侧表达式');

  // 剩余 '=' 或裸 y：既非 y=f(x) 前缀、也未命中几何标准形 → 隐式方程分类（D7）
  if (body.includes('=')) return parseImplicit(src);
  if (/(^|[^a-z])y([^a-z]|$)/.test(body)) {
    // 等号被剥前缀后右侧仍含自由 y（如 y=x+y ⟺ x=0）→ 按隐式方程整体分类；
    // 无等号的裸 y（如 "2y"，数字邻接按 mathjs 原生隐式乘法保留）不是方程，单独引导
    return src.includes('=') ? parseImplicit(src) : err('方程缺少等号：请输入 y=f(x) 或二元一次方程（如 3x+2y=6）');
  }

  // 字符白名单（mathjs 会把 '#' 等解析为 undefined 常量，必须前置拦截）
  const badChar = body.match(/[^a-z0-9+\-*/^().,]/);
  if (badChar) return err(`无法识别的字符 “${badChar[0]}”`);

  let node: MathNode;
  try {
    node = parse(body);
  } catch (e) {
    return err(mapSyntaxError(e instanceof Error ? e.message : String(e)));
  }

  const problem = checkNode(node);
  if (problem) return err(problem);

  try {
    const compiled = compileCached(body, node);
    // 求值函数：scope 只含 x；异常与非 number 结果一律 NaN（采样期按断笔处理）
    const fn = (x: number): number => {
      try {
        const v = compiled.evaluate({ x });
        return typeof v === 'number' ? v : NaN;
      } catch {
        return NaN;
      }
    };
    return { kind: 'explicit', fn };
  } catch {
    return err('无法识别的表达式');
  }
}
