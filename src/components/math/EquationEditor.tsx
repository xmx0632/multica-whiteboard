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
 * - ZOO-164：模板区按方程族分组折叠（默认首组展开），折叠状态会话级保持
 *   （src/lib/templateGroupCollapse.ts）；插入行为与平铺版零差异。
 * - ZOO-166 方案 A：任意单字母可作自变量——显式函数状态行按实际字母显示
 *   （y=f(z)），y=4z 直接出图不再报错。
 * - ZOO-194 入口 1（创建侧）：模板分组区底部「微积分 / 物理公式…」入口项，
 *   点击展开高级公式二级面板——面板经 portal 独立挂载，开合为纯 UI 态；
 *   既有输入框 / 19 模板 / 符号按钮 / MiniPreview 一律不动（零回归硬约束）。
 * - ZOO-188（T1 常量绑定）：常量草稿（面板常量区编辑）参与实时校验与预览，
 *   确认载荷全量带出（EquationDraftPayload.constants）；重编辑流经
 *   initialConstants 回填。含符号常量的公式绑定后即时出图。
 */
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import AdvancedFormulaPanel from './AdvancedFormulaPanel';
import MiniPreview from './MiniPreview';
import { useT } from '@/i18n/I18nProvider';
import { SYMBOL_BUTTONS, groupTemplates, symbolTitleKey, templateGroupNameKey, templateNameKey } from '@/lib/math/templates';
import { getExpandedGroupIds, subscribeTemplateGroupCollapse, toggleGroupExpansion } from '@/lib/templateGroupCollapse';
import { validateEquation } from '@/lib/math/validate';
import { createPreviewPolylines as samplePreviewPolylines } from '@/lib/math/sample';
import type { EquationDraftPayload, MathPlotOverlay, PreviewData, StructuralOutcome } from '@/lib/math/types';

/** 分类状态行文案资源键（ZOO-166 方案 A：显式函数按实际自变量字母显示；ZOO-176 随语言）。 */
const KIND_LABEL_KEYS: Record<string, string> = {
  line: 'equation.kindLine',
  linePair: 'equation.kindLinePair',
  point: 'equation.kindPoint',
  parabola: 'equation.kindParabola',
  hyperbola: 'equation.kindHyperbola',
  circle: 'equation.kindCircle',
  ellipse: 'equation.kindEllipse',
};

/** 分类状态行文案（经注入 t 按语言渲染）。 */
function kindLabel(outcome: StructuralOutcome, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (outcome.kind === 'explicit') return t('equation.kindExplicit', { v: outcome.variable ?? 'x' });
  const key = KIND_LABEL_KEYS[outcome.kind];
  return key ? t(key) : outcome.kind;
}

export interface EquationEditorProps {
  /** 载入初始方程（错误占位元素重编辑流程，4d 接线） */
  initialEquation?: string;
  /** 载入初始常量绑定（ZOO-188：高级元素重编辑回填常量草稿；缺省空） */
  initialConstants?: Record<string, number>;
  /** 载入初始叠加（ZOO-189：高级元素重编辑回填叠加草稿；缺省空） */
  initialOverlays?: MathPlotOverlay[];
  /** 确认（回车 / 插入按钮）。payload.outcome.kind 为 'error' 时也回调。 */
  onConfirm?: (payload: EquationDraftPayload) => void;
  /** 原位替换流的取消返回（ZOO-136；不传则不显示取消按钮） */
  onCancel?: () => void;
  /** 预览采样注入点：默认走 4b 采样管线，可注入替换（测试 / 演示）。 */
  createPreviewPolylines?: (equation: string, outcome: StructuralOutcome, constants?: Record<string, number>) => PreviewData | null;
}

