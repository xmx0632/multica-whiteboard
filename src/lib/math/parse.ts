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
 * ZOO-166：错误文案全面升级为「现象 + 怎么办」双段式（——分隔）。
 * ZOO-166 方案 A（自由变量）：任意单字母可作自变量——显式路径恰一个自由字母
 * 即绑定（y=4z ⟂ y=4x 同一条直线），隐式路径未知字母按出现顺序补进 x/y 空缺位；
 * 仅数学上欠定的输入（两个及以上自由字母）与多字母词仍拦截。
 * ZOO-176 i18n：文案经注入的翻译器 t 产出（LibT，默认 zhT 与历史行为逐字节
 * 一致），组件按当前语言传入，错误文案无硬编码语言。
 * ZOO-188（T1 常量绑定）：parseEquation 第三参 constants——显式路径符号三分法
 * （常量∪自变量∪报错），scope 多常量注入；缺省行为与现状逐字节一致。
 * 未赋值希腊名（theta/omega/phi，源自 ω/θ/φ 归一）属常量命名空间：不作拼写
 * 错误、不抢自变量位，未赋值即报「常量区赋值」引导（见 splitFreeSymbols）。
 * ZOO-191（T4 参数式与极坐标）：dispatch 前置两个分支（几何标准形 / 显式 /
 * 隐式之前）——顶层逗号双等式 x=f(t),y=g(t) → parametric（x/y 是 LHS 标记，
 * 不算自由变量；两侧自由字母并集恰一个字母即参数）；r= 前缀 → polar
 * （θ 经 T1 归一映射 theta；polar 语境 theta 是参数而非常量命名空间——
 * 未赋值即默认参数，omega/phi 仍引导去常量区）。
 */
import { parse } from 'mathjs/number';
import type { MathNode } from 'mathjs/number';
import { GREEK_CONSTANT_NAMES, normalizeEquation } from './normalize';
import { buildImplicitExpression, classifyImplicit, splitTopLevelEquals, type BinaryFn } from './conic';
import { compileCached } from './cache';
import { zhT, type LibT } from '../../i18n/lib';
import type { CircleParams, EllipseParams, ParseResult } from './types';

const err = (message: string): ParseResult => ({ kind: 'error', message });

