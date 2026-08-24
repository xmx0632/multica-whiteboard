'use client';

import { useState, useCallback, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { exportToImage, exportToSvg, exportFrameToImage, exportFrameToSvg, downloadBlob, downloadText } from '@/lib/export';
import { saveToLocal, saveToServer } from '@/lib/persistence';
import { useAutosaveStore } from '@/lib/autosave';
import { usePhonePortrait } from '@/lib/usePhonePortrait';
import { CANVAS_INTERACT_EVENT } from '@/lib/landscape';
import { useI18n } from '@/i18n/I18nProvider';
import { FrameElement } from '@/lib/types';
import { useShortcutUI } from '@/lib/keymap';
import { confirmDiscardNew } from '@/lib/confirmDialog';
import ZoomControl from './ZoomControl';
import LanguageSwitch from './LanguageSwitch';

export default function TopMenuBar() {
  const {
    elements, viewport, documentId, documentTitle, schemaVersion,
    undo, redo, undoStack, redoStack, clearAll, newDocument, markSaved, isDirty,
    activeFrameId,
  } = useStore();
  const { locale, t } = useI18n();
  const [showExport, setShowExport] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // 自动保存状态（ZOO-170）：常驻「✓ 已自动保存 HH:MM」+ 恢复/冲突一次性提示
  const { lastSavedAt, notice, setNotice } = useAutosaveStore();
  useEffect(() => {
    if (!notice) return;
    const t2 = setTimeout(() => setNotice(null), notice.kind === 'conflict' ? 6000 : 3000);
    return () => clearTimeout(t2);
  }, [notice, setNotice]);

  // 手机竖屏（ZOO-152 追加）：菜单默认收起为一枚钮，点击弹出完整面板
  const phonePortrait = usePhonePortrait();
  const [menuOpen, setMenuOpen] = useState(false);

  // 画布触点 / 展开菜单后操作完随手落笔 → 自动收起（与底部抽屉同语义）
  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener(CANVAS_INTERACT_EVENT, close);
    return () => window.removeEventListener(CANVAS_INTERACT_EVENT, close);
  }, []);

  const handleExportPng = useCallback(async () => {
    const blob = await exportToImage(elements, 'png', { scale: 2 });
    downloadBlob(blob, `${documentTitle || 'whiteboard'}.png`);
    setShowExport(false);
  }, [elements, documentTitle]);

  const handleExportJpg = useCallback(async () => {
    const blob = await exportToImage(elements, 'jpg', { scale: 2, background: '#ffffff' });
    downloadBlob(blob, `${documentTitle || 'whiteboard'}.jpg`);
    setShowExport(false);
  }, [elements, documentTitle]);

  const handleExportSvg = useCallback(() => {
    const svg = exportToSvg(elements, t);
    downloadText(svg, `${documentTitle || 'whiteboard'}.svg`);
    setShowExport(false);
  }, [elements, documentTitle, t]);

  // —— 导出当前页（ZOO-198）：按帧边界裁剪，含页内元素与页名，无页外内容 ——
  const activeFrame = elements.find(
    (e): e is FrameElement => e.type === 'frame' && e.id === activeFrameId
  ) ?? null;

  const handleExportPagePng = useCallback(async () => {
    if (!activeFrame) return;
    const blob = await exportFrameToImage(activeFrame, elements, 'png', { scale: 2 });
    downloadBlob(blob, `${documentTitle || 'whiteboard'}-${activeFrame.name}.png`);
    setShowExport(false);
  }, [activeFrame, elements, documentTitle]);

  const handleExportPageSvg = useCallback(() => {
    if (!activeFrame) return;
    const svg = exportFrameToSvg(activeFrame, elements, t);
    downloadText(svg, `${documentTitle || 'whiteboard'}-${activeFrame.name}.svg`);
    setShowExport(false);
  }, [activeFrame, elements, documentTitle, t]);

  const handleSaveLocal = useCallback(() => {
    saveToLocal({ id: documentId, title: documentTitle, schemaVersion, elements, viewport, createdAt: Date.now(), updatedAt: Date.now() });
    markSaved();
    setMessage(t('menu.savedLocal'));
    setTimeout(() => setMessage(''), 2000);
  }, [documentId, documentTitle, schemaVersion, elements, viewport, markSaved, t]);

  const handleSaveServer = useCallback(async () => {
    setSaving(true);
    try {
      await saveToServer({ id: documentId, title: documentTitle, schemaVersion, elements, viewport, createdAt: Date.now(), updatedAt: Date.now() });
      markSaved();
      setMessage(t('menu.savedServer'));
    } catch {
      setMessage(t('menu.saveFailed'));
    }
    setSaving(false);
    setTimeout(() => setMessage(''), 2000);
  }, [documentId, documentTitle, schemaVersion, elements, viewport, markSaved, t]);

  const handleClear = useCallback(() => {
    if (confirm(t('menu.confirmClear'))) clearAll();
  }, [clearAll, t]);

  const handleNew = useCallback(() => {
    // 未保存确认改自定义弹窗（ZOO-209）：Enter 放弃并新建 / Esc 留在当前画布
    if (!isDirty) {
      // ZOO-176：默认标题随语言（新建即入历史列表的可见文案）
      newDocument(t('common.untitled'));
      return;
    }
    void confirmDiscardNew(t).then((ok) => {
      if (ok) newDocument(t('common.untitled'));
    });
  }, [isDirty, newDocument, t]);

  const barContent = (
    <>
      <button onClick={handleNew} className="touch-target px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md" title={`${t('menu.new')} (Alt+N)`}>
        {t('menu.new')}
      </button>

      <div className="w-px h-5 bg-gray-200" />

      <button onClick={undo} disabled={undoStack.length === 0} className="touch-target px-1.5 py-1 text-sm text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md disabled:opacity-30" title={`${t('menu.undo')} (Ctrl+Z)`}>
        ↩
      </button>
      <button onClick={redo} disabled={redoStack.length === 0} className="touch-target px-1.5 py-1 text-sm text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md disabled:opacity-30" title={`${t('menu.redo')} (Ctrl+Shift+Z)`}>
        ↪
      </button>

      <div className="w-px h-5 bg-gray-200" />

      <div className="relative">
        <button onClick={() => setShowExport(!showExport)} className="touch-target px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md">
          {t('menu.export')}
        </button>
        {showExport && (
          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[120px]">
            <button onClick={handleExportPng} className="touch-target w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 active:bg-gray-100">{t('menu.exportPng')}</button>
            <button onClick={handleExportJpg} className="touch-target w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 active:bg-gray-100">{t('menu.exportJpg')}</button>
            <button onClick={handleExportSvg} className="touch-target w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 active:bg-gray-100">{t('menu.exportSvg')}</button>
            <div className="h-px bg-gray-100 my-1" />
            <button onClick={handleExportPagePng} disabled={!activeFrame} className="touch-target w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40" title={activeFrame ? undefined : t('pages.exportDisabledTip')}>{t('menu.exportPagePng')}</button>
            <button onClick={handleExportPageSvg} disabled={!activeFrame} className="touch-target w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40" title={activeFrame ? undefined : t('pages.exportDisabledTip')}>{t('menu.exportPageSvg')}</button>
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-gray-200" />

      <button onClick={handleSaveLocal} className="touch-target px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md" title={`${t('menu.save')} (Alt+S)`}>
        {t('menu.save')}
      </button>
      <button onClick={handleSaveServer} disabled={saving} className="touch-target px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md disabled:opacity-50">
        {saving ? '...' : t('menu.saveServer')}
      </button>

      <div className="w-px h-5 bg-gray-200" />

      <button onClick={handleClear} className="touch-target px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md">
        {t('menu.clear')}
      </button>

      <div className="w-px h-5 bg-gray-200" />

      <ZoomControl />

      <div className="w-px h-5 bg-gray-200" />

      {/* ZOO-176：语言切换（cookie 记住偏好，优先级高于自动检测） */}
      <LanguageSwitch />

      <div className="w-px h-5 bg-gray-200" />

      {/* 快捷键帮助（ZOO-205）：? 入口按钮，与 Alt+/ 同一开合源 */}
      <button
        onClick={() => useShortcutUI.getState().setHelpOpen(true)}
        aria-label={t('shortcuts.title')}
        title={`${t('shortcuts.title')} (Alt+/)`}
        className="touch-target px-1.5 py-1 text-sm text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-md"
      >
        ?
      </button>

      {message && <span className="text-xs text-green-600 px-1">{message}</span>}
      {notice ? (
        <span className={`text-xs px-1 ${notice.kind === 'conflict' ? 'text-amber-600' : 'text-blue-600'}`}>
          {notice.text}
        </span>
      ) : lastSavedAt ? (
        <span className="text-xs text-gray-400 px-1" title={t('menu.autosavedTip')}>
          {t('menu.autosaved', {
            time: new Date(lastSavedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
          })}
        </span>
      ) : null}
      {isDirty && <span className="w-2 h-2 rounded-full bg-orange-400" title={t('menu.dirtyTip')} />}
    </>
  );

  // —— 手机竖屏：默认收起为一枚钮（顶部不常驻占位），点击弹出完整面板 ——
  if (phonePortrait && !menuOpen) {
    return (
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={t('menu.openMenuAria')}
        className="whiteboard-chrome touch-target absolute top-3 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 active:bg-gray-100 z-10"
      >
        {t('menu.menu')}
      </button>
    );
  }

  return (
    <div className="whiteboard-chrome touch-menubar absolute top-3 left-1/2 -translate-x-1/2 flex flex-wrap justify-center items-center gap-1 max-w-[calc(100vw-1.5rem)] bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 px-2 py-1.5 z-10">
      {barContent}
      {phonePortrait && (
        <>
          <div className="w-px h-5 bg-gray-200" />
          <button
            onClick={() => setMenuOpen(false)}
            aria-label={t('menu.closeMenuAria')}
            className="touch-target px-2 py-1 text-xs text-gray-400 hover:text-gray-600 active:text-gray-800 rounded-md"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}
