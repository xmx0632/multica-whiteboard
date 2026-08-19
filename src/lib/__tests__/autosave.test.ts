/**
 * 白板自动保存单测（ZOO-170）：
 * - autosaveSignature：内容变更（增删 / 移动 / 改样式 / 改文本 / 改方程 / 视口）必变，
 *   亚像素漂移与 store 抖动不变；
 * - shouldRestoreSnapshot：恢复裁决（本地新于服务端 / 服务端为空 / 断网 / 空板不恢复）；
 * - 存储层（node 无 IndexedDB → 走 localStorage 降级路径）：写入-读取-删除往返、
 *   会话标记维护、同步兜底写、过期清理；
 * - recoverForDocument / recoverLastSession：两条恢复入口的裁决；
 * - isForeignWrite：多标签页冲突检测（LWW + 提示的判定输入）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autosaveSignature,
  documentSignature,
  shouldRestoreSnapshot,
  isForeignWrite,
  writeSnapshot,
  writeSnapshotFlush,
  readSnapshot,
  deleteSnapshot,
  purgeStaleSnapshots,
  recoverForDocument,
  recoverLastSession,
  readSessionMarker,
  clearSessionMarker,
  AutosaveSnapshot,
} from '../autosave';
import { WhiteboardDocument, WhiteboardElement, PathElement, TextElement, MathPlotElement } from '../types';

class MockLocalStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

const VP = { offsetX: 0, offsetY: 0, scale: 1 };

function pathEl(id: string, x = 0, y = 0): PathElement {
  return { id, type: 'path', x, y, points: [{ x, y }, { x: x + 40, y: y + 10 }], strokeColor: '#000000', strokeWidth: 2, opacity: 1 };
}

function textEl(id: string, content = 'hi'): TextElement {
  return { id, type: 'text', x: 0, y: 0, content, fontSize: 20, fontFamily: 'sans', color: '#000000', width: 30, height: 24, strokeColor: '#000000', strokeWidth: 2, opacity: 1 };
}

function mathPlotEl(id: string, equation = 'sin(x)'): MathPlotElement {
  return {
    id, type: 'mathPlot', x: 0, y: 0, width: 480, height: 360, equation, kind: 'explicit',
    xAxis: { min: -10, max: 10 }, equalRatio: true, sampleCount: 320,
    showAxis: true, showGrid: true, showLabel: true, strokeColor: '#3B82F6', strokeWidth: 2, opacity: 1,
  };
}

function snap(overrides: Partial<AutosaveSnapshot> = {}): AutosaveSnapshot {
  const elements = overrides.elements ?? [pathEl('p1')];
  return {
    documentId: 'doc-1',
    documentTitle: 'Board',
    elements,
    viewport: VP,
    updatedAt: 2000,
    tabId: 'tab-a',
    sig: overrides.sig ?? autosaveSignature({ documentId: 'doc-1', documentTitle: 'Board', elements, viewport: VP }),
    ...overrides,
  };
}

function docOf(s: AutosaveSnapshot): WhiteboardDocument {
  return { id: s.documentId, title: s.documentTitle, elements: s.elements, viewport: s.viewport, createdAt: 1000, updatedAt: s.updatedAt };
}

// ========== 内容指纹 ==========

describe('autosaveSignature（变更必变 / 抖动不变）', () => {
  const base = { documentId: 'doc-1', documentTitle: 'Board', viewport: VP };

  it('相同内容 → 签名稳定', () => {
    const a = autosaveSignature({ ...base, elements: [pathEl('p1'), textEl('t1'), mathPlotEl('m1')] });
    const b = autosaveSignature({ ...base, elements: [pathEl('p1'), textEl('t1'), mathPlotEl('m1')] });
    expect(a).toBe(b);
  });

  it('亚像素漂移不触发（坐标取整）', () => {
    const el = pathEl('p1');
    const drifted = { ...el, x: el.x + 0.3, points: el.points.map((p) => ({ ...p, x: p.x + 0.2 })) };
    expect(autosaveSignature({ ...base, elements: [drifted] })).toBe(autosaveSignature({ ...base, elements: [el] }));
  });

  it('增删 / 移动 / 样式 / 线型变更必变', () => {
    const one = autosaveSignature({ ...base, elements: [pathEl('p1')] });
    expect(autosaveSignature({ ...base, elements: [pathEl('p1'), pathEl('p2')] })).not.toBe(one); // 新增
    expect(autosaveSignature({ ...base, elements: [] })).not.toBe(one); // 删除
    expect(autosaveSignature({ ...base, elements: [pathEl('p1', 100, 50)] })).not.toBe(one); // 移动
    expect(autosaveSignature({ ...base, elements: [{ ...pathEl('p1'), strokeColor: '#ff0000' }] })).not.toBe(one); // 颜色
    expect(autosaveSignature({ ...base, elements: [{ ...pathEl('p1'), dash: 'dashed' }] })).not.toBe(one); // 线型
  });

  it('文本内容 / 字号变更必变', () => {
    const a = autosaveSignature({ ...base, elements: [textEl('t1', 'hello')] });
    expect(autosaveSignature({ ...base, elements: [textEl('t1', 'world')] })).not.toBe(a);
    expect(autosaveSignature({ ...base, elements: [{ ...textEl('t1'), fontSize: 32 }] })).not.toBe(a);
  });

  it('函数图形方程变更必变（mathPlot 全字段参与）', () => {
    const a = autosaveSignature({ ...base, elements: [mathPlotEl('m1', 'sin(x)')] });
    expect(autosaveSignature({ ...base, elements: [mathPlotEl('m1', 'cos(x)')] })).not.toBe(a);
    expect(autosaveSignature({ ...base, elements: [{ ...mathPlotEl('m1'), sampleCount: 640 }] })).not.toBe(a);
  });

  it('视口平移 / 缩放 / 标题变更必变', () => {
    const a = autosaveSignature({ ...base, elements: [pathEl('p1')] });
    expect(autosaveSignature({ ...base, viewport: { offsetX: 120, offsetY: 0, scale: 1 }, elements: [pathEl('p1')] })).not.toBe(a);
    expect(autosaveSignature({ ...base, viewport: { offsetX: 0, offsetY: 0, scale: 2 }, elements: [pathEl('p1')] })).not.toBe(a);
    expect(autosaveSignature({ ...base, documentTitle: 'Renamed', elements: [pathEl('p1')] })).not.toBe(a);
  });
});

// ========== 恢复裁决 ==========

describe('shouldRestoreSnapshot（恢复裁决）', () => {
  it('无快照 / 空快照 → 不恢复', () => {
    expect(shouldRestoreSnapshot(null, 0)).toBe(false);
    expect(shouldRestoreSnapshot({ updatedAt: 5000, elements: [] }, 0)).toBe(false);
  });

  it('服务端为空（404）或断网（null）→ 恢复本地（含新建未保存的板）', () => {
    expect(shouldRestoreSnapshot({ updatedAt: 1000, elements: [pathEl('p1')] }, 0)).toBe(true);
    expect(shouldRestoreSnapshot({ updatedAt: 1000, elements: [pathEl('p1')] }, null)).toBe(true);
  });

  it('本地严格新于服务端 → 恢复；相等 / 更旧 → 不恢复', () => {
    const local = { updatedAt: 5000, elements: [pathEl('p1')] };
    expect(shouldRestoreSnapshot(local, 4000)).toBe(true);
    expect(shouldRestoreSnapshot(local, 5000)).toBe(false);
    expect(shouldRestoreSnapshot(local, 6000)).toBe(false);
  });
});

describe('isForeignWrite（多标签页检测）', () => {
  it('无记录 / 本标签页写的 / 他人写但内容相同 → 非冲突', () => {
    const mine = snap();
    expect(isForeignWrite(null, 'tab-a', 'x')).toBe(false);
    expect(isForeignWrite(mine, 'tab-a', 'changed')).toBe(false);
    expect(isForeignWrite({ ...mine, tabId: 'tab-b' }, 'tab-a', mine.sig)).toBe(false);
  });

  it('其他标签页写了不同内容 → 冲突（LWW + 提示）', () => {
    const foreign = snap({ tabId: 'tab-b' });
    expect(isForeignWrite(foreign, 'tab-a', 'different-sig')).toBe(true);
  });
});

// ========== 存储层（localStorage 降级路径） ==========

describe('快照存储（无 IndexedDB → localStorage 降级）', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MockLocalStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('写入 → 读取往返保持内容与视口', async () => {
    const s = snap({ elements: [pathEl('p1'), textEl('t1'), mathPlotEl('m1')], viewport: { offsetX: 33, offsetY: 44, scale: 1.5 } });
    await writeSnapshot(s);
    const back = await readSnapshot('doc-1');
    expect(back).not.toBeNull();
    expect(back!.elements).toHaveLength(3);
    expect(back!.viewport).toEqual({ offsetX: 33, offsetY: 44, scale: 1.5 });
    expect(back!.tabId).toBe('tab-a');
  });

  it('写入维护会话标记（刷新找回当前板）', async () => {
    await writeSnapshot(snap());
    expect(readSessionMarker()).toEqual({ documentId: 'doc-1', updatedAt: 2000 });
  });

  it('pagehide 同步兜底写：无需 await 立即可读', () => {
    writeSnapshotFlush(snap());
    expect(readSessionMarker()?.documentId).toBe('doc-1');
    // readSnapshot 是 async，但数据已同步落 LS（IDB 缺席）
    return readSnapshot('doc-1').then((back) => {
      expect(back?.sig).toBe(snap().sig);
    });
  });

  it('删除快照：连同会话标记一起清理', async () => {
    await writeSnapshot(snap());
    await deleteSnapshot('doc-1');
    expect(await readSnapshot('doc-1')).toBeNull();
    expect(readSessionMarker()).toBeNull();
  });

  it('deleteSnapshot 不误伤别的板的标记', async () => {
    await writeSnapshot(snap({ documentId: 'doc-1' }));
    await writeSnapshot(snap({ documentId: 'doc-2', updatedAt: 3000 }));
    await deleteSnapshot('doc-1');
    expect(readSessionMarker()?.documentId).toBe('doc-2');
  });

  it('clearSessionMarker 直接清除标记', async () => {
    await writeSnapshot(snap());
    clearSessionMarker();
    expect(readSessionMarker()).toBeNull();
  });

  it('过期清理：只清超出 maxAge 的快照', async () => {
    const now = Date.now();
    await writeSnapshot(snap({ documentId: 'old', updatedAt: now - 10_000 }));
    await writeSnapshot(snap({ documentId: 'fresh', updatedAt: now - 100 }));
    await purgeStaleSnapshots(1000);
    expect(await readSnapshot('old')).toBeNull();
    expect((await readSnapshot('fresh'))?.documentId).toBe('fresh');
  });
});

// ========== 恢复入口 ==========

describe('recoverForDocument（History 打开路径）', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MockLocalStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('快照与文档内容一致（刚保存过）→ 返回原文档，不提示恢复', async () => {
    const s = snap({ updatedAt: 5000 });
    await writeSnapshot(s);
    const same = docOf(s);
    const out = await recoverForDocument(same);
    expect(out).toBe(same); // 同一引用 = 未替换
  });

  it('快照新且内容不同 → 返回快照版本', async () => {
    const saved = snap({ updatedAt: 1000 });
    await writeSnapshot(saved);
    // 磁盘上是 5000 的新内容（模拟保存后又编辑再崩溃）
    const newerDisk = snap({ updatedAt: 5000, elements: [pathEl('p1'), textEl('t1')] });
    await writeSnapshot(newerDisk);
    const out = await recoverForDocument(docOf(saved));
    expect(out.elements).toHaveLength(2);
    expect(out.updatedAt).toBe(5000);
  });

  it('快照更旧（文档已是新版）→ 返回原文档', async () => {
    await writeSnapshot(snap({ updatedAt: 1000 }));
    const newerDoc = docOf(snap({ updatedAt: 9000, elements: [pathEl('p1'), textEl('t1')] }));
    const out = await recoverForDocument(newerDoc);
    expect(out).toBe(newerDoc);
  });

  it('无快照 → 返回原文档', async () => {
    const d = docOf(snap());
    expect(await recoverForDocument(d)).toBe(d);
  });
});

describe('recoverLastSession（启动恢复路径）', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MockLocalStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('无会话标记 → 不恢复', async () => {
    expect(await recoverLastSession(async () => null)).toBeNull();
  });

  it('本地新于服务端（有未保存编辑）→ 恢复快照', async () => {
    await writeSnapshot(snap({ updatedAt: 9000, elements: [pathEl('p1'), mathPlotEl('m1')] }));
    const server = docOf(snap({ updatedAt: 1000 }));
    const out = await recoverLastSession(async () => server);
    expect(out?.elements).toHaveLength(2);
    expect(out?.viewport).toEqual(VP);
  });

  it('服务端为空（新建板未保存过，404）→ 恢复本地', async () => {
    await writeSnapshot(snap({ updatedAt: 1000 }));
    const out = await recoverLastSession(async () => null);
    expect(out?.id).toBe('doc-1');
  });

  it('断网（fetch 抛异常）→ 本地即最新，恢复', async () => {
    await writeSnapshot(snap({ updatedAt: 1000 }));
    const out = await recoverLastSession(async () => { throw new Error('offline'); });
    expect(out?.id).toBe('doc-1');
  });

  it('时间新但内容与服务端一致（保存后空转）→ 不打扰', async () => {
    const s = snap({ updatedAt: 9000, elements: [pathEl('p1'), textEl('t1')] });
    await writeSnapshot(s);
    const server = docOf(snap({ updatedAt: 1000, elements: s.elements })); // 内容同、时间旧
    expect(await recoverLastSession(async () => server)).toBeNull();
  });

  it('服务端已是更新版本 → 不恢复', async () => {
    await writeSnapshot(snap({ updatedAt: 1000 }));
    const server = docOf(snap({ updatedAt: 9000, elements: [pathEl('p1'), textEl('t1')] }));
    expect(await recoverLastSession(async () => server)).toBeNull();
  });
});

describe('documentSignature（WhiteboardDocument 适配）', () => {
  it('同 id/title 的文档与快照签名互通（恢复路径一致性）', () => {
    const s = snap();
    expect(documentSignature(docOf(s))).toBe(s.sig);
  });
});