/** 圆 (x-a)²+(y-b)²=r² / 椭圆 x²/A+(y-b)²/B=1 标准形识别（原型 detectGeometry 平移）。 */
function detectGeometry(src: string, t: LibT): ParseResult | null {
  let m = src.match(/^\(?x([+-][\d.]+)?\)?\^2\+\(?y([+-][\d.]+)?\)?\^2=([\d.]+)$/);
  if (m) {
    const r = Math.sqrt(parseFloat(m[3]));
    // r=0（如 x²+y²=0）是退化单点：交回隐式分类器出 kind='point'（ZOO-148）
    if (r === 0) return null;
    if (!(r > 0)) return err(t('mathErr.circleRadius'));
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
    if (!(rx > 0 && ry > 0)) return err(t('mathErr.ellipseParams'));
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

/**
 * AST 函数白名单（原型 §6 函数族）。
 * ZOO-189（T2）：补 sec/csc/cot——tan 求导输出 sec(x)^2（calculus.ts 求导链
 * 产物需可回灌本解析管线），mathjs/number 原生可求值，此前仅被本白名单拦截。
 */
const ALLOWED_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sqrt', 'abs', 'log', 'exp', 'asin', 'acos', 'atan', 'sec', 'csc', 'cot']);
/** 各函数允许的参数个数（log 支持带底 two-arg）。 */
const FUNCTION_ARITY: Record<string, [number, number]> = {
  log: [1, 2],
};
for (const name of ALLOWED_FUNCTIONS) {
  if (!FUNCTION_ARITY[name]) FUNCTION_ARITY[name] = [1, 1];
}

/**
 * AST 节点白名单巡检（安全防线之二，PRD §8 禁公式注入）：
 * 只放行 Constant / Symbol / 白名单 Function / Operator / Parenthesis；
 * Assignment / Accessor / Conditional / Block 等一律拒绝。
 * ZOO-166 方案 A：SymbolNode 不再就地报错——出现的符号名全部收进 syms，
 * 由调用方按自由变量绑定规则裁决（单字母 → 自变量；多字母 → 报错）。
 * 返回 null 表示结构通过，否则为用户可读错误文案。
 */
function auditNode(node: MathNode, syms: Set<string>, t: LibT): string | null {
  switch (node.type) {
    case 'ConstantNode':
      return null;
    case 'ParenthesisNode': {
      const content = (node as unknown as { content?: MathNode }).content;
      return content ? auditNode(content, syms, t) : t('mathErr.generic');
    }
    case 'OperatorNode': {
      const args = (node as unknown as { args?: MathNode[] }).args ?? [];
      if (args.length === 0) return t('mathErr.generic');
      for (const arg of args) {
        const problem = auditNode(arg, syms, t);
        if (problem) return problem;
      }
      return null;
    }
    case 'SymbolNode': {
      const name = (node as unknown as { name?: string }).name ?? '';
      if (name) syms.add(name);
      return null;
    }
    case 'FunctionNode': {
      const fn = (node as unknown as { fn?: { name?: string } }).fn;
      const name = fn?.name ?? '';
      if (!ALLOWED_FUNCTIONS.has(name)) {
        return t('mathErr.unknownFn', { name });
      }
      const [min, max] = FUNCTION_ARITY[name];
      const args = (node as unknown as { args?: MathNode[] }).args ?? [];
      if (args.length < min || args.length > max) {
        return t('mathErr.arity');
      }
      for (const arg of args) {
        const problem = auditNode(arg, syms, t);
        if (problem) return problem;
      }
      return null;
    }
    default:
      // AssignmentNode / AccessorNode / ConditionalNode / BlockNode / RangeNode …
      return t('mathErr.generic');
  }
}

/**
 * 自由变量裁决（ZOO-166 方案 A）：syms 剔除常数 pi/e 后的自由字母表。
 * 多字母词 → 报错（拼写/未知名）；超出路径容量（显式 1 个 / 隐式 2 个）→ 报错；
 * 其余即合法变量集，按出现顺序绑定（显式：该字母即自变量；隐式：补进 x/y 空缺位）。
 * 隐式路径沿用本裁决（不参与常量，希腊名按多字母词报错）。
 */
function freeSymbolsImplicit(syms: Set<string>): { free: string[]; bad: string | undefined } {
  const free = [...syms].filter((s) => s !== 'pi' && s !== 'e');
  return { free, bad: free.find((s) => s.length > 1) };
}

/**
 * ZOO-188（T1 常量绑定，符号三分法）：显式路径自由符号集划分为
 * {已赋值常量（剔除）} ∪ {希腊名（常量命名空间——未赋值即引导赋值，不作拼写
 * 错误、不作自变量候选）} ∪ {其余未赋值字母（candidates）}：
 * - bad：未赋值的非希腊多字母词 → 拼写错误（现状语义）；
 * - hasUnassignedGreek：存在未赋值希腊名 → 一律报「常量区赋值」引导
 *   （即使只剩它一个符号也不抢自变量位——y=ω 不是恒等线，是缺常量赋值）；
 * - dictActive：常量字典非空 → 多符号欠定文案同样用常量引导。
 * constants 缺省 / 空字典且无希腊名时 candidates/bad 与现状逐字节一致。
 */
function splitFreeSymbols(
  syms: Set<string>,
  constants?: Record<string, number>,
): { candidates: string[]; unassigned: string[]; bad: string | undefined; hasUnassignedGreek: boolean; dictActive: boolean } {
  const free = [...syms].filter((s) => s !== 'pi' && s !== 'e');
  const assigned = new Set(constants ? Object.keys(constants) : []);
  const unassigned = free.filter((s) => !assigned.has(s));
  return {
    candidates: unassigned.filter((s) => !GREEK_CONSTANT_NAMES.has(s)),
    unassigned,
    bad: unassigned.find((s) => s.length > 1 && !GREEK_CONSTANT_NAMES.has(s)),
    hasUnassignedGreek: unassigned.some((s) => GREEK_CONSTANT_NAMES.has(s)),
    dictActive: assigned.size > 0,
  };
}

/** mathjs SyntaxError → 原型五类文案映射（ZOO-166：附「怎么办」指引；ZOO-176 随语言）。 */
function mapSyntaxError(message: string, t: LibT): string {
  if (/parenthesis/i.test(message)) return t('mathErr.parenUnclosed');
  if (/unexpected end/i.test(message)) return t('mathErr.incomplete');
  if (/unexpected part/i.test(message)) return t('mathErr.badNumber');
  return t('mathErr.generic');
}

/**
 * 顶层逗号切分（ZOO-191 T4，括号内逗号不算——log(t,2) 的第二参不拆）：
 * `x=cos(t),y=sin(t)` → ['x=cos(t)', 'y=sin(t)']；无顶层逗号返回 null。
 */
function splitTopLevelCommas(s: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.length > 1 ? parts : null;
}

/**
 * 参数式 / 极坐标单侧表达式编译（ZOO-191 T4）：与显式路径同款安全管线
 * （字符白名单 → mathjs parse → AST 白名单巡检）产出符号集，供调用方做
 * 参数 / 常量裁决；错误以 ParseResult 透传（文案与显式路径同源）。
 */
function compileParamBody(
  body: string,
  t: LibT,
): { node: MathNode; syms: Set<string> } | { error: ParseResult } {
  const badCharMatch = body.match(/[^a-z0-9+\-*/^().,]/);
  if (badCharMatch) {
    return { error: err(t('mathErr.badChar', { ch: badCharMatch[0], suffix: t('mathErr.badCharSuffix') })) };
  }
  let node: MathNode;
  try {
    node = parse(body);
  } catch (e) {
    return { error: err(mapSyntaxError(e instanceof Error ? e.message : String(e), t)) };
  }
  const syms = new Set<string>();
  const problem = auditNode(node, syms, t);
  if (problem) return { error: err(problem) };
  return { node, syms };
}

/**
 * 参数方程解析（ZOO-191 T4）：顶层逗号双等式 x=f(t),y=g(t)（两侧 x=/y= 顺序
 * 不限）。x/y 是 LHS 标记不算自由变量；两侧自由符号（剔除已赋值常量、希腊名
 * 走常量引导）并集恰一个字母即参数 t（x=2,y=t 的竖线段——单侧无字母也合法）。
 * 形不符（无顶层逗号 / 段数 ≠2 / LHS 非 x=、y=）返回 null 交回既有路径
 * （零回归：普通单方程行为逐字节不变）。
 */
function parseParametric(src: string, t: LibT, constants?: Record<string, number>): ParseResult | null {
  const parts = splitTopLevelCommas(src);
  if (!parts || parts.length !== 2) return null;
  const xPart = parts.find((p) => p.startsWith('x='));
  const yPart = parts.find((p) => p.startsWith('y='));
  if (!xPart || !yPart) return null;
  const xBody = xPart.slice(2);
  const yBody = yPart.slice(2);
  if (!xBody || !yBody) return err(t('mathErr.missingRhs'));

  const dictActive = constants !== undefined && Object.keys(constants).length > 0;
  const sides: Array<{ body: string; node: MathNode; syms: Set<string> }> = [];
  for (const body of [xBody, yBody]) {
    const compiled = compileParamBody(body, t);
    if ('error' in compiled) return compiled.error;
    sides.push({ body, node: compiled.node, syms: compiled.syms });
  }

  // 逐侧裁决（口径同显式路径）：已赋值常量剔除；未赋值希腊名引导常量区；
  // 未赋值非希腊多字母词是拼写 / 未知名
  const candidates = new Set<string>();
  for (const side of sides) {
    const split = splitFreeSymbols(side.syms, constants);
    if (split.bad) return err(t('mathErr.badSymbolExplicit', { name: split.bad }));
    if (split.hasUnassignedGreek) {
      return err(t('mathErr.multiVarWithConstants', { list: split.unassigned.join(t('common.listSep')) }));
    }
    for (const c of split.candidates) candidates.add(c);
  }

  const union = [...candidates];
  if (union.length === 0) {
    return err(t('mathErr.parametricNoParameter'));
  }
  if (union.length > 1) {
    const messageKey = dictActive ? 'mathErr.multiVarWithConstants' : 'mathErr.multiVarExplicit';
    return err(t(messageKey, { list: union.join(t('common.listSep')) }));
  }
  const param = union[0];

  try {
    const fns = sides.map((side) => {
      const compiled = compileCached(side.body, side.node);
      const fn = (v: number): number => {
        try {
          const scope: Record<string, number> = dictActive ? { ...constants } : {};
          scope[param] = v; // 参数后注入，同名时参数优先（与显式路径自变量同口径）
          const val = compiled.evaluate(scope);
          return typeof val === 'number' ? val : NaN;
        } catch {
          return NaN;
        }
      };
      return fn;
    });
    return { kind: 'parametric', fx: fns[0], fy: fns[1], variable: param === 't' ? undefined : param };
  } catch {
    return err(t('mathErr.generic'));
  }
}

/**
 * 极坐标方程解析（ZOO-191 T4）：r= 前缀（不与既有 y= / f(x)= 前缀冲突）。
 * 参数裁决：polar 语境 theta 是参数而非常量命名空间——未赋值 theta 即默认
 * 参数（r=1+cos(θ) 直接出图）；其余字母剔除已赋值常量后，omega/phi 等希腊名
 * 仍引导常量区，单字母可作参数（方案 A 任意字母哲学），无常量无字母时默认
 * theta（r=2 → 圆）。非 r= 前缀返回 null 交回既有路径（零回归）。
 */
function parsePolar(src: string, t: LibT, constants?: Record<string, number>): ParseResult | null {
  if (!src.startsWith('r=')) return null;
  const body = src.slice(2);
  if (!body) return err(t('mathErr.missingRhs'));

  const compiledBody = compileParamBody(body, t);
  if ('error' in compiledBody) return compiledBody.error;

  const dictActive = constants !== undefined && Object.keys(constants).length > 0;
  const free = [...compiledBody.syms].filter((s) => s !== 'pi' && s !== 'e');
  const assigned = new Set(constants ? Object.keys(constants) : []);
  const unassigned = free.filter((s) => !assigned.has(s));
  const bad = unassigned.find((s) => s.length > 1 && !GREEK_CONSTANT_NAMES.has(s));
  if (bad) return err(t('mathErr.badSymbolExplicit', { name: bad }));

  // 参数裁决：theta 优先；其余未赋值字母（含希腊名）一律引导常量区赋值
  if (unassigned.includes('theta')) {
    const rest = unassigned.filter((s) => s !== 'theta');
    if (rest.length > 0) {
      return err(t('mathErr.multiVarWithConstants', { list: rest.join(t('common.listSep')) }));
    }
  } else {
    const letters = unassigned.filter((s) => !GREEK_CONSTANT_NAMES.has(s));
    if (letters.length > 1) {
      const messageKey = dictActive ? 'mathErr.multiVarWithConstants' : 'mathErr.multiVarExplicit';
      return err(t(messageKey, { list: letters.join(t('common.listSep')) }));
    }
    if (unassigned.some((s) => GREEK_CONSTANT_NAMES.has(s))) {
      return err(t('mathErr.multiVarWithConstants', { list: unassigned.join(t('common.listSep')) }));
    }
  }
  const variable = unassigned.includes('theta')
    ? 'theta'
    : unassigned.length === 1 && !GREEK_CONSTANT_NAMES.has(unassigned[0])
      ? unassigned[0]
      : 'theta';

  try {
    const compiled = compileCached(body, compiledBody.node);
    const fn = (theta: number): number => {
      try {
        const scope: Record<string, number> = dictActive ? { ...constants } : {};
        scope[variable] = theta; // 参数后注入，同名时参数优先
        const val = compiled.evaluate(scope);
        return typeof val === 'number' ? val : NaN;
      } catch {
        return NaN;
      }
    };
    return { kind: 'polar', fn, variable: variable === 'theta' ? undefined : variable };
  } catch {
    return err(t('mathErr.generic'));
  }
}

/**
 * 隐式二元方程分类（D7，ZOO-146/147/148/149）：顶层 split `=` → F=lhs−rhs →
 * 复用本文件安全管线（字符白名单 / AST 白名单含 y / compile LRU）→ conic.ts
 * 数值探针。二元一次 → kind='line'（含竖线）；二次判别式 → 'parabola' /
 * 'hyperbola' / 'ellipse'（B=0 轴对齐含平移；椭圆型一般式 ZOO-149 直接出图）；
 * 含 xy 交叉项 → 坐标旋转消交叉项后同族出图（含 rotation 参数，ZOO-149）；
 * 退化形 → 'linePair'（两直线）/ 'point'（单点）出图、空集友好报错；
 * 非多项式 → 引导文案。
 */
function parseImplicit(src: string, t: LibT): ParseResult {
  const split = splitTopLevelEquals(src);
  if (!split) {
    return src.includes('=')
      ? err(t('mathErr.oneEquals'))
      : err(t('mathErr.missingEquals'));
  }
  const expr = buildImplicitExpression(split.lhs, split.rhs);

  // 字符白名单（与显式路径同款， '#' 等必须在 parse 前拦截）
  const badCharMatch = expr.match(/[^a-z0-9+\-*/^().,]/);
  if (badCharMatch) {
    return err(t('mathErr.badChar', { ch: badCharMatch[0], suffix: t('mathErr.badCharSuffix') }));
  }

  let node: MathNode;
  try {
    node = parse(expr);
  } catch (e) {
    return err(mapSyntaxError(e instanceof Error ? e.message : String(e), t));
  }

  const syms = new Set<string>();
  const problem = auditNode(node, syms, t);
  if (problem) return err(problem);

  // ZOO-166 方案 A：自由变量裁决——二元方程最多两个字母，未知字母补进 x/y 空缺位
  const { free, bad } = freeSymbolsImplicit(syms);
  if (bad) return err(t('mathErr.badSymbolImplicit', { name: bad }));
  if (free.length > 2) {
    return err(t('mathErr.tooManyVarsImplicit', { list: free.join(t('common.listSep')) }));
  }
  const xVar = free.includes('x') ? 'x' : free[0];
  const yVar = free.includes('y') ? 'y' : free.find((s) => s !== xVar);

  try {
    const compiled = compileCached(expr, node);
    // F(x,y)：scope 只含实际用到的变量字母（x/y 或补位的未知字母）；
    // 异常与非 number 结果一律 NaN（探针按非线性处理）
    const fn: BinaryFn = (x, y) => {
      try {
        const scope: Record<string, number> = {};
        if (xVar) scope[xVar] = x;
        if (yVar) scope[yVar] = y;
        const v = compiled.evaluate(scope);
        return typeof v === 'number' ? v : NaN;
      } catch {
        return NaN;
      }
    };
    const outcome = classifyImplicit(fn, t);
    if (outcome.kind === 'line') return { kind: 'line', params: outcome.params };
    if (outcome.kind === 'linePair') return { kind: 'linePair', params: outcome.params };
    if (outcome.kind === 'point') return { kind: 'point', params: outcome.params };
    if (outcome.kind === 'parabola') return { kind: 'parabola', params: outcome.params };
    if (outcome.kind === 'hyperbola') return { kind: 'hyperbola', params: outcome.params };
    if (outcome.kind === 'ellipse') return { kind: 'ellipse', params: outcome.params };
    // degenerate / unsupported：conic 已按语言产好文案，透传
    if (outcome.kind === 'degenerate' || outcome.kind === 'unsupported') return err(outcome.message);
    return err(t('mathErr.unsupportedImplicit'));
  } catch {
    return err(t('mathErr.generic'));
  }
}

/**
 * 方程解析入口（编辑器每键调用 / 确认出图共用）。
 *
 * 分类：parametric / polar（ZOO-191 T4 前置分支）→ explicit（含求值函数）/
 * line（二元一次，D7）/ circle / ellipse / error。
 * 安全：AST 白名单 + scope 只注入实际用到的变量字母（ZOO-166 方案 A 起不限于 x/y），无 eval，无属性访问。
 * ZOO-188（T1 常量绑定）：constants 非空时显式路径走符号三分法——常量从自由
 * 符号集剔除，求值 scope 同时注入自变量 + 常量（自变量后注入，同名时自变量优先）；
 * 缺省 / 空字典与现状逐字节一致（既有单测零改动）。
 * ZOO-191（T4）：parametric / polar 分支前置（几何标准形 / 显式 / 隐式之前），
 * 形不符即返回 null 交回既有路径——普通单方程行为不变（零回归）。
 */
export function parseEquation(raw: string, t: LibT = zhT, constants?: Record<string, number>): ParseResult {
  const src = normalizeEquation(raw);
  if (!src) return err(t('mathErr.empty'));

  // 未配对的 | / √ 在归一化中保留原样，统一在此报未闭合
  if (src.includes('|') || src.includes('√')) return err(t('mathErr.parenUnclosed'));

  // ZOO-191 T4 前置分支：顶层逗号双等式 → parametric；r= 前缀 → polar
  const parametric = parseParametric(src, t, constants);
  if (parametric) return parametric;
  const polar = parsePolar(src, t, constants);
  if (polar) return polar;

  const geo = detectGeometry(src, t);
  if (geo) return geo;

  // 剥离 y= / f(x)= 前缀（ZOO-166 方案 A：求值函数前缀放宽为任意单字母，f(z)= 亦认可）
  const body = src.replace(/^y=/, '').replace(/^([a-z])\([a-z]\)=/, '');
  if (!body) return err(t('mathErr.missingRhs'));

  // 剩余 '=' 或裸 y：既非 y=f(x) 前缀、也未命中几何标准形 → 隐式方程分类（D7）
  if (body.includes('=')) return parseImplicit(src, t);
  if (/(^|[^a-z])y([^a-z]|$)/.test(body)) {
    // 等号被剥前缀后右侧仍含自由 y（如 y=x+y ⟺ x=0）→ 按隐式方程整体分类；
    // 无等号的裸 y（如 "2y"，数字邻接按 mathjs 原生隐式乘法保留）不是方程，单独引导
    return src.includes('=') ? parseImplicit(src, t) : err(t('mathErr.missingEquals'));
  }

  // 字符白名单（mathjs 会把 '#' 等解析为 undefined 常量，必须前置拦截）
  const badCharMatch = body.match(/[^a-z0-9+\-*/^().,]/);
  if (badCharMatch) {
    return err(t('mathErr.badChar', { ch: badCharMatch[0], suffix: t('mathErr.badCharSuffix') }));
  }

  let node: MathNode;
  try {
    node = parse(body);
  } catch (e) {
    return err(mapSyntaxError(e instanceof Error ? e.message : String(e), t));
  }

  const syms = new Set<string>();
  const problem = auditNode(node, syms, t);
  if (problem) return err(problem);

  // ZOO-166 方案 A + ZOO-188 三分法：自由符号剔除已赋值常量后，恰一个字母即自变量
  // （y=4z ⟂ y=4x 同一条直线）；未赋值的非希腊多字母词是拼写/未知名；存在未赋值
  // 希腊名或已启用常量字典时，多符号欠定一律引导去常量区赋值（含模板
  // y=A·sin(ωx+φ) 未赋值的初始态——不是拼写错误）
  const { candidates, unassigned, bad, hasUnassignedGreek, dictActive } = splitFreeSymbols(syms, constants);
  if (bad) return err(t('mathErr.badSymbolExplicit', { name: bad }));
  if (hasUnassignedGreek) {
    return err(t('mathErr.multiVarWithConstants', { list: unassigned.join(t('common.listSep')) }));
  }
  if (candidates.length > 1) {
    const messageKey = dictActive ? 'mathErr.multiVarWithConstants' : 'mathErr.multiVarExplicit';
    return err(t(messageKey, { list: candidates.join(t('common.listSep')) }));
  }
  const variable = candidates[0] ?? 'x';

  try {
    const compiled = compileCached(body, node);
    // 求值函数：scope 注入自变量 + 常量（常量先行、自变量后注入，同名时自变量优先）；
    // 无常量时 scope 形状与现状一致。异常与非 number 结果一律 NaN（采样期按断笔处理）
    const fn = (x: number): number => {
      try {
        const scope: Record<string, number> = dictActive ? { ...constants } : {};
        scope[variable] = x;
        const v = compiled.evaluate(scope);
        return typeof v === 'number' ? v : NaN;
      } catch {
        return NaN;
      }
    };
    return variable === 'x' ? { kind: 'explicit', fn } : { kind: 'explicit', fn, variable };
  } catch {
    return err(t('mathErr.generic'));
  }
}

/**
 * 显式路径方程体（ZOO-189 T2）：normalize + 几何标准形排除 + y=/f(x)= 前缀剥离
 * 后的右侧表达式。与 parseEquation 显式分支同款判定（单源，不复制剥离规则）：
 * 几何标准形 / 隐式方程 / 含自由 y / 空 RHS 一律返回 null。
 * calculus.ts 求导链复用——求导输入与解析主流程取同一份 body。
 */
export function explicitBody(raw: string): string | null {
  const src = normalizeEquation(raw);
  if (!src || src.includes('|') || src.includes('√')) return null;
  if (detectGeometry(src, zhT)) return null;
  const body = src.replace(/^y=/, '').replace(/^([a-z])\([a-z]\)=/, '');
  if (!body || body.includes('=')) return null;
  if (/(^|[^a-z])y([^a-z]|$)/.test(body)) return null;
  return body;
}
