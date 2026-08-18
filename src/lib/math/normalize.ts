/**
 * Unicode / 书写习惯归一化 —— 方程解析前置层（技术方案 §7.1）。
 *
 * 只做「数学符号翻译，不改语义」：π→pi、上标→^n、√→sqrt、·×→*、÷→/、
 * 全角括号/逗号→半角、|…|→abs(…)、ln→log、字母连写的隐式乘法补 `*`。
 * 归一化产物是 mathjs 可直接 parse 的 ASCII 语法（mathjs 原生支持 2x、2sin(x)
 * 等值元邻接隐式乘法，但会把粘连字母吞成一个符号，如 2pix → pix，故需拆分）。
 */

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '^0',
  '¹': '^1',
  '²': '^2',
  '³': '^3',
  '⁴': '^4',
  '⁵': '^5',
  '⁶': '^6',
  '⁷': '^7',
  '⁸': '^8',
  '⁹': '^9',
  'ˣ': '^x',
};

/** 白名单标识符（贪心切分，长名在前；asin 在 sin 前、exp 在 e 前）。ln 在切分时译为 log。
 *  y 供二元方程隐式分类（ZOO-146 / D7）：无已知标识符以 y 开头，切分无冲突。 */
const KNOWN_IDS = ['asin', 'acos', 'atan', 'sqrt', 'abs', 'sin', 'cos', 'tan', 'exp', 'log', 'ln', 'pi', 'e', 'x', 'y'];

/** √(…) → sqrt(…)：括号配平扫描（支持嵌套括号，如 √(sin(x)+1)）。 */
function convertSqrtParen(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '√') {
      out += s[i];
      continue;
    }
    if (s[i + 1] !== '(') {
      out += '√';
      continue;
    }
    let depth = 0;
    let j = i + 1;
    for (; j < s.length; j++) {
      if (s[j] === '(') depth++;
      else if (s[j] === ')' && --depth === 0) break;
    }
    if (depth !== 0) {
      out += '√'; // 括号不闭合，留给 parse 阶段报「括号或绝对值符号未闭合」
      continue;
    }
    out += `sqrt(${convertSqrtParen(s.slice(i + 2, j))})`;
    i = j;
  }
  return out;
}

/** |…| → abs(…)：栈式配对（与 4a 状态机同解释：同深度下首个 | 开、次个 | 闭）。 */
function convertAbsBars(s: string): string {
  const stack: number[] = [];
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') stack.push(-1);
    else if (c === ')') {
      while (stack.length && stack[stack.length - 1] !== -1) stack.pop();
      if (stack.length) stack.pop();
    } else if (c === '|') {
      if (stack.length && stack[stack.length - 1] !== -1) {
        ranges.push([stack.pop()!, i]);
      } else {
        stack.push(i);
      }
    }
  }
  let out = s;
  for (let k = ranges.length - 1; k >= 0; k--) {
    const [open, close] = ranges[k];
    out = out.slice(0, open) + 'abs(' + out.slice(open + 1, close) + ')' + out.slice(close + 1);
  }
  return out;
}

/** 单个字母连写段拆分为已知标识符并以 `*` 连接；含未知片段则整段保留（由白名单报完整符号名）。 */
function splitLetterRun(run: string): string {
  const ids: string[] = [];
  let k = 0;
  while (k < run.length) {
    const rest = run.slice(k);
    const id = KNOWN_IDS.find((t) => rest.startsWith(t));
    if (!id) return run; // 未知片段：不拆，mathjs/白名单以完整符号名报错
    ids.push(id);
    k += id.length;
  }
  return ids.map((id) => (id === 'ln' ? 'log' : id)).join('*');
}

/** 字母连写隐式乘法补 `*`：2pix → 2pi*x、xsin(x) → x*sin(x)、pix → pi*x。 */
function splitIdentifierRuns(s: string): string {
  return s.replace(/[a-z]+/g, splitLetterRun);
}

/**
 * 方程归一化入口（parse 前置）。去空白、小写、符号翻译、隐式乘法补 `*`。
 * 未配对的 | 与 √ 保留原样，由 parseEquation 统一报错。
 */
export function normalizeEquation(raw: string): string {
  let s = String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/π/g, 'pi')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ˣ]/g, (ch) => SUPERSCRIPTS[ch])
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .replace(/[·×]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-');
  s = convertSqrtParen(s);
  s = s.replace(/√([0-9.]+|x|pi|e)/g, 'sqrt($1)').replace(/√/g, 'sqrt');
  s = convertAbsBars(s);
  return splitIdentifierRuns(s);
}
