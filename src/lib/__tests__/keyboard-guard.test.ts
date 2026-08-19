/**
 * 键盘编辑态守卫单测（ZOO-163）：
 *
 * 背景：空格平移快捷键曾在 window 级 keydown 无条件 preventDefault，把聚焦
 * textarea（ZOO-159 内联文字浮层）里的空格字符吞掉——T 工具输入 `a b` 得 `ab`。
 * 守卫判定 isEditableTarget 沉淀于 keyboard.ts（本仓库惯例：Canvas/useShortcuts
 * 只做事件接线），node 环境以元素形状桩测全部分支。
 *
 * 对应 Canvas.tsx 接线语义：
 * - isEditableTarget(e.target) === true → 监听器直接 return，不 preventDefault、
 *   不 setSpaceDown——空格字符照常进入聚焦中的 textarea；
 * - === false（非编辑态）→ preventDefault + setSpaceDown(true)，空格平移照常工作。
 */
import { describe, expect, it } from 'vitest';
import { isEditableTarget } from '../keyboard';

/** 最小元素形状桩（node 环境无 DOM，守卫只读 tagName / isContentEditable） */
const el = (props: Record<string, unknown>) => props as unknown as HTMLElement;

describe('isEditableTarget（ZOO-163 编辑态守卫）', () => {
  it('textarea：编辑态——空格放行输入，不吞键（回归：a b 不再变 ab）', () => {
    expect(isEditableTarget(el({ tagName: 'TEXTAREA' }))).toBe(true);
  });

  it('input：编辑态——方程面板输入框等同样放行', () => {
    expect(isEditableTarget(el({ tagName: 'INPUT' }))).toBe(true);
  });

  it('contenteditable：编辑态', () => {
    expect(isEditableTarget(el({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
  });

  it('画布非编辑态（body / canvas / div）：守卫不拦——空格平移照常工作', () => {
    expect(isEditableTarget(el({ tagName: 'BODY' }))).toBe(false);
    expect(isEditableTarget(el({ tagName: 'CANVAS' }))).toBe(false);
    expect(isEditableTarget(el({ tagName: 'DIV', isContentEditable: false }))).toBe(false);
  });

  it('非元素目标（window / document / null）无 tagName：视为非编辑态', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget({})).toBe(false);
    expect(isEditableTarget(42)).toBe(false);
  });

  it('守卫语义镜像 Canvas 空格监听：编辑态跳过 preventDefault，非编辑态平移生效', () => {
    // Canvas.tsx down 监听器的判定：guardTarget || guardActive 任一命中即跳过
    const panEngages = (target: unknown, activeElement: unknown = null) =>
      !isEditableTarget(target) && !isEditableTarget(activeElement);
    // 浮层 textarea 聚焦（target 即 activeElement）：平移不得启动，空格归输入
    const overlay = el({ tagName: 'TEXTAREA' });
    expect(panEngages(overlay, overlay)).toBe(false);
    // 非编辑态（焦点在 body）：平移照常
    expect(panEngages(el({ tagName: 'BODY' }))).toBe(true);
    // target 非编辑但焦点仍在输入控件（activeElement 兜底）：平移不启动
    expect(panEngages(el({ tagName: 'BODY' }), el({ tagName: 'INPUT' }))).toBe(false);
  });
});
