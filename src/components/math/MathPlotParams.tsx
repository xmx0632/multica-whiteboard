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
import { useMemo } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { COLORS } from '@/lib/types';
import { validateEquation } from '@/lib/math/validate';
import {
  ellipseTeachingInfo,
  formatCoef,
  formatGeneralForm,
  hyperbolaTeachingInfo,
  linePairTeachingInfo,
  lineTeachingInfo,
  parabolaTeachingInfo,
  pointTeachingInfo,
} from '@/lib/math/conic';
import type {
  DegeneratePointParams,
  EllipseParams,
  HyperbolaParams,
  LineParams,
  LinePairParams,
  ParabolaParams,
} from '@/lib/math/types';

export interface MathPlotParamsValue {
  equation: string;
  kind: 'explicit' | 'line' | 'linePair' | 'point' | 'parabola' | 'hyperbola' | 'circle' | 'ellipse' | 'error';
  /** kind === 'error' 时的用户可读原因 */
  errorMessage?: string;
  /** kind === 'line' 时的一般式系数（调用方经 validateEquation 重解析填充，D7 教学参数） */
  lineParams?: LineParams;
  /** kind === 'linePair' 时的退化直线对参数（ZOO-148 教学参数） */
  linePairParams?: LinePairParams;
  /** kind === 'point' 时的退化单点参数（ZOO-148 教学参数） */
  pointParams?: DegeneratePointParams;
  /** kind === 'parabola' 时的探针参数（顶点/焦参数/开口轴，ZOO-147 教学参数） */
  parabolaParams?: ParabolaParams;
  /** kind === 'hyperbola' 时的探针参数（中心/半轴/实轴方向，ZOO-147 教学参数） */
  hyperbolaParams?: HyperbolaParams;
  /** kind === 'ellipse' 时的参数（中心/半轴/旋转角，ZOO-149 教学参数） */
  ellipseParams?: EllipseParams;
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
  /** 方程提交非法时的提示（ZOO-155：元素保持原值，仅提示不改错误占位） */
  equationError?: string | null;
}

/** 徽章资源键（ZOO-176 随语言），样式沿用基线。 */
const KIND_BADGE_KEYS: Record<MathPlotParamsValue['kind'], { key: string; cls: string }> = {
  explicit: { key: 'params.badgeExplicit', cls: 'bg-blue-50 text-blue-600' },
  line: { key: 'params.badgeLine', cls: 'bg-blue-50 text-blue-600' },
  linePair: { key: 'params.badgeLinePair', cls: 'bg-amber-50 text-amber-700' },
  point: { key: 'params.badgePoint', cls: 'bg-amber-50 text-amber-700' },
  parabola: { key: 'params.badgeParabola', cls: 'bg-blue-50 text-blue-600' },
  hyperbola: { key: 'params.badgeHyperbola', cls: 'bg-blue-50 text-blue-600' },
  circle: { key: 'params.badgeCircle', cls: 'bg-blue-50 text-blue-600' },
  ellipse: { key: 'params.badgeEllipse', cls: 'bg-blue-50 text-blue-600' },
  error: { key: 'params.badgeError', cls: 'bg-red-50 text-red-600' },
};

const PRESET_DOMAINS: { label: string; min: number; max: number }[] = [
  { label: '-2π~2π', min: -6.28, max: 6.28 },
  { label: '-5~5', min: -5, max: 5 },
  { label: '-10~10', min: -10, max: 10 },
];

/** 采样档位（ZOO-176：档位名资源键随语言）。 */
const SAMPLE_STEP_KEYS: { key: string; count: 160 | 320 | 640 }[] = [
  { key: 'params.sampleCoarse', count: 160 },
  { key: 'params.sampleMedium', count: 320 },
  { key: 'params.sampleFine', count: 640 },
];

