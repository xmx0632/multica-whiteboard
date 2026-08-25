/**
 * 工具 → 画布光标统一映射（ZOO-207）。
 *
 * 与 keymap.ts（ZOO-205）同构的配置表驱动：全站唯一的「工具长什么光标」事实源，
 * Canvas 只负责传入状态上下文（平移 / 空格 / 文本编辑 / 悬停命中），不散落三元式。
 *
 * 自定义 SVG 光标约定（画笔 / 橡皮）：
 * - 热点（hotspot）必须对准实际作用点——画笔=笔尖角点、橡皮=擦除作用中心；
 *   坐标系为光标图自身 px，写在 `url(...) x y` 的 x y 上；
 * - 根节点必须带 width/height（cursor 图的 intrinsic size，否则浏览器拒用）；
 *   24px 远低于 128px 上限，矢量内容浏览器按显示器实际缩放栅格化（即天然的
 *   @2x/@3x 适配，Retina 不糊；画布缩放视口也不影响 OS 合成的光标尺寸）；
 * - Safari 不支持 SVG cursor：`url(...) , fallback` 回退系统关键字（crosshair），
 *   热点仍在准星中心，几何语义不漂移；
 * - 橡皮为整元素命中擦除（无独立尺寸设置），光标为固定 24px 图示。
 */
import type { ToolType } from './types';

/** 自定义 SVG 光标规格（热点与图形几何对齐是验收项，勿单独改动其一） */
export interface SvgCursorSpec {
  /** SVG 源码（根节点带 width/height，锁定 intrinsic size） */
  svg: string;
  /** intrinsic 尺寸 px（浏览器 cursor 上限 128） */
  size: number;
  /** 热点：光标图 px 坐标，必须落在 [0, size] 内 */
  hotspot: { x: number; y: number };
  /** SVG cursor 不支持时的系统关键字回退（热点同为图示中心/准星中心） */
  fallback: string;
}

/**
 * 画笔：Lucide 铅笔几何（M17 3 … L2 22 l1.5-5.5 Z），笔尖角点恰在 (2,22)。
 * 深灰笔身 + 1.6px 白描边，深浅底色上均可读。
 */
export const PEN_CURSOR: SvgCursorSpec = {
  svg:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" fill="#1f2937" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="m15 5 4 4" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>' +
    '</svg>',
  size: 24,
  hotspot: { x: 2, y: 22 },
  fallback: 'crosshair',
};

/**
 * 橡皮：15×8 矩形绕中心 (12,12) 旋转 45° 的双色板擦（粉面 + 灰底、白描边），
 * 热点取板擦几何中心——与整元素命中擦除的作用点一致。
 */
export const ERASER_CURSOR: SvgCursorSpec = {
  svg:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<path d="M3.87 9.53 9.53 3.87 14.83 9.17 9.17 14.83Z" fill="#f9a8d4" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>' +
    '<path d="M9.17 14.83 14.83 9.17 20.13 14.47 14.47 20.13Z" fill="#9ca3af" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>' +
    '</svg>',
  size: 24,
  hotspot: { x: 12, y: 12 },
  fallback: 'crosshair',
};

/** 各工具的系统关键字光标（SVG 自定义之外的工具收口在此配置表） */
const KEYWORD_CURSORS: Record<ToolType, string> = {
  hand: 'grab',
  select: 'default',
  pen: 'crosshair', // 仅作 SVG cursor 不支持时的回退，实际走 PEN_CURSOR
  rectangle: 'crosshair',
  circle: 'crosshair',
  diamond: 'crosshair',
  line: 'crosshair',
  arrow: 'crosshair',
  text: 'text',
  eraser: 'crosshair', // 同上，实际走 ERASER_CURSOR
  equation: 'default', // 输入在右侧方程面板，画布点击无落点作用
};

/** SVG 规格 → CSS cursor 值（data URI 需转义；encodeURIComponent 全量覆盖） */
export function svgCursorCss(spec: SvgCursorSpec): string {
  return `url("data:image/svg+xml,${encodeURIComponent(spec.svg)}") ${spec.hotspot.x} ${spec.hotspot.y}, ${spec.fallback}`;
}

// Canvas 每次渲染都取值，模块级缓存一次编码
const PEN_CURSOR_CSS = svgCursorCss(PEN_CURSOR);
const ERASER_CURSOR_CSS = svgCursorCss(ERASER_CURSOR);

/** 光标状态上下文（Canvas 传入；优先级见 canvasCursor） */
export interface CursorContext {
  /** 平移拖拽进行中（手型主键 / 空格 / 中键共用通道，ZOO-157） */
  panning?: boolean;
  /** 空格按住的临时平移预备态（ZOO-163） */
  spacePanning?: boolean;
  /** 内联文本编辑中（ZOO-159）：点画布=提交草稿，非落字 */
  textEditing?: boolean;
  /** select 工具悬停命中元素（可拖动 → move） */
  hoverElement?: boolean;
  /** select 工具悬停 / 拖动中可拖点（ZOO-201 → move，沿曲线点另有吸附高亮） */
  hoverDragPoint?: boolean;
}

/**
 * 取当前画布光标 CSS 值。覆盖链（先到先得）：
 * panning(grabbing) > textEditing(default) > spacePanning|hand(grab) > 工具映射。
 * 文本编辑优先于平移预备态：草稿打开时点画布是提交而非平移（pointerdown 先走草稿分支）。
 */
export function canvasCursor(tool: ToolType, ctx: CursorContext = {}): string {
  if (ctx.panning) return 'grabbing';
  if (ctx.textEditing) return 'default';
  if (ctx.spacePanning || tool === 'hand') return 'grab';
  if (tool === 'pen') return PEN_CURSOR_CSS;
  if (tool === 'eraser') return ERASER_CURSOR_CSS;
  if (tool === 'select') return ctx.hoverElement || ctx.hoverDragPoint ? 'move' : 'default';
  return KEYWORD_CURSORS[tool];
}
