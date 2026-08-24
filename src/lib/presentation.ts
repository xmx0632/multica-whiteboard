/**
 * 演示模式（ZOO-200）：课堂翻页放映 + 激光指针。
 *
 * 与沉浸模式（ImmersiveToggle）正交：沉浸只是手机竖屏的「隐藏浮层」CSS 态，
 * 演示模式是独立的放映会话——进入时快照视口与选中态、清选中、视口锁定当前帧
 * 等比铺满；退出时精确还原。两者互不写对方状态，先后进入 / 退出任意组合无冲突。
 *
 * 分层惯例（与 gestures / frame 同构）：
 * - 纯函数（presentationViewport / stepPresentationIndex / swipeDirection /
 *   laser 系列）→ 单测覆盖；
 * - usePresentation zustand store → 演示态会话状态机（进入 / 翻页 / 退出 / 激光）；
 * - Canvas / PresentationOverlay / useShortcuts 只做事件接线。
 *
 * 激光轨迹是纯渲染层：点集只存在于 Canvas 的 ref（屏幕坐标），不入 elements、
 * 不压撤销栈、不持久化——翻页 / 激光全程 undoStack 长度与文档内容零变化。
 */
import { create } from 'zustand';
import { FrameElement, Point, Viewport } from './types';
import { framesOf } from './frame';
import { MAX_SCALE } from './gestures';
import { useStore } from './store';
import { enterFullscreenLandscape, exitFullscreen } from './fullscreen';

/** 演示铺满的缩放上界：防止极小帧被放大到失焦（与手势缩放同上界） */
export const PRESENTATION_MAX_SCALE = MAX_SCALE;

/**
 * 演示页视口（等比铺满）：帧 contain-fit 填满可视区（无页边距——放映要的是满屏），
 * 帧中心对齐视口中心；与 frameFocusViewport（页条跳转，带留白 + maxScale=1）区分。
 */
export function presentationViewport(
  frame: FrameElement,
  viewWidth: number,
  viewHeight: number,
): Viewport {
  const w = Math.max(frame.width, 1);
  const h = Math.max(frame.height, 1);
  const scale = Math.min(
    Math.min(viewWidth / w, viewHeight / h),
    PRESENTATION_MAX_SCALE,
  );
  const cx = frame.x + w / 2;
  const cy = frame.y + h / 2;
  return {
    scale,
    offsetX: viewWidth / 2 - cx * scale,
    offsetY: viewHeight / 2 - cy * scale,
  };
}

/** 页序指针步进：边界夹取（末页再按 → 空转，PPT 直觉）；空列表恒 0 */
export function stepPresentationIndex(index: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index + dir));
}

// —— 激光指针（纯渲染层参数；判定逻辑纯函数化，单测覆盖） ——

/** 松开后轨迹渐隐时长（验收：1-2s） */
export const LASER_FADE_MS = 1500;
/** 轨迹采点最小位移（屏幕 px）：抖动去重，防点集爆炸 */
export const LASER_POINT_MIN_DIST = 2;
/** 触屏长按进入激光的判定时长（ms） */
export const LASER_TOUCH_HOLD_MS = 350;
/** 长按等待期的位移豁免（屏幕 px）：超过视作滑动开始，取消长按 */
export const LASER_HOLD_CANCEL_PX = 10;
/** 横滑翻页的最小位移（屏幕 px）；且横向位移须显著大于纵向 */
export const PRESENTATION_SWIPE_MIN_PX = 48;

/** 激光轨迹（Canvas 渲染层 ref 持有；屏幕坐标，演示态视口锁定故坐标稳定） */
export interface LaserTrail {
  points: Point[];
  drawing: boolean;
  releasedAt: number | null;
}

/** 轨迹不透明度：绘制中恒 1；松开后按 (now - releasedAt) 线性渐隐到 0 */
export function laserAlpha(drawing: boolean, releasedAt: number | null, now: number): number {
  if (drawing) return 1;
  if (releasedAt == null) return 0;
  return Math.max(0, 1 - (now - releasedAt) / LASER_FADE_MS);
}

/** 渐隐是否完成（完成即可清空点集、停 rAF 循环） */
export function laserTrailDone(trail: LaserTrail, now: number): boolean {
  return !trail.drawing && laserAlpha(trail.drawing, trail.releasedAt, now) <= 0;
}

/** 新点是否入集：空集直收；否则距末点 ≥ LASER_POINT_MIN_DIST 才收 */
export function laserShouldAppend(points: Point[], p: Point): boolean {
  if (points.length === 0) return true;
  const last = points[points.length - 1];
  return Math.hypot(p.x - last.x, p.y - last.y) >= LASER_POINT_MIN_DIST;
}

/**
 * 滑动手势方向（演示态触屏翻页）：横向位移达阈值且显著主导纵向 → 返回翻页方向
 * （左滑 = +1 下一页，右滑 = -1 上一页）；否则 null（垂向滑动 / 位移不足不翻页）。
 */
export function swipeDirection(dx: number, dy: number): 1 | -1 | null {
  if (Math.abs(dx) < PRESENTATION_SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.2) return null;
  return dx < 0 ? 1 : -1;
}

/** 进入演示时的还原快照：退出后视口与选中态逐字段还原 */
export interface PresentationSnapshot {
  viewport: Viewport;
  selectedId: string | null;
  selectedIds: string[];
  activeFrameId: string | null;
}

