'use client';

/**
 * 属性面板三态路由（技术方案 §8，ZOO-136 接线）：
 * 1. activeTool === 'equation' → EquationEditor（新建；确认经 store 握手由 Canvas 落点）；
 * 2. 选中 mathPlot → MathPlotParams（实时调参，D5 两段式历史）；
 * 3. 其余 → 既有工具默认面板（零回归）。
 * 错误占位元素经「重新编辑方程」进原位替换流（editingId，原型决策 4）。
 */
import { useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '@/lib/store';
import { COLORS, MathPlotElement, WhiteboardElement } from '@/lib/types';
import { validateEquation } from '@/lib/math/validate';
import { mathPlotFieldsFromPayload } from '@/lib/mathplotElement';
import EquationEditor from './math/EquationEditor';
import MathPlotParams, { type MathPlotParamsValue } from './math/MathPlotParams';

export default function PropertyPanel() {
  const {
    activeTool, elements, selectedId,
    strokeColor, setStrokeColor, strokeWidth, setStrokeWidth,
    fillColor, setFillColor, fontSize, setFontSize,
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

  // —— 态 1：方程编辑器（equation 工具新建）——
  if (activeTool === 'equation') {
    return <EquationEditor onConfirm={(payload) => requestMathPlotInsert(payload)} />;
  }

  // —— 态 1.5：原位替换（错误占位 / 既有元素「重新编辑方程」）——
  if (editingEl && editingEl.type === 'mathPlot') {
    return (
      <EquationEditor
        key={editingEl.id}
        initialEquation={editingEl.equation}
        onCancel={() => setEditingId(null)}
        onConfirm={(payload) => {
          updateElement(editingEl.id, mathPlotFieldsFromPayload(payload));
          setEditingId(null);
          setSelected(editingEl.id);
        }}
      />
    );
  }

  // —— 态 2：mathPlot 参数面板 ——
  if (selectedEl && selectedEl.type === 'mathPlot') {
    const el = selectedEl;

    const value: MathPlotParamsValue = {
      equation: el.equation,
      kind: el.kind,
      errorMessage: el.error ?? undefined,
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
      const { errorMessage, ...rest } = patch;
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

    return (
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
      />
    );
  }

  // —— 态 3：既有工具默认面板（维持原状）——
  const showFill = ['rectangle', 'circle'].includes(activeTool);
  const showFont = activeTool === 'text';

  return (
    <div className="touch-panel absolute right-3 top-1/2 -translate-y-1/2 w-48 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-3">
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Stroke</label>
        <div className="flex flex-wrap gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setStrokeColor(c)}
              className={`touch-swatch w-5 h-5 rounded-full border-2 ${strokeColor === c ? 'border-blue-500 scale-110' : 'border-gray-300'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={strokeColor}
            onChange={(e) => setStrokeColor(e.target.value)}
            className="touch-swatch w-5 h-5 rounded cursor-pointer border border-gray-300"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Width: {strokeWidth}px</label>
        <input
          type="range"
          min={1}
          max={50}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
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
    </div>
  );
}
