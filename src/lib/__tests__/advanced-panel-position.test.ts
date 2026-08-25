import { describe, it, expect, beforeEach } from 'vitest';
import {
  clampPanelPosition,
  dragPanelPosition,
  getAdvancedPanelPosition,
  setAdvancedPanelPosition,
  resetAdvancedPanelPosition,
} from '../advancedPanelPosition';

/** ZOO-224：高级公式面板拖拽位置——边缘 clamp 纯函数 + 会话级位置记忆 */
describe('advancedPanelPosition（面板拖拽位置）', () => {
  beforeEach(() => {
    resetAdvancedPanelPosition();
  });

  describe('clampPanelPosition（边缘 clamp）', () => {
    const panel = { width: 340, height: 500 };
    const viewport = { width: 1280, height: 800 };

    it('视口内的位置原样保留（含贴边）', () => {
      expect(clampPanelPosition({ x: 100, y: 80 }, panel, viewport)).toEqual({ x: 100, y: 80 });
      expect(clampPanelPosition({ x: 0, y: 0 }, panel, viewport)).toEqual({ x: 0, y: 0 });
      // 右/下贴边（面板右缘 = 视口右缘）合法
      expect(clampPanelPosition({ x: 940, y: 300 }, panel, viewport)).toEqual({ x: 940, y: 300 });
    });

    it('越界位置拉回视口内（四向独立夹取）', () => {
      expect(clampPanelPosition({ x: -50, y: 80 }, panel, viewport)).toEqual({ x: 0, y: 80 });
      expect(clampPanelPosition({ x: 100, y: -30 }, panel, viewport)).toEqual({ x: 100, y: 0 });
      expect(clampPanelPosition({ x: 1200, y: 80 }, panel, viewport)).toEqual({ x: 940, y: 80 });
      expect(clampPanelPosition({ x: 100, y: 790 }, panel, viewport)).toEqual({ x: 100, y: 300 });
    });

    it('视口装不下面板时该维夹到 0——左上角（把手）始终可见，找不回不来不可能发生', () => {
      // 手机竖屏：340px 面板宽 > 320px 视口宽
      expect(clampPanelPosition({ x: 200, y: 50 }, panel, { width: 320, height: 800 })).toEqual({ x: 0, y: 50 });
      // 高度同理（max-h-75vh 通常兜住，防御极端视口）
      expect(clampPanelPosition({ x: 10, y: 400 }, panel, { width: 1280, height: 400 })).toEqual({ x: 10, y: 0 });
    });
  });

  describe('dragPanelPosition（拖拽一步）', () => {
    const panel = { width: 340, height: 500 };
    const viewport = { width: 1280, height: 800 };
    const start = { x: 300, y: 200 };

    it('位移 1:1 跟手（不缩放）', () => {
      expect(dragPanelPosition(start, 100, -40, panel, viewport)).toEqual({ x: 400, y: 160 });
      expect(dragPanelPosition(start, -280, 590, panel, viewport)).toEqual({ x: 20, y: 790 - 500 + 10 });
    });

    it('拖出视口的位移被 clamp 截住（贴边滑，不回弹）', () => {
      // 向左拖 1000px：面板停在左缘，y 仍跟手
      expect(dragPanelPosition(start, -1000, 33, panel, viewport)).toEqual({ x: 0, y: 233 });
      // 向右下猛拖：右缘 940 / 下缘 300
      expect(dragPanelPosition(start, 5000, 5000, panel, viewport)).toEqual({ x: 940, y: 300 });
    });

    it('零位移返回原位（点击标题栏不动不算拖）', () => {
      expect(dragPanelPosition(start, 0, 0, panel, viewport)).toEqual(start);
    });
  });

  describe('会话位置记忆（模块单例）', () => {
    it('缺省 null（从未拖过 = 自动居中），写入后可读回', () => {
      expect(getAdvancedPanelPosition()).toBeNull();
      setAdvancedPanelPosition({ x: 940, y: 0 });
      expect(getAdvancedPanelPosition()).toEqual({ x: 940, y: 0 });
      // 后写覆盖先写（resize 拉回后的新位置即为最新事实）
      setAdvancedPanelPosition({ x: 0, y: 300 });
      expect(getAdvancedPanelPosition()).toEqual({ x: 0, y: 300 });
    });

    it('reset 清回 null（单测隔离口径，模拟页面刷新回默认居中）', () => {
      setAdvancedPanelPosition({ x: 100, y: 100 });
      resetAdvancedPanelPosition();
      expect(getAdvancedPanelPosition()).toBeNull();
    });

    it('写 null 显式回落自动居中', () => {
      setAdvancedPanelPosition({ x: 100, y: 100 });
      setAdvancedPanelPosition(null);
      expect(getAdvancedPanelPosition()).toBeNull();
    });
  });
});
