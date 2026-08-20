'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '@/lib/store';
import { renderGrid, renderElements, renderSelection, hitTest, screenToCanvas, hitTestSelectionHandle, MathPlotHandle, ResizeHandleId, translateElement } from '@/lib/renderer';
import { boxResizePatch, endpointResizePatch, pathResizePatch, elementResizeChanged, CornerHandle, SHAPE_MIN_SIZE } from '@/lib/shapeResize';
import { WhiteboardElement, PathElement, Point, MathPlotElement, TextElement, MATHPLOT_MIN_WIDTH, MATHPLOT_MIN_HEIGHT } from '@/lib/types';
import { createMathPlotElement } from '@/lib/mathplotElement';
import { createTextElement, textContentPatch, textResizePatch } from '@/lib/textElement';
import { parseVertexHandle, vertexDragPatch, insertVertexPatch } from '@/lib/polyline';
import { PinchSnapshot, pinchViewport, shouldPromoteToPinch, zoomAt, panBy } from '@/lib/gestures';
import { CANVAS_INTERACT_EVENT } from '@/lib/landscape';
import { isEditableTarget } from '@/lib/keyboard';
import TextInputOverlay from './TextInputOverlay';
import { v4 as uuidv4 } from 'uuid';
import { useT } from '@/i18n/I18nProvider';

/** 活跃指针记录（ZOO-144 Pointer 输入层）：坐标为画布 rect 相对屏幕 px */
interface ActivePointer {
  x: number;
  y: number;
  type: string; // 'mouse' | 'pen' | 'touch'
}

/** 内联文本输入草稿（ZOO-159）：editingId 为 null 表示新建，否则为原位编辑目标 */
interface TextDraft {
  editingId: string | null;
  worldX: number;
  worldY: number;
  value: string;
  fontSize: number;
  color: string;
}

