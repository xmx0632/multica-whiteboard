'use client';

import { useState, useEffect, useCallback } from 'react';
import { listLocalDocuments, loadFromLocal, deleteFromLocal, listServerDocuments, loadFromServer, deleteFromServer } from '@/lib/persistence';
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
  const { loadDocument, newDocument, isDirty } = useStore();

  const refreshDocs = useCallback(async () => {
    setLocalDocs(listLocalDocuments());
    const server = await listServerDocuments();
    setServerDocs(server);
  }, []);

  useEffect(() => {
    if (open) refreshDocs();
  }, [open, refreshDocs]);

  const handleLoad = useCallback(async (id: string, source: 'local' | 'server') => {
    if (isDirty && !confirm('Discard unsaved changes?')) return;
    let doc: WhiteboardDocument | null = null;
    if (source === 'local') {
      doc = loadFromLocal(id);
    } else {
      doc = await loadFromServer(id);
    }
    if (doc) {
      loadDocument(doc);
      setOpen(false);
    }
  }, [isDirty, loadDocument]);

  const handleDelete = useCallback(async (id: string, source: 'local' | 'server') => {
    if (!confirm('Delete this whiteboard?')) return;
    if (source === 'local') {
      deleteFromLocal(id);
    } else {
      await deleteFromServer(id);
    }
    refreshDocs();
  }, [refreshDocs]);

  const handleNew = useCallback(() => {
    if (isDirty && !confirm('Discard unsaved changes?')) return;
    newDocument();
    setOpen(false);
  }, [isDirty, newDocument]);

  const formatDate = (ts: number) => new Date(ts).toLocaleString();

  const docs = tab === 'local' ? localDocs : serverDocs;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 z-10"
      >
        ☰ History
      </button>

      {open && (
        <div className="absolute inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Whiteboards</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <div className="flex border-b">
              <button
                onClick={() => setTab('local')}
                className={`flex-1 py-2 text-sm font-medium ${tab === 'local' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              >
                Browser Storage ({localDocs.length})
              </button>
              <button
                onClick={() => setTab('server')}
                className={`flex-1 py-2 text-sm font-medium ${tab === 'server' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
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
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{doc.title}</div>
                      <div className="text-xs text-gray-400">{formatDate(doc.updatedAt)}</div>
                    </div>
                    <button
                      onClick={() => handleLoad(doc.id, tab)}
                      className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => handleDelete(doc.id, tab)}
                      className="px-2 py-1 text-xs text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t">
              <button
                onClick={handleNew}
                className="w-full py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
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
