'use client';

/**
 * MathPlot 元素参数面板（骨架，ZOO-133 交付 / ZOO-136 接线）。
 *
 * 受控组件：参数由 value 注入、变更经 onChange(patch) 上抛 —— 4d 集成时映射到
 * MathPlotElement（技术方案 §5.1 字段）与 updateElement / updateElementTransient。
 * 历史语义（技术方案 D5 两段式）：滑杆拖动触发 onChange（直改实时预览），
 * 松手/失焦触发 onCommit（压一条快照）；离散控件（色板/开关/预设）一次
 * onChange + onCommit。错误态走「重新编辑方程」回调（原位替换，原型决策）。
 *
 * ZOO-194 入口 2（编辑侧）：仅当 value.advanced 存在（元素带 overlays /
 * constants / 新 kind，PropertyPanel 经 advancedFormulaState 派生）时渲染
 * 紧凑「公式设置」按钮（带已开启叠加徽标数），点开高级公式二级面板；
 * 普通元素不出现任何新控件，面板与现状逐像素一致。开合为纯 UI 态。
 * ZOO-192（T5 物理模板）：物理区直连元素——标注开关读写 overlays 的 physics
 * 条目；模板点选整包回填（方程 / 常量 / t 域〔xAxis〕/ 标注），一次离散提交。
 */
import { useMemo, useState, type ReactNode } from 'react';
import AdvancedFormulaPanel from './AdvancedFormulaPanel';
import { useT } from '@/i18n/I18nProvider';
import { COLORS } from '@/lib/types';
import { constantDisplayName } from '@/lib/math/normalize';
import type { DraggablePoint } from '@/lib/math/types';
import type { PhysicsTemplate } from '@/lib/math/templates';
import { validateEquation } from '@/lib/math/validate';
import type { ConstantSliderMap } from '@/lib/math/slider';
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
  MathPlotOverlay,
  ParabolaParams,
} from '@/lib/math/types';

