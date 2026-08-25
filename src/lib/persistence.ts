import { WhiteboardDocument, CURRENT_SCHEMA_VERSION } from './types';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_PREFIX = 'whiteboard_';
const DOC_LIST_KEY = 'whiteboard_documents';

// ========== localStorage persistence ==========

interface DocMeta {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
}

function getDocList(): DocMeta[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DOC_LIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDocList(list: DocMeta[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DOC_LIST_KEY, JSON.stringify(list));
}

export function saveToLocal(doc: WhiteboardDocument): void {
  if (typeof window === 'undefined') return;

  const meta: DocMeta = {
    id: doc.id,
    title: doc.title,
    updatedAt: Date.now(),
    createdAt: doc.createdAt,
  };

  const list = getDocList();
  const idx = list.findIndex((d) => d.id === doc.id);
  if (idx >= 0) {
    list[idx] = meta;
  } else {
    list.unshift(meta);
  }
  saveDocList(list);

  localStorage.setItem(
    STORAGE_PREFIX + doc.id,
    JSON.stringify({ ...doc, updatedAt: meta.updatedAt })
  );
}

export function loadFromLocal(id: string): WhiteboardDocument | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function deleteFromLocal(id: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_PREFIX + id);
  const list = getDocList().filter((d) => d.id !== id);
  saveDocList(list);
}

/**
 * 行内重命名的输入裁决：去首尾空白后为空或与原名相同 → null（调用方保持原名），
 * 否则返回整理后的新名。空名回退 / 无变更不发写的规则收口在这里（ZOO-158）。
 */
export function resolveRenameInput(raw: string, current: string): string | null {
  const title = raw.trim();
  if (!title || title === current) return null;
  return title;
}

/**
 * 重命名本地白板：列表 meta 与已存文档体同步改 title（两者都改，否则下次
 * loadFromLocal 会带回旧名）；updatedAt 保持不变——改名不是内容变更，不重排列表。
 * 返回是否命中（未命中不动任何存储）。
 */
export function renameLocalDocument(id: string, title: string): boolean {
  if (typeof window === 'undefined') return false;
  const list = getDocList();
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0) return false;
  list[idx] = { ...list[idx], title };
  saveDocList(list);

  const raw = localStorage.getItem(STORAGE_PREFIX + id);
  if (raw) {
    try {
      const doc = JSON.parse(raw);
      localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify({ ...doc, title }));
    } catch {
      // 文档体损坏时仅保留列表名，下次保存自愈
    }
  }
  return true;
}

export function listLocalDocuments(): DocMeta[] {
  return getDocList().sort((a, b) => b.updatedAt - a.updatedAt);
}

// —— 自动保存（IndexedDB 快照 + 恢复）见 autosave.ts / useAutosave.ts（ZOO-170）——

// ========== Server-side persistence (API routes) ==========

const API_BASE = '/api/whiteboards';

export async function saveToServer(doc: WhiteboardDocument): Promise<void> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error(`Save failed: ${res.statusText}`);
}

export async function loadFromServer(id: string): Promise<WhiteboardDocument | null> {
  const res = await fetch(`${API_BASE}/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Load failed: ${res.statusText}`);
  return res.json();
}

export async function listServerDocuments(): Promise<DocMeta[]> {
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function deleteFromServer(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed: ${res.statusText}`);
}

/**
 * 重命名服务端白板（PATCH 只改 title，不整篇回写，避免用过期 elements 覆盖他端改动）。
 * 返回是否命中（404 / 失败 → false，由调用方决定是否提示）。
 */
export async function renameServerDocument(id: string, title: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function createNewDocument(title: string = 'Untitled'): WhiteboardDocument {
  return {
    id: uuidv4(),
    title,
    elements: [],
    viewport: { offsetX: 0, offsetY: 0, scale: 1 },
    schemaVersion: CURRENT_SCHEMA_VERSION, // v3 起含菱形元素（ZOO-217）
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
