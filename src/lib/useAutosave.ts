'use client';

/**
 * 自动保存引擎挂载（ZOO-170）：
 * - 元素 / 视口变更 → debounce 1.5s → requestIdleCallback 里落 IndexedDB（降级 localStorage），
 *   大板序列化让出输入关键路径，不卡主线程；
 * - visibilitychange(hidden) / pagehide → 同步兜底写（localStorage 立即落盘 + IDB 尽力），
 *   覆盖直接刷新 / 关标签页 / 崩溃；
 * - 挂载时启动恢复：按会话标记读本地快照，新于服务端（含服务端为空 / 断网）→ 自动恢复 + 提示；
 * - 多标签页：last-write-wins，检测到他人写入不同内容 → 冲突提示。
 *
 * 恢复落地前用户已开画（服务端拉取慢的竞态）→ 放弃恢复不覆盖；快照留在磁盘等下次。
 * 撤销 / 重做栈不进快照，恢复后清空（loadDocument 语义，PR 已说明）。
 */
import { useEffect, useRef } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { useStore } from './store';
import { loadFromServer } from './persistence';
import { WhiteboardDocument } from './types';
import {
  AutosaveSnapshot,
  autosaveSignature,
  clearSessionMarker,
  documentSignature,
  isForeignWrite,
  newTabId,
  purgeStaleSnapshots,
  readSnapshot,
  recoverLastSession,
  writeSnapshot,
  writeSnapshotFlush,
  useAutosaveStore,
} from './autosave';

/** debounce 间隔（需求建议 1–2s，取中） */
const DEBOUNCE_MS = 1500;
/** 启动恢复兜底超时：服务端拉取超过此时长按无服务端处理，别让自动保存一直挂起 */
const RECOVERY_TIMEOUT_MS = 4000;

/** 空板且无未保存改动 → 没有值得落盘的内容（防止把「全新会话」写进快照顶掉上一板标记） */
function nothingToSave(elements: unknown[], isDirty: boolean): boolean {
  return elements.length === 0 && !isDirty;
}

/** idle 调度：无 requestIdleCallback（旧 Safari / 测试环境）退化为 setTimeout */
const scheduleIdle: (cb: () => void) => void =
  typeof requestIdleCallback === 'function'
    ? (cb) => requestIdleCallback(cb, { timeout: 2000 })
    : (cb) => setTimeout(cb, 0);

export function useAutosave() {
  // ZOO-176：恢复 / 冲突提示文案随语言。t 经 ref 取用——切换语言不重启保存引擎
  // （notice 为一次性字符串，产生时即定语言）
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const tabId = newTabId();
    const { setNotice, markSaved } = useAutosaveStore.getState();

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let recoveryDone = false;
    /** 内容版本号：保存期间又有编辑 → 完成后再排一轮，防止旧内容盖新内容 */
    let dirtySeq = 0;
    let savedSeq = 0;
    /** 最近已落盘的内容指纹：内容没变的 store 抖动（切工具 / 换颜色）不触发写 */
    let lastWrittenSig = '';
    /** 当前跟踪的文档 id：变化即换板（会话标记维护用） */
    let lastSeenDocId = useStore.getState().documentId;

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        scheduleIdle(() => void maybeSave());
      }, DEBOUNCE_MS);
    };

    const snapshotOf = (sig: string): AutosaveSnapshot => {
      const st = useStore.getState();
      return {
        documentId: st.documentId,
        documentTitle: st.documentTitle,
        elements: st.elements,
        viewport: st.viewport,
        schemaVersion: st.schemaVersion,
        updatedAt: Date.now(),
        tabId,
        sig,
      };
    };

    async function maybeSave() {
      if (disposed) return;
      // 恢复未落地前先不写盘（避免空新板快照顶掉上一板的会话标记），稍后重试
      if (!recoveryDone) {
        schedule();
        return;
      }
      if (savedSeq === dirtySeq) return;
      const st = useStore.getState();
      if (nothingToSave(st.elements, st.isDirty)) {
        savedSeq = dirtySeq;
        return;
      }
      const sig = autosaveSignature({
        documentId: st.documentId,
        documentTitle: st.documentTitle,
        elements: st.elements,
        viewport: st.viewport,
      });
      if (sig === lastWrittenSig) {
        savedSeq = dirtySeq;
        return;
      }
      const captureSeq = dirtySeq;
      const snap = snapshotOf(sig);

      // 多标签页：磁盘上已有别的标签页写的不同内容 → last-write-wins + 冲突提示
      const prev = await readSnapshot(snap.documentId);
      if (disposed) return;
      if (isForeignWrite(prev, tabId, snap.sig)) {
        setNotice({
          kind: 'conflict',
          text: tRef.current('autosave.conflict'),
          at: Date.now(),
        });
      }
      if (dirtySeq !== captureSeq) {
        // 等待期间又有编辑：不写旧快照，让下一轮写最新内容
        schedule();
        return;
      }
      const backend = await writeSnapshot(snap);
      if (disposed) return;
      if (backend) {
        lastWrittenSig = sig;
        savedSeq = captureSeq;
        markSaved(snap.updatedAt);
      }
      if (dirtySeq !== captureSeq) schedule();
    }

    function flush() {
      if (disposed) return;
      const st = useStore.getState();
      if (nothingToSave(st.elements, st.isDirty)) return;
      const sig = autosaveSignature({
        documentId: st.documentId,
        documentTitle: st.documentTitle,
        elements: st.elements,
        viewport: st.viewport,
      });
      if (sig === lastWrittenSig) return;
      writeSnapshotFlush(snapshotOf(sig));
      lastWrittenSig = sig;
      savedSeq = dirtySeq;
      markSaved(Date.now());
    }

    async function recover() {
      let doc: WhiteboardDocument | null = null;
      try {
        doc = await Promise.race([
          recoverLastSession(loadFromServer),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), RECOVERY_TIMEOUT_MS)),
        ]);
      } catch {
        doc = null;
      }
      if (disposed) return;
      if (doc) {
        const st = useStore.getState();
        // 干净画布才恢复：拉取期间用户已开画 → 不覆盖（快照留待下次）
        if (st.elements.length === 0 && !st.isDirty && st.undoStack.length === 0) {
          useStore.getState().loadDocument(doc);
          lastWrittenSig = documentSignature(doc); // 恢复内容已在盘上，不重写
          const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setNotice({ kind: 'restored', text: tRef.current('autosave.restored', { time }), at: Date.now() });
        }
      }
      recoveryDone = true;
      savedSeq = dirtySeq;
    }

    const onStoreChange = () => {
      const st = useStore.getState();
      // 换板（New / 打开历史文档）且目标板是空的 → 清会话标记，
      // 刷新不再找回用户明确弃掉的旧板；有内容的板随首次自动保存重建标记
      if (st.documentId !== lastSeenDocId) {
        lastSeenDocId = st.documentId;
        if (st.elements.length === 0 && !st.isDirty) clearSessionMarker();
      }
      dirtySeq++;
      schedule();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    const unsub = useStore.subscribe(onStoreChange);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    void purgeStaleSnapshots();
    void recover();

    return () => {
      disposed = true;
      unsub();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
}
