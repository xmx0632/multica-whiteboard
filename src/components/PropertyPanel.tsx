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
import { COLORS, MathPlotElement, WhiteboardElement } from '@/lib/types';
import { canRestyleFromToolPanel, elementStrokeColor } from '@/lib/stroke';
import { validateEquation } from '@/lib/math/validate';
import { mathPlotFieldsFromPayload } from '@/lib/mathplotElement';
import { CANVAS_INTERACT_EVENT, nextPanelFold, type PanelState } from '@/lib/landscape';
import { usePhoneLandscape } from '@/lib/usePhoneLandscape';
import EquationEditor from './math/EquationEditor';
import MathPlotParams, { type MathPlotParamsValue } from './math/MathPlotParams';

export default function PropertyPanel() {
  const {
    activeTool, elements, selectedId,
    strokeColor, strokeWidth,
    fillColor, setFillColor, fontSize, setFontSize,
    pickStrokeColor, inputStrokeColor, inputStrokeWidth, commitStrokeStyle,
    addElement, updateElement, updateElementTransient, deleteElement,
    setSelected, setTool, pushOperations, requestMathPlotInsert,
  } = useStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  // D5 两段式：手势（滑杆拖动 / 文本输入）开始前的元素快照，onCommit 时压一条快照
  const gestureStartRef = useRef<MathPlotElement | null>(null);

  const selectedEl = elements.find((e) => e.id === selectedId) ?? null;
  // 原位替换态只在「仍选中该元素」时有效：点选别处 / 取消选中即自然退出
  const editingEl =
    editingId != null && editingId === selectedId
      ? elements.find((e) => e.id === editingId) ?? null
      : null;

  // —— ZOO-152 手机横屏：面板可折叠（默认收起为 chip，方程 / 参数面板出现时自动展开）——
  const phoneLandscape = usePhoneLandscape();
  const [fold, dispatchFold] = useReducer(nextPanelFold, 'unfolded');
  const panelState: PanelState =
    activeTool === 'equation' || editingEl
      ? 'equation'
      : selectedEl?.type === 'mathPlot'
        ? 'mathplot'
        : 'tool';

  // 旋转进入 / 离开手机横屏：默认收起 / 恢复常驻
  useEffect(() => {
    dispatchFold({ type: 'phone-landscape', active: phoneLandscape });
  }, [phoneLandscape]);

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

  const folded = phoneLandscape && fold === 'folded';

  /**
   * 折叠包装（ZOO-152）：仅手机横屏收起时隐藏面板本体、只渲染底部 chip
   * （tool 态显示当前触笔色，方程 / 参数态显示对应图标）；桌面 / 竖屏原样透传。
   */
  const renderFoldable = (panel: React.ReactNode) => (
    <>
      <div className={folded ? 'hidden' : undefined}>{panel}</div>
      {/* 展开态收起钮（贴面板左下角）：方程 / 参数面板不吃「画布触点即收」，需显式收起出口 */}
      {!folded && phoneLandscape && (
        <button
          type="button"
          aria-label="收起面板"
          onClick={() => dispatchFold({ type: 'toggle' })}
          className="touch-target absolute right-[264px] bottom-[68px] w-11 h-11 rounded-full bg-white/90 backdrop-blur-sm shadow-lg border border-gray-200 text-gray-500 flex items-center justify-center active:bg-gray-100 z-10"
        >
          ⌄
        </button>
      )}
      {folded && (
        <button
          type="button"
          aria-label={panelState === 'tool' ? '展开触笔颜色面板' : panelState === 'equation' ? '展开方程面板' : '展开参数面板'}
          onClick={() => dispatchFold({ type: 'toggle' })}
          className="touch-target absolute right-3 bottom-3 z-20 w-11 h-11 rounded-full bg-white/90 backdrop-blur-sm shadow-lg border border-gray-200 flex items-center justify-center active:bg-gray-100"
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
        ? validateEquation(el.equation)
        : null;
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
      // errorMessage / lineParams / linePairParams / pointParams / parabolaParams / hyperbolaParams / ellipseParams 为面板派生字段（元素不落盘），剥除后落元素
      const rest: Partial<MathPlotParamsValue> = { ...patch };
      const errorMessage = rest.errorMessage;
      delete rest.errorMessage;
      delete rest.lineParams;
      delete rest.linePairParams;
      delete rest.pointParams;
      delete rest.parabolaParams;
      delete rest.hyperbolaParams;
      delete rest.ellipseParams;
      updateElementTransient(el.id, { ...rest, ...(errorMessage !== undefined ? { error: errorMessage } : {}) } as Partial<WhiteboardElement>);
    };

    const handleParamsCommit = () => {
      const before = gestureStartRef.current;
      gestureStartRef.current = null;
      const cur = useStore.getState().elements.find((e) => e.id === el.id) as MathPlotElement | undefined;
      if (!cur) return;
      // 方程文本收敛：重新校验分类与错误信息（几何方程同步推导定义域）
      const outcome = validateEquation(cur.equation);
      const fields = mathPlotFieldsFromPayload({ equation: cur.equation.trim(), outcome });
      const after: MathPlotElement = {
        ...cur,
        ...fields,
        equation: cur.equation.trim() || cur.equation,
      };
      const changed = (k: keyof MathPlotElement) => (after[k] as unknown) !== (cur[k] as unknown);
      const converged = changed('equation') || changed('kind') || changed('error') || changed('xAxis') || changed('equalRatio');
      if (before) {
        const diffKeys = (Object.keys(after) as (keyof MathPlotElement)[]).filter((k) => (after[k] as unknown) !== (before[k] as unknown));
        if (diffKeys.length === 0 && !converged) return;
        if (converged) updateElementTransient(el.id, fields as Partial<WhiteboardElement>);
        pushOperations([{ type: 'update', elementId: el.id, before, after }]);
      } else if (converged) {
        updateElement(el.id, fields as Partial<WhiteboardElement>);
      }
    };

    return renderFoldable(
      <MathPlotParams
        value={value}
        onChange={handleParamsChange}
        onCommit={handleParamsCommit}
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

  const showFill = ['rectangle', 'circle'].includes(activeTool);
  const showFont = activeTool === 'text';

  return renderFoldable(
    <div className="touch-panel touch-side-panel absolute right-3 top-1/2 -translate-y-1/2 w-48 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-3">
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">
          Stroke{restyleTarget ? ' · 已选中元素' : ''}
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
        <label className="text-xs font-medium text-gray-500 mb-1 block">Width: {panelWidth}px</label>
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

      {showFill && (
        <div>
          <label className="touch-target text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
            <input
              type="checkbox"
              checked={fillColor !== null}
              onChange={(e) => setFillColor(e.target.checked ? '#3B82F6' : null)}
              className="accent-blue-500"
            />
            Fill
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

      {showFont && (
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Font Size: {fontSize}px</label>
          <input
            type="range"
            min={10}
            max={72}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="touch-target w-full accent-blue-500"
          />
        </div>
      )}
    </div>,
  );
}
