/**
 * 菱形元素单测（ZOO-217，绑定系列 PR1）：
 * - diamondVertices：外框四边中点（上→右→下→左）推导，负宽高（拖拽翻转）仍构成菱形；
 * - hitTest 精确轮廓：bbox 四角空白不命中（ZOO-217 初衷），内部无条件可选中
 *   （ZOO-223 用户反馈修正：无填充内部不再是点选死区）、边带与填充区内命中；
 * - elementLocalFrame / translateElement / 角控点：外框语义同 rectangle；
 * - boxResizePatch：角控点对角锚定 + Shift 等比（参数联合含 DiamondElement）；
 * - SVG 导出：<polygon> 四顶点与画布同一份推导，dash / fill 属性同语义；
 * - keymap Alt+I + TOOL_BINDING；线型面板谓词；autosave 指纹含 fillColor；
 * - CURRENT_SCHEMA_VERSION = 3（沿 ZOO-198 先例自文档化）。
 */
import { describe, expect, it } from 'vitest';
import { DiamondElement, Viewport, CURRENT_SCHEMA_VERSION } from '../types';
import { diamondVertices, elementLocalFrame, hitTest, hitTestSelectionHandle, translateElement } from '../renderer';
import { boxResizePatch } from '../shapeResize';
import { exportToSvg } from '../export';
import { canDashFromToolPanel, canRestyleFromToolPanel } from '../stroke';
import { elementSignature } from '../autosave';
import { KEY_BINDINGS, TOOL_BINDING, matchEvent, formatShortcut } from '../keymap';

const VP: Viewport = { offsetX: 0, offsetY: 0, scale: 1 };

const diamond = (fillColor: string | null = null): DiamondElement => ({
  id: 'd1', type: 'diamond', x: 100, y: 100, width: 200, height: 120,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor,
});

describe('diamondVertices（外框四边中点推导）', () => {
  it('上→右→下→左：顶点 = (cx,y) (x+w,cy) (cx,y+h) (x,cy)', () => {
    expect(diamondVertices(diamond())).toEqual([
      { x: 200, y: 100 },
      { x: 300, y: 160 },
      { x: 200, y: 220 },
      { x: 100, y: 160 },
    ]);
  });

  it('负宽高（拖拽向左上翻转）：四顶点仍构成菱形，中心不变', () => {
    const verts = diamondVertices({ ...diamond(), width: -200, height: -120 });
    // 外框翻转后中心 = (0,40)，四顶点围绕它两两对称
    expect(verts).toEqual([
      { x: 0, y: 100 },
      { x: -100, y: 40 },
      { x: 0, y: -20 },
      { x: 100, y: 40 },
    ]);
  });
});

describe('hitTest（精确轮廓，bbox 空白不误选）', () => {
  it('bbox 四角空白：无填充 / 有填充均不命中', () => {
    for (const corner of [{ x: 101, y: 101 }, { x: 299, y: 101 }, { x: 101, y: 219 }, { x: 299, y: 219 }]) {
      expect(hitTest(diamond(), corner, VP), JSON.stringify(corner)).toBe(false);
      expect(hitTest(diamond('#3B82F6'), corner, VP), JSON.stringify(corner)).toBe(false);
    }
  });

  it('无填充：中心 / 内部可选中（ZOO-223 修正，与 rect/circle 一致）；四边上命中', () => {
    const el = diamond();
    expect(hitTest(el, { x: 200, y: 160 }, VP)).toBe(true); // 中心（距四边 ≈51px，内部点选）
    expect(hitTest(el, { x: 250, y: 130 }, VP)).toBe(true); // 上右边中点（贴边）
    expect(hitTest(el, { x: 200, y: 100 }, VP)).toBe(true); // 上顶点
  });

  it('有填充：中心内点命中（叉积同号）', () => {
    expect(hitTest(diamond('#3B82F6'), { x: 200, y: 160 }, VP)).toBe(true);
  });

  it('边带容差（与 line/arrow 同口径）：贴边 8px 内命中、10px 外不命中', () => {
    const el = diamond(); // strokeWidth 2 → margin = max(8, 5) = 8
    expect(hitTest(el, { x: 92, y: 160 }, VP)).toBe(true); // 左顶点正左 8px（边界含）
    expect(hitTest(el, { x: 90, y: 160 }, VP)).toBe(false); // 10px 外
  });

  it('负宽高翻转形态：填充态中心仍命中（顶点推导天然兼容）', () => {
    const flipped = { ...diamond('#3B82F6'), width: -200, height: -120 };
    expect(hitTest(flipped, { x: 0, y: 40 }, VP)).toBe(true);
    expect(hitTest(flipped, { x: 99, y: 99 }, VP)).toBe(false); // 原外框角落
  });
});

