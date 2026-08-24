/**
 * 白板自动保存（ZOO-170 客户端兜底）：
 *
 * 服务端存储在 Vercel 上不持久（ZOO-169 结论），编辑内容必须先落本地。
 * 本模块提供「快照存储 + 恢复裁决」两层：
 *
 * - 存储：IndexedDB 为主（异步、无容量压力），localStorage 降级（无 IDB / IDB 打开失败）；
 *   pagehide / visibilitychange 的同步兜底走 localStorage（IDB 事务不保证在卸载前落盘）。
 * - 恢复：shouldRestoreSnapshot 纯函数裁决「本地是否新于服务端（含服务端为空 / 断网）」，
 *   recoverForDocument / recoverLastSession 供启动恢复与 History 打开两条路径复用。
 *
 * 多标签页策略（ZOO-170 需求 5）：last-write-wins——各标签页各自写快照（带 tabId），
 * 检测到他人写入且内容不同 → 冲突提示，最近写入者胜出，不做合并。
 *
 * 撤销 / 重做栈不入快照（体积与跨会话语义都不划算），恢复后清空，见 PR 说明。
 */
import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { WhiteboardDocument, WhiteboardElement, Viewport } from './types';

// ========== 快照模型 ==========

export interface AutosaveSnapshot {
  documentId: string;
  documentTitle: string;
  elements: WhiteboardElement[];
  viewport: Viewport;
  /** 快照生成时刻（ms）；恢复裁决与 last-write-wins 都以它为准 */
  updatedAt: number;
  /** 写入快照的标签页（多标签页冲突提示用；恢复方自己的 tabId 不同即说明他人写过） */
  tabId: string;
  /** 内容指纹（autosaveSignature）：恢复后回填 lastSignature，避免「恢复即重写」 */
  sig: string;
  /** 数据模型版本透传（ZOO-198）：不进指纹（版本号变化不是内容冲突） */
  schemaVersion?: number;
}

/** 降级存储的 per-doc 键与索引（IndexedDB 不可用时才使用） */
const LS_SNAPSHOT_PREFIX = 'whiteboard_autosave_snap_';
const LS_INDEX_KEY = 'whiteboard_autosave_ls_index';
/** 最近一次自动保存的会话标记：刷新后按它找回当前白板（需求 3「新建未保存可找回」） */
export const SESSION_MARKER_KEY = 'whiteboard_last_session';
/** 标签页 id 存 sessionStorage：同标签页刷新沿用（防误报多标签页冲突），跨标签页天然隔离 */
const TAB_ID_KEY = 'whiteboard_tab_id';

// ========== 内容指纹 ==========
// 只取会变的字段做轻量签名（避免每次 4MB 级 stringify 对比）；坐标取整——
// 亚像素级漂移不构成一次需要落盘的内容变更。

function samplePathPoints(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  const mid = points[Math.floor((points.length - 1) / 2)];
  const last = points[points.length - 1];
  return `${points.length}@${Math.round(points[0].x)},${Math.round(points[0].y)};${Math.round(mid.x)},${Math.round(mid.y)};${Math.round(last.x)},${Math.round(last.y)}`;
}

export function elementSignature(el: WhiteboardElement): string {
  const base = `${el.id}|${el.type}|${Math.round(el.x)},${Math.round(el.y)}|${el.strokeColor}|${el.strokeWidth}|${el.opacity}|${el.dash ?? 'solid'}`;
  switch (el.type) {
    case 'path':
      return `${base}|p:${samplePathPoints(el.points)}`;
    case 'text':
      return `${base}|t:${el.content}|${el.fontSize}|${el.fontFamily}|${el.color}|${Math.round(el.width)}x${Math.round(el.height)}`;
    case 'mathPlot':
      return `${base}|m:${el.equation}|${el.kind}|${Math.round(el.width)}x${Math.round(el.height)}|${el.xAxis.min}~${el.xAxis.max}|${el.sampleCount}|${el.equalRatio ? 1 : 0}${el.showAxis ? 1 : 0}${el.showGrid ? 1 : 0}${el.showLabel ? 1 : 0}`;
    case 'line':
    case 'arrow': {
      const pts = el.points ?? [];
      // 折线形态（>2 顶点）抽采样中间顶点；两点直线仅看端点
      const mid = pts.length > 2 ? samplePathPoints(pts.slice(1, -1)) : '';
      return `${base}|e:${Math.round(el.x2)},${Math.round(el.y2)}|${mid}`;
    }
    case 'rectangle':
    case 'circle':
      return `${base}|s:${Math.round(el.width)}x${Math.round(el.height)}|${el.fillColor ?? ''}`;
    case 'frame':
      // 分页帧（ZOO-198）：页名 / 外框进指纹——改名、缩放页都要触发自动保存
      return `${base}|f:${el.name}|${Math.round(el.width)}x${Math.round(el.height)}`;
  }
}

