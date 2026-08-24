/**
 * 演示模式单测（ZOO-200）：
 * - 纯函数：铺满视口（等比 contain、居中、缩放上界）、页序步进夹取、
 *   横滑方向判定、激光采点去重 / 渐隐 alpha / 渐隐完成判定；
 * - 状态机（usePresentation + useStore）：进入（快照 + 清选中 + 锁定首帧视口）、
 *   翻页（step / goTo / jumpToEdge，边界空转）、退出（视口与选中态逐字段还原）、
 *   激光标志（L 按住 / 抬起）；
 * - 不变量：全程撤销 / 重做栈长度与 isDirty / elements 零变化（激光不入历史栈、
 *   翻页不改文档），无帧文档进入被拒绝。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { FrameElement, Viewport, WhiteboardElement } from '../types';
import { framesOf } from '../frame';
import {
  usePresentation,
  presentationViewport,
  stepPresentationIndex,
  swipeDirection,
  laserAlpha,
  laserTrailDone,
  laserShouldAppend,
  LASER_FADE_MS,
  LASER_POINT_MIN_DIST,
  PRESENTATION_SWIPE_MIN_PX,
  PRESENTATION_MAX_SCALE,
  type LaserTrail,
} from '../presentation';

const frame = (id: string, x: number, y: number, w = 960, h = 640): FrameElement => ({
  id, type: 'frame', x, y, width: w, height: h, name: `页 ${id}`,
  strokeColor: '#94a3b8', strokeWidth: 2, opacity: 1,
});

const rect = (id: string, x: number, y: number): WhiteboardElement => ({
  id, type: 'rectangle', x, y, width: 100, height: 60,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

/** 三帧横排文档：f1(0) f2(1040) f3(2080)，f2 内放一个元素 */
function threeFrameDoc() {
  return [
    frame('f1', 0, 0),
    frame('f2', 1040, 0),
    frame('f3', 2080, 0),
    rect('r1', 1100, 100),
  ] as WhiteboardElement[];
}

const VIEW = { width: 1200, height: 800 };

beforeEach(() => {
  useStore.setState({
    elements: threeFrameDoc(),
    selectedId: 'r1',
    selectedIds: ['r1'],
    polylineEditId: null,
    polylineVertexIndex: null,
    activeFrameId: 'f2',
    undoStack: [],
    redoStack: [],
    isDirty: false,
    viewport: { offsetX: 33, offsetY: 44, scale: 0.7 },
  });
  usePresentation.setState({
    active: false,
    frameId: null,
    laserPointerActive: false,
    restore: null,
    requestedFullscreen: false,
  });
});

// ========== 纯函数：铺满视口 ==========

describe('presentationViewport（等比铺满）', () => {
  it('宽主导时按宽 contain：帧完整可见、居中、无多余留白', () => {
    // 1200×800 视口放 960×640 帧：宽比 1.25 / 高比 1.25——取小者等比铺满
    const vp = presentationViewport(frame('f', 0, 0), 1200, 800);
    expect(vp.scale).toBeCloseTo(1.25);
    // 帧中心 (480, 320) 对齐视口中心
    expect(480 * vp.scale + vp.offsetX).toBeCloseTo(600);
    expect(320 * vp.scale + vp.offsetY).toBeCloseTo(400);
  });

  it('非零原点帧同样中心对齐（offset 吸收帧位置）', () => {
    const vp = presentationViewport(frame('f', 1040, 200), 1200, 800);
    const cx = 1040 + 480;
    const cy = 200 + 320;
    expect(cx * vp.scale + vp.offsetX).toBeCloseTo(600);
    expect(cy * vp.scale + vp.offsetY).toBeCloseTo(400);
  });

  it('极小帧放大不超过上界（防失焦）', () => {
    const vp = presentationViewport(frame('f', 0, 0, 100, 66), 1200, 800);
    expect(vp.scale).toBe(PRESENTATION_MAX_SCALE);
  });

  it('超高帧按高 contain（letterbox 竖向留白归零、横向对称）', () => {
    const vp = presentationViewport(frame('f', 0, 0, 960, 1280), 1200, 800);
    expect(vp.scale).toBeCloseTo(800 / 1280);
    expect(vp.offsetX + 480 * vp.scale).toBeCloseTo(600); // 横向仍居中
  });
});

// ========== 纯函数：页序步进 / 横滑 ==========

