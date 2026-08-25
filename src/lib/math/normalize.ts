/**
 * Unicode / 书写习惯归一化 —— 方程解析前置层（技术方案 §7.1）。
 *
 * 只做「数学符号翻译，不改语义」：π→pi、上标→^n、√→sqrt、·×→*、÷→/、
 * 全角括号/逗号→半角、|…|→abs(…)、ln→log、字母连写的隐式乘法补 `*`。
 * ZOO-188（T1 常量绑定）：希腊字母 θ/ω/φ→theta/omega/phi、下标 ₀-₉→0-9
 * （ZOO-214 增 λ/ρ→lambda/rho），
 * 含符号常量的公式（y=A·sin(ωx+φ)、x(t)=A·cos(ωt+φ)）归一为可 parse 的 ASCII。
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

/**
 * 希腊字母 → ASCII 名（ZOO-188 T1 常量绑定）：θ→theta、ω→omega、φ→phi
 * （φ 含 U+03D5 直立形变体）。存储层统一 ASCII 名，显示层经 constantDisplayName
 * 还原原貌（面板 / chip 标签）。
 * ZOO-214：补 λ→lambda（波长）、ρ→rho（密度）——物理书写高频符号，
 * 与 θ/ω/φ 同口径（常量命名空间，未赋值引导常量区）。
 */
const GREEK_TO_ASCII: Record<string, string> = {
  'θ': 'theta',
  'ω': 'omega',
  'φ': 'phi',
  'ϕ': 'phi',
  'λ': 'lambda',
  'ρ': 'rho',
};

/** 下标数字 → 普通数字（v₀ → v0，并入标识符名，不再是独立字符）。 */
const SUBSCRIPT_DIGITS: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
};

/** 白名单标识符（贪心切分，长名在前；asin 在 sin 前、exp 在 e 前）。ln 在切分时译为 log。
 *  y 供二元方程隐式分类（ZOO-146 / D7）：无已知标识符以 y 开头，切分无冲突。
 *  ZOO-188：补希腊名 theta/omega/phi（ωx → omega*x 需贪心拆出），三者互为
 *  前缀无关、与既有标识符亦无前缀关系，置于表首即可。
 *  ZOO-214：补 lambda/rho（λx → lambda*x），与 theta/omega/phi 及既有标识符
 *  同样无前缀关系，并置表首。 */
const KNOWN_IDS = ['lambda', 'rho', 'theta', 'omega', 'phi', 'asin', 'acos', 'atan', 'sqrt', 'abs', 'sin', 'cos', 'tan', 'exp', 'log', 'ln', 'pi', 'e', 'x', 'y'];

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

/**
 * 单个字母连写段拆分为已知标识符并以 `*` 连接；含未知片段则整段保留
 * （由白名单报完整符号名）。
 * ZOO-188：已消费**多字母**已知名（omega/theta/phi 等）后的单个未知尾字母是
 * 合法隐式乘法因子（ωt → omega*t，x(t)=A·cos(ωt+φ) 的物理书写习惯）；
 * 纯单字母序列（如 xyz）与未知段 ≥2 字母（拼写词，如 foo）仍整段保留——
 * 既有 badSymbol / 欠定报错行为逐字节不变。
 */
function splitLetterRun(run: string): string {
  const ids: string[] = [];
  let k = 0;
  let consumedMulti = false;
  while (k < run.length) {
    const rest = run.slice(k);
    const id = KNOWN_IDS.find((t) => rest.startsWith(t));
    if (id) {
      ids.push(id);
      k += id.length;
      if (id.length > 1) consumedMulti = true;
      continue;
    }
    if (consumedMulti && rest.length === 1) {
      ids.push(rest);
      k += 1;
      continue;
    }
    return run; // 未知片段：不拆，mathjs/白名单以完整符号名报错
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
 * ZOO-188：希腊字母（θ/ω/φ）与下标数字（₀-₉）并入符号名翻译——归一化产物
 * 仍是 mathjs 可直接 parse 的 ASCII 标识符（theta/omega/phi/v0）。
 */
export function normalizeEquation(raw: string): string {
  let s = String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/π/g, 'pi')
    .replace(/[θωφϕλρ]/g, (ch) => GREEK_TO_ASCII[ch])
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ˣ]/g, (ch) => SUPERSCRIPTS[ch])
    .replace(/[₀-₉]/g, (ch) => SUBSCRIPT_DIGITS[ch])
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

/**
 * 常量名归一（ZOO-188）：面板自定义常量输入 → 存储层键（ASCII）。
 * 希腊 / 下标映射与方程归一化同表（θ→theta、v₀→v0），其余非字母数字剔除；
 * 合法性（字母开头等）由调用方校验。
 */
export function normalizeConstantKey(raw: string): string {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/π/g, 'pi')
    .replace(/[θωφϕλρ]/g, (ch) => GREEK_TO_ASCII[ch])
    .replace(/[₀-₉]/g, (ch) => SUBSCRIPT_DIGITS[ch])
    .replace(/[^a-z0-9]/g, '');
}

/** ASCII 名 → 希腊字母原貌（constantDisplayName 用反向表；λ/ρ 见 ZOO-214）。 */
const ASCII_TO_GREEK: Record<string, string> = {
  theta: 'θ',
  omega: 'ω',
  phi: 'φ',
  lambda: 'λ',
  rho: 'ρ',
};

/**
 * 希腊名 ASCII 集（ZOO-188）：这些名字由希腊字母归一产生，属常量命名空间——
 * 未赋值时引导去常量区赋值（不作拼写错误、不作自变量候选）；已赋值即常量。
 */
export const GREEK_CONSTANT_NAMES: ReadonlySet<string> = new Set(Object.keys(ASCII_TO_GREEK));

/** 普通数字 → 下标（v0 → v₀ 的显示还原）。 */
const DIGIT_TO_SUBSCRIPT = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

/**
 * 常量名显示（ZOO-188）：存储层键 → 面板 / chip 原貌（theta→θ、v0→v₀、omega→ω）。
 * 与 normalizeConstantKey 互逆（仅限合法键；非希腊名的字母原样保留）。
 */
export function constantDisplayName(key: string): string {
  return (ASCII_TO_GREEK[key] ?? key).replace(/[0-9]/g, (d) => DIGIT_TO_SUBSCRIPT[Number(d)]);
}

/** 数值前缀（含符号 / 小数 / 科学计数）；余下非空白部分即单位后缀。 */
const NUMBER_PREFIX_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;

/**
 * 常量值输入解析（ZOO-192 T5）：剥离单位后缀后取数值——`9.8 m/s²` →
 * { value: 9.8, unit: 'm/s²' }、`20` → { value: 20, unit: '' }。
 * 单位字符串仅作显示（面板单位行 / 轴标签），**不做量纲运算**：存储与求值
 * 恒为纯数值，unit 由调用方决定去留。无数值前缀（如 'abc'）返回 null。
 */
export function parseConstantValue(raw: string): { value: number; unit: string } | null {
  const s = String(raw).trim();
  const m = s.match(NUMBER_PREFIX_RE);
  if (!m) return null;
  const value = parseFloat(m[0]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: s.slice(m[0].length).trim() };
}
