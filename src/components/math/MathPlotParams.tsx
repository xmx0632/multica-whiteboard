'use client';

/**
 * MathPlot 元素参数面板（骨架，ZOO-133 交付 / ZOO-136 接线）。
 *
 * 受控组件：参数由 value 注入、变更经 onChange(patch) 上抛 —— 4d 集成时映射到
 * MathPlotElement（技术方案 §5.1 字段）与 updateElement / updateElementTransient。
 * 历史语义（技术方案 D5 两段式）：滑杆拖动触发 onChange（直改实时预览），
 * 松手/失焦触发 onCommit（压一条快照）；离散控件（色板/开关/预设）一次
 * onChange + onCommit。错误态走「重新编辑方程」回调（原位替换，原型决策）。
 */
import { COLORS } from '@/lib/types';
import { formatCoef, formatGeneralForm, lineTeachingInfo } from '@/lib/math/conic';
import type { LineParams } from '@/lib/math/types';

export interface MathPlotParamsValue {
  equation: string;
  kind: 'explicit' | 'line' | 'circle' | 'ellipse' | 'error';
  /** kind === 'error' 时的用户可读原因 */
  errorMessage?: string;
  /** kind === 'line' 时的一般式系数（调用方经 validateEquation 重解析填充，D7 教学参数） */
  lineParams?: LineParams;
  /** 定义域（数学单位），仅显式函数可调 */
  xAxis: { min: number; max: number };
  sampleCount: 160 | 320 | 640;
  /** x/y 单位等比；圆/椭圆强制 true（隐藏开关） */
  equalRatio: boolean;
  showAxis: boolean;
  showGrid: boolean;
  showLabel: boolean;
  strokeColor: string;
  /** 1–8，步进 0.5 */
  strokeWidth: number;
  /** 0.2–1 */
  opacity: number;
}

export interface MathPlotParamsProps {
  value: MathPlotParamsValue;
  /** 参数补丁上抛（实时重绘用） */
  onChange: (patch: Partial<MathPlotParamsValue>) => void;
  /** 一次可撤销操作的边界（滑杆松手 / 离散变更后） */
  onCommit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** 错误态「重新编辑方程」（载入编辑器原位替换） */
  onRequestEdit?: () => void;
}

const KIND_BADGES: Record<MathPlotParamsValue['kind'], { label: string; cls: string }> = {
  explicit: { label: '显式函数', cls: 'bg-blue-50 text-blue-600' },
  line: { label: '直线 · 几何', cls: 'bg-blue-50 text-blue-600' },
  circle: { label: '圆 · 几何', cls: 'bg-blue-50 text-blue-600' },
  ellipse: { label: '椭圆 · 几何', cls: 'bg-blue-50 text-blue-600' },
  error: { label: '解析失败', cls: 'bg-red-50 text-red-600' },
};

const PRESET_DOMAINS: { label: string; min: number; max: number }[] = [
  { label: '-2π~2π', min: -6.28, max: 6.28 },
  { label: '-5~5', min: -5, max: 5 },
  { label: '-10~10', min: -10, max: 10 },
];

const SAMPLE_STEPS: { label: string; count: 160 | 320 | 640 }[] = [
  { label: '粗', count: 160 },
  { label: '中', count: 320 },
  { label: '细', count: 640 },
];

