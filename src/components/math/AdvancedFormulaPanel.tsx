'use client';

/**
 * 高级公式二级面板（ZOO-194 T0：框架与四分区；ZOO-188 T1：常量分区落地）。
 *
 * UI 分层（ZOO-186 报告 v1.1 §四）：微积分 / 物理能力独立入口 + 二级面板，
 * 现有 EquationEditor / MathPlotParams 的既有控件零改动。两个入口共用本组件：
 * - 入口 1（创建侧）：EquationEditor 模板分组区底部「微积分 / 物理公式…」；
 * - 入口 2（编辑侧）：MathPlotParams 条件出现的「公式设置」按钮。
 *
 * - 经 portal 挂 document.body：不进入侧面板的 transform 定位上下文，
 *   也不挤占既有面板布局（空间独立）；
 * - 开合是纯 UI 态（调用方 useState），不入元素数据、不入撤销历史；
 * - T1 常量区（constants 绑定非空时渲染，缺省保持 T0 占位）：预置槽
 *   （g/v₀/θ/ω/A/φ）+ 自定义项，值变更走「静默直改 + 提交一条」调参历史
 *   （技术方案 D5，onChange 实时预览 / onBlur·离散点击 onCommit 压快照）；
 *   存储层键为 ASCII 名（theta/v0），显示层经 constantDisplayName 还原原貌；
 * - T2/T3（微积分）/ T4（参数式）/ T5（物理模板）分区仍为占位。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n/I18nProvider';
import { constantDisplayName, normalizeConstantKey } from '@/lib/math/normalize';
import { validateEquation } from '@/lib/math/validate';
import { ADVANCED_TEMPLATES, advancedTemplateNameKey } from '@/lib/math/templates';

/**
 * T1 常量编辑区绑定（两入口共用）：创建侧由 EquationEditor 持草稿态，
 * 编辑侧由 MathPlotParams 直连元素（onChange → updateElementTransient 直改、
 * onCommit → 提交一条历史）。onApplyTemplate 供模板点选回填方程输入。
 */
export interface AdvancedConstantsBinding {
  /** 当前方程文本（常量赋值后的解析状态行反馈） */
  equation: string;
  /** 常量绑定值（存储层 ASCII 键名） */
  values: Record<string, number>;
  /** 值变更（直改实时预览，不上历史） */
  onChange: (next: Record<string, number>) => void;
  /** 一次可撤销操作边界（离散变更即时 / 输入失焦时）；创建侧可缺省 */
  onCommit?: () => void;
  /** 模板点选出口（回填方程输入）；缺省（无方程输入侧）不渲染模板行 */
  onApplyTemplate?: (equation: string) => void;
}

export interface AdvancedFormulaPanelProps {
  /** 关闭出口（背板点击 / Esc / 标题栏 ✕，三路同源） */
  onClose: () => void;
  /** T1 常量编辑区绑定；缺省时常量分区保持 T0 占位（coming soon） */
  constants?: AdvancedConstantsBinding;
}

/** 四分区骨架（组序即面板展示序）：字形为语言无关数学记号，名称 / 描述走资源键 */
const SECTIONS: readonly { id: 'calculus' | 'physics' | 'constants' | 'parametric'; glyph: string; nameKey: string; descKey: string }[] = [
  { id: 'calculus', glyph: '∫', nameKey: 'advFormula.sectionCalculus', descKey: 'advFormula.sectionCalculusDesc' },
  { id: 'physics', glyph: '⚛', nameKey: 'advFormula.sectionPhysics', descKey: 'advFormula.sectionPhysicsDesc' },
  { id: 'constants', glyph: 'A', nameKey: 'advFormula.sectionConstants', descKey: 'advFormula.sectionConstantsDesc' },
  { id: 'parametric', glyph: 't', nameKey: 'advFormula.sectionParametric', descKey: 'advFormula.sectionParametricDesc' },
];

/** 预置常量槽（ZOO-188）：label 为显示原貌，key 为存储层 ASCII 名，def 为点选初值。 */
const PRESET_CONSTANTS: readonly { key: string; label: string; def: number }[] = [
  { key: 'g', label: 'g', def: 9.8 },
  { key: 'v0', label: 'v₀', def: 1 },
  { key: 'theta', label: 'θ', def: Math.PI / 4 },
  { key: 'omega', label: 'ω', def: 1 },
  { key: 'a', label: 'A', def: 1 },
  { key: 'phi', label: 'φ', def: 0 },
];