export default function EquationEditor({
  initialEquation = '',
  initialConstants,
  initialOverlays,
  onConfirm,
  onCancel,
  createPreviewPolylines = samplePreviewPolylines,
}: EquationEditorProps) {
  const [draft, setDraft] = useState(initialEquation);
  // ZOO-188：常量草稿（高级公式面板常量区编辑；确认时随载荷全量带出，空字典 = 显式清空）
  const [constantValues, setConstantValues] = useState<Record<string, number>>(initialConstants ?? {});
  // ZOO-189：叠加草稿（高级公式面板微积分区编辑；确认时随载荷全量带出，空数组 = 无叠加）
  const [overlayDraft, setOverlayDraft] = useState<MathPlotOverlay[]>(initialOverlays ?? []);
  // ZOO-194：高级公式面板开合（纯 UI 态，不入元素数据、不入撤销历史）
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  // ZOO-164：分组折叠状态（会话级 store——面板收起 / 切工具再回来不丢）。
  // 第三参 getServerSnapshot 供 SSG 预渲染（mathplot-demo 静态导出），快照确定无 hydration 问题
  const expandedGroupIds = useSyncExternalStore(
    subscribeTemplateGroupCollapse,
    getExpandedGroupIds,
    getExpandedGroupIds,
  );
  const templateGroups = useMemo(() => groupTemplates(), []);

  const trimmed = draft.trim();
  // ZOO-188：常量草稿参与裁决——绑定常量后 y=A·sin(ωx+φ) 实时转合法并出预览
  const outcome = useMemo(() => validateEquation(draft, t, constantValues), [draft, t, constantValues]);
  const isError = trimmed.length > 0 && outcome.kind === 'error';
  const isValid = trimmed.length > 0 && !isError;

  const preview = useMemo(() => {
    if (!isValid || !createPreviewPolylines) return null;
    return createPreviewPolylines(trimmed, outcome, constantValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, isValid, createPreviewPolylines, constantValues]);

  const confirm = () => {
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    onConfirm?.({ equation: trimmed, outcome, constants: constantValues, overlays: overlayDraft });
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
    if (!trimmed) return { text: t('equation.wait'), cls: 'text-gray-400' };
    if (isError) return { text: `⚠ ${outcome.kind === 'error' ? outcome.message : ''}`, cls: 'text-red-500' };
    return { text: t('equation.recognized', { kind: kindLabel(outcome, t) }), cls: 'text-green-600' };
  };
  const status = statusLine();

  return (
    <div className="touch-panel touch-side-panel absolute right-3 top-1/2 -translate-y-1/2 w-[264px] bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-3">
      <div className="text-[13px] font-semibold text-gray-700 flex items-center gap-1.5 pb-0.5">
        <span className="font-serif italic text-blue-500 text-base leading-none">ƒ</span>
        {t('equation.title')}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="touch-target ml-auto border-none bg-transparent text-gray-400 text-[11px] cursor-pointer hover:text-gray-600 active:text-gray-800 transition-colors"
          >
            {t('equation.cancel')}
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
          placeholder={t('equation.placeholder')}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className={`touch-target w-full px-2.5 py-1.5 border rounded-lg font-serif text-[15px] text-gray-900 outline-none bg-white select-text transition-shadow ${
            isError
              ? 'border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]'
              : 'border-gray-300 focus:border-blue-500 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]'
          }`}
          aria-label={t('equation.inputAria')}
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
        <span className="text-xs font-medium text-gray-500 mb-1 block">{t('equation.symbols')}</span>
        <div className="flex gap-1 flex-wrap">
          {SYMBOL_BUTTONS.map((sym) => (
            <button
              key={sym.label}
              type="button"
              title={t(symbolTitleKey(sym.id))}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertAtCursor(sym.insert)}
              className="touch-target min-w-7 h-6 px-1.5 border border-gray-200 bg-white rounded-md font-serif text-[13px] text-gray-700 cursor-pointer hover:border-blue-500 hover:text-blue-500 active:bg-gray-100 transition-colors"
            >
              {sym.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="text-xs font-medium text-gray-500 mb-1 block">{t('equation.templates')}</span>
        <div className="flex flex-col gap-1">
          {templateGroups.map((group) => {
            const expanded = expandedGroupIds.has(group.id);
            const listId = `tpl-group-${group.id}`;
            return (
              <div key={group.id} className="border border-gray-200 rounded-md overflow-hidden bg-white">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={listId}
                  title={t('equation.groupTip', { name: t(templateGroupNameKey(group.id)), count: group.templates.length })}
                  onClick={() => toggleGroupExpansion(group.id)}
                  className="touch-target w-full flex items-center gap-1.5 px-1.5 py-1 border-none bg-transparent cursor-pointer hover:bg-blue-50/50 active:bg-blue-100 transition-colors"
                >
                  <span className="text-[11px] font-medium text-gray-600">{t(templateGroupNameKey(group.id))}</span>
                  <span className="text-[10px] text-gray-400">{group.templates.length}</span>
                  <span
                    className={`ml-auto text-gray-400 text-[11px] leading-none transition-transform duration-150 ${expanded ? 'rotate-0' : '-rotate-90'}`}
                    aria-hidden="true"
                  >
                    ⌄
                  </span>
                </button>
                <div className="group-collapse" data-collapsed={!expanded}>
                  <div className="group-collapse-inner">
                    <div id={listId} className="grid grid-cols-2 gap-1 p-1 pt-0">
                      {group.templates.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        title={tpl.equation}
                        onClick={() => applyTemplate(tpl.equation)}
                        className="touch-target border border-gray-200 bg-white rounded-md px-1.5 py-1 text-left cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 active:bg-blue-100 transition-colors"
                      >
                        <span className="block text-[10px] text-gray-400 leading-tight">{t(templateNameKey(tpl.id))}</span>
                        <span className="block font-serif text-xs text-gray-800 whitespace-nowrap overflow-hidden text-ellipsis">
                          {tpl.equation}
                        </span>
                      </button>
                    ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {/* ZOO-194 入口 1（创建侧）：高级公式入口项，置于模板分组底部（分组本身不动） */}
          <button
            type="button"
            onClick={() => setAdvancedOpen(true)}
            title={t('advFormula.entryTitle')}
            className="touch-target w-full flex items-center gap-1.5 px-1.5 py-1.5 border border-dashed border-blue-300 bg-blue-50/40 rounded-md cursor-pointer hover:border-blue-500 hover:bg-blue-50/80 active:bg-blue-100 transition-colors"
          >
            <span className="font-serif italic text-blue-500 text-[13px] leading-none">∫</span>
            <span className="text-[11px] font-medium text-blue-600">{t('advFormula.entryLabel')}</span>
            <span className="ml-auto text-gray-400 text-[11px] leading-none" aria-hidden="true">›</span>
          </button>
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
          {t('equation.insert')}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft('');
            inputRef.current?.focus();
          }}
          className="touch-target py-1.5 px-3 border border-gray-200 rounded-lg bg-white text-gray-500 text-xs cursor-pointer hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >
          {t('equation.clear')}
        </button>
      </div>

      <div className="text-[11px] text-gray-400 leading-relaxed">{t('equation.hint')}</div>

      {/* ZOO-194：高级公式二级面板（portal 挂 body，不占本面板布局）。
          ZOO-188 T1：常量区连编辑器草稿（无历史提交——元素尚未建立），模板点选回填输入框。
          ZOO-189 T2：微积分区连叠加草稿（确认时随载荷全量带出） */}
      {advancedOpen && (
        <AdvancedFormulaPanel
          onClose={() => setAdvancedOpen(false)}
          constants={{
            equation: draft,
            values: constantValues,
            onChange: setConstantValues, // 函数式更新直连（ZOO-188 修复：连点预置槽逐次叠加）
            onApplyTemplate: applyTemplate,
          }}
          calculus={{
            values: overlayDraft,
            applicable: outcome.kind === 'explicit',
            onChange: setOverlayDraft,
          }}
        />
      )}
    </div>
  );
}
