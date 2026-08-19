import { describe, it, expect } from 'vitest';
import {
  isPhonePortrait,
  phonePortraitMediaQuery,
  immersiveToggleMode,
  PHONE_PORTRAIT_MAX_WIDTH,
} from '../portrait';
import { isPhoneLandscape, phoneLandscapeMediaQuery } from '../landscape';

describe('isPhonePortrait（ZOO-156 手机竖屏判定）', () => {
  it('手机竖屏（320×568 / 390×844 / 430×932）判定为 true', () => {
    expect(isPhonePortrait({ width: 320, height: 568, coarsePointer: true })).toBe(true);
    expect(isPhonePortrait({ width: 390, height: 844, coarsePointer: true })).toBe(true);
    expect(isPhonePortrait({ width: 430, height: 932, coarsePointer: true })).toBe(true);
  });

  it('手机横屏判定为 false', () => {
    expect(isPhonePortrait({ width: 844, height: 390, coarsePointer: true })).toBe(false);
    expect(isPhonePortrait({ width: 568, height: 320, coarsePointer: true })).toBe(false);
  });

  it('平板竖屏（宽度超上限）判定为 false', () => {
    expect(isPhonePortrait({ width: 768, height: 1024, coarsePointer: true })).toBe(false);
    expect(isPhonePortrait({ width: 834, height: 1194, coarsePointer: true })).toBe(false);
  });

  it('桌面（细指针）即使尺寸满足也判定为 false', () => {
    expect(isPhonePortrait({ width: 390, height: 844, coarsePointer: false })).toBe(false);
    expect(isPhonePortrait({ width: 800, height: 1280, coarsePointer: false })).toBe(false);
  });

  it('宽度边界：等于上限为 true，超过 1px 为 false', () => {
    expect(isPhonePortrait({ width: PHONE_PORTRAIT_MAX_WIDTH, height: 900, coarsePointer: true })).toBe(true);
    expect(isPhonePortrait({ width: PHONE_PORTRAIT_MAX_WIDTH + 1, height: 900, coarsePointer: true })).toBe(false);
  });

  it('正方形视口（宽 === 高）不算竖屏', () => {
    expect(isPhonePortrait({ width: 500, height: 500, coarsePointer: true })).toBe(false);
  });

  it('与 isPhoneLandscape 互斥：同一 metrics 不可能同时成立', () => {
    const viewports: [number, number][] = [
      [320, 568], [568, 320], [390, 844], [844, 390],
      [430, 932], [932, 430], [500, 500], [768, 1024], [1024, 768],
    ];
    for (const [width, height] of viewports) {
      const metrics = { width, height, coarsePointer: true };
      expect(isPhonePortrait(metrics) && isPhoneLandscape(metrics)).toBe(false);
    }
  });
});

describe('phonePortraitMediaQuery（与 CSS / 判定函数同阈值）', () => {
  it('包含粗指针、纵向与宽度上限三个条件', () => {
    const q = phonePortraitMediaQuery();
    expect(q).toContain('(pointer: coarse)');
    expect(q).toContain('(orientation: portrait)');
    expect(q).toContain(`(max-width: ${PHONE_PORTRAIT_MAX_WIDTH}px)`);
  });

  it('与横屏媒体查询互补：orientation 相反（横屏限高 / 竖屏限宽）', () => {
    expect(phoneLandscapeMediaQuery()).toContain('(orientation: landscape)');
    expect(phoneLandscapeMediaQuery()).toContain('(max-height:');
    expect(phonePortraitMediaQuery()).toContain('(orientation: portrait)');
    expect(phonePortraitMediaQuery()).toContain('(max-width:');
  });
});

describe('immersiveToggleMode（沉浸模式切换钮三态）', () => {
  it('非竖屏（桌面 / 横屏）一律隐藏', () => {
    expect(immersiveToggleMode(false, false)).toBe('hidden');
    expect(immersiveToggleMode(false, true)).toBe('hidden');
  });

  it('竖屏非沉浸 → 进入；沉浸中 → 唤回', () => {
    expect(immersiveToggleMode(true, false)).toBe('enter');
    expect(immersiveToggleMode(true, true)).toBe('exit');
  });
});
