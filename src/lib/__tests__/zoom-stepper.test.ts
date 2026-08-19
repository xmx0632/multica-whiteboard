import { describe, it, expect } from 'vitest';
import {
  MIN_SCALE,
  MAX_SCALE,
  zoomAt,
  zoomPercentage,
  stepZoomScale,
  MIN_ZOOM_PERCENT,
  MAX_ZOOM_PERCENT,
} from '../gestures';

describe('zoomPercentage（scale → 整数百分比读数）', () => {
  it('三通道共用读数：整数百分比展示', () => {
    expect(zoomPercentage(1)).toBe(100);
    expect(zoomPercentage(1.3)).toBe(130);
    expect(zoomPercentage(0.1)).toBe(10);
    expect(zoomPercentage(5)).toBe(500);
  });
  it('wheel/捏合残留小数 scale 四舍五入到整数档', () => {
    expect(zoomPercentage(0.9994)).toBe(100);
    expect(zoomPercentage(1.234)).toBe(123);
    expect(zoomPercentage(4.996)).toBe(500);
  });
  it('先夹取再取整——越界 scale 读数落在边界内', () => {
    expect(zoomPercentage(99)).toBe(500);
    expect(zoomPercentage(0.001)).toBe(10);
  });
});

describe('stepZoomScale（步进器档位，ZOO-161）', () => {
  it('PM 验收链：100% 点 + 三次 → 130%，点 − 逐级回落', () => {
    let scale = 1;
    scale = stepZoomScale(scale, 1);
    expect(zoomPercentage(scale)).toBe(110);
    scale = stepZoomScale(scale, 1);
    expect(zoomPercentage(scale)).toBe(120);
    scale = stepZoomScale(scale, 1);
    expect(zoomPercentage(scale)).toBe(130);
    scale = stepZoomScale(scale, -1);
    expect(zoomPercentage(scale)).toBe(120);
  });

  it('常规档 ±10%，Shift 微调 ±1%（fine）', () => {
    expect(zoomPercentage(stepZoomScale(1, 1))).toBe(110);
    expect(zoomPercentage(stepZoomScale(1, 1, true))).toBe(101);
    expect(zoomPercentage(stepZoomScale(1.5, -1))).toBe(140);
    expect(zoomPercentage(stepZoomScale(1.5, -1, true))).toBe(149);
  });

  it('从残留小数档步进先取整——步进通道永远落在整数档', () => {
    // wheel 缩放后 scale = 1.234（读数 123%），+10 → 133%
    expect(zoomPercentage(stepZoomScale(1.234, 1))).toBe(133);
    expect(zoomPercentage(stepZoomScale(1.234, -1))).toBe(113);
  });

  it('上界 500%：越界夹取，边界步进为空操作（按钮侧禁用态）', () => {
    expect(zoomPercentage(stepZoomScale(5, 1))).toBe(500);
    expect(zoomPercentage(stepZoomScale(4.95, 1))).toBe(500);
    // 499% + 10% 夹到 500%，不越界
    expect(zoomPercentage(stepZoomScale(4.99, 1))).toBe(500);
  });

  it('下界 10%：越界夹取，边界步进为空操作', () => {
    expect(zoomPercentage(stepZoomScale(0.1, -1))).toBe(10);
    expect(zoomPercentage(stepZoomScale(0.15, -1))).toBe(10);
    // 11% − 10% 夹到 10%，不越界
    expect(zoomPercentage(stepZoomScale(0.11, -1))).toBe(10);
  });

  it('微调在边界同样夹取', () => {
    expect(zoomPercentage(stepZoomScale(5, 1, true))).toBe(500);
    expect(zoomPercentage(stepZoomScale(0.1, -1, true))).toBe(10);
  });
});

describe('步进器与缩放通道的协同（锚定/夹取一致性）', () => {
  it('百分比边界常量与 MIN_SCALE / MAX_SCALE 对齐', () => {
    expect(MIN_ZOOM_PERCENT).toBe(Math.round(MIN_SCALE * 100));
    expect(MAX_ZOOM_PERCENT).toBe(Math.round(MAX_SCALE * 100));
    expect(MIN_ZOOM_PERCENT).toBe(10);
    expect(MAX_ZOOM_PERCENT).toBe(500);
  });

  it('步进产出的 scale 直接可喂给 zoomAt（滑杆/步进器共用锚定通道）', () => {
    const vp = { offsetX: 100, offsetY: 80, scale: 1 };
    const next = stepZoomScale(1, 1); // 1.1
    const zipped = zoomAt(vp, { x: 400, y: 300 }, next);
    expect(zipped.scale).toBeCloseTo(1.1, 10);
    // anchor 下的世界点缩放后不动
    const wxBefore = (400 - vp.offsetX) / vp.scale;
    const wxAfter = (400 - zipped.offsetX) / zipped.scale;
    expect(wxAfter).toBeCloseTo(wxBefore, 8);
  });

  it('zoomPercentage(stepZoomScale(x)) 循环稳定——读数即下一档输入', () => {
    // 连点 50 次 + 不越过 500%，且每一步读数都是 10 的倍数（自 100% 起）
    let scale = 1;
    for (let i = 0; i < 50; i++) scale = stepZoomScale(scale, 1);
    expect(zoomPercentage(scale)).toBe(500);
  });
});
