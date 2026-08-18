'use client';

/**
 * 方程编辑面板（交互原型「方程 Equation」模式 1:1 实现）。
 *
 * ZOO-133（4a）交付形态：独立组件，暂不接入工具栏 / store（技术方案 §10 PR4；
 * 工具栏入口、三态面板路由与 addElement 落点在 ZOO-136/4d 集成）。
 * - 输入即校验：每键调用 validateEquation（ZOO-134 起为 mathjs 安全解析的薄适配）；
 * - 回车 / 「插入图形」确认 → onConfirm(EquationDraftPayload)，error 态同样允许确认
 *   （4d 据此生成错误占位元素，交互原型决策 4）；
 * - 预览采样默认走 ZOO-134 管线（createPreviewPolylines），可注入替换。
 */
import { useMemo, useRef, useState } from 'react';
import MiniPreview from './MiniPreview';
import { EQUATION_TEMPLATES, SYMBOL_BUTTONS } from '@/lib/math/templates';
import { validateEquation } from '@/lib/math/validate';
import { createPreviewPolylines as samplePreviewPolylines } from '@/lib/math/sample';
import type { EquationDraftPayload, PreviewData, StructuralOutcome } from '@/lib/math/types';

const KIND_LABELS: Record<string, string> = {
  explicit: '显式函数 y=f(x)',
  circle: '圆（几何方程）',
  ellipse: '椭圆（几何方程）',
};

export interface EquationEditorProps {
  /** 载入初始方程（错误占位元素重编辑流程，4d 接线） */
  initialEquation?: string;
  /** 确认（回车 / 插入按钮）。payload.outcome.kind 为 'error' 时也回调。 */
  onConfirm?: (payload: EquationDraftPayload) => void;
  /** 原位替换流的取消返回（ZOO-136；不传则不显示取消按钮） */
  onCancel?: () => void;
  /** 预览采样注入点：默认走 4b 采样管线，可注入替换（测试 / 演示）。 */
  createPreviewPolylines?: (equation: string, outcome: StructuralOutcome) => PreviewData | null;
}

export default function EquationEditor({
  initialEquation = '',
  onConfirm,
  onCancel,
  createPreviewPolylines = samplePreviewPolylines,
}: EquationEditorProps) {
  const [draft, setDraft] = useState(initialEquation);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = draft.trim();
  const outcome = useMemo(() => validateEquation(draft), [draft]);
  const isError = trimmed.length > 0 && outcome.kind === 'error';
  const isValid = trimmed.length > 0 && !isError;

  const preview = useMemo(() => {
    if (!isValid || !createPreviewPolylines) return null;
    return createPreviewPolylines(trimmed, outcome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, isValid, createPreviewPolylines]);

  const confirm = () => {
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    onConfirm?.({ equation: trimmed, outcome });
  };

  const insertAtCursor = (text: string) => {
    const input = inputRef.current;
    if (!input) return;
    input.setRangeText(text, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
    setDraft(input.value);
    input.focus();
  };

  const applyTemplate = (equation: string) => {
    setDraft(equation);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(equation.length, equation.length);
      }
    });
  };

  const statusLine = () => {
    if (!trimmed) return { text: '等待输入…', cls: 'text-gray-400' };
    if (isError) return { text: `⚠ ${outcome.kind === 'error' ? outcome.message : ''}`, cls: 'text-red-500' };
    return { text: `✓ 已识别：${KIND_LABELS[outcome.kind]}`, cls: 'text-green-600' };
  };
  const status = statusLine();

  return (
    <div className="touch-panel absolute right-3 top-1/2 -translate-y-1/2 w-[264px] bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-3">
      <div className="text-[13px] font-semibold text-gray-700 flex items-center gap-1.5 pb-0.5">
        <span className="font-serif italic text-blue-500 text-base leading-none">ƒ</span>
        方程 Equation
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="touch-target ml-auto border-none bg-transparent text-gray-400 text-[11px] cursor-pointer hover:text-gray-600 active:text-gray-800 transition-colors"
          >
            ✕ 取消
          </button>
        )}
      </div>

      <div>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              confirm();
            }
            if (e.key === 'Escape') inputRef.current?.blur();
          }}
          placeholder="如 y=sin(x) 或 y=x²-2x-3"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className={`touch-target w-full px-2.5 py-1.5 border rounded-lg font-serif text-[15px] text-gray-900 outline-none bg-white select-text transition-shadow ${
            isError
              ? 'border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]'
              : 'border-gray-300 focus:border-blue-500 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]'
          }`}
          aria-label="方程输入"
        />
        <div className={`text-[11px] mt-1 leading-snug ${status.cls}`}>{status.text}</div>
      </div>

      {/* ZOO-144：小屏（粗指针）下内容超高 → 中段内滚，方程输入与插入按钮钉在可视区 */}
      <div className="touch-scroll flex flex-col gap-3">
      <MiniPreview
        status={!trimmed ? 'wait' : isError ? 'error' : 'ok'}
        errorMessage={outcome.kind === 'error' ? outcome.message : undefined}
        polylines={preview?.polylines ?? null}
        xMin={preview?.xMin}
        xMax={preview?.xMax}
        yMin={preview?.yMin}
        yMax={preview?.yMax}
      />

      <div>
        <span className="text-xs font-medium text-gray-500 mb-1 block">插入符号</span>
        <div className="flex gap-1 flex-wrap">
          {SYMBOL_BUTTONS.map((s) => (
            <button
              key={s.label}
              type="button"
              title={s.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertAtCursor(s.insert)}
              className="touch-target min-w-7 h-6 px-1.5 border border-gray-200 bg-white rounded-md font-serif text-[13px] text-gray-700 cursor-pointer hover:border-blue-500 hover:text-blue-500 active:bg-gray-100 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="text-xs font-medium text-gray-500 mb-1 block">模板 Templates</span>
        <div className="grid grid-cols-2 gap-1">
          {EQUATION_TEMPLATES.map((t) => (
            <button
              key={t.name}
              type="button"
              title={t.equation}
              onClick={() => applyTemplate(t.equation)}
              className="touch-target border border-gray-200 bg-white rounded-md px-1.5 py-1 text-left cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 active:bg-blue-100 transition-colors"
            >
              <span className="block text-[10px] text-gray-400 leading-tight">{t.name}</span>
              <span className="block font-serif text-xs text-gray-800 whitespace-nowrap overflow-hidden text-ellipsis">
                {t.equation}
              </span>
            </button>
          ))}
        </div>
      </div>
      </div>{/* /touch-scroll */}

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={confirm}
          disabled={!trimmed}
          className="touch-target flex-1 py-1.5 border-none rounded-lg bg-blue-500 text-white text-[13px] font-semibold cursor-pointer hover:bg-[#2f7ae5] active:bg-[#2564c4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          插入图形 ⏎
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft('');
            inputRef.current?.focus();
          }}
          className="touch-target py-1.5 px-3 border border-gray-200 rounded-lg bg-white text-gray-500 text-xs cursor-pointer hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >
          清空
        </button>
      </div>

      <div className="text-[11px] text-gray-400 leading-relaxed">
        确认后在画布生成数学图形元素（MathPlot）：自带坐标系，可移动 / 缩放 / 撤销重做。
      </div>
    </div>
  );
}
