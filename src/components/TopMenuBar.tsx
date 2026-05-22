'use client';

import { useState, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { exportToImage, exportToSvg, downloadBlob, downloadText } from '@/lib/export';
import { saveToLocal, saveToServer } from '@/lib/persistence';

export default function TopMenuBar() {
  const {
    elements, viewport, documentId, documentTitle,
    undo, redo, undoStack, redoStack, clearAll, newDocument, markSaved, isDirty, setDocumentTitle,
  } = useStore();
  const [showExport, setShowExport] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

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
    const svg = exportToSvg(elements);
    downloadText(svg, `${documentTitle || 'whiteboard'}.svg`);
    setShowExport(false);
  }, [elements, documentTitle]);

  const handleSaveLocal = useCallback(() => {
    saveToLocal({ id: documentId, title: documentTitle, elements, viewport, createdAt: Date.now(), updatedAt: Date.now() });
    markSaved();
    setMessage('Saved to browser');
    setTimeout(() => setMessage(''), 2000);
  }, [documentId, documentTitle, elements, viewport, markSaved]);

  const handleSaveServer = useCallback(async () => {
    setSaving(true);
    try {
      await saveToServer({ id: documentId, title: documentTitle, elements, viewport, createdAt: Date.now(), updatedAt: Date.now() });
      markSaved();
      setMessage('Saved to server');
    } catch {
      setMessage('Server save failed');
    }
    setSaving(false);
    setTimeout(() => setMessage(''), 2000);
  }, [documentId, documentTitle, elements, viewport, markSaved]);

  const handleClear = useCallback(() => {
    if (confirm('Clear all elements?')) clearAll();
  }, [clearAll]);

  const handleNew = useCallback(() => {
    if (isDirty && !confirm('Discard unsaved changes?')) return;
    newDocument();
  }, [isDirty, newDocument]);

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 px-2 py-1.5 z-10">
      <button onClick={handleNew} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md" title="New (Ctrl+N)">
        New
      </button>

      <div className="w-px h-5 bg-gray-200" />

      <button onClick={undo} disabled={undoStack.length === 0} className="px-1.5 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-30" title="Undo (Ctrl+Z)">
        ↩
      </button>
      <button onClick={redo} disabled={redoStack.length === 0} className="px-1.5 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-30" title="Redo (Ctrl+Shift+Z)">
        ↪
      </button>

      <div className="w-px h-5 bg-gray-200" />

      <div className="relative">
        <button onClick={() => setShowExport(!showExport)} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md">
          Export
        </button>
        {showExport && (
          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[120px]">
            <button onClick={handleExportPng} className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50">Export PNG</button>
            <button onClick={handleExportJpg} className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50">Export JPG</button>
            <button onClick={handleExportSvg} className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50">Export SVG</button>
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-gray-200" />

      <button onClick={handleSaveLocal} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md">
        Save
      </button>
      <button onClick={handleSaveServer} disabled={saving} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-50">
        {saving ? '...' : 'Save Server'}
      </button>

      <div className="w-px h-5 bg-gray-200" />

      <button onClick={handleClear} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md">
        Clear
      </button>

      <div className="w-px h-5 bg-gray-200" />

      <span className="text-xs text-gray-500 px-1">{Math.round(viewport.scale * 100)}%</span>

      {message && <span className="text-xs text-green-600 px-1">{message}</span>}
      {isDirty && <span className="w-2 h-2 rounded-full bg-orange-400" title="Unsaved changes" />}
    </div>
  );
}