/** 保留名：x/y 是自变量、e/π 是数学常数（parse 层不视为自由符号，赋值无意义）。 */
const RESERVED_CONSTANT_KEYS = new Set(['x', 'y', 'e', 'pi']);
/** 常量键合法形（归一化后）：字母开头、字母数字、至多 8 字符。 */
const CONSTANT_KEY_RE = /^[a-z][a-z0-9]{0,7}$/;

/** T1 常量编辑区：模板行 + 预置槽 + 已绑定行 + 自定义项 + 解析状态行。 */
function ConstantsArea({ binding }: { binding: AdvancedConstantsBinding }) {
  const t = useT();
  const [customName, setCustomName] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  // 赋值后的解析反馈：欠定报错引导补常量，合法则报自变量字母
  const outcome = validateEquation(binding.equation, t, binding.values);
  const entries = Object.entries(binding.values);

  /** 离散变更（点选预置 / 移除 / 自定义添加）：一次 onChange + 一次 onCommit */
  const applyDiscrete = (next: Record<string, number>) => {
    binding.onChange(next);
    binding.onCommit?.();
  };

  const togglePreset = (key: string, def: number) => {
    if (key in binding.values) {
      const next = { ...binding.values };
      delete next[key];
      applyDiscrete(next);
    } else {
      applyDiscrete({ ...binding.values, [key]: def });
    }
  };

  const addCustom = () => {
    const key = normalizeConstantKey(customName);
    const value = parseFloat(customValue);
    if (!CONSTANT_KEY_RE.test(key) || RESERVED_CONSTANT_KEYS.has(key) || key in binding.values) {
      setNameError(t('advFormula.constantsInvalidName'));
      return;
    }
    if (!Number.isFinite(value)) return;
    applyDiscrete({ ...binding.values, [key]: value });
    setCustomName('');
    setCustomValue('');
    setNameError(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* 示例模板：点选回填方程输入（三角变换联动教学，ZOO-188） */}
      {binding.onApplyTemplate && (
        <div className="flex flex-wrap gap-1">
          {ADVANCED_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => binding.onApplyTemplate?.(tpl.equation)}
              title={tpl.equation}
              className="touch-target flex-1 border border-blue-200 bg-blue-50/50 rounded-md px-1.5 py-1 text-left cursor-pointer hover:border-blue-500 hover:bg-blue-50 active:bg-blue-100 transition-colors"
            >
              <span className="block text-[10px] text-gray-400 leading-tight">{t(advancedTemplateNameKey(tpl.id))}</span>
              <span className="block font-serif text-xs text-gray-800 whitespace-nowrap overflow-hidden text-ellipsis">{tpl.equation}</span>
            </button>
          ))}
        </div>
      )}

      {/* 预置槽：点选添加（缺省值）/ 再点移除 */}
      <div className="flex flex-wrap gap-1">
        {PRESET_CONSTANTS.map((p) => {
          const active = p.key in binding.values;
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              aria-label={t('advFormula.constantsPresetAria', { name: p.label })}
              onClick={() => togglePreset(p.key, p.def)}
              className={`touch-target min-w-8 h-6 px-1.5 border rounded-md font-serif text-[13px] cursor-pointer transition-colors ${
                active ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 bg-white text-gray-600 hover:border-blue-500 hover:text-blue-500'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* 已绑定行：数值输入直改实时预览（D5），失焦提交一条 */}
      {entries.length === 0 ? (
        <div className="text-[11px] text-gray-400 leading-relaxed">{t('advFormula.constantsEmpty')}</div>
      ) : (
        entries.map(([key, value]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="font-serif italic text-[13px] text-gray-800 w-8 text-center leading-none">{constantDisplayName(key)}</span>
            <span className="text-gray-400 text-[11px]" aria-hidden="true">
              =
            </span>
            <input
              type="number"
              step="any"
              value={String(value)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) binding.onChange({ ...binding.values, [key]: v });
              }}
              onBlur={binding.onCommit}
              aria-label={t('advFormula.constantsValueAria', { name: constantDisplayName(key) })}
              autoComplete="off"
              className="touch-target flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => {
                const next = { ...binding.values };
                delete next[key];
                applyDiscrete(next);
              }}
              aria-label={t('advFormula.constantsRemoveAria', { name: constantDisplayName(key) })}
              className="touch-target border-none bg-transparent text-gray-400 text-base leading-none cursor-pointer hover:text-red-500 active:text-red-600 transition-colors"
            >
              ×
            </button>
          </div>
        ))
      )}

      {/* 自定义项：符号（支持 θ/v₀ 等书写原貌，归一化为存储键）+ 数值 */}
      <div className="flex items-center gap-1.5">
        <input
          value={customName}
          onChange={(e) => {
            setCustomName(e.target.value);
            setNameError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={t('advFormula.constantsNamePh')}
          autoComplete="off"
          spellCheck={false}
          aria-label={t('advFormula.constantsNamePh')}
          className="touch-target w-[92px] px-1.5 py-1 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500"
        />
        <input
          value={customValue}
          onChange={(e) => {
            setCustomValue(e.target.value);
            setNameError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={t('advFormula.constantsValuePh')}
          inputMode="decimal"
          autoComplete="off"
          aria-label={t('advFormula.constantsValuePh')}
          className="touch-target flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded-md font-serif text-xs text-gray-900 outline-none select-text focus:border-blue-500"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!customName.trim() || !Number.isFinite(parseFloat(customValue))}
          className="touch-target px-2.5 py-1 border border-blue-200 rounded-md bg-blue-50/60 text-[11px] font-medium text-blue-600 cursor-pointer hover:bg-blue-50 active:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {t('advFormula.constantsAdd')}
        </button>
      </div>
      {nameError && (
        <div className="text-[11px] text-red-500 leading-relaxed" role="alert">
          {nameError}
        </div>
      )}

      {/* 解析状态行：合法（显式函数）报自变量字母；欠定引导补常量 */}
      {(outcome.kind === 'error' || outcome.kind === 'explicit') && (
        <div
          className={`text-[11px] leading-relaxed break-all ${
            outcome.kind === 'error' ? 'text-red-500' : 'text-green-600'
          }`}
        >
          {outcome.kind === 'error'
            ? `⚠ ${outcome.message}`
            : t('equation.recognized', { kind: t('equation.kindExplicit', { v: outcome.variable ?? 'x' }) })}
        </div>
      )}
    </div>
  );
}

export default function AdvancedFormulaPanel({ onClose, constants }: AdvancedFormulaPanelProps) {
  const t = useT();

  // Esc 关闭（窗口级监听，LanguageSwitch 同款）。T1 起面板含文本输入（常量名/数值），
  // 输入中 Esc 关面板是模态标准行为；画布快捷键守卫按事件目标判定，不受本监听影响
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // SSG 防御（mathplot-demo 静态导出）：面板仅由用户交互在客户端拉起，服务端一律不渲染
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="whiteboard-chrome fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('advFormula.title')}
        className="touch-panel touch-modal bg-white rounded-2xl shadow-2xl w-[340px] max-w-[calc(100vw-1.5rem)] max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 p-3.5 border-b">
          <span className="font-serif italic text-blue-500 text-base leading-none">ƒ</span>
          <h2 className="text-[15px] font-semibold text-gray-700">{t('advFormula.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('advFormula.closeAria')}
            className="touch-target ml-auto border-none bg-transparent text-gray-400 text-xl leading-none cursor-pointer hover:text-gray-600 active:text-gray-800 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          <div className="text-[11px] text-gray-400 leading-relaxed">{t('advFormula.hint')}</div>
          {SECTIONS.map((s) => {
            // T1：常量分区带绑定时渲染编辑区（不再显示 coming soon）；其余分区维持占位
            const constantsLive = s.id === 'constants' && constants;
            return (
              <section key={s.id} className="border border-gray-200 rounded-lg p-2.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-serif italic text-blue-500 text-sm leading-none">{s.glyph}</span>
                  <span className="text-[13px] font-semibold text-gray-700">{t(s.nameKey)}</span>
                  {!constantsLive && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 font-medium">
                      {t('advFormula.comingSoon')}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 leading-relaxed">{t(s.descKey)}</div>
                {constantsLive ? (
                  <ConstantsArea binding={constants} />
                ) : (
                  // T0 占位：分区控件由后续任务填充（f′·切线·积分 T2·T3 / 参数式 T4 / 物理模板 T5）
                  <div className="text-[11px] text-gray-300 leading-relaxed select-none" aria-hidden="true">
                    ▢ ▢ ▢
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
