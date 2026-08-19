'use client';

import { useState, useEffect, useCallback } from 'react';
import { listLocalDocuments, loadFromLocal, deleteFromLocal, listServerDocuments, loadFromServer, deleteFromServer, renameLocalDocument, renameServerDocument, resolveRenameInput } from '@/lib/persistence';
import { deleteSnapshot, recoverForDocument } from '@/lib/autosave';
import { useStore } from '@/lib/store';
import { WhiteboardDocument } from '@/lib/types';

interface DocMeta {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
}

export default function HistoryPanel() {
  const [open, setOpen] = useState(false);
  const [localDocs, setLocalDocs] = useState<DocMeta[]>([]);
  const [serverDocs, setServerDocs] = useState<DocMeta[]>([]);
  const [tab, setTab] = useState<'local' | 'server'>('local');
  // 行内重命名（ZOO-158）：editingId 命中的行渲染输入框
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const { loadDocument, newDocument, isDirty, applyDocumentRename } = useStore();

  const refreshDocs = useCallback(async () => {
    setLocalDocs(listLocalDocuments());
    const server = await listServerDocuments();
    setServerDocs(server);
  }, []);

  useEffect(() => {
    if (open) refreshDocs();
  }, [open, refreshDocs]);

  // 切页签 / 关面板时收起行内编辑，避免编辑态串到另一份列表
  const switchTab = useCallback((next: 'local' | 'server') => {
    setTab(next);
    setEditingId(null);
  }, []);
  const closePanel = useCallback(() => {
    setOpen(false);
    setEditingId(null);
  }, []);

  const handleLoad = useCallback(async (id: string, source: 'local' | 'server') => {
    if (isDirty && !confirm('Discard unsaved changes?')) return;
    let doc: WhiteboardDocument | null = null;
    if (source === 'local') {
      doc = loadFromLocal(id);
    } else {
      doc = await loadFromServer(id);
    }
    if (doc) {
      // 本地快照比载入的版本新（刷新前有未保存编辑）→ 打开快照版本（ZOO-170 需求 3）
      loadDocument(await recoverForDocument(doc));
      closePanel();
    }
  }, [isDirty, loadDocument, closePanel]);

  const handleDelete = useCallback(async (id: string, source: 'local' | 'server') => {
    if (!confirm('Delete this whiteboard?')) return;
    if (source === 'local') {
      deleteFromLocal(id);
    } else {
      await deleteFromServer(id);
    }
    // 删除即弃：连带清掉自动保存快照与会话标记，防止刷新后「复活」
    await deleteSnapshot(id);
    refreshDocs();
  }, [refreshDocs]);

  const handleNew = useCallback(() => {
    if (isDirty && !confirm('Discard unsaved changes?')) return;
    newDocument();
    closePanel();
  }, [isDirty, newDocument, closePanel]);

  const startRename = useCallback((doc: DocMeta) => {
    setEditingId(doc.id);
    setEditingValue(doc.title);
  }, []);

  /** 提交重命名：空名/未改动保持原名（resolveRenameInput 裁决）；写穿两份存储（若都存在）并联动当前打开文档 */
  const commitRename = useCallback(async (doc: DocMeta, raw: string) => {
    setEditingId(null);
    const title = resolveRenameInput(raw, doc.title);
    if (title === null) return;

    if (tab === 'local') {
      renameLocalDocument(doc.id, title);
      // 已 Save Server 的白板同步服务端记录，避免两份存储名字分叉
      if (serverDocs.some((d) => d.id === doc.id)) await renameServerDocument(doc.id, title);
    } else {
      await renameServerDocument(doc.id, title);
      if (localDocs.some((d) => d.id === doc.id)) renameLocalDocument(doc.id, title);
    }
    applyDocumentRename(doc.id, title);
    refreshDocs();
  }, [tab, localDocs, serverDocs, applyDocumentRename, refreshDocs]);

  const cancelRename = useCallback(() => setEditingId(null), []);

  const formatDate = (ts: number) => new Date(ts).toLocaleString();

  const docs = tab === 'local' ? localDocs : serverDocs;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="whiteboard-chrome touch-target absolute top-3 left-3 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 active:bg-gray-100 z-10"
      >
        ☰ History
      </button>

      {open && (
        <div className="absolute inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={closePanel}>
          <div className="touch-panel touch-modal bg-white rounded-2xl shadow-2xl w-[480px] max-w-[calc(100vw-1.5rem)] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Whiteboards</h2>
              <button onClick={closePanel} className="touch-target text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <div className="flex border-b">
              <button
                onClick={() => switchTab('local')}
                className={`touch-target flex-1 py-2 text-sm font-medium ${tab === 'local' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              >
                Browser Storage ({localDocs.length})
              </button>
              <button
                onClick={() => switchTab('server')}
                className={`touch-target flex-1 py-2 text-sm font-medium ${tab === 'server' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              >
                Server ({serverDocs.length})
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {docs.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">
                  No saved whiteboards
                </div>
              ) : (
                docs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 group">
                    {editingId === doc.id ? (
                      /* 行内编辑：text-base 防 iOS 聚焦缩放；Enter 提交 / Esc 取消 / 失焦提交 */
                      <input
                        autoFocus
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => commitRename(doc, editingValue)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(doc, editingValue);
                          if (e.key === 'Escape') cancelRename();
                        }}
                        className="flex-1 min-w-0 text-base border border-blue-400 rounded-md px-2 py-1 outline-none"
                        aria-label="Whiteboard name"
                      />
                    ) : (
                      <>
                        <div className="flex-1 min-w-0" title="Double-click to rename">
                          <div
                            className="text-sm font-medium truncate cursor-text"
                            onDoubleClick={() => startRename(doc)}
                          >
                            {doc.title}
                          </div>
                          <div className="text-xs text-gray-400">{formatDate(doc.updatedAt)}</div>
                        </div>
                        <button
                          onClick={() => handleLoad(doc.id, tab)}
                          className="touch-target px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 active:bg-blue-200"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => startRename(doc)}
                          className="touch-target touch-visible px-2 py-1 text-xs text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => handleDelete(doc.id, tab)}
                          className="touch-target touch-visible px-2 py-1 text-xs text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t">
              <button
                onClick={handleNew}
                className="touch-target w-full py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 active:bg-blue-700 transition-colors"
              >
                New Whiteboard
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