describe('外框语义（同 rectangle）', () => {
  it('elementLocalFrame 返回 x/y/width/height 外框', () => {
    expect(elementLocalFrame(diamond())).toEqual({ x: 100, y: 100, width: 200, height: 120 });
  });

  it('translateElement 仅平移 x/y，形状不变（顶点随外框推导同步）', () => {
    const moved = translateElement(diamond(), 10, -5) as DiamondElement;
    expect(moved.x).toBe(110);
    expect(moved.y).toBe(95);
    expect(moved.width).toBe(200);
    expect(diamondVertices(moved)[0]).toEqual({ x: 210, y: 95 });
  });

  it('选中框 4 角控点可命中（与 rect/circle 同布局）', () => {
    const el = diamond();
    // 布局 = bbox 外扩 4px 的 8×8 方块（scale 1）：nw 方块中心 ≈ (100,100)
    expect(hitTestSelectionHandle(el, { x: 100, y: 100 }, VP)).toBe('nw');
    expect(hitTestSelectionHandle(el, { x: 300, y: 220 }, VP)).toBe('se');
  });
});

describe('boxResizePatch（角控点缩放，参数联合含 diamond）', () => {
  it('se 角外拉 → width/height 变大，nw 对角锚定不动', () => {
    expect(boxResizePatch('se', diamond(), { x: 400, y: 280 })).toEqual({
      x: 100, y: 100, width: 300, height: 180,
    });
  });

  it('Shift 等比锁定：纵横比起手元素（120/200）', () => {
    const next = boxResizePatch('se', diamond(), { x: 400, y: 400 }, { shift: true });
    expect(next.x).toBe(100);
    expect(next.y).toBe(100);
    expect(next.width / next.height).toBeCloseTo(200 / 120, 10);
  });
});

describe('SVG 导出（<polygon> 四顶点）', () => {
  it('顶点串与 diamondVertices 同一份推导；无填充 fill="none"', () => {
    const svg = exportToSvg([diamond()]);
    expect(svg).toContain('<polygon points="200,100 300,160 200,220 100,160"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke-linejoin="round"');
  });

  it('有填充 → fill 写入 fillColor；dashed → stroke-dasharray（线宽 2 → 8,6）', () => {
    const filled = { ...diamond('#EF4444'), dash: 'dashed' as const };
    const svg = exportToSvg([filled]);
    expect(svg).toContain('fill="#EF4444"');
    expect(svg).toContain('stroke-dasharray="8,6"');
  });

  it('透明度 < 1 → opacity 属性（与 rect 同语义）', () => {
    const svg = exportToSvg([{ ...diamond(), opacity: 0.5 }]);
    expect(svg).toContain('opacity="0.5"');
  });
});

describe('工具链接入（快捷键 / 面板谓词 / autosave / schema）', () => {
  it('Alt+I 命中 tool.diamond；修饰键精确相等（Ctrl+Alt+I 不劫持）', () => {
    const ev = { code: 'KeyI', key: 'i', altKey: true, shiftKey: false, ctrlKey: false, metaKey: false };
    expect(matchEvent(ev)?.id).toBe('tool.diamond');
    expect(matchEvent({ ...ev, ctrlKey: true })).toBeNull();
    const binding = KEY_BINDINGS.find((b) => b.id === 'tool.diamond');
    expect(binding?.labelKey).toBe('toolbar.diamond');
    expect(formatShortcut(binding!, false)).toBe('Alt+I'); // 帮助面板 / tooltip 展示
  });

  it('TOOL_BINDING 映射 diamond（LeftToolbar tooltip 同源）', () => {
    expect(TOOL_BINDING['diamond']).toBe('tool.diamond');
  });

  it('线型 / 改色面板谓词放行 diamond（描边类元素）', () => {
    expect(canDashFromToolPanel(diamond())).toBe(true);
    expect(canRestyleFromToolPanel(diamond())).toBe(true);
  });

  it('autosave 指纹含外框与 fillColor：改填充 / 缩放均构成内容变更', () => {
    expect(elementSignature(diamond('#3B82F6'))).not.toBe(elementSignature(diamond()));
    expect(elementSignature({ ...diamond(), width: 300 })).not.toBe(elementSignature(diamond()));
  });

  it('CURRENT_SCHEMA_VERSION = 3（v3 起含菱形元素）', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
  });
});
