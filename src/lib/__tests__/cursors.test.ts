/**
 * 工具光标映射测试（ZOO-207）：配置表覆盖全工具、状态覆盖链优先级、
 * 自定义 SVG 光标的热点 / intrinsic size / data URI 编码与回退关键字。
 */
import { describe, expect, it } from 'vitest';
import { canvasCursor, svgCursorCss, PEN_CURSOR, ERASER_CURSOR, SvgCursorSpec } from '../cursors';
import type { ToolType } from '../types';

const ALL_TOOLS: ToolType[] = [
  'hand', 'select', 'pen', 'rectangle', 'circle', 'line', 'arrow', 'text', 'eraser', 'equation',
];

/** `url("data:...") x y, fallback` → { uri, x, y, fallback } */
function parseCustomCursor(css: string) {
  const m = css.match(/^url\("data:image\/svg\+xml,([^"]*)"\) (\d+) (\d+), (\S+)$/);
  expect(m, `自定义光标 CSS 形如 url("data:image/svg+xml,…") x y, fallback：${css}`).toBeTruthy();
  return { uri: m![1], x: Number(m![2]), y: Number(m![3]), fallback: m![4] };
}

describe('cursors：工具 → 光标配置表', () => {
  it('全部工具都有非空光标值（无 undefined / 空串漏网）', () => {
    for (const tool of ALL_TOOLS) {
      const css = canvasCursor(tool);
      expect(css, tool).toBeTruthy();
      expect(css, tool).not.toContain('undefined');
    }
  });

  it('系统关键字工具：图形类 crosshair、文字 I 型、选择默认箭头、手型 grab、equation 默认', () => {
    expect(canvasCursor('select')).toBe('default');
    expect(canvasCursor('hand')).toBe('grab');
    expect(canvasCursor('rectangle')).toBe('crosshair');
    expect(canvasCursor('circle')).toBe('crosshair');
    expect(canvasCursor('line')).toBe('crosshair');
    expect(canvasCursor('arrow')).toBe('crosshair');
    expect(canvasCursor('text')).toBe('text');
    expect(canvasCursor('equation')).toBe('default'); // 画布点击无作用，箭头即诚实
  });

  it('画笔 / 橡皮走自定义 SVG 光标（前缀 + 热点 + 回退三段式）', () => {
    expect(parseCustomCursor(canvasCursor('pen')).fallback).toBe('crosshair');
    expect(parseCustomCursor(canvasCursor('eraser')).fallback).toBe('crosshair');
  });

  it('select 悬停命中元素 → move，未命中 → 默认箭头', () => {
    expect(canvasCursor('select', { hoverElement: true })).toBe('move');
    expect(canvasCursor('select', { hoverElement: false })).toBe('default');
  });

  it('旋转手柄（ZOO-222）：悬停 → grab、拖转中 → grabbing（与平移 grab/grabbing 同族）', () => {
    expect(canvasCursor('select', { hoverRotate: true })).toBe('grab');
    expect(canvasCursor('select', { hoverRotate: true, hoverElement: true })).toBe('grab');
    expect(canvasCursor('select', { rotating: true })).toBe('grabbing');
    // 覆盖链：拖转中不输平移（两手势互斥，只验同为 grabbing 的最高档）
    expect(canvasCursor('select', { rotating: true, hoverRotate: true })).toBe('grabbing');
    expect(canvasCursor('hand', { rotating: true })).toBe('grabbing');
    // 未悬停 / 非选中态维持默认
    expect(canvasCursor('select', { hoverRotate: false })).toBe('default');
  });
});

describe('cursors：状态覆盖链（panning > textEditing > spacePanning > 工具映射）', () => {
  it('平移拖拽中一律 grabbing（对全部工具）', () => {
    for (const tool of ALL_TOOLS) {
      expect(canvasCursor(tool, { panning: true })).toBe('grabbing');
    }
  });

  it('文本编辑中回默认箭头（点画布=提交草稿，非落字），且优先于空格预备态', () => {
    expect(canvasCursor('text', { textEditing: true })).toBe('default');
    expect(canvasCursor('pen', { textEditing: true })).toBe('default');
    expect(canvasCursor('text', { textEditing: true, spacePanning: true })).toBe('default');
  });

  it('空格按住 → grab（临时平移预备态，对全部工具生效）', () => {
    for (const tool of ALL_TOOLS) {
      expect(canvasCursor(tool, { spacePanning: true })).toBe('grab');
    }
  });
});

describe('cursors：自定义 SVG 规格（热点精确性 / 尺寸 / 编码）', () => {
  const CUSTOM: [string, SvgCursorSpec][] = [
    ['画笔', PEN_CURSOR],
    ['橡皮', ERASER_CURSOR],
  ];

  it.each(CUSTOM)('%s：热点落在 [0, size] 图形边界内', (_name, spec) => {
    expect(spec.hotspot.x).toBeGreaterThanOrEqual(0);
    expect(spec.hotspot.x).toBeLessThanOrEqual(spec.size);
    expect(spec.hotspot.y).toBeGreaterThanOrEqual(0);
    expect(spec.hotspot.y).toBeLessThanOrEqual(spec.size);
  });

  it.each(CUSTOM)('%s：intrinsic size 显式钉在 SVG 根节点且 ≤128 上限', (_name, spec) => {
    expect(spec.size).toBeLessThanOrEqual(128);
    expect(spec.svg).toContain(`width="${spec.size}"`);
    expect(spec.svg).toContain(`height="${spec.size}"`);
    expect(spec.svg).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(spec.svg.trim().endsWith('</svg>')).toBe(true);
  });

  it.each(CUSTOM)('%s：svgCursorCss 热点坐标与规格一致，data URI 可无损解码', (_name, spec) => {
    const parsed = parseCustomCursor(svgCursorCss(spec));
    expect(parsed.x).toBe(spec.hotspot.x);
    expect(parsed.y).toBe(spec.hotspot.y);
    // encodeURIComponent 全量转义：payload 解码后应还原源码（无裸 # / 引号逃逸）
    expect(decodeURIComponent(parsed.uri)).toBe(spec.svg);
  });

  it('画笔热点=笔尖角点 (2,22)（Lucide 铅笔几何 M17 3…L2 22 的 tip）', () => {
    expect(PEN_CURSOR.hotspot).toEqual({ x: 2, y: 22 });
  });

  it('橡皮热点=图示几何中心（整元素命中擦除的作用中心）', () => {
    expect(ERASER_CURSOR.hotspot).toEqual({ x: ERASER_CURSOR.size / 2, y: ERASER_CURSOR.size / 2 });
  });
});
