import { describe, it, expect } from 'vitest';
import {
  isPhoneLandscape,
  phoneLandscapeMediaQuery,
  nextPanelFold,
  PHONE_LANDSCAPE_MAX_HEIGHT,
  type PanelFold,
  type PanelState,
} from '../landscape';

describe('isPhoneLandscape（ZOO-152 手机横屏判定）', () => {
  it('手机横屏（844×390 / 568×320 / 932×430）判定为 true', () => {
    expect(isPhoneLandscape({ width: 844, height: 390, coarsePointer: true })).toBe(true);
    expect(isPhoneLandscape({ width: 568, height: 320, coarsePointer: true })).toBe(true);
    expect(isPhoneLandscape({ width: 932, height: 430, coarsePointer: true })).toBe(true);
  });

  it('手机竖屏判定为 false', () => {
    expect(isPhoneLandscape({ width: 390, height: 844, coarsePointer: true })).toBe(false);
  });

  it('平板横屏（高度超上限）判定为 false', () => {
    expect(isPhoneLandscape({ width: 1024, height: 768, coarsePointer: true })).toBe(false);
    expect(isPhoneLandscape({ width: 1194, height: 834, coarsePointer: true })).toBe(false);
  });

  it('桌面（细指针）即使尺寸满足也判定为 false', () => {
    expect(isPhoneLandscape({ width: 844, height: 390, coarsePointer: false })).toBe(false);
    expect(isPhoneLandscape({ width: 1280, height: 800, coarsePointer: false })).toBe(false);
  });

  it('高度边界：等于上限为 true，超过 1px 为 false', () => {
    expect(isPhoneLandscape({ width: 900, height: PHONE_LANDSCAPE_MAX_HEIGHT, coarsePointer: true })).toBe(true);
    expect(isPhoneLandscape({ width: 900, height: PHONE_LANDSCAPE_MAX_HEIGHT + 1, coarsePointer: true })).toBe(false);
  });

  it('正方形视口（宽 === 高）不算横屏', () => {
    expect(isPhoneLandscape({ width: 500, height: 500, coarsePointer: true })).toBe(false);
  });
});

describe('phoneLandscapeMediaQuery（与 CSS / 判定函数同阈值）', () => {
  it('包含粗指针、横向与高度上限三个条件', () => {
    const q = phoneLandscapeMediaQuery();
    expect(q).toContain('(pointer: coarse)');
    expect(q).toContain('(orientation: landscape)');
    expect(q).toContain(`(max-height: ${PHONE_LANDSCAPE_MAX_HEIGHT}px)`);
  });
});

describe('nextPanelFold（属性面板折叠状态机）', () => {
  it('toggle 双向翻转', () => {
    expect(nextPanelFold('folded', { type: 'toggle' })).toBe('unfolded');
    expect(nextPanelFold('unfolded', { type: 'toggle' })).toBe('folded');
  });

  it('画布触点：颜色面板（tool）收起', () => {
    expect(nextPanelFold('unfolded', { type: 'canvas-interact', panel: 'tool' })).toBe('folded');
    expect(nextPanelFold('folded', { type: 'canvas-interact', panel: 'tool' })).toBe('folded');
  });

  it('画布触点：方程 / 参数面板保持（调参中不打断）', () => {
    expect(nextPanelFold('unfolded', { type: 'canvas-interact', panel: 'equation' })).toBe('unfolded');
    expect(nextPanelFold('unfolded', { type: 'canvas-interact', panel: 'mathplot' })).toBe('unfolded');
    // 已收起的不会被画布触点展开
    expect(nextPanelFold('folded', { type: 'canvas-interact', panel: 'mathplot' })).toBe('folded');
  });

  it('进入方程 / 参数面板自动展开（ƒ 工具点开必须见到编辑器）', () => {
    expect(nextPanelFold('folded', { type: 'panel-state', panel: 'equation' })).toBe('unfolded');
    expect(nextPanelFold('folded', { type: 'panel-state', panel: 'mathplot' })).toBe('unfolded');
  });

  it('回到默认工具面板保持当前折叠态', () => {
    expect(nextPanelFold('folded', { type: 'panel-state', panel: 'tool' })).toBe('folded');
    expect(nextPanelFold('unfolded', { type: 'panel-state', panel: 'tool' })).toBe('unfolded');
  });

  it('进入手机紧凑布局（横屏 / 竖屏）默认收起，离开恢复常驻展开', () => {
    expect(nextPanelFold('unfolded', { type: 'phone-compact', active: true })).toBe('folded');
    expect(nextPanelFold('folded', { type: 'phone-compact', active: false })).toBe('unfolded');
  });

  it('重入紧凑布局按「进入」语义收起；组件接线仅 compact 变化时派发（横竖互转不打扰当前态）', () => {
    let s: PanelFold = 'unfolded';
    s = nextPanelFold(s, { type: 'phone-compact', active: true }); // 进横屏：收起
    s = nextPanelFold(s, { type: 'toggle' }); // chip 展开
    // 若再次派发进入事件（接线层横竖互转不会派发：compactLayout 真值不变）：按进入语义收起
    s = nextPanelFold(s, { type: 'phone-compact', active: true });
    expect(s).toBe('folded');
    s = nextPanelFold(s, { type: 'phone-compact', active: false }); // 离开紧凑布局（回桌面）
    expect(s).toBe('unfolded');
  });

  it('典型序列：进横屏（收起）→ 展开 → 画布绘制（收起）→ chip 再展开', () => {
    const states: PanelFold[] = [];
    let s: PanelFold = 'unfolded';
    const steps: Parameters<typeof nextPanelFold>[1][] = [
      { type: 'phone-compact', active: true },
      { type: 'toggle' },
      { type: 'canvas-interact', panel: 'tool' },
      { type: 'toggle' },
    ];
    for (const ev of steps) {
      s = nextPanelFold(s, ev);
      states.push(s);
    }
    expect(states).toEqual(['folded', 'unfolded', 'folded', 'unfolded']);
  });

  it('典型序列：横屏下选中 mathPlot（触点收起 + 态切换展开并发）→ 仍展开', () => {
    let s: PanelFold = 'unfolded';
    s = nextPanelFold(s, { type: 'phone-compact', active: true });
    // 选中元素的 pointerdown 先收起，随后面板态切入 mathplot 自动展开
    s = nextPanelFold(s, { type: 'canvas-interact', panel: 'tool' });
    s = nextPanelFold(s, { type: 'panel-state', panel: 'mathplot' });
    expect(s).toBe('unfolded');
  });

  it('方程面板被手动收起后，画布触点不将其展开', () => {
    let s: PanelFold = 'unfolded';
    s = nextPanelFold(s, { type: 'panel-state', panel: 'equation' });
    s = nextPanelFold(s, { type: 'toggle' });
    s = nextPanelFold(s, { type: 'canvas-interact', panel: 'equation' });
    expect(s).toBe('folded');
  });

  it('PanelState 三态字面量齐全（tool / equation / mathplot）', () => {
    const all: PanelState[] = ['tool', 'equation', 'mathplot'];
    expect(all).toHaveLength(3);
  });
});
