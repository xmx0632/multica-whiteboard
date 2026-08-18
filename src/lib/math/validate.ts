/**
 * 方程结构校验 —— ZOO-133（4a 输入）的临时校验源。
 *
 * 职责边界（技术方案 §10 PR4 / 串行链 4a→4b）：
 * - 只做「结构层」实时校验：Unicode 归一化、字符白名单、括号/绝对值配对、
 *   表达式完整性、圆/椭圆标准形识别。不做求值，禁用 eval / new Function，零依赖。
 * - 分类规则与错误文案逐条对齐交互原型（docs/prototype/whiteboard-prototype.html）：
 *   无法识别的符号 / 无法识别的字符 / 括号或绝对值符号未闭合 / 表达式不完整 /
 *   暂不支持该隐式方程（圆/椭圆除外）等。
 * - ZOO-134（4b）落地 mathjs 安全解析（normalize.ts + parse.ts）后，由 parse()
 *   取代本模块作为编辑器校验源；组件只消费 kind / message / params，切换零改动。
 */
import type { EllipseParams, CircleParams, StructuralOutcome } from './types';

const err = (message: string): StructuralOutcome => ({ kind: 'error', message });

/** 贪心切分标识符，长名在前（asin 在 abs 前）。 */
const IDS = ['asin', 'acos', 'atan', 'sqrt', 'abs', 'sin', 'cos', 'tan', 'exp', 'log', 'ln', 'pi', 'e', 'x'];

const SUPERScript: Record<string, string> = { '²': '^2', '³': '^3', '⁴': '^4', '⁰': '^0', '¹': '^1', 'ˣ': '^x' };

/**
 * Unicode / 书写习惯归一化（仅用于结构检查，4b 的 normalize.ts 是正式实现）：
 * 去空白、小写、π→pi、√(...)→sqrt(...)、上标→^n、·×→*、÷→/、全角括号/逗号→半角。
 */
export function normalizeEquation(raw: string): string {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/π/g, 'pi')
    .replace(/√\(([^()]*)\)/g, 'sqrt($1)')
    .replace(/√([0-9.]+|x|pi)/g, 'sqrt($1)')
    .replace(/√/g, 'sqrt')
    .replace(/[·×]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .replace(/[²³⁴⁰¹ˣ]/g, (ch) => SUPERScript[ch]);
}

/** 圆 (x-a)²+(y-b)²=r² / 椭圆 x²/A+y²/B=1 标准形识别（原型 detectGeometry 平移）。 */
function detectGeometry(src: string): StructuralOutcome | null {
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

/**
 * 表达式完整性状态机（token 级，无优先级、不求值）：
 * 值元（数字/x/pi/e/函数/左括号/绝对值开）之间允许隐式乘法（2x、2sin(x)、(x)(y)）；
 * 右括号/绝对值闭必须跟在值后；二元运算符（乘除幂逗号）必须夹在值之间；加减号可作一元。
 */
function checkExpression(s: string): StructuralOutcome {
  let i = 0;
  let prev: 'start' | 'value' | 'op' | 'open' = 'start';
  let paren = 0;
  let bar = 0;
  const n = s.length;
  const expectValue = () => prev !== 'value';

  while (i < n) {
    const c = s[i];

    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < n && /[0-9.]/.test(s[j])) j++;
      const num = s.slice(i, j);
      if (!/^\d+\.?\d*$|^\.\d+$/.test(num)) return err('数字格式有误');
      i = j;
      prev = 'value';
      continue;
    }

    if (/[a-z]/.test(c)) {
      const rest = s.slice(i);
      const id = IDS.find((k) => rest.startsWith(k));
      if (!id) {
        let j = i;
        while (j < n && /[a-z]/.test(s[j])) j++;
        return err(`无法识别的符号 “${s.slice(i, j)}”`);
      }
      i += id.length;
      if (id === 'x' || id === 'pi' || id === 'e') {
        prev = 'value';
        continue;
      }
      // 函数名后必须跟左括号
      if (s[i] !== '(') return err('方程表达式不完整');
      prev = 'value'; // 函数名本身视作值元；紧随的 '(' 走下方左括号分支
      continue;
    }

    if (c === '(') {
      paren++;
      prev = 'open';
      i++;
      continue;
    }
    if (c === ')') {
      if (expectValue()) return err('方程表达式不完整');
      if (--paren < 0) return err('括号或绝对值符号未闭合');
      prev = 'value';
      i++;
      continue;
    }
    if (c === '|') {
      if (expectValue()) {
        bar++;
        prev = 'open';
      } else {
        if (--bar < 0) return err('括号或绝对值符号未闭合');
        prev = 'value';
      }
      i++;
      continue;
    }
    if (c === ',' || c === '*' || c === '/' || c === '^') {
      if (expectValue()) return err('方程表达式不完整');
      prev = 'op';
      i++;
      continue;
    }
    if (c === '+' || c === '-') {
      prev = 'op';
      i++;
      continue;
    }
    return err(`无法识别的字符 “${c}”`);
  }

  if (paren !== 0 || bar !== 0) return err('括号或绝对值符号未闭合');
  if (expectValue()) return err('表达式不完整');
  return { kind: 'explicit' };
}

/**
 * 方程实时校验入口（编辑器每键调用）。
 * 空输入返回「请输入方程」；编辑器据 draft 是否为空自行展示等待态。
 */
export function validateEquation(raw: string): StructuralOutcome {
  const src = normalizeEquation(raw);
  if (!src) return err('请输入方程');

  const geo = detectGeometry(src);
  if (geo) return geo;

  // 剥离 y= / f(x)= 前缀
  const body = src.replace(/^y=/, '').replace(/^f\(x\)=/, '');
  if (!body) return err('方程缺少右侧表达式');

  // 剩余的 '='：既不是 y=f(x) 前缀、也未命中几何标准形 → 隐式方程
  if (body.includes('=')) return err('暂不支持该隐式方程：请使用 y=f(x) 形式（圆/椭圆除外）');
  if (/(^|[^a-z0-9])y([^a-z0-9]|$)/.test(body)) return err('暂不支持该隐式方程：请使用 y=f(x) 形式（圆/椭圆除外）');

  return checkExpression(body);
}
