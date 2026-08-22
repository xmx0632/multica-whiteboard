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
import { zhT, type LibT } from '../../i18n/lib';
import type { StructuralOutcome } from './types';

/** ZOO-176：t 透传给 parseEquation（错误文案随语言；缺省中文与历史行为一致）。
 *  ZOO-188（T1）：constants 透传——符号常量参与三分法裁决与求值 scope 注入；
 *  缺省 / 空字典与历史行为逐字节一致。 */
export function validateEquation(raw: string, t: LibT = zhT, constants?: Record<string, number>): StructuralOutcome {
  const result = parseEquation(raw, t, constants);
  // ZOO-166 方案 A：透传自变量字母（缺省 x 不携带，旧消费方零感知）
  return result.kind === 'explicit'
    ? result.variable
      ? { kind: 'explicit', variable: result.variable }
      : { kind: 'explicit' }
    : result;
}
