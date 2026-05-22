import { WhiteboardDocument, WhiteboardElement, Viewport } from './types';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_PREFIX = 'whiteboard_';
const DOC_LIST_KEY = 'whiteboard_documents';
const AUTOSAVE_KEY = 'whiteboard_autosave';

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

export function listLocalDocuments(): DocMeta[] {
  return getDocList().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function autoSave(elements: WhiteboardElement[], viewport: Viewport, documentId: string, documentTitle: string): void {
  if (typeof window === 'undefined') return;
  const data = { elements, viewport, documentId, documentTitle, updatedAt: Date.now() };
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
}

export function loadAutoSave(): { elements: WhiteboardElement[]; viewport: Viewport; documentId: string; documentTitle: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAutoSave(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(AUTOSAVE_KEY);
}

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

export function createNewDocument(title: string = 'Untitled'): WhiteboardDocument {
  return {
    id: uuidv4(),
    title,
    elements: [],
    viewport: { offsetX: 0, offsetY: 0, scale: 1 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
