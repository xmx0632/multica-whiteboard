import { describe, it, expect } from 'vitest';
import { fullscreenSupported, fullscreenButtonMode } from '../fullscreen';

describe('fullscreenSupported（浏览器能力判定）', () => {
  it('进入 / 退出 API 双全可用才算支持', () => {
    expect(fullscreenSupported({ requestFullscreen: true, exitFullscreen: true })).toBe(true);
    expect(fullscreenSupported({ requestFullscreen: true, exitFullscreen: false })).toBe(false);
    expect(fullscreenSupported({ requestFullscreen: false, exitFullscreen: true })).toBe(false);
    expect(fullscreenSupported({ requestFullscreen: false, exitFullscreen: false })).toBe(false);
  });
});

describe('fullscreenButtonMode（全屏按钮四态）', () => {
  it('桌面（细指针）不显示', () => {
    expect(fullscreenButtonMode({ coarse: false, supported: true, fullscreen: false, landscape: false })).toBe('hidden');
    expect(fullscreenButtonMode({ coarse: false, supported: true, fullscreen: true, landscape: true })).toBe('hidden');
  });

  it('不支持元素全屏的浏览器（iOS Safari）不显示', () => {
    expect(fullscreenButtonMode({ coarse: true, supported: false, fullscreen: false, landscape: false })).toBe('hidden');
  });

  it('移动端竖屏非全屏 → 进入横屏全屏（附带方向锁）', () => {
    expect(fullscreenButtonMode({ coarse: true, supported: true, fullscreen: false, landscape: false })).toBe('enter-landscape');
  });

  it('移动端横屏非全屏 → 进入全屏', () => {
    expect(fullscreenButtonMode({ coarse: true, supported: true, fullscreen: false, landscape: true })).toBe('enter');
  });

  it('全屏中 → 退出全屏（与方向无关）', () => {
    expect(fullscreenButtonMode({ coarse: true, supported: true, fullscreen: true, landscape: false })).toBe('exit');
    expect(fullscreenButtonMode({ coarse: true, supported: true, fullscreen: true, landscape: true })).toBe('exit');
  });
});
