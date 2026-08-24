'use client';

/**
 * 页导航条（ZOO-198）：一节课的板书按页组织的入口——
 * - 缩略图 + 序号 + 页名（双击页名原位重命名）；
 * - 新增 / 复制 / 删除页，HTML5 拖动重排序（页序 = elements 中帧的相对顺序）；
 * - 点击跳转：视口平滑对齐到帧（rAF 240ms easeOutCubic，目标帧整页可见）。
 * 无帧时退化为单个「＋ 新页」按钮（教师第一步建页的入口）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { FrameElement, Viewport, WhiteboardElement } from '@/lib/types';
import { framesOf, frameContents, frameFocusViewport } from '@/lib/frame';
import { animateViewportTo } from '@/lib/frameNav';
import { drawFrame, renderElements } from '@/lib/renderer';
import { useT } from '@/i18n/I18nProvider';

/** 页缩略图：帧外框 fit 到小画布，白底 + 页框 + 页内内容（不画页名） */
function FrameThumbnail({
  frame, contents, active,
}: {
  frame: FrameElement;
  contents: WhiteboardElement[];
  active: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 88;
    const h = 58;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, w, h);
    const pad = 5;
    const s = Math.min((w - pad * 2) / frame.width, (h - pad * 2) / frame.height);
    const vp: Viewport = {
      offsetX: (w - frame.width * s) / 2 - frame.x * s,
      offsetY: (h - frame.height * s) / 2 - frame.y * s,
      scale: s,
    };
    drawFrame(ctx, frame, vp, { active, showTitle: false });
    renderElements(ctx, contents, vp, { width: w, height: h });
  }, [frame, contents, active]);

  return <canvas ref={ref} style={{ width: 88, height: 58 }} className="rounded-[4px]" />;
}

export default function PageBar() {
  const t = useT();
  const {
    elements, activeFrameId, setActiveFrame,
    addFrame, renameFrame, duplicateFrame, deleteFrame, moveFrameTo,
    setViewport,
  } = useStore();

  const frames = useMemo(() => framesOf(elements), [elements]);
  // activeFrameId 撤销 / 删除后可能悬空：兜底到首页
  const active = frames.find((f) => f.id === activeFrameId) ?? frames[0] ?? null;

  // —— 点击跳转：视口平滑对齐到帧（动画沉淀 frameNav，与 ←→ 翻页快捷键共用，ZOO-205）——
  const jumpTo = useCallback((frame: FrameElement) => {
    setActiveFrame(frame.id);
    const to = frameFocusViewport(frame, window.innerWidth, window.innerHeight);
    animateViewportTo(
      to,
      () => useStore.getState().viewport,
      setViewport,
    );
  }, [setActiveFrame, setViewport]);

  // —— 页操作 ——
  /** 新页 / 复制页落在既有页右侧，视口须跟过去——教师点「新页」即见新页 */
  const jumpToFrameId = useCallback((id: string) => {
    const created = useStore.getState().elements.find(
      (e): e is FrameElement => e.type === 'frame' && e.id === id,
    );
    if (created) jumpTo(created);
  }, [jumpTo]);

  const handleAdd = useCallback(() => {
    const size = typeof window === 'undefined'
      ? undefined
      : { width: window.innerWidth, height: window.innerHeight };
    const id = addFrame(t('pages.defaultName', { n: frames.length + 1 }), size);
    jumpToFrameId(id);
  }, [addFrame, frames.length, t, jumpToFrameId]);

  const handleDuplicate = useCallback((frame: FrameElement) => {
    duplicateFrame(frame.id, t('pages.copyName', { name: frame.name }));
    const active = useStore.getState().activeFrameId;
    if (active) jumpToFrameId(active);
  }, [duplicateFrame, t, jumpToFrameId]);

  const handleDelete = useCallback((frame: FrameElement) => {
    if (confirm(t('pages.confirmDelete', { name: frame.name }))) deleteFrame(frame.id);
  }, [deleteFrame, t]);

  // —— 双击页名原位重命名 ——
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const commitRename = useCallback(() => {
    if (renaming) renameFrame(renaming.id, renaming.draft);
    setRenaming(null);
  }, [renaming, renameFrame]);

  // —— 拖动重排序（HTML5 DnD）——
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // 无帧：仅「＋ 新页」入口
  if (frames.length === 0) {
    return (
      <div className="whiteboard-chrome absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
        <button
          onClick={handleAdd}
          className="touch-target bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 active:bg-gray-100"
          title={t('pages.add')}
        >
          ＋ {t('pages.add')}
        </button>
      </div>
    );
  }

  return (
    <div className="whiteboard-chrome absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-end gap-1 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 px-2 py-1.5 max-w-[calc(100vw-5rem)] overflow-x-auto">
      {frames.map((frame, i) => {
        const isActive = active?.id === frame.id;
        const contents = frameContents(elements, frame);
        return (
          <div
            key={frame.id}
            draggable={renaming?.id !== frame.id}
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom != null && dragFrom !== i) moveFrameTo(dragFrom, i);
              setDragFrom(null);
              setDragOver(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            onClick={() => {
              if (renaming?.id !== frame.id) jumpTo(frame);
            }}
            title={t('pages.jumpTip', { name: frame.name })}
            className={`group relative flex flex-col items-center gap-0.5 rounded-lg px-1 pt-1 pb-0.5 cursor-pointer select-none border ${
              isActive
                ? 'bg-blue-50 border-blue-300'
                : 'border-transparent hover:bg-gray-50'
            } ${dragOver === i && dragFrom != null && dragFrom !== i ? 'ring-2 ring-blue-300' : ''}`}
          >
            <FrameThumbnail frame={frame} contents={contents} active={isActive} />
            <div className="flex items-center gap-1 max-w-[96px]">
              <span className="text-[10px] text-gray-400 tabular-nums">{i + 1}</span>
              {renaming?.id === frame.id ? (
                <input
                  autoFocus
                  value={renaming.draft}
                  onChange={(e) => setRenaming({ id: frame.id, draft: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-16 text-[10px] px-1 border border-blue-300 rounded focus:outline-none"
                />
              ) : (
                <span
                  className="text-[10px] text-gray-600 truncate"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenaming({ id: frame.id, draft: frame.name });
                  }}
                  title={t('pages.renameTip')}
                >
                  {frame.name}
                </span>
              )}
            </div>
            {/* hover 操作：复制 / 删除（不触发跳转） */}
            <div className="absolute -top-1.5 -right-1.5 hidden group-hover:flex gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); handleDuplicate(frame); }}
                className="w-5 h-5 rounded-full bg-white shadow border border-gray-200 text-[10px] text-gray-500 hover:text-blue-500 leading-none"
                title={t('pages.duplicate')}
              >⧉</button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(frame); }}
                className="w-5 h-5 rounded-full bg-white shadow border border-gray-200 text-[10px] text-gray-500 hover:text-red-500 leading-none"
                title={t('pages.delete')}
              >✕</button>
            </div>
          </div>
        );
      })}
      <button
        onClick={handleAdd}
        className="touch-target shrink-0 w-9 h-9 mb-2 rounded-lg border border-dashed border-gray-300 text-gray-400 hover:text-blue-500 hover:border-blue-400 active:bg-gray-50 text-base leading-none"
        title={t('pages.add')}
      >
        ＋
      </button>
    </div>
  );
}
