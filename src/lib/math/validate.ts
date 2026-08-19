/**
 * 方程实时校验入口（编辑器每键调用）。
 *
 * ZOO-133（4a）交付时本文件是结构层临时校验（字符白名单状态机 + 正则几何
 * 识别，不求值）；ZOO-134（4b）按交接约定整体替换为 mathjs 安全解析
 * （normalize.ts + parse.ts）的薄适配 —— 分类规则与错误文案不变，组件只
 * 消费 kind / message / params，切换零改动。求值函数（fn）不进入编辑器载荷
 * （EquationDraftPayload 携带 StructuralOutcome），由渲染侧按需重新编译（LRU 缓存命中）。
 */
import { parseEquation } from './parse';
import type { StructuralOutcome } from './types';

export function validateEquation(raw: string): StructuralOutcome {
  const result = parseEquation(raw);
  // ZOO-166 方案 A：透传自变量字母（缺省 x 不携带，旧消费方零感知）
  return result.kind === 'explicit'
    ? result.variable
      ? { kind: 'explicit', variable: result.variable }
      : { kind: 'explicit' }
    : result;
}