export default function MathPlotParams({ value, onChange, onCommit, onDuplicate, onDelete, onRequestEdit }: MathPlotParamsProps) {
  const isFn = value.kind === 'explicit';
  const isError = value.kind === 'error';
  const badge = KIND_BADGES[value.kind];
  const line = value.kind === 'line' && value.lineParams ? lineTeachingInfo(value.lineParams) : null;

  const patch = (p: Partial<MathPlotParamsValue>, commit = false) => {
    onChange(p);
    if (commit) onCommit?.();
  };

  return (
    <div className="touch-panel absolute right-3 top-1/2 -translate-y-1/2 w-[264px] bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-3">
      <div className="text-[13px] font-semibold text-gray-700 flex items-center gap-1.5 pb-0.5">
        <span className="font-serif italic text-blue-500 text-base leading-none">ƒ</span>
        数学图形
        <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>{badge.label}</span>
      </div>

      {isError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2">
          <div className="text-xs text-red-700 font-semibold">⚠ 无法识别的方程</div>
          <div className="text-[11px] text-gray-400 my-1 break-all">{value.errorMessage || '无法识别的方程'}</div>
          <button
            type="button"
            onClick={onRequestEdit}
            className="touch-target w-full py-1.5 border-none rounded-lg bg-blue-500 text-white text-[13px] font-semibold cursor-pointer hover:bg-[#2f7ae5] active:bg-[#2564c4] transition-colors"
          >
            重新编辑方程
          </button>
        </div>
      ) : (
        <>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">方程</label>
            <input
              value={value.equation}
              onChange={(e) => patch({ equation: e.target.value })}
              onBlur={onCommit}
              autoComplete="off"
              spellCheck={false}
              className="touch-target w-full px-2 py-1.5 border border-gray-300 rounded-lg font-serif text-sm text-gray-900 outline-none bg-white select-text focus:border-blue-500"
              aria-label="方程"
            />
          </div>

          {isFn && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">定义域 x ∈</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step={0.5}
                    value={value.xAxis.min}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v)) patch({ xAxis: { ...value.xAxis, min: v } });
                    }}
                    onBlur={onCommit}
                    className="touch-target w-full px-1.5 py-1 border border-gray-300 rounded-md text-xs outline-none select-text focus:border-blue-500"
                    aria-label="x 最小值"
                  />
                  <span className="text-gray-400">~</span>
                  <input
                    type="number"
                    step={0.5}
                    value={value.xAxis.max}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v)) patch({ xAxis: { ...value.xAxis, max: v } });
                    }}
                    onBlur={onCommit}
                    className="touch-target w-full px-1.5 py-1 border border-gray-300 rounded-md text-xs outline-none select-text focus:border-blue-500"
                    aria-label="x 最大值"
                  />
                </div>
                <div className="flex gap-1 mt-1">
                  {PRESET_DOMAINS.map((p) => {
                    const active = Math.abs(value.xAxis.min - p.min) < 0.01 && Math.abs(value.xAxis.max - p.max) < 0.01;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => patch({ xAxis: { min: p.min, max: p.max } }, true)}
                        className={`touch-target flex-1 border rounded-md font-serif text-[10px] py-1 cursor-pointer transition-colors ${
                          active ? 'border-blue-500 text-blue-500' : 'border-gray-200 bg-white text-gray-500 hover:border-blue-500 hover:text-blue-500'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">采样精度</label>
                <div className="flex border border-gray-200 rounded-lg overflow-hidden">
                  {SAMPLE_STEPS.map((s) => (
                    <button
                      key={s.count}
                      type="button"
                      onClick={() => patch({ sampleCount: s.count }, true)}
                      className={`touch-target flex-1 border-none text-xs py-1.5 cursor-pointer transition-colors ${
                        value.sampleCount === s.count ? 'bg-blue-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {value.kind === 'line' && value.lineParams && (
            <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-2 flex flex-col gap-1">
              <div className="font-serif text-[13px] text-gray-800">{formatGeneralForm(value.lineParams)}</div>
              {line ? (
                line.verticalX !== null ? (
                  <div className="text-[11px] text-gray-500 leading-relaxed">
                    竖直直线：斜率不存在，x 轴截距 = {formatCoef(line.verticalX)}
                  </div>
                ) : (
                  <div className="text-[11px] text-gray-500 leading-relaxed">
                    斜率 k = {formatCoef(line.slope ?? 0)}
                    {line.yIntercept !== null && <> · y 轴截距 = {formatCoef(line.yIntercept)}</>}
                    {line.xIntercept !== null && <> · x 轴截距 = {formatCoef(line.xIntercept)}</>}
                  </div>
                )
              ) : null}
            </div>
          )}

          {(value.kind === 'circle' || value.kind === 'ellipse') && (
            <div className="text-[11px] text-gray-400 leading-relaxed">几何方程按参数化精确绘制，自动等比坐标（1:1）。</div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">坐标系</label>
            <div className="flex flex-wrap gap-x-2.5 gap-y-1">
              <label className="touch-target text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={value.showAxis} onChange={(e) => patch({ showAxis: e.target.checked }, true)} className="accent-blue-500" />
                坐标轴
              </label>
              <label className="touch-target text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={value.showGrid} onChange={(e) => patch({ showGrid: e.target.checked }, true)} className="accent-blue-500" />
                网格
              </label>
              <label className="touch-target text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={value.showLabel} onChange={(e) => patch({ showLabel: e.target.checked }, true)} className="accent-blue-500" />
                方程标签
              </label>
              {isFn && (
                <label className="touch-target text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={value.equalRatio}
                    onChange={(e) => patch({ equalRatio: e.target.checked }, true)}
                    className="accent-blue-500"
                  />
                  等比 1:1
                </label>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">线条颜色</label>
            <div className="flex flex-wrap gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => patch({ strokeColor: c }, true)}
                  className={`touch-swatch w-5 h-5 rounded-full border-2 ${value.strokeColor === c ? 'border-blue-500 scale-110' : 'border-gray-300'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={value.strokeColor}
                onChange={(e) => patch({ strokeColor: e.target.value }, true)}
                className="touch-swatch w-5 h-5 rounded cursor-pointer border border-gray-300"
                aria-label="自定义颜色"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">线宽：{value.strokeWidth}px</label>
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={value.strokeWidth}
              onChange={(e) => patch({ strokeWidth: Number(e.target.value) })}
              onPointerUp={onCommit}
              onKeyUp={onCommit}
              className="touch-target w-full accent-blue-500"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">不透明度：{Math.round(value.opacity * 100)}%</label>
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round(value.opacity * 100)}
              onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
              onPointerUp={onCommit}
              onKeyUp={onCommit}
              className="touch-target w-full accent-blue-500"
            />
          </div>
        </>
      )}

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onDuplicate}
          className="touch-target flex-1 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-500 text-xs cursor-pointer hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >
          复制
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="touch-target py-1.5 px-3.5 border border-red-200 rounded-lg bg-white text-red-600 text-xs cursor-pointer hover:bg-red-50 active:bg-red-100 transition-colors"
        >
          删除
        </button>
      </div>

      <div className="text-[11px] text-gray-400 leading-relaxed">修改参数实时重绘；移动 / 缩放 / 删除均可用 Ctrl+Z 撤销。</div>
    </div>
  );
}
