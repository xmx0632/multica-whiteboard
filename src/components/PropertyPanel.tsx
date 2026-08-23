'use client';

/**
 * 属性面板三态路由（技术方案 §8，ZOO-136 接线）：
 * 1. activeTool === 'equation' → EquationEditor（新建；确认经 store 握手由 Canvas 落点）；
 * 2. 选中 mathPlot → MathPlotParams（实时调参，D5 两段式历史）；
 * 3. 其余 → 既有工具默认面板（零回归）。
 * 错误占位元素经「重新编辑方程」进原位替换流（editingId，原型决策 4）。
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '@/lib/store';
import { COLORS, MathPlotElement, StrokeDashStyle, WhiteboardElement, TEXT_MIN_FONT_SIZE, TEXT_MAX_FONT_SIZE } from '@/lib/types';
import { canRestyleFromToolPanel, elementStrokeColor, canDashFromToolPanel, elementDash } from '@/lib/stroke';
import { validateEquation } from '@/lib/math/validate';
import { convergeEquationCommit, mathPlotFieldsFromPayload } from '@/lib/mathplotElement';
import { advancedFormulaState } from '@/lib/advancedFormula';
import { CANVAS_INTERACT_EVENT, nextPanelFold, type PanelState } from '@/lib/landscape';
import { usePhoneLandscape } from '@/lib/usePhoneLandscape';
import { usePhonePortrait } from '@/lib/usePhonePortrait';
import { useT } from '@/i18n/I18nProvider';
import type { LibT } from '@/i18n/lib';
import EquationEditor from './math/EquationEditor';
import MathPlotParams, { type MathPlotParamsValue } from './math/MathPlotParams';
import ArrangeGroup from './ArrangeGroup';

/** 线型按钮组（ZOO-165）：顺序即面板展示序；文案 key 随语言（ZOO-176） */
const DASH_STYLES: StrokeDashStyle[] = ['solid', 'dashed', 'dotted'];
const DASH_LABEL_KEYS: Record<StrokeDashStyle, string> = { solid: 'panel.dashSolid', dashed: 'panel.dashDashed', dotted: 'panel.dashDotted' };

