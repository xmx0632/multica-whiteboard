/**
 * 矩形旋转交互层单测（ZOO-222 矩形旋转系列 PR-R2）：
 * - rotation.ts 新原语：stepRotation（Shift 15° 网格取整，结果归一）、
 *   pointerToLocalFrame（世界指针逆旋转进局部系，rot=0 原样返回）；
 * - 旋转系选中框 / 控点：hitTestSelectionHandle 指针逆旋转后查局部矩形——
 *   旋转角点的世界位置命中对应角、AABB 旋外空白角不命中；
 * - 旋转手柄：hitTestRotationHandle 悬伸手柄位置（rot≠0 随框转动）、
 *   鼠标 / 触摸双半径（44px 等效口径）；三形状均有手柄（ZOO-223），
 *   其余类型恒无；
 * - renderSelection：rot≠0 时 translate(center)→rotate→restore 变换序
 *   （局部框 / 控点绘制）、rot=0 与其余类型零变换（逐像素等价）；
 * - 缩放适配：世界指针逆旋转进局部系喂 boxResizePatch——刚体变换下对角锚定
 *   保持（Canvas applyResize 路径的纯函数组合，等价复现）。
 */
import { describe, expect, it } from 'vitest';
import { CircleElement, DiamondElement, RectangleElement, TextElement, Viewport } from '../types';
import { hitTestSelectionHandle, hitTestRotationHandle, renderSelection } from '../renderer';
import { stepRotation, pointerToLocalFrame, rotatePointAround } from '../rotation';
import { boxResizePatch } from '../shapeResize';

const VP: Viewport = { offsetX: 0, offsetY: 0, scale: 1 };

const rect = (rotation?: number): RectangleElement => ({
  id: 'r1', type: 'rectangle', x: 100, y: 100, width: 200, height: 100,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
  ...(rotation !== undefined ? { rotation } : {}),
});