describe('stepPresentationIndex（边界夹取）', () => {
  it('常规步进', () => {
    expect(stepPresentationIndex(0, 3, 1)).toBe(1);
    expect(stepPresentationIndex(2, 3, -1)).toBe(1);
  });
  it('首 / 末页再按空转（PPT 直觉）', () => {
    expect(stepPresentationIndex(0, 3, -1)).toBe(0);
    expect(stepPresentationIndex(2, 3, 1)).toBe(2);
  });
  it('空列表恒 0', () => {
    expect(stepPresentationIndex(0, 0, 1)).toBe(0);
  });
});

describe('swipeDirection（横滑翻页判定）', () => {
  it('左滑 = 下一页，右滑 = 上一页', () => {
    expect(swipeDirection(-80, 5)).toBe(1);
    expect(swipeDirection(80, -5)).toBe(-1);
  });
  it('位移不足 / 垂向主导不翻页', () => {
    expect(swipeDirection(-30, 0)).toBeNull();
    expect(swipeDirection(-80, 100)).toBeNull(); // 斜向滑动
    expect(swipeDirection(0, -200)).toBeNull();
  });
  it('阈值边界：恰达阈值且横向主导才动作', () => {
    expect(swipeDirection(-PRESENTATION_SWIPE_MIN_PX, 0)).toBe(1);
    expect(swipeDirection(-PRESENTATION_SWIPE_MIN_PX - 0.01, 0)).toBe(1);
  });
});

// ========== 纯函数：激光轨迹 ==========