export interface MathPlotParamsValue {
  equation: string;
  /** ZOO-191（T4）：parametric / polar——xAxis 复用为参数 t/θ 域、equalRatio 强制 true */
  kind: 'explicit' | 'line' | 'linePair' | 'point' | 'parabola' | 'hyperbola' | 'circle' | 'ellipse' | 'parametric' | 'polar' | 'error';
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
  /**
   * ZOO-194 T0 预留：高级公式入口信号（面板派生字段，元素不落盘——
   * PropertyPanel 由元素经 advancedFormulaState 派生）。
   * 缺省（普通元素）不渲染「公式设置」按钮；T1 constants / T2 overlays /
   * T4 新 kind 上线后由调用方透传点亮。
   */
  advanced?: {
    /** 已开启叠加数（入口徽标；非 overlays 信号为 0） */
    overlayCount: number;
  };
  /**
   * 符号常量绑定（ZOO-188 T1）：元素真实字段（非派生，落元素数据）——
   * 高级公式面板常量区直改（onChange 直改实时重绘 / onBlur 提交一条，D5）。
   * 键为存储层 ASCII 名，显示层经 constantDisplayName 还原（θ/ω/φ/v₀）。
   */
  constants?: Record<string, number>;
  /**
   * 常量滑块元数据（ZOO-197）：元素真实字段——高级公式面板常量区滑杆范围 /
   * 步长编辑与播放直改（onChange 直改实时生效 / 离散变更 onCommit 提交一条）。
   * 仅存自定义条目，缺省常量回落 DEFAULT_SLIDER。
   */
  constantSliders?: ConstantSliderMap;
  /**
   * 可拖点（ZOO-201）：元素真实字段——高级公式面板常量区增删（离散变更一次
   * 提交一条）；画布拖动经 Canvas 直改常量（点位由常量派生，本字段只在
   * 增删 / 清洗时变化）。仅显式函数元素渲染 / 命中。
   */
  draggablePoints?: DraggablePoint[];
  /**
   * 微积分叠加（ZOO-189 T2）：元素真实字段（f′ 叠加 / 切线 x₀）——高级公式
   * 面板微积分区直改；清空全部叠加时归一为 undefined（元素不留空壳字段）。
   */
  overlays?: MathPlotOverlay[];
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
  /** 图层顺序操作组插槽（ZOO-183：mathPlot 与其他元素一视同仁；由调用方注入自取 store 的 ArrangeGroup） */
  layerControls?: ReactNode;
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
  parametric: { key: 'params.badgeParametric', cls: 'bg-blue-50 text-blue-600' },
  polar: { key: 'params.badgePolar', cls: 'bg-blue-50 text-blue-600' },
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

export default function MathPlotParams({ value, onChange, onCommit, onDuplicate, onDelete, onRequestEdit, equationError, layerControls }: MathPlotParamsProps) {
  const t = useT();
  // ZOO-194：高级公式面板开合（纯 UI 态，不入元素数据、不入撤销历史）
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isFn = value.kind === 'explicit';
  // ZOO-191（T4）：参数式 / 极坐标——定义域（t/θ 域）与采样档位控件同样开放
  const isParam = value.kind === 'parametric' || value.kind === 'polar';
  const isError = value.kind === 'error';
  // ZOO-166 方案 A：自变量字母随方程显示（y=4z 的定义域是 z ∈；缺省 x）。
  // ZOO-188：常量参与裁决——y=A·sin(ωx+φ) 绑定常量后自变量解析为 x。
  // ZOO-191（T4）：参数式按实际参数字母（缺省 t）；极坐标缺省显示 θ（theta 经
  // constantDisplayName 还原原貌）
  const variable = useMemo(() => {
    const r = validateEquation(value.equation, t, value.constants);
    if (r.kind === 'explicit') return r.variable ?? 'x';
    if (r.kind === 'parametric') return r.variable ?? 't';
    if (r.kind === 'polar') return constantDisplayName(r.variable ?? 'theta');
    return 'x';
  }, [value.equation, value.constants, t]);
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

          {/* ZOO-194 入口 2（编辑侧）：仅高级元素（overlays/constants/新 kind）渲染，
              普通元素不出现任何新控件（value.advanced 缺省即不渲染） */}
          {value.advanced && (
            <button
              type="button"
              onClick={() => setAdvancedOpen(true)}
              aria-label={t('advFormula.settingsAria', { count: value.advanced.overlayCount })}
              className="touch-target w-full flex items-center justify-center gap-1.5 py-1.5 border border-blue-200 rounded-lg bg-blue-50/60 text-[12px] font-medium text-blue-600 cursor-pointer hover:bg-blue-50 active:bg-blue-100 transition-colors"
            >
              <span className="text-[13px] leading-none" aria-hidden="true">⚙</span>
              {t('advFormula.settingsLabel')}
              {value.advanced.overlayCount > 0 && (
                <span className="min-w-4 h-4 px-1 rounded-full bg-blue-500 text-white text-[10px] font-semibold leading-4 text-center">
                  {value.advanced.overlayCount}
                </span>
              )}
            </button>
          )}

          {(isFn || isParam) && (
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

      {/* 图层顺序（ZOO-183）：错误态 / 正常态均可用（mathPlot 也是普通元素） */}
      {layerControls}

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

      {/* ZOO-194：高级公式二级面板（portal 挂 body，不占本面板布局）。
          ZOO-188 T1：常量区直连元素——onChange 直改实时重绘（constants 为元素
          真实字段，经 handleParamsChange 落元素，不在派生剥除清单）、onCommit 提交一条；
          模板点选回填方程输入。
          ZOO-189 T2：微积分区直连元素 overlays（同为真实字段）；清空归一 undefined；
          仅显式函数可叠加（几何/错误态禁用并提示——parametric/polar 同口径）。
          ZOO-190 T3：微积分区增定积分 a/b 输入（domain 传元素定义域做越界校验）。
          ZOO-191 T4：参数式区直连元素 xAxis（t/θ 域，元素真实字段）。
          ZOO-192 T5：物理区直连元素——标注开关读写 overlays physics 条目，模板
          点选整包回填（方程 / 常量 / t 域 / 标注）并一次离散提交。
          ZOO-193 T6：微积分区增 ×10 邻域放大预设（onDomainChange 写元素 xAxis，
          离散变更面板内即提交一条）。
          ZOO-197：常量区滑块元数据直连元素 constantSliders（同为真实字段；
          清空归一 undefined）。
          ZOO-201：常量区可拖点直连元素 draggablePoints（增删为离散变更，
          一次提交一条；空归一 undefined）。 */}

      {advancedOpen && (
        <AdvancedFormulaPanel
          onClose={() => setAdvancedOpen(false)}
          constants={{
            equation: value.equation,
            values: value.constants ?? {},
            sliders: value.constantSliders,
            points: value.draggablePoints,
            onChange: (update) => patch({ constants: update(value.constants ?? {}) }),
            onSlidersChange: (update) => {
              const next = update(value.constantSliders ?? {});
              patch({ constantSliders: Object.keys(next).length > 0 ? next : undefined });
            },
            onPointsChange: (update) => {
              const next = update(value.draggablePoints ?? []);
              patch({ draggablePoints: next.length > 0 ? next : undefined });
            },
            onCommit: () => onCommit?.(),
            onApplyTemplate: (equation) => patch({ equation }),
          }}
          calculus={{
            values: value.overlays ?? [],
            applicable: isFn,
            // ZOO-190 T3：a/b 定义域内校验（元素 xAxis；创建侧无元素、缺省不校验）
            domain: value.xAxis,
            // ZOO-193 T6：×10 邻域放大预设写元素定义域（点击即 onChange+onCommit）
            onDomainChange: (domain) => patch({ xAxis: domain }),
            onChange: (next) => patch({ overlays: next.length > 0 ? next : undefined }),
            onCommit: () => onCommit?.(),
          }}
          parametric={{
            equation: value.equation,
            constants: value.constants,
            domain: value.xAxis,
            onDomainChange: (domain) => patch({ xAxis: domain }),
            onCommit: () => onCommit?.(),
            onApplyTemplate: (equation) => patch({ equation }),
          }}
          physics={{
            equation: value.equation,
            constants: value.constants,
            values: value.overlays ?? [],
            onChange: (next) => patch({ overlays: next.length > 0 ? next : undefined }),
            onCommit: () => onCommit?.(),
            // ZOO-192：模板整包回填——常量预置（ASCII 键落元素真实字段）、t 域
            // 预置（xAxis，commit 收敛按新方程判定 fallback 保持不被默认域覆盖）、
            // 标注预置（physics 条目）；一次 onChange + 一次 onCommit（离散变更）
            onApplyTemplate: (tpl: PhysicsTemplate) => {
              const rest = (value.overlays ?? []).filter((o) => o.type !== 'physics');
              const overlays = tpl.marks ? [...rest, { type: 'physics' as const }] : rest;
              patch({
                equation: tpl.equation,
                constants: { ...tpl.constants },
                xAxis: { ...tpl.domain },
                ...(overlays.length > 0 ? { overlays } : { overlays: undefined }),
              });
              onCommit?.();
            },
          }}
        />
      )}
    </div>
  );
}