const circle = (): CircleElement => ({
  id: 'c1', type: 'circle', x: 0, y: 0, width: 50, height: 50,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

/** 世界点绕元素几何中心顺时针旋转 rad 后的世界位置（旋转矩形角点推导用） */
function worldAfterRotate(p: { x: number; y: number }, center: { x: number; y: number }, deg: number) {
  return rotatePointAround(p, center, (deg * Math.PI) / 180);
}

describe('stepRotation：Shift 15° 步进', () => {
  it('就近取整到 15° 网格', () => {
    expect(stepRotation(47)).toBeCloseTo(45);
    expect(stepRotation(8)).toBeCloseTo(15);
    expect(stepRotation(7)).toBeCloseTo(0);
    expect(stepRotation(-20)).toBeCloseTo(345);
  });

  it('跨 360 归一（不落 360）', () => {
    expect(stepRotation(352)).toBeCloseTo(345);
    expect(stepRotation(355)).toBeCloseTo(0);
  });

  it('步长可参数化', () => {
    expect(stepRotation(47, 45)).toBeCloseTo(45);
    expect(stepRotation(70, 45)).toBeCloseTo(90);
  });
});

describe('pointerToLocalFrame：世界指针 → 局部系', () => {
  const frame = { x: 100, y: 100, width: 200, height: 100 };
  const center = { x: 200, y: 150 };

  it('rot = 0 原样返回（与旧代码逐字节等价）', () => {
    const p = { x: 37, y: -11 };
    expect(pointerToLocalFrame(p, frame, 0)).toBe(p);
  });

  it('rot = 90：世界系中心右侧的点属于局部系上缘（刚体逆旋转）', () => {
    // 旋转 90° 后局部上缘转向世界右侧——世界 (center.x + d, center.y) 逆旋转
    // 回局部应为 (center.x, center.y - d)
    const local = pointerToLocalFrame({ x: center.x + 80, y: center.y }, frame, 90);
    expect(local.x).toBeCloseTo(center.x);
    expect(local.y).toBeCloseTo(center.y - 80);
  });

  it('正逆旋转互逆（任意角度往返还原）', () => {
    const p = { x: 173, y: 42 };
    const there = pointerToLocalFrame(p, frame, 37);
    const back = rotatePointAround(there, center, (37 * Math.PI) / 180);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
});

describe('hitTestSelectionHandle：旋转系控点命中', () => {
  it('旋转角点的世界位置命中对应局部角（45°）', () => {
    const el = rect(45);
    const center = { x: 200, y: 150 };
    // 局部 nw 角 (100,100) 顺时针转 45° 后的世界位置 → 命中 nw
    const nwWorld = worldAfterRotate({ x: 100, y: 100 }, center, 45);
    expect(hitTestSelectionHandle(el, nwWorld, VP)).toBe('nw');
    const seWorld = worldAfterRotate({ x: 300, y: 200 }, center, 45);
    expect(hitTestSelectionHandle(el, seWorld, VP)).toBe('se');
  });

  it('AABB 旋外空白角不命中（45°：AABB 角 ≠ 任一旋转角点）', () => {
    const el = rect(45);
    // AABB 左上角 ≈ (93.9, 43.9)——空白区，任何控点手柄都不在
    expect(hitTestSelectionHandle(el, { x: 96, y: 47 }, VP)).toBeNull();
  });

  it('rot = 0 命中与旧逻辑一致（局部即世界）', () => {
    expect(hitTestSelectionHandle(rect(), { x: 100, y: 100 }, VP)).toBe('nw');
    expect(hitTestSelectionHandle(rect(), { x: 304, y: 204 }, VP)).toBe('se');
  });

  it('触摸 margin 外扩在旋转系同样生效', () => {
    const el = rect(45);
    const nwWorld = worldAfterRotate({ x: 100, y: 100 }, { x: 200, y: 150 }, 45);
    const off = { x: nwWorld.x - 12, y: nwWorld.y };
    expect(hitTestSelectionHandle(el, off, VP)).toBeNull();
    expect(hitTestSelectionHandle(el, off, VP, { margin: 18 })).toBe('nw');
  });
});

describe('hitTestRotationHandle：旋转手柄命中', () => {
  // rot = 0：手柄圆心 = 选中框上缘中点 (200, 100-4) 再外移 20 + 6 → (200, 70)
  it('rot = 0：手柄在选中框上缘中点上方悬伸', () => {
    expect(hitTestRotationHandle(rect(), { x: 200, y: 70 }, VP)).toBe(true);
    expect(hitTestRotationHandle(rect(), { x: 200, y: 58 }, VP)).toBe(false); // 12px 外
  });

  it('rot ≠ 0：手柄随框转动（90° 转到中心右侧）', () => {
    // 局部手柄 (200,70) 绕中心 (200,150) 顺时针 90° → (280,150)
    expect(hitTestRotationHandle(rect(90), { x: 280, y: 150 }, VP)).toBe(true);
    // 未旋转的旧位置不再命中
    expect(hitTestRotationHandle(rect(90), { x: 200, y: 70 }, VP)).toBe(false);
  });

  it('触摸命中沿 ZOO-160 的 44px 等效口径（半径 22）', () => {
    expect(hitTestRotationHandle(rect(), { x: 200, y: 50 }, VP, { touch: true })).toBe(true); // 20px
    expect(hitTestRotationHandle(rect(), { x: 200, y: 50 }, VP)).toBe(false); // 鼠标 10px 半径外
    expect(hitTestRotationHandle(rect(), { x: 200, y: 47 }, VP, { touch: true })).toBe(false); // 23px
  });

  it('三形状均有旋转手柄（ZOO-223），其余类型恒 false', () => {
    // circle 外框 (0,0,50,50)：手柄圆心 = 上缘中点 (25,-4) 外移 26 → (25,-30)
    expect(hitTestRotationHandle(circle(), { x: 25, y: -30 }, VP)).toBe(true);
    const diamond: DiamondElement = {
      id: 'd1', type: 'diamond', x: 0, y: 0, width: 50, height: 50,
      strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
    };
    expect(hitTestRotationHandle(diamond, { x: 25, y: -30 }, VP)).toBe(true);
    // text 无旋转手柄：选中框上缘中点上方同位不命中
    const text: TextElement = {
      id: 't1', type: 'text', x: 0, y: 0, width: 50, height: 20, content: 'x',
      fontSize: 16, fontFamily: 'sans-serif', color: '#000000',
      strokeColor: '#000000', strokeWidth: 2, opacity: 1,
    };
    expect(hitTestRotationHandle(text, { x: 25, y: -30 }, VP)).toBe(false);
  });
});

describe('renderSelection：旋转系选中框变换序', () => {
  function fakeCtx() {
    const calls: { op: string; args: number[] }[] = [];
    const rec = (op: string) => (...args: number[]) => { calls.push({ op, args }); };
    const ctx = {
      save: rec('save'), restore: rec('restore'),
      translate: rec('translate'), rotate: rec('rotate'),
      strokeRect: rec('strokeRect'), fillRect: rec('fillRect'), setLineDash: rec('setLineDash'),
      beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'),
      arc: rec('arc'), stroke: rec('stroke'), fill: rec('fill'),
      strokeStyle: '', fillStyle: '', lineWidth: 0,
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }
  const ops = (calls: { op: string; args: number[] }[], op: string) => calls.filter((c) => c.op === op);

  it('rot ≠ 0：translate(center) → rotate(rad) → translate(-center) 变换序', () => {
    const { ctx, calls } = fakeCtx();
    renderSelection(ctx, rect(45), VP);
    const rotates = ops(calls, 'rotate');
    expect(rotates).toHaveLength(1);
    expect(rotates[0].args[0]).toBeCloseTo(Math.PI / 4);
    const translates = ops(calls, 'translate').map((c) => c.args);
    expect(translates).toContainEqual([200, 150]);   // 几何中心（屏幕系）
    expect(translates).toContainEqual([-200, -150]); // 回平移：局部坐标原样可用
  });

  it('rot = 0 / 非 rectangle：零旋转变换（逐像素等价）', () => {
    const a = fakeCtx();
    renderSelection(a.ctx, rect(), VP);
    expect(ops(a.calls, 'rotate')).toHaveLength(0);

    const b = fakeCtx();
    renderSelection(b.ctx, circle(), VP);
    expect(ops(b.calls, 'rotate')).toHaveLength(0);
  });

  it('三形状画旋转手柄（stem + 圆）（ZOO-223），rot=0 零旋转变换', () => {
    const a = fakeCtx();
    renderSelection(a.ctx, rect(), VP);
    // 手柄圆：arc 到 (200, 70)（rot=0 悬伸位）
    expect(ops(a.calls, 'arc').some((c) => c.args[0] === 200 && c.args[1] === 70)).toBe(true);

    // circle / diamond 同样画手柄（悬伸位 = 上缘中点上方），且不进旋转变换
    const b = fakeCtx();
    renderSelection(b.ctx, circle(), VP);
    expect(ops(b.calls, 'arc').some((c) => c.args[0] === 25 && c.args[1] === -30)).toBe(true);
    expect(ops(b.calls, 'rotate')).toHaveLength(0);

    const d = fakeCtx();
    const diamond: DiamondElement = {
      id: 'd1', type: 'diamond', x: 0, y: 0, width: 50, height: 50,
      strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
    };
    renderSelection(d.ctx, diamond, VP);
    expect(ops(d.calls, 'arc').some((c) => c.args[0] === 25 && c.args[1] === -30)).toBe(true);
    expect(ops(d.calls, 'rotate')).toHaveLength(0);
  });
});

describe('缩放适配：逆旋转指针喂 boxResizePatch（对角锚定保持）', () => {
  it('rot = 90 拖 se 角：世界指针进局部系后对角 (nw) 锚定不变', () => {
    const el = rect(90);
    const frame = { x: el.x, y: el.y, width: el.width, height: el.height };
    // 局部系远端 (350, 280)（se 方向）顺时针转 90° 后的世界位置 → (70, 300)
    const world = worldAfterRotate({ x: 350, y: 280 }, { x: 200, y: 150 }, 90);
    const local = pointerToLocalFrame(world, frame, 90);
    expect(local.x).toBeCloseTo(350);
    expect(local.y).toBeCloseTo(280);
    const patch = boxResizePatch('se', el, local);
    expect(patch.x).toBe(100);       // 对角 nw 锚定
    expect(patch.y).toBe(100);
    expect(patch.width).toBe(250);
    expect(patch.height).toBe(180);
  });

  it('rot = 0：指针原样喂入（既有语义零改动）', () => {
    const el = rect();
    const p = { x: 350, y: 280 };
    expect(pointerToLocalFrame(p, el, 0)).toBe(p);
    const patch = boxResizePatch('se', el, pointerToLocalFrame(p, el, 0));
    expect(patch).toEqual({ x: 100, y: 100, width: 250, height: 180 });
  });
});
