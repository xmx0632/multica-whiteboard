/**
 * 方程文本 → Unicode 美化标签（技术方案 §6.1 第 5 层：元素左下角方程 chip）。
 *
 * 只做显示层美化、不改语义：pi→π、^2/^3→²/³（后随数字时保留 ^n 防歧义）、
 * sqrt(→√(、显式乘号 *→·。画布 fillText / SVG 导出共用。
 */
export function beautifyEquation(raw: string): string {
  return String(raw)
    .replace(/(?<![a-zA-Z])pi(?![a-zA-Z])/gi, 'π')
    .replace(/\^2(?![0-9.])/g, '²')
    .replace(/\^3(?![0-9.])/g, '³')
    .replace(/sqrt\(/gi, '√(')
    .replace(/\*/g, '·');
}