export function autosaveSignature(input: {
  documentId: string;
  documentTitle: string;
  elements: WhiteboardElement[];
  viewport: Viewport;
}): string {
  const vp = `${Math.round(input.viewport.offsetX)},${Math.round(input.viewport.offsetY)},${input.viewport.scale.toFixed(2)}`;
  return [
    'v1',
    input.documentId,
    input.documentTitle,
    vp,
    input.elements.map(elementSignature).join(';'),
  ].join('|#|');
}

/** WhiteboardDocument（id/title 字段名）→ 指纹适配 */
export function documentSignature(doc: WhiteboardDocument): string {
  return autosaveSignature({
    documentId: doc.id,
    documentTitle: doc.title,
    elements: doc.elements,
    viewport: doc.viewport,
  });
}

// ========== 恢复裁决（纯函数） ==========

export interface RecoveryCandidate {
  updatedAt: number;
  elements: WhiteboardElement[];
}

/**
 * 本地快照是否应恢复：
 * - 无快照 / 快照为空 → false（空板恢复无意义，刷新即全新开始）；
 * - serverUpdatedAt === null：服务端无此文档（404）或断网不可达 → 本地即最新，恢复；
 * - 本地严格新于服务端 → 恢复（相等视为已同步，不打扰）。
 */
export function shouldRestoreSnapshot(
  local: RecoveryCandidate | null,
  serverUpdatedAt: number | null,
): boolean {
  if (!local || local.elements.length === 0) return false;
  if (serverUpdatedAt === null) return true;
  return local.updatedAt > serverUpdatedAt;
}

/** 多标签页检测：磁盘上的快照出自别的标签页（且内容与本次不同）→ 冲突提示 */
export function isForeignWrite(prev: AutosaveSnapshot | null, ownTabId: string, nextSig: string): boolean {
  if (!prev) return false;
  return prev.tabId !== ownTabId && prev.sig !== nextSig;
}

function snapshotToDocument(snap: AutosaveSnapshot): WhiteboardDocument {
  return {
    id: snap.documentId,
    title: snap.documentTitle,
    elements: snap.elements,
    viewport: snap.viewport,
    schemaVersion: snap.schemaVersion,
    createdAt: snap.updatedAt,
    updatedAt: snap.updatedAt,
  };
}

// ========== 轻量状态提示（ZOO-170 需求 6） ==========

export type AutosaveNoticeKind = 'restored' | 'conflict' | 'saved';

export interface AutosaveNotice {
  kind: AutosaveNoticeKind;
  text: string;
  at: number;
}

export const useAutosaveStore = create<{
  /** 最近一次自动保存成功时刻；null = 本会话尚未自动保存过 */
  lastSavedAt: number | null;
  /** 一次性提示（恢复成功 / 多标签页冲突），组件侧展示后自动清除 */
  notice: AutosaveNotice | null;
  markSaved: (at: number) => void;
  setNotice: (notice: AutosaveNotice | null) => void;
}>((set) => ({
  lastSavedAt: null,
  notice: null,
  markSaved: (at) => set({ lastSavedAt: at }),
  setNotice: (notice) => set({ notice }),
}));

// ========== IndexedDB 主存储 ==========

const IDB_NAME = 'whiteboard-autosave';
const IDB_STORE = 'snapshots';

let idbPromise: Promise<IDBDatabase | null> | null = null;

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE, { keyPath: 'documentId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  // 打不开（隐私模式拦截 / 配额异常等）→ 记 null 供降级判断
  idbPromise.then((db) => {
    if (!db) idbPromise = Promise.resolve(null);
  });
  return idbPromise;
}