describe('laser（采点与渐隐）', () => {
  it('采点去重：距末点不足阈值不入集', () => {
    const points = [{ x: 0, y: 0 }];
    expect(laserShouldAppend(points, { x: LASER_POINT_MIN_DIST - 0.01, y: 0 })).toBe(false);
    expect(laserShouldAppend(points, { x: LASER_POINT_MIN_DIST, y: 0 })).toBe(true);
    expect(laserShouldAppend([], { x: 0, y: 0 })).toBe(true); // 空集直收
  });

  it('alpha：绘制中恒 1；松开后线性渐隐到 0', () => {
    expect(laserAlpha(true, null, 1000)).toBe(1);
    const releasedAt = 1000;
    expect(laserAlpha(false, releasedAt, 1000)).toBeCloseTo(1);
    expect(laserAlpha(false, releasedAt, 1000 + LASER_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(laserAlpha(false, releasedAt, 1000 + LASER_FADE_MS)).toBe(0);
    expect(laserAlpha(false, releasedAt, 1000 + LASER_FADE_MS * 3)).toBe(0);
  });

  it('渐隐完成判定：未松开 / 渐隐中未完成为 false，归零后为 true', () => {
    const trail = (over: Partial<LaserTrail>): LaserTrail => ({
      points: [{ x: 0, y: 0 }], drawing: true, releasedAt: null, ...over,
    });
    expect(laserTrailDone(trail({}), 0)).toBe(false); // 绘制中
    expect(laserTrailDone(trail({ drawing: false, releasedAt: 100 }), 100 + 10)).toBe(false);
    expect(laserTrailDone(trail({ drawing: false, releasedAt: 100 }), 100 + LASER_FADE_MS)).toBe(true);
  });
});

// ========== 状态机：进入 / 翻页 / 退出 ==========

describe('演示态状态机（usePresentation）', () => {
  it('进入：起始页 = 当前活动页，视口锁定铺满，选中清空且快照留存', () => {
    const ok = usePresentation.getState().enter(VIEW);
    expect(ok).toBe(true);
    const pres = usePresentation.getState();
    expect(pres.active).toBe(true);
    expect(pres.frameId).toBe('f2'); // activeFrameId 起始
    expect(pres.laserPointerActive).toBe(false);

    // 视口 = f2 铺满（帧中心对齐视口中心）
    const vp = useStore.getState().viewport;
    const f2 = framesOf(useStore.getState().elements)[1];
    expect((f2.x + f2.width / 2) * vp.scale + vp.offsetX).toBeCloseTo(VIEW.width / 2);
    expect((f2.y + f2.height / 2) * vp.scale + vp.offsetY).toBeCloseTo(VIEW.height / 2);

    // 选中清空 + 快照逐字段还原进入前状态
    expect(useStore.getState().selectedId).toBeNull();
    expect(useStore.getState().selectedIds).toEqual([]);
    expect(pres.restore).toEqual({
      viewport: { offsetX: 33, offsetY: 44, scale: 0.7 },
      selectedId: 'r1',
      selectedIds: ['r1'],
      activeFrameId: 'f2',
    });
  });

  it('无活动页时从首页进入；无帧文档进入被拒绝且状态不变', () => {
    useStore.setState({ activeFrameId: null });
    expect(usePresentation.getState().enter(VIEW)).toBe(true);
    expect(usePresentation.getState().frameId).toBe('f1');

    usePresentation.getState().exit();
    useStore.setState({ elements: [rect('only', 0, 0)] });
    expect(usePresentation.getState().enter(VIEW)).toBe(false);
    expect(usePresentation.getState().active).toBe(false);
  });

  it('翻页：step 走页序且边界空转，goTo 越界夹取，jumpToEdge 跳首末', () => {
    usePresentation.getState().enter(VIEW);
    const pres = usePresentation.getState();

    pres.step(1); // f2 → f3（末页）
    expect(usePresentation.getState().frameId).toBe('f3');
    usePresentation.getState().step(1); // 末页再按 → 空转
    expect(usePresentation.getState().frameId).toBe('f3');

    usePresentation.getState().step(-1); // f3 → f2
    expect(usePresentation.getState().frameId).toBe('f2');

    usePresentation.getState().goTo(99); // 夹到末页
    expect(usePresentation.getState().frameId).toBe('f3');
    usePresentation.getState().goTo(-5); // 夹到首页
    expect(usePresentation.getState().frameId).toBe('f1');

    usePresentation.getState().jumpToEdge('end');
    expect(usePresentation.getState().frameId).toBe('f3');
    usePresentation.getState().jumpToEdge('home');
    expect(usePresentation.getState().frameId).toBe('f1');
  });

  it('翻页同步活动页与铺满视口（页序即 framesOf 序）', () => {
    usePresentation.getState().enter(VIEW);
    usePresentation.getState().step(-1); // f2 → f1
    expect(useStore.getState().activeFrameId).toBe('f1');
    const vp: Viewport = useStore.getState().viewport;
    const f1 = framesOf(useStore.getState().elements)[0];
    expect((f1.x + f1.width / 2) * vp.scale + vp.offsetX).toBeCloseTo(VIEW.width / 2);
  });

  it('退出：视口与选中态逐字段还原，active 复位', () => {
    usePresentation.getState().enter(VIEW);
    usePresentation.getState().step(1);
    usePresentation.getState().exit();

    const st = useStore.getState();
    expect(usePresentation.getState().active).toBe(false);
    expect(usePresentation.getState().restore).toBeNull();
    expect(st.viewport).toEqual({ offsetX: 33, offsetY: 44, scale: 0.7 });
    expect(st.selectedId).toBe('r1');
    expect(st.selectedIds).toEqual(['r1']);
    expect(st.activeFrameId).toBe('f2'); // 进入前的活动页，非演示停留页
  });

  it('refit：窗口尺寸变化后当前页重新铺满', () => {
    usePresentation.getState().enter(VIEW);
    usePresentation.getState().refit({ width: 800, height: 600 });
    const vp = useStore.getState().viewport;
    const f2 = framesOf(useStore.getState().elements)[1];
    expect(vp.scale).toBeCloseTo(800 / 960); // 800/960 < 600/640，宽主导
    expect((f2.x + f2.width / 2) * vp.scale + vp.offsetX).toBeCloseTo(400);
  });

  it('激光标志：L 按住 / 抬起切换，重复设置不抖动', () => {
    usePresentation.getState().setLaserPointer(true);
    expect(usePresentation.getState().laserPointerActive).toBe(true);
    usePresentation.getState().setLaserPointer(true); // 幂等
    expect(usePresentation.getState().laserPointerActive).toBe(true);
    usePresentation.getState().setLaserPointer(false);
    expect(usePresentation.getState().laserPointerActive).toBe(false);
  });

  it('不变量：进入 / 翻页 / 激光 / 退出全程文档零变化（撤销栈 / elements / isDirty）', () => {
    const before = {
      elements: useStore.getState().elements,
      undoStackLen: useStore.getState().undoStack.length,
      redoStackLen: useStore.getState().redoStack.length,
      isDirty: useStore.getState().isDirty,
    };
    usePresentation.getState().enter(VIEW);
    usePresentation.getState().setLaserPointer(true);
    usePresentation.getState().setLaserPointer(false);
    usePresentation.getState().step(1);
    usePresentation.getState().jumpToEdge('home');
    usePresentation.getState().exit();

    const st = useStore.getState();
    expect(st.elements).toBe(before.elements); // 引用不变 = 无任何元素改动
    expect(st.undoStack.length).toBe(before.undoStackLen);
    expect(st.redoStack.length).toBe(before.redoStackLen);
    expect(st.isDirty).toBe(before.isDirty);
  });
});
