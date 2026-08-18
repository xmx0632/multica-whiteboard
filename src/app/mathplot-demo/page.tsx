'use client';

/**
 * MathPlot 出图演示路由（ZOO-135 / 4c 自测与评审入口，独立于主白板路由）。
 * 「选中方程 → 自动出图」全链路演示：输入 → 解析 → 矢量渲染 → 参数实时调整。
 * ZOO-136（4d）把 MathPlot 接入主画布后，本页保留作回归/演示入口。
 */
import MathPlotStage from '@/components/math/MathPlotStage';

export default function MathPlotDemoPage() {
  return <MathPlotStage />;
}