export default function Canvas() {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const isDrawingRef = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);
  // pan 进行中（ZOO-157 手型工具光标 grab → grabbing；空格 / 中键平移同享）
  const [panActive, setPanActive] = useState(false);
  const tempElementRef = useRef<WhiteboardElement | null>(null);
  const dragStartRef = useRef<Point>({ x: 0, y: 0 });
  /** select 拖拽起手元素快照（ZOO-154 整体平移）：多锚点类型须存整元素——移动 / 双指取消恢复 / 抬指 undo 快照三处共用 */
  const dragElementStartRef = useRef<WhiteboardElement | null>(null);
  const panStartRef = useRef<Point>({ x: 0, y: 0 });
  const panOffsetStartRef = useRef<Point>({ x: 0, y: 0 });
  // pan 的 rAF 合并（技术方案 §6.4）：pointermove 只记最新位移，每帧至多一次 setViewport
  const panRafRef = useRef<number | null>(null);
  const panPendingRef = useRef<Point | null>(null);
  // mathPlot 8 控点缩放（§11 D-1）：startEl 为手势前快照，抬指压一条 update 快照
  // text 4 角等比缩放（ZOO-159）同走此通道；图形元素（ZOO-160）扩展分派：
  // rect/circle 角控点改外框、line/arrow 端点手柄、path 角控点整体等比缩放点集
  const resizeRef = useRef<{ handle: ResizeHandleId; startEl: WhiteboardElement; startWorld: Point } | null>(null);

  // —— 内联文本输入（ZOO-159）——
  /** 当前草稿镜像（提交 / 取消以 ref 为准，state 只驱动渲染——blur 与卸载竞态下幂等） */
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const textDraftRef = useRef<TextDraft | null>(null);

  // —— Pointer 输入层（ZOO-144：鼠标 / 触摸 / 触控笔统一通道）——
  const activePointersRef = useRef<Map<number, ActivePointer>>(new Map());
  /** 当前驱动工具手势的指针（单指）；其余指针不参与绘制 */
  const toolPointerIdRef = useRef<number | null>(null);
  /** 双指手势快照：pointerIds + 起点两指位置 + 起手 viewport */
  const pinchRef = useRef<(PinchSnapshot & { pointerIds: [number, number] }) | null>(null);
  const pinchRafRef = useRef<number | null>(null);
  /** 惰性指针：捏合后的残余手指（抬指前不再驱动工具，防双指后误画）/ 触控笔在位时的掌压触摸 */
  const inertPointersRef = useRef<Set<number>>(new Set());
  /** select 拖拽中的元素 id（双指取消时恢复原位用） */
  const dragElementIdRef = useRef<string | null>(null);

  const {
    elements, selectedId, activeTool, strokeColor, strokeWidth, strokeDash, fillColor,
    viewport, addElement, setSelected, setViewport, pushOperations,
    pendingMathPlot, consumeMathPlotInsert, setTool,
    polylineEditId, polylineVertexIndex, selectPolylineVertex,
  } = useStore();

  // 容器宽（ZOO-159）：输入浮层右缘避让用；ResizeObserver 维护，渲染期不读 ref
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // —— 内联文本输入草稿操作（ZOO-159；ref 为准、state 驱动渲染）——
  /** 原位编辑既有文字（双击 / T 工具点中）：预填内容与样式，编辑中画布隐藏原元素 */
  const openTextDraftForElement = useCallback((el: TextElement) => {
    const d: TextDraft = {
      editingId: el.id,
      worldX: el.x,
      worldY: el.y,
      value: el.content,
      fontSize: el.fontSize,
      color: el.color,
    };
    textDraftRef.current = d;
    setTextDraft(d);
    setSelected(el.id);
  }, [setSelected]);

  /** T 工具点空白处：新建草稿，字号 / 颜色取当前面板设置（输入即预览） */
  const openTextDraftForNew = useCallback((point: Point) => {
    const { fontSize: fs, strokeColor: color } = useStore.getState();
    const d: TextDraft = {
      editingId: null,
      worldX: point.x,
      worldY: point.y,
      value: '',
      fontSize: fs,
      color,
    };
    textDraftRef.current = d;
    setTextDraft(d);
  }, []);

  const handleDraftChange = useCallback((value: string) => {
    const d = textDraftRef.current;
    if (!d) return;
    const next = { ...d, value };
    textDraftRef.current = next;
    setTextDraft(next);
  }, []);

  /** 确认：新建 → 实度量落元素并选中；编辑 → 更新内容与实度量宽高（均可撤销） */
  const commitTextDraft = useCallback(() => {
    const d = textDraftRef.current;
    if (!d) return; // 幂等：blur / 键序 / 画布点按多路触发只生效一次
    textDraftRef.current = null;
    setTextDraft(null);
    const content = d.value;
    if (!content) return; // 空内容不落：新建跳过，编辑保持原文（不误删）
    if (d.editingId) {
      const st = useStore.getState();
      const el = st.elements.find((e) => e.id === d.editingId);
      if (el && el.type === 'text') {
        st.updateElement(el.id, textContentPatch(el, content));
      }
    } else {
      const created = createTextElement({
        x: d.worldX, y: d.worldY, content, fontSize: d.fontSize, color: d.color,
      });
      addElement(created);
      setSelected(created.id);
    }
  }, [addElement, setSelected]);

  /** 取消：仅关浮层，元素 / 画布零改动 */
  const cancelTextDraft = useCallback(() => {
    textDraftRef.current = null;
    setTextDraft(null);
  }, []);

  /** 原位编辑中的元素 id（画布隐藏其本体与选中框，浮层即其替身） */
  const hiddenTextId = textDraft?.editingId ?? null;

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    renderGrid(ctx, rect.width, rect.height, viewport);
    // 传入可视尺寸启用视口 culling（§6.4，视口外元素跳过绘制）
    renderElements(
      ctx,
      hiddenTextId ? elements.filter((e) => e.id !== hiddenTextId) : elements,
      viewport,
      { width: rect.width, height: rect.height, t }
    );
    if (tempElementRef.current) {
      renderElements(ctx, [tempElementRef.current], viewport);
    }
    const sel = elements.find((e) => e.id === selectedId);
    if (sel && sel.id !== hiddenTextId) {
      // 折线编辑态（ZOO-168）：选中框改画逐顶点手柄（renderer 内部分派）
      renderSelection(ctx, sel, viewport, {
        polylineEditing: sel.id === polylineEditId && (sel.type === 'line' || sel.type === 'arrow'),
        selectedVertex: polylineVertexIndex,
      });
    }
  }, [elements, selectedId, viewport, hiddenTextId, polylineEditId, polylineVertexIndex, t]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const handleResize = () => render();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [render]);

  // 方程确认 → 建元素落点（技术方案 §8）：外框中心 = 画布可视区中心；
  // 默认 480×360 超出可视区时按比例收缩。创建后自动选中并切回 select。
  useEffect(() => {
    if (!pendingMathPlot) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const vp = useStore.getState().viewport;
    const center = screenToCanvas({ x: rect.width / 2, y: rect.height / 2 }, vp);
    const el = createMathPlotElement(pendingMathPlot.payload, {
      centerX: center.x,
      centerY: center.y,
      maxWidth: (rect.width / vp.scale) * 0.8,
      maxHeight: (rect.height / vp.scale) * 0.8,
      strokeColor: pendingMathPlot.strokeColor,
      strokeWidth: pendingMathPlot.strokeWidth,
    });
    addElement(el);
    setTool('select'); // setTool 清选中，故先切工具再选中
    setSelected(el.id);
    consumeMathPlotInsert();
  }, [pendingMathPlot, addElement, setTool, setSelected, consumeMathPlotInsert]);

  /** 事件 → 画布 rect 相对屏幕坐标（PointerEvent / MouseEvent 同构） */
  const getLocalPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const getCanvasPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    return screenToCanvas(getLocalPoint(e), useStore.getState().viewport);
  }, [getLocalPoint]);

  const touchCount = useCallback(() => {
    let n = 0;
    for (const p of activePointersRef.current.values()) if (p.type === 'touch') n++;
    return n;
  }, []);

  /** 双指提升时取消进行中的工具手势：丢弃临时元素 / 恢复拖拽缩放前状态（验收：双指落下不产生元素） */
  const cancelToolGesture = useCallback(() => {
    tempElementRef.current = null;
    isDrawingRef.current = false;
    toolPointerIdRef.current = null;

    const rs = resizeRef.current;
    if (rs) {
      resizeRef.current = null;
      const st = useStore.getState();
      if (st.elements.some((el) => el.id === rs.startEl.id)) {
        useStore.setState({
          elements: st.elements.map((el) => (el.id === rs.startEl.id ? rs.startEl : el)),
        });
      }
    }

    const dragId = dragElementIdRef.current;
    const dragStart = dragElementStartRef.current;
    if (dragId && dragStart) {
      dragElementIdRef.current = null;
      dragElementStartRef.current = null;
      const st = useStore.getState();
      useStore.setState({
        elements: st.elements.map((el) => (el.id === dragId ? dragStart : el)),
      });
    }
  }, []);

  /** 以当前头两个非惰性触摸指针起手双指手势 */
  const beginPinch = useCallback(() => {
    const touches = [...activePointersRef.current.entries()].filter(
      ([id, p]) => p.type === 'touch' && !inertPointersRef.current.has(id)
    );
    if (touches.length < 2) return;
    const [[idA, pa], [idB, pb]] = touches;
    pinchRef.current = {
      pointerIds: [idA, idB],
      viewport: { ...useStore.getState().viewport },
      a: { x: pa.x, y: pa.y },
      b: { x: pb.x, y: pb.y },
    };
  }, []);

  // pinch 帧回调：双指每帧至多一次 setViewport（与 pan 的 rAF 合并同构）
  const applyPinchFromRaf = useCallback(() => {
    pinchRafRef.current = null;
    const p = pinchRef.current;
    if (!p) return;
    const a = activePointersRef.current.get(p.pointerIds[0]);
    const b = activePointersRef.current.get(p.pointerIds[1]);
    if (!a || !b) return;
    setViewport(pinchViewport(p, a, b));
  }, [setViewport]);

  // 卸载时取消未决 rAF
  useEffect(() => {
    return () => {
      if (panRafRef.current !== null) cancelAnimationFrame(panRafRef.current);
      if (pinchRafRef.current !== null) cancelAnimationFrame(pinchRafRef.current);
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const local = getLocalPoint(e);
    activePointersRef.current.set(e.pointerId, { x: local.x, y: local.y, type: e.pointerType });

    // ZOO-152：画布触点广播（手机横屏颜色面板自动收起；桌面 / 竖屏无折叠 UI，空操作）
    window.dispatchEvent(new CustomEvent(CANVAS_INTERACT_EVENT));

    // 内联输入进行中（ZOO-159）：点画布 = 提交草稿并吞掉该次手势（不误落新元素 / 误选中）
    if (textDraftRef.current) {
      commitTextDraft();
      return;
    }

    // 捕获指针：手势跨出画布边界仍持续到抬指（替代原 onMouseLeave 提交语义；
    // 合成事件 / 指针已失效时 setPointerCapture 会抛 NotFoundError，防御忽略）
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }

    // 触控笔在位时忽略触摸（最小掌压防护）：掌压不驱动任何手势
    let penActive = false;
    for (const p of activePointersRef.current.values()) {
      if (p.type === 'pen') { penActive = true; break; }
    }
    if (penActive && e.pointerType === 'touch') {
      inertPointersRef.current.add(e.pointerId);
      return;
    }

    // 双指提升（ZOO-144 验收：双指落下不产生元素）：取消工具手势，进入画布平移缩放
    if (e.pointerType === 'touch' && shouldPromoteToPinch(touchCount())) {
      if (isDrawingRef.current || resizeRef.current || dragElementIdRef.current) cancelToolGesture();
      // 手型 / 空格单指平移进行中提升为双指：终止单指 pan（含未决 rAF 帧），双指手势全量接管视口
      if (isPanningRef.current) {
        isPanningRef.current = false;
        setPanActive(false);
        panPendingRef.current = null;
        if (panRafRef.current !== null) {
          cancelAnimationFrame(panRafRef.current);
          panRafRef.current = null;
        }
      }
      if (!pinchRef.current) beginPinch();
      return;
    }

    // 该指针接管当前手势通道（工具 / pan 均独占，后续 move 只认它）
    toolPointerIdRef.current = e.pointerId;

    // 平移起手（ZOO-157）：手型工具主键（鼠标 / 触摸 / 触控笔统一），空格按住与中键为既有通道
    if (spaceDown || e.button === 1 || (activeTool === 'hand' && e.button === 0)) {
      isPanningRef.current = true;
      setPanActive(true);
      panStartRef.current = { x: e.clientX, y: e.clientY };
      panOffsetStartRef.current = { x: viewport.offsetX, y: viewport.offsetY };
      return;
    }
    if (e.button > 1) return; // 右键等非主键不启动手势（长按呼出菜单已被 contextmenu 拦截）

    const point = getCanvasPoint(e);
    dragStartRef.current = point;
    isDrawingRef.current = true;

    if (activeTool === 'select') {
      // 控点缩放优先于元素命中（D-1：mathPlot 8 控点画在包围盒外沿；ZOO-159 text、
      // ZOO-160 rect/circle/path 角控点与 line/arrow 端点手柄，同优先级）。
      // ZOO-168 折线编辑态：line/arrow 布局换成逐顶点手柄 vN（v0/v末位 同端点语义）。
      // 触摸命中外扩至 44px 等效（8px 方块 + 18px 边距）；鼠标 / 触控笔维持 2px 基线
      const sel = elements.find((el) => el.id === selectedId);
      const editingPolyline =
        !!sel && sel.id === polylineEditId && (sel.type === 'line' || sel.type === 'arrow');
      if (sel) {
        const handle = hitTestSelectionHandle(
          sel, local, viewport,
          e.pointerType === 'touch'
            ? { margin: 18, polylineEditing: editingPolyline }
            : { polylineEditing: editingPolyline }
        );
        if (handle) {
          resizeRef.current = { handle, startEl: { ...sel }, startWorld: point };
          // 点中顶点手柄 = 选中该顶点（Delete 的删除目标）
          const vi = parseVertexHandle(handle);
          if (vi != null) selectPolylineVertex(vi);
          isDrawingRef.current = false; // 缩放手势独立提交，防止滞留的 select-drag 在抬指时用陈旧起点压脏快照
          return;
        }
      }
      let found = false;
      for (let i = elements.length - 1; i >= 0; i--) {
        if (hitTest(elements[i], point, viewport)) {
          setSelected(elements[i].id);
          dragElementStartRef.current = elements[i];
          dragElementIdRef.current = elements[i].id;
          found = true;
          break;
        }
      }
      if (!found) setSelected(null);
      // 点中编辑元素的线身（非顶点手柄）：清顶点选中，保留编辑态可继续拖整体
      if (found && useStore.getState().polylineVertexIndex !== null) {
        selectPolylineVertex(null);
      }
      return;
    }

    // equation 工具不在画布上落笔：输入与确认在右侧方程面板
    if (activeTool === 'equation') {
      isDrawingRef.current = false;
      return;
    }

    if (activeTool === 'pen') {
      const el: PathElement = {
        id: uuidv4(), type: 'path',
        x: point.x, y: point.y,
        points: [{ x: point.x, y: point.y }],
        strokeColor, strokeWidth, opacity: 1,
        dash: strokeDash,
      };
      tempElementRef.current = el;
      return;
    }

    if (activeTool === 'eraser') {
      for (let i = elements.length - 1; i >= 0; i--) {
        if (hitTest(elements[i], point, viewport)) {
          useStore.getState().deleteElement(elements[i].id);
          break;
        }
      }
      return;
    }

    if (activeTool === 'text') {
      // 取消 pointerdown 默认行为：否则同一次物理点击的兼容 mousedown 会把焦点从
      // 浮层 textarea 上抢走 → blur 误提交空草稿（浮层闪现即逝）
      e.preventDefault();
      // 点中已有文字 → 原位编辑（触摸通道主入口：T 工具单点即改）；点空白 → 新建草稿
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (el.type === 'text' && hitTest(el, point, viewport)) {
          openTextDraftForElement(el);
          isDrawingRef.current = false;
          return;
        }
      }
      openTextDraftForNew(point);
      isDrawingRef.current = false;
      return;
    }

    // Shape tools start
    if (['rectangle', 'circle', 'line', 'arrow'].includes(activeTool)) {
      const base = {
        id: uuidv4(), x: point.x, y: point.y,
        strokeColor, strokeWidth, opacity: 1,
        dash: strokeDash,
      };
      switch (activeTool) {
        case 'rectangle':
          tempElementRef.current = { ...base, type: 'rectangle', width: 0, height: 0, fillColor } as any;
          break;
        case 'circle':
          tempElementRef.current = { ...base, type: 'circle', width: 0, height: 0, fillColor } as any;
          break;
        case 'line':
          tempElementRef.current = { ...base, type: 'line', x2: point.x, y2: point.y } as any;
          break;
        case 'arrow':
          tempElementRef.current = { ...base, type: 'arrow', x2: point.x, y2: point.y } as any;
          break;
      }
    }
  }, [activeTool, elements, selectedId, strokeColor, strokeWidth, strokeDash, fillColor, spaceDown, viewport, polylineEditId, getLocalPoint, getCanvasPoint, setSelected, selectPolylineVertex, cancelToolGesture, beginPinch, touchCount, openTextDraftForElement, openTextDraftForNew, commitTextDraft]);

  // pan 帧回调：只读 ref，无需依赖数组
  const applyPanFromRaf = useCallback(() => {
    panRafRef.current = null;
    const d = panPendingRef.current;
    if (!d) return;
    panPendingRef.current = null;
    setViewport(panBy(
      { offsetX: panOffsetStartRef.current.x, offsetY: panOffsetStartRef.current.y, scale: useStore.getState().viewport.scale },
      d.x,
      d.y,
    ));
  }, [setViewport]);

  /** 控点缩放几何（§5.2 缩放语义）：equalRatio 角拖拽锁定纵横比 → y 视窗随宽高比保持，圆不变形。 */
  const applyResize = useCallback((rs: { handle: MathPlotHandle; startEl: MathPlotElement; startWorld: Point }, world: Point) => {
    const { viewport } = useStore.getState();
    const minW = Math.max(MATHPLOT_MIN_WIDTH, 48 / viewport.scale);
    const minH = Math.max(MATHPLOT_MIN_HEIGHT, 36 / viewport.scale);
    const { startEl, handle } = rs;
    let left = startEl.x;
    let top = startEl.y;
    let right = startEl.x + startEl.width;
    let bottom = startEl.y + startEl.height;

    if (handle.includes('w')) left = Math.min(world.x, right - minW);
    if (handle.includes('e')) right = Math.max(world.x, left + minW);
    if (handle.includes('n')) top = Math.min(world.y, bottom - minH);
    if (handle.includes('s')) bottom = Math.max(world.y, top + minH);

    let width = right - left;
    let height = bottom - top;
    if (startEl.equalRatio && handle.length === 2) {
      const aspect = startEl.height / startEl.width;
      // 主导轴优先：x 变化折算的 height 与直接拖出的 height 取更接近拖拽意图的一侧
      if (Math.abs(width - startEl.width) >= Math.abs(height - startEl.height) / (aspect || 1)) {
        height = width * aspect;
      } else {
        width = height / (aspect || 1);
      }
      if (handle.includes('n')) top = bottom - height;
      else bottom = top + height;
      if (handle.includes('w')) left = right - width;
      else right = left + width;
    }
    return { x: left, y: top, width: Math.max(width, minW), height: Math.max(height, minH) };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const local = getLocalPoint(e);
    const rec = activePointersRef.current.get(e.pointerId);
    if (rec) {
      rec.x = local.x;
      rec.y = local.y;
    }

    // 双指手势进行中：合并到每帧一次的 viewport 计算
    if (pinchRef.current) {
      if (pinchRafRef.current === null) {
        pinchRafRef.current = requestAnimationFrame(applyPinchFromRaf);
      }
      return;
    }

    // 惰性指针（捏合残余指 / 掌压）与非工具指针不驱动绘制
    if (inertPointersRef.current.has(e.pointerId)) return;
    if (toolPointerIdRef.current !== null && e.pointerId !== toolPointerIdRef.current) return;

    if (isPanningRef.current) {
      panPendingRef.current = { x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y };
      if (panRafRef.current === null) {
        panRafRef.current = requestAnimationFrame(applyPanFromRaf);
      }
      return;
    }

    // 控点缩放拖拽（静默直改，抬指统一压快照 —— 与移动拖拽同构）：
    // mathPlot（§11 D-1）/ text（ZOO-159）/ 图形元素（ZOO-160）按类型分派
    const rs = resizeRef.current;
    if (rs) {
      const point = getCanvasPoint(e);
      const start = rs.startEl;
      const { scale } = useStore.getState().viewport;
      const minSize = Math.max(SHAPE_MIN_SIZE, 16 / scale); // 屏幕侧 16px 下限
      let next: Record<string, unknown> | null = null;
      switch (start.type) {
        case 'text':
          next = textResizePatch(rs.handle as 'nw' | 'ne' | 'sw' | 'se', start, point);
          break;
        case 'mathPlot':
          next = applyResize({ handle: rs.handle as MathPlotHandle, startEl: start, startWorld: rs.startWorld }, point);
          break;
        case 'rectangle':
        case 'circle':
          next = boxResizePatch(rs.handle as CornerHandle, start, point, { shift: e.shiftKey, minSize });
          break;
        case 'line':
        case 'arrow': {
          // 折线编辑态顶点手柄 vN（ZOO-168）：拖动第 N 个顶点；非编辑态维持 p1/p2 端点语义
          const vi = parseVertexHandle(rs.handle);
          next = vi != null
            ? vertexDragPatch(start, vi, point)
            : endpointResizePatch(rs.handle as 'p1' | 'p2', start, point);
          break;
        }
        case 'path':
          next = pathResizePatch(rs.handle as CornerHandle, start, point, { minSize });
          break;
      }
      if (next) {
        useStore.setState({
          elements: useStore.getState().elements.map((el) =>
            el.id === rs.startEl.id ? { ...el, ...next } : el
          ),
        });
      }
      return;
    }

    if (!isDrawingRef.current) return;
    const point = getCanvasPoint(e);
    const temp = tempElementRef.current;
    if (!temp) {
      // Select tool dragging（ZOO-154：整体平移——以起手快照 + 位移重算，多锚点同步移动、形状不变）
      if (activeTool === 'select' && selectedId) {
        const dx = point.x - dragStartRef.current.x;
        const dy = point.y - dragStartRef.current.y;
        const el = useStore.getState().elements.find((e) => e.id === selectedId);
        const start = dragElementStartRef.current;
        if (el && start) {
          useStore.setState({
            elements: useStore.getState().elements.map((e) =>
              e.id === selectedId ? translateElement(start, dx, dy) : e
            ),
          });
        }
      }
      // Eraser drag
      if (activeTool === 'eraser') {
        for (let i = useStore.getState().elements.length - 1; i >= 0; i--) {
          if (hitTest(useStore.getState().elements[i], point, viewport)) {
            useStore.getState().deleteElement(useStore.getState().elements[i].id);
            break;
          }
        }
      }
      return;
    }

    if (temp.type === 'path') {
      temp.points.push({ x: point.x, y: point.y });
    } else if (temp.type === 'rectangle' || temp.type === 'circle') {
      temp.width = point.x - temp.x;
      temp.height = point.y - temp.y;
    } else if (temp.type === 'line' || temp.type === 'arrow') {
      (temp as any).x2 = point.x;
      (temp as any).y2 = point.y;
    }
    render();
  }, [activeTool, selectedId, viewport, getLocalPoint, getCanvasPoint, render, applyPanFromRaf, applyResize, applyPinchFromRaf]);

  /** 抬指 / 手势被系统打断（pointercancel）的统一收尾 */
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);

    // 双指之一抬起：结束捏合并落定最终帧；残余触摸标记惰性（防止误画）
    const pinch = pinchRef.current;
    if (pinch && pinch.pointerIds.includes(e.pointerId)) {
      if (pinchRafRef.current !== null) {
        cancelAnimationFrame(pinchRafRef.current);
        pinchRafRef.current = null;
      }
      const a = activePointersRef.current.get(pinch.pointerIds[0]);
      const b = activePointersRef.current.get(pinch.pointerIds[1]);
      if (a && b) setViewport(pinchViewport(pinch, a, b));
      pinchRef.current = null;
      for (const [id, p] of activePointersRef.current) {
        if (p.type === 'touch') inertPointersRef.current.add(id);
      }
      return;
    }

    if (inertPointersRef.current.delete(e.pointerId)) return;

    if (toolPointerIdRef.current !== e.pointerId) return; // 非工具指针（第三指等）抬指不影响手势
    toolPointerIdRef.current = null;

    if (isPanningRef.current) {
      isPanningRef.current = false;
      setPanActive(false);
      // 结束 pan：取消未决帧并同步落定最终位移（避免停留在倒数第二帧位置）
      if (panRafRef.current !== null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      const d = panPendingRef.current;
      panPendingRef.current = null;
      if (d) {
        setViewport(panBy(
          { offsetX: panOffsetStartRef.current.x, offsetY: panOffsetStartRef.current.y, scale: useStore.getState().viewport.scale },
          d.x,
          d.y,
        ));
      }
      return;
    }
    // 缩放提交：一次拖拽 = 一条可撤销快照（D5 同构）；判变泛化到全类型
    // （ZOO-160：path 逐点比值，text fontSize / mathPlot 外框语义均被覆盖）
    const rs = resizeRef.current;
    if (rs) {
      resizeRef.current = null;
      const cur = useStore.getState().elements.find((el) => el.id === rs.startEl.id);
      if (cur && elementResizeChanged(cur, rs.startEl)) {
        pushOperations([{
          type: 'update', elementId: rs.startEl.id,
          before: rs.startEl,
          after: { ...cur },
        }]);
      }
      return;
    }

    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    dragElementIdRef.current = null;

    const temp = tempElementRef.current;
    if (temp) {
      addElement(temp);
      tempElementRef.current = null;
    }

    // Commit select drag（before 取起手整元素快照——undo 按整元素回滚，多锚点不变形）
    if (activeTool === 'select' && selectedId) {
      const el = useStore.getState().elements.find((e) => e.id === selectedId);
      const orig = dragElementStartRef.current;
      if (el && orig) {
        if (el.x !== orig.x || el.y !== orig.y) {
          useStore.getState().pushOperations([{
            type: 'update', elementId: selectedId,
            before: orig,
            after: { ...el },
          }]);
        }
      }
    }
  }, [activeTool, selectedId, addElement, setViewport, pushOperations]);

  // 滚轮缩放：原生非 passive 监听（React 合成 onWheel 为 passive，preventDefault 无效）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { viewport, setViewport } = useStore.getState();
      const rect = canvas.getBoundingClientRect();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setViewport(zoomAt(viewport, { x: e.clientX - rect.left, y: e.clientY - rect.top }, viewport.scale * factor));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      // 编辑态守卫（ZOO-163）：焦点在输入控件（内联文字浮层 textarea、方程输入框等）
      // 时空格归文本输入——不平移、不 preventDefault，否则空格字符被吞（a b 变 ab）。
      // keyup 不设守卫：按住空格中途点进输入框，抬键仍要解除平移态。
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      e.preventDefault();
      setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  /**
   * 双击交互（select 工具）：文字 → 原位编辑（ZOO-159）；
   * line/arrow → 折线编辑态（ZOO-168）：双击中段进入编辑态，并在双击处
   * （最近段投影点）插入首个可拖顶点；已在编辑态 → 双击某段即追加顶点。
   * 距段端点过近（<12 屏幕 px）不插——双击落在端点 / 既有顶点手柄上防重合顶点。
   */
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool !== 'select' || textDraftRef.current) return;
    const st = useStore.getState();
    const point = getCanvasPoint(e);
    for (let i = st.elements.length - 1; i >= 0; i--) {
      const el = st.elements[i];
      if (el.type === 'text' && hitTest(el, point, st.viewport)) {
        openTextDraftForElement(el);
        return;
      }
    }
    for (let i = st.elements.length - 1; i >= 0; i--) {
      const el = st.elements[i];
      if ((el.type === 'line' || el.type === 'arrow') && hitTest(el, point, st.viewport)) {
        if (st.polylineEditId !== el.id) {
          st.setSelected(el.id); // 选中变化会清旧编辑态，先选再进（同元素则原位保留）
          st.beginPolylineEdit(el.id);
        }
        const insert = insertVertexPatch(el, point, { minEndDist: 12 / st.viewport.scale });
        if (insert) {
          st.updateElement(el.id, insert.patch); // 转换 / 插点 = 单条可撤销快照
          st.selectPolylineVertex(insert.index);
        } else {
          st.selectPolylineVertex(null);
        }
        return;
      }
    }
  }, [activeTool, getCanvasPoint, openTextDraftForElement]);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden">
      <canvas
        ref={canvasRef}
        className="whiteboard-canvas absolute inset-0 w-full h-full"
        style={{ cursor: panActive ? 'grabbing' : spaceDown || activeTool === 'hand' ? 'grab' : activeTool === 'select' ? 'default' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      {textDraft && (
        <TextInputOverlay
          x={textDraft.worldX * viewport.scale + viewport.offsetX}
          y={textDraft.worldY * viewport.scale + viewport.offsetY}
          fontSizePx={textDraft.fontSize * viewport.scale}
          color={textDraft.color}
          value={textDraft.value}
          maxWidth={Math.max(120, containerWidth - (textDraft.worldX * viewport.scale + viewport.offsetX) - 8)}
          onChange={handleDraftChange}
          onConfirm={commitTextDraft}
          onCancel={cancelTextDraft}
        />
      )}
      {activeTool === 'equation' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-[5]">
          <div className="px-4 py-2 bg-white/90 backdrop-blur-sm rounded-full shadow border border-gray-200 text-sm text-gray-500 flex items-center gap-1.5">
            <span className="font-serif italic text-blue-500">ƒ</span>
            {t('canvas.equationHint')}
          </div>
        </div>
      )}
    </div>
  );
}