async function idbRun<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, mode);
      const req = run(tx.objectStore(IDB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// ========== localStorage 降级 + 会话标记 ==========

function lsReadSnapshot(documentId: string): AutosaveSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_SNAPSHOT_PREFIX + documentId);
    return raw ? (JSON.parse(raw) as AutosaveSnapshot) : null;
  } catch {
    return null;
  }
}

/** 同步兜底写（pagehide / visibilitychange 用）：localStorage 立即落盘，失败不抛 */
function lsWriteSnapshotSync(snap: AutosaveSnapshot): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(LS_SNAPSHOT_PREFIX + snap.documentId, JSON.stringify(snap));
  } catch {
    return false; // 配额满（4MB 级重板可能超 ~5MB 限额）：交给 IDB 异步写
  }
  try {
    const idx = JSON.parse(localStorage.getItem(LS_INDEX_KEY) ?? '[]') as { documentId: string; updatedAt: number }[];
    const next = idx.filter((e) => e.documentId !== snap.documentId);
    next.unshift({ documentId: snap.documentId, updatedAt: snap.updatedAt });
    localStorage.setItem(LS_INDEX_KEY, JSON.stringify(next.slice(0, 50)));
  } catch {
    // 索引尽力而为：写不进不影响主流程（purge 少清几条而已）
  }
  return true;
}

function writeSessionMarker(snap: AutosaveSnapshot): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      SESSION_MARKER_KEY,
      JSON.stringify({ documentId: snap.documentId, updatedAt: snap.updatedAt }),
    );
  } catch {
    // 标记写失败：本次刷新找回失效，但不影响保存主流程
  }
}

export function readSessionMarker(): { documentId: string; updatedAt: number } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_MARKER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 切到全新空白板时清掉标记：刷新回去找「上一块板」而不是用户明确弃掉的新板 */
export function clearSessionMarker(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_MARKER_KEY);
  } catch {
    // 尽力而为
  }
}

// ========== 对外存储 API（IDB 优先，降级 LS） ==========

export async function writeSnapshot(snap: AutosaveSnapshot): Promise<'idb' | 'ls' | null> {
  const put = await idbRun('readwrite', (store) => store.put(snap));
  if (put !== null) {
    writeSessionMarker(snap);
    return 'idb';
  }
  // IDB 不可用 / 写失败 → 降级 localStorage（异步路径，同样尽力而为）
  if (lsWriteSnapshotSync(snap)) {
    writeSessionMarker(snap);
    return 'ls';
  }
  return null;
}

/** 卸载兜底：同步写 LS（保证落盘）+ 触发 IDB 异步写（不等待完成） */
export function writeSnapshotFlush(snap: AutosaveSnapshot): void {
  lsWriteSnapshotSync(snap);
  writeSessionMarker(snap);
  void writeSnapshot(snap);
}

export async function readSnapshot(documentId: string): Promise<AutosaveSnapshot | null> {
  const fromIdb = await idbRun<AutosaveSnapshot | undefined>('readonly', (store) => store.get(documentId));
  const fromLs = lsReadSnapshot(documentId);
  // 两份都可能有（flush 双写）：取 updatedAt 新的——卸载兜底时 IDB 事务未必提交，
  // localStorage 的同步副本才是最新；LS 配额满写失败时则只剩 IDB 旧记录
  if (fromIdb && fromLs) return fromLs.updatedAt > fromIdb.updatedAt ? fromLs : fromIdb;
  return fromIdb ?? fromLs ?? null;
}

export async function deleteSnapshot(documentId: string): Promise<void> {
  await idbRun('readwrite', (store) => store.delete(documentId));
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(LS_SNAPSHOT_PREFIX + documentId);
      const idx = JSON.parse(localStorage.getItem(LS_INDEX_KEY) ?? '[]') as { documentId: string }[];
      localStorage.setItem(LS_INDEX_KEY, JSON.stringify(idx.filter((e) => e.documentId !== documentId)));
      const marker = readSessionMarker();
      if (marker?.documentId === documentId) localStorage.removeItem(SESSION_MARKER_KEY);
    } catch {
      // 清理尽力而为
    }
  }
}