export default function PropertyPanel() {
  const {
    activeTool, elements, selectedId,
    strokeColor, strokeWidth, strokeDash,
    fillColor, setFillColor, fontSize, setFontSize,
    pickStrokeColor, inputStrokeColor, inputStrokeWidth, commitStrokeStyle, inputFontSize, pickStrokeDash,
    addElement, updateElement, updateElementTransient, deleteElement,
    setSelected, setTool, pushOperations, requestMathPlotInsert,
  } = useStore();

  const t: LibT = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  // D5 两段式：手势（滑杆拖动 / 文本输入）开始前的元素快照，onCommit 时压一条快照
  const gestureStartRef = useRef<MathPlotElement | null>(null);
  // ZOO-155：方程提交非法的瞬时提示（元素保持原值，不落元素、不入历史）
  const [equationError, setEquationError] = useState<string | null>(null);

  const selectedEl = elements.find((e) => e.id === selectedId) ?? null;

  // 切换选中元素：方程提交提示随上一元素失效，清空防串显
  useEffect(() => {
    setEquationError(null);
  }, [selectedId]);
  // 原位替换态只在「仍选中该元素」时有效：点选别处 / 取消选中即自然退出
  const editingEl =
    editingId != null && editingId === selectedId
      ? elements.find((e) => e.id === editingId) ?? null
      : null;

  // —— ZOO-152/156 手机紧凑布局（横屏 / 竖屏）：面板可折叠（默认收起为 chip，方程 / 参数面板出现时自动展开）——
  const phoneLandscape = usePhoneLandscape();
  const phonePortrait = usePhonePortrait();
  const compactLayout = phoneLandscape || phonePortrait;
  const [fold, dispatchFold] = useReducer(nextPanelFold, 'unfolded');
  const panelState: PanelState =
    activeTool === 'equation' || editingEl
      ? 'equation'
      : selectedEl?.type === 'mathPlot'
        ? 'mathplot'
        : 'tool';

  // 旋转进入 / 离开手机紧凑布局（横竖互转均默认收起，回桌面恢复常驻）
  useEffect(() => {
    dispatchFold({ type: 'phone-compact', active: compactLayout });
  }, [compactLayout]);

  // 面板态切换：方程 / 参数面板出现时自动展开（ƒ 工具点开必须见到编辑器）
  const prevPanelStateRef = useRef(panelState);
  useEffect(() => {
    if (prevPanelStateRef.current !== panelState) {
      prevPanelStateRef.current = panelState;
      dispatchFold({ type: 'panel-state', panel: panelState });
    }
  }, [panelState]);

  // 画布触点（Canvas pointerdown 派发）：颜色面板自动收起
  useEffect(() => {
    const onCanvasInteract = () => dispatchFold({ type: 'canvas-interact', panel: prevPanelStateRef.current });
    window.addEventListener(CANVAS_INTERACT_EVENT, onCanvasInteract);
    return () => window.removeEventListener(CANVAS_INTERACT_EVENT, onCanvasInteract);
  }, []);

  const folded = compactLayout && fold === 'folded';

  /**
   * 折叠包装（ZOO-152 横屏 / ZOO-156 竖屏）：仅手机紧凑布局收起时隐藏面板本体、只渲染 chip
   * （tool 态显示当前触笔色，方程 / 参数态显示对应图标）；桌面原样透传。
   * chip / 收起钮位置经 panel-chip / panel-collapse 钩子类由媒体查询分形态摆放
   * （横屏右下、竖屏右缘中部）；whiteboard-chrome 供沉浸模式整体隐藏。
   */
  const renderFoldable = (panel: React.ReactNode) => (
    <>
      <div className={`whiteboard-chrome ${folded ? 'hidden' : ''}`}>{panel}</div>
      {/* 展开态收起钮（贴面板）：方程 / 参数面板不吃「画布触点即收」，需显式收起出口 */}
      {!folded && compactLayout && (
        <button
          type="button"
          aria-label={t('panel.collapseAria')}
          onClick={() => dispatchFold({ type: 'toggle' })}
          className="panel-collapse whiteboard-chrome touch-target absolute right-[264px] bottom-[68px] w-11 h-11 rounded-full bg-white/90 backdrop-blur-sm shadow-lg border border-gray-200 text-gray-500 flex items-center justify-center active:bg-gray-100 z-10"
        >
          ⌄
        </button>
      )}
      {folded && (
        <button
          type="button"
          aria-label={panelState === 'tool' ? t('panel.expandToolAria') : panelState === 'equation' ? t('panel.expandEquationAria') : t('panel.expandParamsAria')}
          onClick={() => dispatchFold({ type: 'toggle' })}
          className="panel-chip whiteboard-chrome touch-target absolute right-3 bottom-3 z-20 w-11 h-11 rounded-full bg-white/90 backdrop-blur-sm shadow-lg border border-gray-200 flex items-center justify-center active:bg-gray-100"
        >
          {panelState === 'tool' ? (
            <span className="w-6 h-6 rounded-full border-2 border-gray-300" style={{ backgroundColor: strokeColor }} />
          ) : panelState === 'equation' ? (
            <span className="font-serif italic text-blue-500 text-lg leading-none">ƒ</span>
          ) : (
            <span className="text-gray-600 text-base leading-none">⚙</span>
          )}
        </button>
      )}
    </>
  );

  // —— 态 1：方程编辑器（equation 工具新建）——
  if (activeTool === 'equation') {
    return renderFoldable(
      <EquationEditor onConfirm={(payload) => requestMathPlotInsert(payload)} />,
    );
  }

  // —— 态 1.5：原位替换（错误占位 / 既有元素「重新编辑方程」）——
  if (editingEl && editingEl.type === 'mathPlot') {
    return renderFoldable(
      <EquationEditor
        key={editingEl.id}
        initialEquation={editingEl.equation}
        initialConstants={editingEl.constants}
        initialOverlays={editingEl.overlays}
        initialConstantSliders={editingEl.constantSliders}
        onCancel={() => setEditingId(null)}
        onConfirm={(payload) => {
          updateElement(editingEl.id, mathPlotFieldsFromPayload(payload));
          setEditingId(null);
          setSelected(editingEl.id);
        }}
      />,
    );
  }

  // —— 态 2：mathPlot 参数面板 ——
  if (selectedEl && selectedEl.type === 'mathPlot') {
    const el = selectedEl;

    // 几何方程教学参数（D7 / ZOO-147/149）：元素只存方程原文，面板展示前经 validateEquation 重解析取系数
    const revalidated =
      el.kind === 'line' || el.kind === 'linePair' || el.kind === 'point' || el.kind === 'parabola' || el.kind === 'hyperbola' || el.kind === 'ellipse'
        ? validateEquation(el.equation, t)
        : null;
    // ZOO-194：高级公式入口信号（overlays/constants/新 kind 才点亮；普通元素
    // undefined → MathPlotParams 不渲染「公式设置」按钮，面板与现状逐像素一致。
    // 结构化最小形状透传，T1/T2/T4 给元素增补可选字段后自动生效，无需改此处）
    const advanced = advancedFormulaState(el);
    const value: MathPlotParamsValue = {
      equation: el.equation,
      kind: el.kind,
      errorMessage: el.error ?? undefined,
      lineParams: revalidated?.kind === 'line' ? revalidated.params : undefined,
      linePairParams: revalidated?.kind === 'linePair' ? revalidated.params : undefined,
      pointParams: revalidated?.kind === 'point' ? revalidated.params : undefined,
      parabolaParams: revalidated?.kind === 'parabola' ? revalidated.params : undefined,
      hyperbolaParams: revalidated?.kind === 'hyperbola' ? revalidated.params : undefined,
      ellipseParams: revalidated?.kind === 'ellipse' ? revalidated.params : undefined,
      advanced: advanced.visible ? { overlayCount: advanced.overlayCount } : undefined,
      // ZOO-188（T1）：常量绑定是元素真实字段（经 onChange 落元素、参与解析裁决）
      constants: el.constants,
      // ZOO-197：滑块元数据同为元素真实字段（不在派生剥除清单，直落元素）
      constantSliders: el.constantSliders,
      // ZOO-189（T2）：微积分叠加同为元素真实字段（不在派生剥除清单，直落元素）
      overlays: el.overlays,
      xAxis: el.xAxis,
      sampleCount: el.sampleCount,
      equalRatio: el.equalRatio,
      showAxis: el.showAxis,
      showGrid: el.showGrid,
      showLabel: el.showLabel,
      strokeColor: el.strokeColor,
      strokeWidth: el.strokeWidth,
      opacity: el.opacity,
    };

    const handleParamsChange = (patch: Partial<MathPlotParamsValue>) => {
      if (!gestureStartRef.current) gestureStartRef.current = el;
      if (patch.equation !== undefined) setEquationError(null);
      // errorMessage / lineParams / linePairParams / pointParams / parabolaParams / hyperbolaParams / ellipseParams / advanced（ZOO-194）为面板派生字段（元素不落盘），剥除后落元素
      const rest: Partial<MathPlotParamsValue> = { ...patch };
      const errorMessage = rest.errorMessage;
      delete rest.errorMessage;
      delete rest.lineParams;
      delete rest.linePairParams;
      delete rest.pointParams;
      delete rest.parabolaParams;
      delete rest.hyperbolaParams;
      delete rest.ellipseParams;
      delete rest.advanced;
      updateElementTransient(el.id, { ...rest, ...(errorMessage !== undefined ? { error: errorMessage } : {}) } as Partial<WhiteboardElement>);
    };

    const handleParamsCommit = () => {
      const before = gestureStartRef.current;
      gestureStartRef.current = null;
      const cur = useStore.getState().elements.find((e) => e.id === el.id) as MathPlotElement | undefined;
      if (!cur) return;
      // 方程文本收敛：重新校验分类与错误信息（几何方程同步推导定义域）。
      // ZOO-188：按元素当前常量绑定裁决——含常量的合法方程（y=A·sin(ωx+φ)）不会
      // 被误判非法而回滚；常量变化使 kind 翻转（欠定 → explicit）也在此收敛
      const converged = convergeEquationCommit(cur.equation, t, cur.constants);
      if (!converged.fields) {
        // ZOO-155：非法方程不落错误占位 —— 元素回滚到手势前快照（曲线保持原样），面板提示原因
        setEquationError(converged.error ?? t('math.unrecognized'));
        if (before) {
          updateElementTransient(el.id, {
            equation: before.equation,
            kind: before.kind,
            error: before.error,
            xAxis: { ...before.xAxis },
            equalRatio: before.equalRatio,
          } as Partial<WhiteboardElement>);
        }
        return;
      }
      setEquationError(null);
      const fields = converged.fields;
      const after: MathPlotElement = {
        ...cur,
        ...fields,
        equation: cur.equation.trim() || cur.equation,
      };
      const changed = (k: keyof MathPlotElement) => (after[k] as unknown) !== (cur[k] as unknown);
      const convergedChanged = changed('equation') || changed('kind') || changed('error') || changed('xAxis') || changed('equalRatio');
      if (before) {
        const diffKeys = (Object.keys(after) as (keyof MathPlotElement)[]).filter((k) => (after[k] as unknown) !== (before[k] as unknown));
        if (diffKeys.length === 0 && !convergedChanged) return;
        if (convergedChanged) updateElementTransient(el.id, fields as Partial<WhiteboardElement>);
        pushOperations([{ type: 'update', elementId: el.id, before, after }]);
      } else if (convergedChanged) {
        updateElement(el.id, fields as Partial<WhiteboardElement>);
      }
    };

    return renderFoldable(
      <MathPlotParams
        value={value}
        onChange={handleParamsChange}
        onCommit={handleParamsCommit}
        equationError={equationError}
        layerControls={<ArrangeGroup />}
        onDuplicate={() => {
          const clone: MathPlotElement = { ...el, id: uuidv4(), x: el.x + 24, y: el.y + 24 };
          addElement(clone);
          setTool('select');
          setSelected(clone.id);
        }}
        onDelete={() => deleteElement(el.id)}
        onRequestEdit={() => setEditingId(el.id)}
      />,
    );
  }

  // —— 态 3：既有工具默认面板 ——
  // ZOO-157 选中改色：有选中元素（mathPlot 除外，其走态 2 专属面板）时，颜色 / 线宽
  // 操作直接作用于该元素（可撤销），面板回显元素当前样式；无选中维持原语义（设默认值）。
  const restyleTarget = canRestyleFromToolPanel(selectedEl) ? selectedEl : null;
  const panelColor = restyleTarget ? elementStrokeColor(restyleTarget) : strokeColor;
  const panelWidth = restyleTarget ? restyleTarget.strokeWidth : strokeWidth;

  // 线型（ZOO-165）：选中描边类元素 → 改该元素；无选中 / text 选中外的场景 → 设新绘制默认。
  // text 无描边不参与（选中 text 时线型区隐藏，颜色 / 线宽维持 ZOO-157 语义）。
  const dashTarget = canDashFromToolPanel(selectedEl) ? selectedEl : null;
  const showDash = dashTarget != null || selectedEl == null;
  const panelDash = dashTarget ? elementDash(dashTarget) : strokeDash;

  const showFill = ['rectangle', 'circle'].includes(activeTool);
  const showFont = activeTool === 'text';
  // 字号滑杆（ZOO-159）：T 工具设默认字号；选中 text 元素时作用于该元素（D5 两段式）
  const selectedText = selectedEl?.type === 'text' ? selectedEl : null;
  const panelFontSize = selectedText ? selectedText.fontSize : fontSize;

  return renderFoldable(
    <div className="touch-panel touch-side-panel absolute right-3 top-1/2 -translate-y-1/2 w-48 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-3">
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">
          {t('panel.stroke')}{restyleTarget ? t('panel.selectedSuffix') : ''}
        </label>
        <div className="flex flex-wrap gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => pickStrokeColor(c)}
              className={`touch-swatch w-5 h-5 rounded-full border-2 ${panelColor === c ? 'border-blue-500 scale-110' : 'border-gray-300'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={panelColor}
            onChange={(e) => inputStrokeColor(e.target.value)}
            onBlur={commitStrokeStyle}
            className="touch-swatch w-5 h-5 rounded cursor-pointer border border-gray-300"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">{t('panel.width', { n: panelWidth })}</label>
        <input
          type="range"
          min={1}
          max={50}
          value={panelWidth}
          onChange={(e) => inputStrokeWidth(Number(e.target.value))}
          onPointerUp={commitStrokeStyle}
          onKeyUp={commitStrokeStyle}
          className="touch-target w-full accent-blue-500"
        />
      </div>

      {showDash && (
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">
            {t('panel.dash')}{dashTarget ? t('panel.selectedSuffix') : ''}
          </label>
          <div className="flex gap-1">
            {DASH_STYLES.map((d) => (
              <button
                key={d}
                type="button"
                title={t(DASH_LABEL_KEYS[d])}
                aria-label={t(DASH_LABEL_KEYS[d])}
                aria-pressed={panelDash === d}
                onClick={() => pickStrokeDash(d)}
                className={`touch-target flex-1 h-7 rounded-md border flex items-center justify-center ${panelDash === d ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'}`}
              >
                <span
                  className="w-5"
                  style={{ borderTop: `2px ${d} #374151` }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {showFill && (
        <div>
          <label className="touch-target text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
            <input
              type="checkbox"
              checked={fillColor !== null}
              onChange={(e) => setFillColor(e.target.checked ? '#3B82F6' : null)}
              className="accent-blue-500"
            />
            {t('panel.fill')}
          </label>
          {fillColor !== null && (
            <div className="flex flex-wrap gap-1 mt-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setFillColor(c)}
                  className={`touch-swatch w-5 h-5 rounded-full border-2 ${fillColor === c ? 'border-blue-500 scale-110' : 'border-gray-300'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={fillColor}
                onChange={(e) => setFillColor(e.target.value)}
                className="touch-swatch w-5 h-5 rounded cursor-pointer border border-gray-300"
              />
            </div>
          )}
        </div>
      )}

      {(showFont || selectedText) && (
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">
            {t('panel.fontSize', { n: panelFontSize })}{selectedText ? t('panel.selectedSuffix') : ''}
          </label>
          <input
            type="range"
            min={TEXT_MIN_FONT_SIZE}
            max={TEXT_MAX_FONT_SIZE}
            value={panelFontSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (selectedText) inputFontSize(v);
              else setFontSize(v);
            }}
            onPointerUp={commitStrokeStyle}
            onKeyUp={commitStrokeStyle}
            className="touch-target w-full accent-blue-500"
          />
        </div>
      )}

      {/* 图层顺序（ZOO-183）：选中任一元素即出现（工具态与 mathPlot 态一视同仁） */}
      {selectedEl && <ArrangeGroup />}
    </div>,
  );
}
