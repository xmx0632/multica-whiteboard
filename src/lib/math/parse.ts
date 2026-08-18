/**
 * 方程安全解析（ZOO-134，技术方案 §7 / D2）—— mathjs number 构建 parse→compile，
 * 禁 eval / new Function（PRD §8 硬约束）。
 *
 * 流程：normalize → 圆/椭圆标准形识别 → 剥离 y= / f(x)= 前缀 → 字符白名单 →
 * mathjs parse → AST 节点白名单 → compile（LRU 缓存）→ { kind, fn }。
 *
 * 分类与错误文案逐条对齐交互原型五类（无法识别的符号 / 括号未闭合 /
 * 表达式不完整 / 定义域内无有效值〔采样期报〕/ 暂不支持隐式方程），
 * 与 4a 结构校验（validate.ts）的既有文案保持一致。
 */
import { parse } from 'mathjs/number';
import type { MathNode } from 'mathjs/number';
import { normalizeEquation } from './normalize';
import { compileCached } from './cache';
import type { CircleParams, EllipseParams, ParseResult } from './types';

const err = (message: string): ParseResult => ({ kind: 'error', message });

/** 圆 (x-a)²+(y-b)²=r² / 椭圆 x²/A+(y-b)²/B=1 标准形识别（原型 detectGeometry 平移）。 */
function detectGeometry(src: string): ParseResult | null {
  let m = src.match(/^\(?x([+-][\d.]+)?\)?\^2\+\(?y([+-][\d.]+)?\)?\^2=([\d.]+)$/);
  if (m) {
    const r = Math.sqrt(parseFloat(m[3]));
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

/** AST 符号白名单：变量与常量（scope 只含 x）。 */
const ALLOWED_SYMBOLS = new Set(['x', 'pi', 'e']);
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
function checkNode(node: MathNode): string | null {
  switch (node.type) {
    case 'ConstantNode':
      return null;
    case 'ParenthesisNode': {
      const content = (node as unknown as { content?: MathNode }).content;
      return content ? checkNode(content) : '无法识别的表达式';
    }
    case 'OperatorNode': {
      const args = (node as unknown as { args?: MathNode[] }).args ?? [];
      if (args.length === 0) return '无法识别的表达式';
      for (const arg of args) {
        const problem = checkNode(arg);
        if (problem) return problem;
      }
      return null;
    }
    case 'SymbolNode': {
      const name = (node as unknown as { name?: string }).name ?? '';
      return ALLOWED_SYMBOLS.has(name) ? null : `无法识别的符号 “${name}”`;
    }
    case 'FunctionNode': {
      const fn = (node as unknown as { fn?: { name?: string } }).fn;
      const name = fn?.name ?? '';
      if (!ALLOWED_FUNCTIONS.has(name)) return `无法识别的符号 “${name}”`;
      const [min, max] = FUNCTION_ARITY[name];
      const args = (node as unknown as { args?: MathNode[] }).args ?? [];
      if (args.length < min || args.length > max) return '无法识别的表达式';
      for (const arg of args) {
        const problem = checkNode(arg);
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

/**
 * 方程解析入口（编辑器每键调用 / 确认出图共用）。
 *
 * 分类：explicit（含求值函数）/ circle / ellipse / error。
 * 安全：AST 白名单 + scope 只注入 x，无 eval，无属性访问。
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

  // 剩余 '=' 或裸 y：既非 y=f(x) 前缀、也未命中几何标准形 → 隐式方程
  if (body.includes('=')) return err('暂不支持该隐式方程：请使用 y=f(x) 形式（圆/椭圆除外）');
  if (/(^|[^a-z0-9])y([^a-z0-9]|$)/.test(body)) return err('暂不支持该隐式方程：请使用 y=f(x) 形式（圆/椭圆除外）');

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
