'use client';

/**
 * 高级公式二级面板（ZOO-194 T0：框架与占位分区，各分区功能由 T1–T5 填充）。
 *
 * UI 分层（ZOO-186 报告 v1.1 §四）：微积分 / 物理能力独立入口 + 二级面板，
 * 现有 EquationEditor / MathPlotParams 的既有控件零改动。两个入口共用本组件：
 * - 入口 1（创建侧）：EquationEditor 模板分组区底部「微积分 / 物理公式…」；
 * - 入口 2（编辑侧）：MathPlotParams 条件出现的「公式设置」按钮。
 *
 * - 经 portal 挂 document.body：不进入侧面板的 transform 定位上下文，
 *   也不挤占既有面板布局（空间独立）；
 * - 开合是纯 UI 态（调用方 useState），不入元素数据、不入撤销历史；
 * - T0 只渲染四分区骨架 + 空态引导，T1（常量）/ T2/T3（微积分）/ T4（参数式）/
 *   T5（物理模板）在各自分区落控件。
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n/I18nProvider';

export interface AdvancedFormulaPanelProps {
  /** 关闭出口（背板点击 / Esc / 标题栏 ✕，三路同源） */
  onClose: () => void;
}

/** 四分区骨架（组序即面板展示序）：字形为语言无关数学记号，名称 / 描述走资源键 */
const SECTIONS: readonly { glyph: string; nameKey: string; descKey: string }[] = [
  { glyph: '∫', nameKey: 'advFormula.sectionCalculus', descKey: 'advFormula.sectionCalculusDesc' },
  { glyph: '⚛', nameKey: 'advFormula.sectionPhysics', descKey: 'advFormula.sectionPhysicsDesc' },
  { glyph: 'A', nameKey: 'advFormula.sectionConstants', descKey: 'advFormula.sectionConstantsDesc' },
  { glyph: 't', nameKey: 'advFormula.sectionParametric', descKey: 'advFormula.sectionParametricDesc' },
];

export default function AdvancedFormulaPanel({ onClose }: AdvancedFormulaPanelProps) {
  const t = useT();

  // Esc 关闭（窗口级监听，LanguageSwitch 同款；面板自身无文本输入，不与编辑态守卫冲突）
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
          {SECTIONS.map((s) => (
            <section key={s.nameKey} className="border border-gray-200 rounded-lg p-2.5 flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className="font-serif italic text-blue-500 text-sm leading-none">{s.glyph}</span>
                <span className="text-[13px] font-semibold text-gray-700">{t(s.nameKey)}</span>
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 font-medium">
                  {t('advFormula.comingSoon')}
                </span>
              </div>
              <div className="text-[11px] text-gray-500 leading-relaxed">{t(s.descKey)}</div>
              {/* T0 占位：分区控件由后续任务填充（常量 T1 / f′·切线·积分 T2·T3 / 参数式 T4 / 物理模板 T5） */}
              <div className="text-[11px] text-gray-300 leading-relaxed select-none" aria-hidden="true">
                ▢ ▢ ▢
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