/** 清理过期快照（启动时调用一次）：默认 7 天；两份后端各自清理 */
export async function purgeStaleSnapshots(maxAgeMs: number = 7 * 24 * 3600 * 1000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  const all = await idbRun<AutosaveSnapshot[]>('readonly', (store) => store.getAll());
  if (all) {
    await Promise.all(all.filter((s) => s.updatedAt < cutoff).map((s) => deleteSnapshot(s.documentId)));
    return; // IDB 可用时 LS 层只可能有同键降级残留，下面的清理顺带覆盖
  }
  if (typeof localStorage === 'undefined') return;
  try {
    const idx = JSON.parse(localStorage.getItem(LS_INDEX_KEY) ?? '[]') as { documentId: string; updatedAt: number }[];
    const stale = idx.filter((e) => e.updatedAt < cutoff);
    if (stale.length > 0) {
      stale.forEach((e) => localStorage.removeItem(LS_SNAPSHOT_PREFIX + e.documentId));
      localStorage.setItem(LS_INDEX_KEY, JSON.stringify(idx.filter((e) => e.updatedAt >= cutoff)));
    }
  } catch {
    // 索引损坏时无从清理，等下次成功写入自愈
  }
}

// ========== 恢复入口（启动恢复 / History 打开） ==========

/**
 * 打开一份已载入的文档前的恢复裁决：本地快照比这份文档新（且内容确实不同）→ 返回快照版本文档。
 * 内容指纹相同（刚手动保存过 / 自动保存已同步）→ 返回原文档，不触发「已恢复」提示。
 */
export async function recoverForDocument(doc: WhiteboardDocument): Promise<WhiteboardDocument> {
  const snap = await readSnapshot(doc.id);
  if (!snap) return doc;
  if (documentSignature(doc) === snap.sig) return doc;
  return shouldRestoreSnapshot(snap, doc.updatedAt) ? snapshotToDocument(snap) : doc;
}

/**
 * 启动恢复（刷新 / 崩溃后）：按会话标记找回上次编辑的白板。
 * 服务端版本通过 serverDocFetcher 注入（启动路径传 loadFromServer，测试可注入桩）；
 * 断网 / 404 / 拉取异常统一视为「服务端无更新」，本地快照即最新。
 */
export async function recoverLastSession(
  serverDocFetcher: (id: string) => Promise<WhiteboardDocument | null> = async () => null,
): Promise<WhiteboardDocument | null> {
  const marker = readSessionMarker();
  if (!marker) return null;
  const snap = await readSnapshot(marker.documentId);
  if (!snap) return null;

  let serverUpdatedAt: number | null = null;
  let serverDoc: WhiteboardDocument | null = null;
  try {
    serverDoc = await serverDocFetcher(marker.documentId);
    serverUpdatedAt = serverDoc ? serverDoc.updatedAt : 0; // 404 → 服务端为空（0），非 null
  } catch {
    serverUpdatedAt = null; // 断网：不可比较，按本地最新处理
  }

  if (!shouldRestoreSnapshot(snap, serverUpdatedAt)) return null;
  // 时间新但内容与服务端一致（保存成功后又空转了一次自动保存）→ 没丢东西，不提示恢复
  if (serverDoc && documentSignature(serverDoc) === snap.sig) return null;
  return snapshotToDocument(snap);
}

/**
 * 标签页 id：存 sessionStorage——同标签页刷新沿用同一个 id（刷新后的「自己」不算
 * 多标签页冲突），不同标签页各自独立（真冲突能检测到）。
 * 注：浏览器「复制标签页」会连 sessionStorage 一起复制，该路径冲突提示可能漏报，
 * last-write-wins 语义不受影响。
 */
export function newTabId(): string {
  if (typeof sessionStorage === 'undefined') return uuidv4();
  try {
    const existing = sessionStorage.getItem(TAB_ID_KEY);
    if (existing) return existing;
    const id = uuidv4();
    sessionStorage.setItem(TAB_ID_KEY, id);
    return id;
  } catch {
    return uuidv4();
  }
}