/** 视口尺寸来源：组件传 window 实测；SSR / 单测显式传参，缺省 1200×800 */
function viewSizeOf(viewSize?: { width: number; height: number }): { width: number; height: number } {
  if (viewSize) return viewSize;
  if (typeof window !== 'undefined') return { width: window.innerWidth, height: window.innerHeight };
  return { width: 1200, height: 800 };
}

interface PresentationState {
  /** 是否处于演示态（页面根挂 presentation-mode 类） */
  active: boolean;
  /** 当前放映页帧 id（悬空时消费方按 framesOf 兜底首页） */
  frameId: string | null;
  /** L 键按住中（鼠标激光通道；触屏激光走长按，不经此标志） */
  laserPointerActive: boolean;
  /** 进入时的还原快照；active 期间非空 */
  restore: PresentationSnapshot | null;
  /** 本次演示会话由我们发起的浏览器全屏（退出时才还原；用户先于进入的全屏不动） */
  requestedFullscreen: boolean;

  /** 进入演示：无帧返回 false 不进入；起始页 = 当前活动页（无则首页） */
  enter: (viewSize?: { width: number; height: number }) => boolean;
  /** 跳到指定页（越界夹取；页序即 framesOf 序） */
  goTo: (index: number) => void;
  /** 上一 / 下一页（边界空转） */
  step: (dir: 1 | -1) => void;
  /** 跳首 / 末页（Home / End） */
  jumpToEdge: (edge: 'home' | 'end') => void;
  /** 窗口尺寸变化后重算当前页铺满视口 */
  refit: (viewSize?: { width: number; height: number }) => void;
  /** 退出演示：还原进入前视口与选中态、还原我们发起的全屏 */
  exit: () => void;
  /** L 键按下 / 抬起（鼠标激光通道） */
  setLaserPointer: (on: boolean) => void;
}

export const usePresentation = create<PresentationState>((set, get) => ({
  active: false,
  frameId: null,
  laserPointerActive: false,
  restore: null,
  requestedFullscreen: false,

  enter: (viewSize) => {
    const st = useStore.getState();
    const frames = framesOf(st.elements);
    if (frames.length === 0) return false;

    const start =
      frames.find((f) => f.id === st.activeFrameId) ?? frames[0];
    const size = viewSizeOf(viewSize);

    // 还原快照先落（进入前的视口 + 选中态 + 活动页）
    set({
      active: true,
      frameId: start.id,
      laserPointerActive: false,
      restore: {
        viewport: { ...st.viewport },
        selectedId: st.selectedId,
        selectedIds: [...st.selectedIds],
        activeFrameId: st.activeFrameId,
      },
    });

    // 演示态无编辑：清选中与折线编辑态（还原走快照，不丢数据）
    useStore.setState({
      selectedId: null,
      selectedIds: [],
      polylineEditId: null,
      polylineVertexIndex: null,
      activeFrameId: start.id,
      viewport: presentationViewport(start, size.width, size.height),
    });

    // 浏览器全屏（复用 fullscreen 工具；需用户手势——入口按钮点击即手势）。
    // 仅当我们发起了全屏，退出演示才还原；用户先于进入的全屏（如手机横屏全屏）不动。
    if (typeof document !== 'undefined' && !document.fullscreenElement) {
      void enterFullscreenLandscape().then((ok) => {
        if (ok && get().active) set({ requestedFullscreen: true });
      });
    }
    return true;
  },

  goTo: (index) => {
    const pres = get();
    if (!pres.active) return;
    const frames = framesOf(useStore.getState().elements);
    if (frames.length === 0) return;
    const clamped = Math.max(0, Math.min(frames.length - 1, index));
    const frame = frames[clamped];
    if (frame.id === pres.frameId) return;
    set({ frameId: frame.id });
    const size = viewSizeOf();
    useStore.setState({
      activeFrameId: frame.id, // 会话态：退出演示后页条停在看过的页
      viewport: presentationViewport(frame, size.width, size.height),
    });
  },

  step: (dir) => {
    const pres = get();
    const frames = framesOf(useStore.getState().elements);
    const idx = Math.max(0, frames.findIndex((f) => f.id === pres.frameId));
    get().goTo(stepPresentationIndex(idx, frames.length, dir));
  },

  jumpToEdge: (edge) => {
    const frames = framesOf(useStore.getState().elements);
    get().goTo(edge === 'home' ? 0 : frames.length - 1);
  },

  refit: (viewSize) => {
    const pres = get();
    if (!pres.active) return;
    const frames = framesOf(useStore.getState().elements);
    const frame = frames.find((f) => f.id === pres.frameId) ?? frames[0];
    if (!frame) return;
    const size = viewSizeOf(viewSize);
    useStore.setState({ viewport: presentationViewport(frame, size.width, size.height) });
  },

  exit: () => {
    const pres = get();
    if (!pres.active) return;
    const restore = pres.restore;
    set({
      active: false,
      frameId: null,
      laserPointerActive: false,
      restore: null,
      requestedFullscreen: false,
    });
    if (restore) {
      useStore.setState({
        viewport: restore.viewport,
        selectedId: restore.selectedId,
        selectedIds: restore.selectedIds,
        activeFrameId: restore.activeFrameId,
      });
    }
    if (pres.requestedFullscreen && typeof document !== 'undefined' && document.fullscreenElement) {
      void exitFullscreen();
    }
  },

  setLaserPointer: (on) => {
    if (get().laserPointerActive === on) return;
    set({ laserPointerActive: on });
  },
}));
