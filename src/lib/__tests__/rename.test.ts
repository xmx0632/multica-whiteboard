/**
 * 白板重命名单测（ZOO-158 完成定义：重命名写回列表、空名回退、当前文档联动）：
 * - resolveRenameInput：空名 / 纯空白 / 未改动 → null（保持原名），正常输入去空白；
 * - renameLocalDocument：列表 meta 与文档体同步改名、updatedAt 不重排、未命中不动存储；
 * - renameServerDocument：PATCH 只发 title，非 2xx / 网络异常 → false；
 * - store.applyDocumentRename：命当前打开文档改名且不置 isDirty，未命中不动。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveToLocal,
  loadFromLocal,
  listLocalDocuments,
  renameLocalDocument,
  renameServerDocument,
  resolveRenameInput,
} from '../persistence';
import { useStore } from '../store';

class MockLocalStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

function seedDoc(id: string, title: string) {
  saveToLocal({
    id,
    title,
    elements: [],
    viewport: { offsetX: 0, offsetY: 0, scale: 1 },
    createdAt: 1000,
    updatedAt: 1000,
  });
}

describe('resolveRenameInput（空名回退裁决）', () => {
  it('空串 / 纯空白 → null，保持原名', () => {
    expect(resolveRenameInput('', 'Old')).toBeNull();
    expect(resolveRenameInput('   ', 'Old')).toBeNull();
  });

  it('与原名相同（含首尾空白差异视为未改动）→ null', () => {
    expect(resolveRenameInput('Old', 'Old')).toBeNull();
    expect(resolveRenameInput(' Old ', 'Old')).toBeNull();
  });

  it('有效输入 → 去首尾空白返回', () => {
    expect(resolveRenameInput('  New Name  ', 'Old')).toBe('New Name');
  });
});

describe('renameLocalDocument（写回列表 + 文档体）', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', new MockLocalStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('列表与文档体同步改名，刷新读取仍为新名', () => {
    seedDoc('doc-1', 'Before');
    seedDoc('doc-2', 'Keep');

    expect(renameLocalDocument('doc-1', 'After')).toBe(true);

    const list = listLocalDocuments();
    expect(list.find((d) => d.id === 'doc-1')?.title).toBe('After');
    expect(list.find((d) => d.id === 'doc-2')?.title).toBe('Keep');
    expect(loadFromLocal('doc-1')?.title).toBe('After');
  });

  it('改名不动 updatedAt——列表顺序不因改名重排', () => {
    seedDoc('doc-old', 'First');
    seedDoc('doc-new', 'Second'); // updatedAt 更晚，排列表首位
    const before = listLocalDocuments().map((d) => d.id);

    renameLocalDocument('doc-old', 'Renamed');

    expect(listLocalDocuments().map((d) => d.id)).toEqual(before);
  });

  it('未命中 id → false 且不动存储', () => {
    seedDoc('doc-1', 'Only');
    const before = JSON.stringify(listLocalDocuments());

    expect(renameLocalDocument('nope', 'X')).toBe(false);
    expect(JSON.stringify(listLocalDocuments())).toBe(before);
    expect(loadFromLocal('nope')).toBeNull();
  });
});

describe('renameServerDocument（PATCH 服务端记录）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PATCH { title } 到 /api/whiteboards/:id，成功 → true', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(renameServerDocument('doc-1', 'After')).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/whiteboards/doc-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'After' });
  });

  it('404 → false；网络异常 → false（不抛出）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(renameServerDocument('gone', 'X')).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(renameServerDocument('doc-1', 'X')).resolves.toBe(false);
  });
});

describe('store.applyDocumentRename（当前打开文档联动）', () => {
  it('命当前打开文档：改名且不置 isDirty（写穿已持久化）', () => {
    useStore.setState({ documentId: 'doc-open', documentTitle: 'Old', isDirty: false });

    useStore.getState().applyDocumentRename('doc-open', 'New');

    expect(useStore.getState().documentTitle).toBe('New');
    expect(useStore.getState().isDirty).toBe(false);
  });

  it('未命中当前文档：标题不动', () => {
    useStore.setState({ documentId: 'doc-open', documentTitle: 'Old' });

    useStore.getState().applyDocumentRename('doc-other', 'New');

    expect(useStore.getState().documentTitle).toBe('Old');
  });
});