export default function MathPlotParams({ value, onChange, onCommit, onDuplicate, onDelete, onRequestEdit, equationError }: MathPlotParamsProps) {
  const t = useT();
  const isFn = value.kind === 'explicit';
  const isError = value.kind === 'error';
  // ZOO-166 方案 A：自变量字母随方程显示（y=4z 的定义域是 z ∈；缺省 x）
  const variable = useMemo(() => {
    const r = validateEquation(value.equation, t);
    return r.kind === 'explicit' && r.variable ? r.variable : 'x';
  }, [value.equation, t]);
  const badge = KIND_BADGE_KEYS[value.kind];
  // ZOO-176：教学参数文案随语言（t 注入；line/point 的产出为纯数学记号，无需 t）
  const line = value.kind === 'line' && value.lineParams ? lineTeachingInfo(value.lineParams) : null;
  const linePair = value.kind === 'linePair' && value.linePairParams ? linePairTeachingInfo(value.linePairParams, t) : null;
  const degeneratePoint = value.kind === 'point' && value.pointParams ? pointTeachingInfo(value.pointParams) : null;
  const parabola = value.kind === 'parabola' && value.parabolaParams ? parabolaTeachingInfo(value.parabolaParams, t) : null;
  const hyperbola = value.kind === 'hyperbola' && value.hyperbolaParams ? hyperbolaTeachingInfo(value.hyperbolaParams, t) : null;
  const ellipse = value.kind === 'ellipse' && value.ellipseParams ? ellipseTeachingInfo(value.ellipseParams, t) : null;

  const patch = (p: Partial<MathPlotParamsValue>, commit = false) => {
    onChange(p);
    if (commit) onCommit?.();
  };

  return (
    <div className="touch-panel touch-side-panel absolute right-3 top-1/2 -translate-y-1/2 w-[264px] bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-3">
      <div className="text-[13px] font-semibold text-gray-700 flex items-center gap-1.5 pb-0.5">
        <span className="font-serif italic text-blue-500 text-base leading-none">ƒ</span>
        {t('params.title')}
        <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>{t(badge.key)}</span>
      </div>

      {isError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2">
          <div className="text-xs text-red-700 font-semibold">{t('params.errTitle')}</div>
          <div className="text-[11px] text-gray-400 my-1 break-all">{value.errorMessage || t('math.unrecognized')}</div>
          <button
            type="button"
            onClick={onRequestEdit}
            className="touch-target w-full py-1.5 border-none rounded-lg bg-blue-500 text-white text-[13px] font-semibold cursor-pointer hover:bg-[#2f7ae5] active:bg-[#2564c4] transition-colors"
          >
            {t('params.editBtn')}
          </button>
        </div>
      ) : (
        <>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">{t('params.eqLabel')}</label>
            <input
              value={value.equation}
              onChange={(e) => patch({ equation: e.target.value })}
              onKeyDown={(e) => {
                // ZOO-155：回车即时提交（随后 blur 再触发一次 onCommit，幂等无害）
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommit?.();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              onBlur={onCommit}
              autoComplete="off"
              spellCheck={false}
              className={`touch-target w-full px-2 py-1.5 border rounded-lg font-serif text-sm text-gray-900 outline-none bg-white select-text ${equationError ? 'border-red-400 focus:border-red-400' : 'border-gray-300 focus:border-blue-500'}`}
              aria-label={t('params.eqAria')}
            />
            {equationError && (
              <div className="text-[11px] text-red-500 mt-1 leading-relaxed break-all" role="alert">
                ⚠ {equationError}
                {t('params.eqErrorSuffix')}
              </div>
            )}
          </div>

          {isFn && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('params.domain', { v: variable })}</label>
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
                    aria-label={t('params.domainMin', { v: variable })}
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
                    aria-label={t('params.domainMax', { v: variable })}
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
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('params.sample')}</label>
                <div className="flex border border-gray-200 rounded-lg overflow-hidden">
                  {SAMPLE_STEP_KEYS.map((step) => (
                    <button
                      key={step.count}
                      type="button"
                      onClick={() => patch({ sampleCount: step.count }, true)}
                      className={`touch-target flex-1 border-none text-xs py-1.5 cursor-pointer transition-colors ${
                        value.sampleCount === step.count ? 'bg-blue-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {t(step.key)}
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
                    {t('params.lineVertical', { v: formatCoef(line.verticalX) })}
                  </div>
                ) : (
                  <div className="text-[11px] text-gray-500 leading-relaxed">
                    {t('params.lineSlope', { k: formatCoef(line.slope ?? 0) })}
                    {line.yIntercept !== null && t('params.lineYIntercept', { v: formatCoef(line.yIntercept) })}
                    {line.xIntercept !== null && t('params.lineXIntercept', { v: formatCoef(line.xIntercept) })}
                  </div>
                )
              ) : null}
            </div>
          )}

          {linePair && (
            <div className="bg-amber-50/60 border border-amber-100 rounded-lg p-2 flex flex-col gap-1">
              <div className="text-[13px] font-semibold text-amber-700">{t('params.degenerate', { label: linePair.label })}</div>
              {linePair.equations.map((eq, i) => (
                <div key={i} className="font-serif text-[13px] text-gray-800">
                  {eq}
                </div>
              ))}
              {linePair.detail && <div className="text-[11px] text-gray-500 leading-relaxed">{linePair.detail}</div>}
            </div>
          )}

          {degeneratePoint && (
            <div className="bg-amber-50/60 border border-amber-100 rounded-lg p-2 flex flex-col gap-1">
              <div className="text-[13px] font-semibold text-amber-700">{t('params.degeneratePoint')}</div>
              <div className="font-serif text-[13px] text-gray-800">{degeneratePoint.point}</div>
              <div className="text-[11px] text-gray-500 leading-relaxed">{t('params.uniqueSolution', { sol: degeneratePoint.solution })}</div>
            </div>
          )}

          {parabola && (
            <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-2 flex flex-col gap-1">
              <div className="font-serif text-[13px] text-gray-800">{parabola.standardForm}</div>
              <div className="text-[11px] text-gray-500 leading-relaxed">
                {t('params.parabolaVertexFocus', { v: parabola.vertex, f: parabola.focus })}
              </div>
              <div className="text-[11px] text-gray-500 leading-relaxed">
                {t('params.parabolaDirectrixOpening', { d: parabola.directrix, o: parabola.opening })}
              </div>
              {parabola.rotation && (
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  {t('params.rotationStd', { r: parabola.rotation })}
                </div>
              )}
            </div>
          )}

          {hyperbola && (
            <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-2 flex flex-col gap-1">
              <div className="font-serif text-[13px] text-gray-800">{hyperbola.standardForm}</div>
              <div className="text-[11px] text-gray-500 leading-relaxed">
                {t('params.centerAxes', { c: hyperbola.center, axes: hyperbola.axes })}
              </div>
              <div className="text-[11px] text-gray-500 leading-relaxed">{t('params.foci', { f: hyperbola.foci })}</div>
              <div className="text-[11px] text-gray-500 leading-relaxed">{t('params.asymptotes', { a: hyperbola.asymptotes })}</div>
              <div className="text-[11px] text-gray-500 leading-relaxed">
                {t('params.directricesEcc', { d: hyperbola.directrices, e: formatCoef(Number(hyperbola.eccentricity)) })}
              </div>
              {hyperbola.rotation && (
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  {t('params.rotationHyperbola', { r: hyperbola.rotation })}
                </div>
              )}
            </div>
          )}

          {ellipse ? (
            <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-2 flex flex-col gap-1">
              <div className="font-serif text-[13px] text-gray-800">{ellipse.standardForm}</div>
              <div className="text-[11px] text-gray-500 leading-relaxed">
                {t('params.centerAxes', { c: ellipse.center, axes: ellipse.axes })}
              </div>
              <div className="text-[11px] text-gray-500 leading-relaxed">{t('params.foci', { f: ellipse.foci })}</div>
              <div className="text-[11px] text-gray-500 leading-relaxed">{t('params.eccentricity', { e: formatCoef(Number(ellipse.eccentricity)) })}</div>
              {ellipse.rotation && (
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  {t('params.rotationEllipse', { r: ellipse.rotation })}
                </div>
              )}
            </div>
          ) : value.kind === 'circle' ? (
            <div className="text-[11px] text-gray-400 leading-relaxed">{t('params.circleNote')}</div>
          ) : null}

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">{t('params.coordSys')}</label>
            <div className="flex flex-wrap gap-x-2.5 gap-y-1">
              <label className="touch-target text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={value.showAxis} onChange={(e) => patch({ showAxis: e.target.checked }, true)} className="accent-blue-500" />
                {t('params.showAxis')}
              </label>
              <label className="touch-target text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={value.showGrid} onChange={(e) => patch({ showGrid: e.target.checked }, true)} className="accent-blue-500" />
                {t('params.showGrid')}
              </label>
              <label className="touch-target text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={value.showLabel} onChange={(e) => patch({ showLabel: e.target.checked }, true)} className="accent-blue-500" />
                {t('params.showLabel')}
              </label>
              {isFn && (
                <label className="touch-target text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={value.equalRatio}
                    onChange={(e) => patch({ equalRatio: e.target.checked }, true)}
                    className="accent-blue-500"
                  />
                  {t('params.equalRatio')}
                </label>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">{t('params.strokeColor')}</label>
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
                aria-label={t('params.customColorAria')}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">{t('params.strokeWidth', { n: value.strokeWidth })}</label>
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
            <label className="text-xs font-medium text-gray-500 mb-1 block">{t('params.opacity', { n: Math.round(value.opacity * 100) })}</label>
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
          {t('params.duplicate')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="touch-target py-1.5 px-3.5 border border-red-200 rounded-lg bg-white text-red-600 text-xs cursor-pointer hover:bg-red-50 active:bg-red-100 transition-colors"
        >
          {t('params.delete')}
        </button>
      </div>

      <div className="text-[11px] text-gray-400 leading-relaxed">{t('params.hint')}</div>
    </div>
  );
}
