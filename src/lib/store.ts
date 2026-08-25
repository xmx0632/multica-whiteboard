import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  WhiteboardElement,
  FrameElement,
  ToolType,
  Viewport,
  Operation,
  WhiteboardDocument,
  StrokeDashStyle,
  DEFAULT_STROKE_COLOR,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_STROKE_DASH,
  DEFAULT_FONT_SIZE,
  CURRENT_SCHEMA_VERSION,
} from './types';
import type { EquationDraftPayload } from './math/types';
import { strokeColorPatch, canRestyleFromToolPanel, canDashFromToolPanel, elementStrokeColor } from './stroke';
import { measureTextElement } from './textElement';
import { isPolyline, removeVertexPatch } from './polyline';
import { reorderElements, reorderElementsMulti, ZOrderAction } from './zorder';
import { framesOf, nextFrameRect, frameContents, duplicateFrameBundle } from './frame';
import { translateElement } from './renderer';
import { clearBindingsOfDeletedElements } from './binding';

/** 粘贴 / 复制并平移的落位偏移（世界坐标，ZOO-205；Excalidraw 同数量级手感） */
const CLIPBOARD_PASTE_OFFSET = 16;

interface WhiteboardState {
  // Document
  documentId: string;
  documentTitle: string;
  /** 数据模型版本（ZOO-198）：新建 = CURRENT；载入旧文档缺省 1（无帧，行为零变化） */
  schemaVersion: number;

  // Elements
  elements: WhiteboardElement[];
  selectedId: string | null;
  /** 最小选中集合（ZOO-205）：Ctrl+A 全选 / 复制粘贴剪切 / 组拖拽作用域。
   *  不变量：selectedId 非空时 ∈ selectedIds（单选即长度 1 的集合） */
  selectedIds: string[];
  /** 页面内剪贴板（ZOO-205）：Ctrl+C/X 存入快照（元素不可变，存引用安全），
   *  Ctrl+V 以新 id 偏移落位；不写系统剪贴板 */
  clipboard: WhiteboardElement[];

  // Tool
  activeTool: ToolType;
  strokeColor: string;
  strokeWidth: number;
  /** 新绘制默认线型（ZOO-165）：pen / rect / circle / line / arrow 建元素携带 */
  strokeDash: StrokeDashStyle;
  fillColor: string | null;
  fontSize: number;

  // Viewport
  viewport: Viewport;

  // History
  undoStack: Operation[][];
  redoStack: Operation[][];

  // Persistence
  isDirty: boolean;
  lastSavedAt: number | null;

  // MathPlot 插入握手（ZOO-136）：编辑面板确认 → Canvas 按画布中心落点建元素
  pendingMathPlot: { payload: EquationDraftPayload; strokeColor: string; strokeWidth: number } | null;
  requestMathPlotInsert: (payload: EquationDraftPayload) => void;
  consumeMathPlotInsert: () => void;

  // Actions - Elements
  addElement: (element: WhiteboardElement) => void;
  updateElement: (id: string, updates: Partial<WhiteboardElement>) => void;
  /** 直改不入栈（技术方案 D5）：滑杆拖动实时预览；提交时由调用方 pushOperations 压一条快照 */
  updateElementTransient: (id: string, updates: Partial<WhiteboardElement>) => void;
  deleteElement: (id: string) => void;
  deleteSelected: () => void;
  clearAll: () => void;

  // Actions - Selection
  setSelected: (id: string | null) => void;
  // Actions - 多选最小集 + 页面内剪贴板（ZOO-205）
  /** Ctrl+A：选中全部内容元素（不含页帧；纯会话态不置脏） */
  selectAll: () => void;
  /** Ctrl+C：当前选中集合存入页面内剪贴板（页帧不参与，页复制走页条） */
  copySelected: () => void;
  /** Ctrl+X：复制入剪贴板后删除源（单条可撤销快照） */
  cutSelected: () => void;
  /** Ctrl+V：剪贴板内容以新 id 偏移落位（单条可撤销快照），粘贴结果成为新选中 */
  pasteClipboard: () => void;
  /** Ctrl+D：选中集合原地克隆偏移落位（不触碰剪贴板，单条可撤销快照） */
  duplicateSelected: () => void;
  /** 批量删除（deleteSelected 多选分支 / cutSelected 共用；单条可撤销快照） */
  deleteElements: (ids: string[]) => void;

  // Actions - 图层顺序（ZOO-183）：基于 selectedId 数组重排；边界空转不入撤销栈
  /** 置于最上层（移到 elements 末位，renderer 最后绘制） */
  bringToFront: () => void;
  /** 置于最底层（移到 elements 首位，renderer 最先绘制） */
  sendToBack: () => void;
  /** 上移一层（与后一位交换；快捷键 ]） */
  moveUp: () => void;
  /** 下移一层（与前一位交换；快捷键 [） */
  moveDown: () => void;
  /** 四操作共用实现（内部；空转不压栈） */
  applyZOrder: (action: ZOrderAction) => void;

  // 折线顶点编辑态（ZOO-168）：双击 line/arrow 中段进入；点空白 / Esc / 切工具退出
  polylineEditId: string | null;
  /** 编辑态中选中的顶点下标（Delete 删除目标）；null = 未选中顶点 */
  polylineVertexIndex: number | null;
  beginPolylineEdit: (id: string) => void;
  endPolylineEdit: () => void;
  selectPolylineVertex: (index: number | null) => void;
  /** 删除编辑态选中的中间顶点（单条可撤销快照；≤2 顶点退化直线并退出编辑态） */
  deletePolylineVertex: () => void;

  // Actions - Tool
  setTool: (tool: ToolType) => void;
  setStrokeColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  /** 线型点选（ZOO-165，离散）：有选中描边元素 → 立即改该元素线型（单条可撤销快照）并同步默认；无选中 → 仅设默认 */
  pickStrokeDash: (dash: StrokeDashStyle) => void;
  setFillColor: (color: string | null) => void;
  setFontSize: (size: number) => void;

  // Actions - 选中样式（ZOO-157：面板操作有选中元素时直接作用于该元素）
  /** 颜色色板点选（离散）：有选中元素 → 立即改该元素颜色（单条可撤销快照）并同步默认色；无选中 → 仅设默认色 */
  pickStrokeColor: (color: string) => void;
  /** 自定义取色器拖动（连续）：有选中元素 → 直改预览（D5 不入栈）并同步默认色；快照由 commitStrokeStyle 压入 */
  inputStrokeColor: (color: string) => void;
  /** 线宽滑杆拖动（连续）：有选中元素 → 直改预览（D5 不入栈）并同步默认线宽；快照由 commitStrokeStyle 压入 */
  inputStrokeWidth: (width: number) => void;
  /** 字号滑杆拖动（ZOO-159，连续）：选中 text → 直改 fontSize + 重测宽高（D5 不入栈）并同步默认字号；快照由 commitStrokeStyle 压入 */
  inputFontSize: (size: number) => void;
  /** 连续调整收尾（抬杆 / 取色器失焦）：一次手势压一条可撤销快照（无改动不压栈） */
  commitStrokeStyle: () => void;
  /** 连续手势起手元素快照（D5 两段式；非渲染态，置空表示手势未开始） */
  strokeGestureBefore: WhiteboardElement | null;

  // Actions - Viewport
  setViewport: (viewport: Partial<Viewport>) => void;

  // Actions - History
  undo: () => void;
  redo: () => void;
  pushOperations: (ops: Operation[]) => void;

  // Actions - 分页帧（ZOO-198）：页序 = elements 中帧的相对顺序
  /** 新增一页（帧）：无帧 → 视口中心，有帧 → 最右帧右侧；页名由调用方按语言传入 */
  addFrame: (name: string, viewSize?: { width: number; height: number }) => string;
  /** 页重命名（空名忽略；单条可撤销快照） */
  renameFrame: (id: string, name: string) => void;
  /** 复制页：帧 + 页内内容整体换新 id，落位源帧右侧，页序插在源页之后（单快照可撤销） */
  duplicateFrame: (id: string, copyName: string) => void;
  /** 删除页：帧 + 页内内容一并删除（单快照可撤销）；活动页自动落到邻页 */
  deleteFrame: (id: string) => void;
  /** 页序重排（帧槽位重排，内容层级不动；reorder 快照可撤销；同位 / 越界空转） */
  moveFrameTo: (fromIndex: number, toIndex: number) => void;
  /** 页条点击跳转时标记当前页（会话态，不置脏、不持久化） */
  setActiveFrame: (id: string | null) => void;
  /** 当前页 id（撤销 / 删除后可能悬空，消费方按 framesOf 自行兜底） */
  activeFrameId: string | null;

  // Actions - Document
  loadDocument: (doc: WhiteboardDocument) => void;
  /** ZOO-176：默认标题可由调用方按语言传入（缺省 'Untitled' 保持既有行为） */
  newDocument: (title?: string) => void;
  setDocumentTitle: (title: string) => void;
  /** 列表侧重命名联动当前打开文档（ZOO-158）：写穿已持久化，不置 isDirty */
  applyDocumentRename: (id: string, title: string) => void;
  markSaved: () => void;
}

/** 撤销 / 重做后编辑态是否失效：编辑中的元素已不存在或不再是折线形态（ZOO-168） */
function polylineEditStale(polylineEditId: string | null, elements: WhiteboardElement[]): boolean {
  if (!polylineEditId) return false;
  const el = elements.find((e) => e.id === polylineEditId);
  if (!el || (el.type !== 'line' && el.type !== 'arrow')) return true;
  return !isPolyline(el);
}

export const useStore = create<WhiteboardState>((set, get) => ({
  // Document defaults
  documentId: uuidv4(),
  documentTitle: 'Untitled',
  schemaVersion: CURRENT_SCHEMA_VERSION,

  // Elements
  elements: [],
  selectedId: null,
  selectedIds: [],
  clipboard: [],

  // 折线顶点编辑态（ZOO-168）
  polylineEditId: null,
  polylineVertexIndex: null,

  // Tool defaults
  activeTool: 'pen',
  strokeColor: DEFAULT_STROKE_COLOR,
  strokeWidth: DEFAULT_STROKE_WIDTH,
  strokeDash: DEFAULT_STROKE_DASH,
  fillColor: null,
  fontSize: DEFAULT_FONT_SIZE,

  // Viewport defaults
  viewport: { offsetX: 0, offsetY: 0, scale: 1 },

  // History
  undoStack: [],
  redoStack: [],

  // Persistence
  isDirty: false,
  lastSavedAt: null,

  // MathPlot 插入握手
  pendingMathPlot: null,

  // 分页帧（ZOO-198）
  activeFrameId: null,

  // 选中样式连续手势快照（取色器 / 线宽滑杆共用）
  strokeGestureBefore: null,

  // Element actions
  addElement: (element) => {
    const ops: Operation[] = [{ type: 'create', elementId: element.id, after: element }];
    set((s) => ({
      elements: [...s.elements, element],
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
    }));
  },

  updateElement: (id, updates) => {
    const el = get().elements.find((e) => e.id === id);
    if (!el) return;
    const updated = Object.assign({}, el, updates) as WhiteboardElement;
    const ops: Operation[] = [{ type: 'update', elementId: id, before: { ...el } as WhiteboardElement, after: updated }];
    set((s) => ({
      elements: s.elements.map((e) => (e.id === id ? Object.assign({}, e, updates) as WhiteboardElement : e)),
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
    }));
  },

  updateElementTransient: (id, updates) => {
    set((s) => ({
      elements: s.elements.map((e) => (e.id === id ? Object.assign({}, e, updates) as WhiteboardElement : e)),
      isDirty: true,
    }));
  },

  deleteElement: (id) => {
    const el = get().elements.find((e) => e.id === id);
    if (!el) return;
    const ops: Operation[] = [{ type: 'delete', elementId: id, before: el }];
    // ZOO-220: 清除指向被删除元素的绑定（端点冻结原地）；绑定解除并入同一条
    // 可撤销记录——undo 恢复元素的同时恢复箭头绑定。变更检测用引用不等
    // （纯函数仅对绑定被清除的箭头建新对象）
    const elementsAfterBindingClear = clearBindingsOfDeletedElements(get().elements, new Set([id]));
    for (const e2 of elementsAfterBindingClear) {
      if (e2.type !== 'arrow') continue;
      const before = get().elements.find((e3) => e3.id === e2.id);
      if (before && before !== e2) ops.push({ type: 'update', elementId: e2.id, before, after: e2 });
    }
    set((s) => ({
      elements: elementsAfterBindingClear.filter((e) => e.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((sid) => sid !== id) : s.selectedIds,
      polylineEditId: s.polylineEditId === id ? null : s.polylineEditId,
      polylineVertexIndex: s.polylineEditId === id ? null : s.polylineVertexIndex,
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
    }));
  },

  deleteSelected: () => {
    const { selectedIds, selectedId, deleteElement, deleteElements } = get();
    const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
    if (ids.length <= 1) {
      if (selectedId) deleteElement(selectedId);
      return;
    }
    deleteElements(ids);
  },

  deleteElements: (ids) => {
    const st = get();
    const removed = st.elements.filter((e) => ids.includes(e.id));
    if (removed.length === 0) return;
    const removedSet = new Set(removed.map((e) => e.id));
    const ops: Operation[] = removed.map((el) => ({ type: 'delete' as const, elementId: el.id, before: el }));
    // ZOO-220: 清除指向被删除元素的绑定，并入同一条可撤销记录（同 deleteElement）
    const elementsAfterBindingClear = clearBindingsOfDeletedElements(st.elements, removedSet);
    for (const e2 of elementsAfterBindingClear) {
      if (e2.type !== 'arrow') continue;
      const before = st.elements.find((e3) => e3.id === e2.id);
      if (before && before !== e2) ops.push({ type: 'update', elementId: e2.id, before, after: e2 });
    }
    const editIdCleared = st.polylineEditId != null && removedSet.has(st.polylineEditId);
    set((s) => ({
      elements: elementsAfterBindingClear.filter((e) => !removedSet.has(e.id)),
      selectedId: s.selectedId != null && removedSet.has(s.selectedId) ? null : s.selectedId,
      selectedIds: s.selectedIds.some((id) => removedSet.has(id)) ? [] : s.selectedIds,
      polylineEditId: editIdCleared ? null : s.polylineEditId,
      polylineVertexIndex: editIdCleared ? null : s.polylineVertexIndex,
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
    }));
  },

  clearAll: () => {
    const els = get().elements;
    if (els.length === 0) return;
    const ops: Operation[] = els.map((el) => ({ type: 'delete' as const, elementId: el.id, before: el }));
    set((s) => ({
      elements: [],
      selectedId: null,
      selectedIds: [],
      polylineEditId: null,
      polylineVertexIndex: null,
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
    }));
  },

  // Selection
  // 选中变化退出折线编辑态（选中别的元素 / 取消选中即退出，ZOO-168 验收 4）
  setSelected: (id) =>
    set((s) =>
      id === s.polylineEditId
        ? { selectedId: id, selectedIds: id ? [id] : [] }
        : { selectedId: id, selectedIds: id ? [id] : [], polylineEditId: null, polylineVertexIndex: null }
    ),

  // 多选最小集 + 页面内剪贴板（ZOO-205）
  selectAll: () => {
    const ids = get().elements.filter((e) => e.type !== 'frame').map((e) => e.id);
    set({
      selectedIds: ids,
      selectedId: ids.length > 0 ? ids[ids.length - 1] : null,
      polylineEditId: null,
      polylineVertexIndex: null,
    });
  },

  copySelected: () => {
    const { elements, selectedIds, selectedId } = get();
    const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
    const picked = elements.filter((e) => ids.includes(e.id) && e.type !== 'frame');
    if (picked.length === 0) return;
    set({ clipboard: picked });
  },

  cutSelected: () => {
    get().copySelected();
    const { clipboard, deleteElements } = get();
    if (clipboard.length === 0) return;
    deleteElements(clipboard.map((e) => e.id));
  },

  pasteClipboard: () => {
    const { clipboard } = get();
    if (clipboard.length === 0) return;
    const created = clipboard.map((el) => ({
      ...translateElement(el, CLIPBOARD_PASTE_OFFSET, CLIPBOARD_PASTE_OFFSET),
      id: uuidv4(),
    })) as WhiteboardElement[];
    const ops: Operation[] = created.map((c) => ({ type: 'create' as const, elementId: c.id, after: c }));
    set((s) => ({
      elements: [...s.elements, ...created],
      selectedIds: created.map((c) => c.id),
      selectedId: created[created.length - 1].id,
      polylineEditId: null,
      polylineVertexIndex: null,
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
    }));
  },

  duplicateSelected: () => {
    const { elements, selectedIds, selectedId } = get();
    const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
    const picked = elements.filter((e) => ids.includes(e.id) && e.type !== 'frame');
    if (picked.length === 0) return;
    const created = picked.map((el) => ({
      ...translateElement(el, CLIPBOARD_PASTE_OFFSET, CLIPBOARD_PASTE_OFFSET),
      id: uuidv4(),
    })) as WhiteboardElement[];
    const ops: Operation[] = created.map((c) => ({ type: 'create' as const, elementId: c.id, after: c }));
    set((s) => ({
      elements: [...s.elements, ...created],
      selectedIds: created.map((c) => c.id),
      selectedId: created[created.length - 1].id,
      polylineEditId: null,
      polylineVertexIndex: null,
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
    }));
  },

  // 图层顺序（ZOO-183）：一次调整一条 reorder 快照（before/after 全量数组，
  // 元素不可变仅持引用）；redoStack 清空同其他操作，与画笔 / 删除历史正确交错
  bringToFront: () => get().applyZOrder('bringToFront'),
  sendToBack: () => get().applyZOrder('sendToBack'),
  moveUp: () => get().applyZOrder('bringForward'),
  moveDown: () => get().applyZOrder('sendBackward'),

  applyZOrder: (action: ZOrderAction) => {
    const { elements, selectedId, selectedIds } = get();
    // 多选集合整体重排（ZOO-205）；单选 / 空选走原单元素路径
    const reordered = selectedIds.length > 1
      ? reorderElementsMulti(elements, selectedIds, action)
      : reorderElements(elements, selectedId, action);
    if (!reordered) return; // 边界 / 无选中空转：不置脏、不压撤销栈
    const ops: Operation[] = [{
      type: 'reorder', elementId: selectedIds.length > 0 ? selectedIds[0] : selectedId!,
      beforeElements: elements, afterElements: reordered,
    }];
    set((s) => ({
      elements: reordered,
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
    }));
  },

  // 折线顶点编辑态（ZOO-168）
  beginPolylineEdit: (id) => set({ polylineEditId: id, polylineVertexIndex: null }),
  endPolylineEdit: () => set({ polylineEditId: null, polylineVertexIndex: null }),
  selectPolylineVertex: (index) => set({ polylineVertexIndex: index }),

  deletePolylineVertex: () => {
    const { polylineEditId, polylineVertexIndex, elements, updateElement } = get();
    if (!polylineEditId || polylineVertexIndex == null) return;
    const el = elements.find((e) => e.id === polylineEditId);
    if (!el || (el.type !== 'line' && el.type !== 'arrow')) return;
    const patch = removeVertexPatch(el, polylineVertexIndex);
    if (!patch) return; // 端点 / 下标越界不可删
    updateElement(el.id, patch);
    // 删除后 ≤2 顶点：元素退化为普通直线，退出编辑态；否则仅清顶点选中
    if (isPolyline(Object.assign({}, el, patch))) {
      set({ polylineVertexIndex: null });
    } else {
      set({ polylineEditId: null, polylineVertexIndex: null });
    }
  },

  // Tool
  setTool: (tool) => set({ activeTool: tool, selectedId: null, selectedIds: [], polylineEditId: null, polylineVertexIndex: null }),
  setStrokeColor: (color) => set({ strokeColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  // 线型与色板点选同语义（ZOO-165）：离散选择即时落元素，单条快照可撤销
  pickStrokeDash: (dash) => {
    const { selectedId, elements } = get();
    const el = elements.find((e) => e.id === selectedId);
    if (el && canDashFromToolPanel(el)) {
      get().updateElement(el.id, { dash });
    }
    set({ strokeDash: dash });
  },
  setFillColor: (color) => set({ fillColor: color }),
  setFontSize: (size) => set({ fontSize: size }),

  // 选中样式（ZOO-157）：mathPlot 有专属参数面板，默认面板操作跳过它防回归
  pickStrokeColor: (color) => {
    const { selectedId, elements } = get();
    const el = elements.find((e) => e.id === selectedId);
    if (el && canRestyleFromToolPanel(el)) {
      get().updateElement(el.id, strokeColorPatch(el, color));
    }
    set({ strokeColor: color });
  },

  inputStrokeColor: (color) => {
    const { selectedId, elements } = get();
    const el = elements.find((e) => e.id === selectedId);
    if (el && canRestyleFromToolPanel(el)) {
      if (!get().strokeGestureBefore) set({ strokeGestureBefore: el });
      get().updateElementTransient(el.id, strokeColorPatch(el, color));
    }
    set({ strokeColor: color });
  },

  inputStrokeWidth: (width) => {
    const { selectedId, elements } = get();
    const el = elements.find((e) => e.id === selectedId);
    if (el && canRestyleFromToolPanel(el)) {
      if (!get().strokeGestureBefore) set({ strokeGestureBefore: el });
      get().updateElementTransient(el.id, { strokeWidth: width });
    }
    set({ strokeWidth: width });
  },

  inputFontSize: (size) => {
    const { selectedId, elements } = get();
    const el = elements.find((e) => e.id === selectedId);
    if (el && el.type === 'text') {
      if (!get().strokeGestureBefore) set({ strokeGestureBefore: el });
      const { width, height } = measureTextElement({
        content: el.content, fontSize: size, fontFamily: el.fontFamily,
      });
      get().updateElementTransient(el.id, { fontSize: size, width, height });
    }
    set({ fontSize: size });
  },

  commitStrokeStyle: () => {
    const before = get().strokeGestureBefore;
    set({ strokeGestureBefore: null });
    if (!before) return;
    const cur = get().elements.find((e) => e.id === before.id);
    if (!cur) return;
    const changed =
      cur.strokeWidth !== before.strokeWidth ||
      elementStrokeColor(cur) !== elementStrokeColor(before) ||
      (cur.type === 'text' && before.type === 'text' && cur.fontSize !== before.fontSize);
    if (!changed) return;
    get().pushOperations([{ type: 'update', elementId: before.id, before, after: { ...cur } }]);
  },

  // MathPlot 插入握手：面板只投递载荷，落点（画布中心）由 Canvas 用自身 rect 计算
  requestMathPlotInsert: (payload) => set((s) => ({
    pendingMathPlot: { payload, strokeColor: s.strokeColor, strokeWidth: s.strokeWidth },
  })),
  consumeMathPlotInsert: () => set({ pendingMathPlot: null }),

  // 分页帧（ZOO-198）
  addFrame: (name, viewSize) => {
    const st = get();
    const rect = nextFrameRect(framesOf(st.elements), st.viewport, viewSize);
    const frame: FrameElement = {
      id: uuidv4(), type: 'frame',
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      name,
      strokeColor: '#94a3b8', strokeWidth: 2, opacity: 1,
    };
    const ops: Operation[] = [{ type: 'create', elementId: frame.id, after: frame }];
    set((s) => ({
      elements: [...s.elements, frame], // 帧槽位末尾 = 页序末尾
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
      activeFrameId: frame.id,
    }));
    return frame.id;
  },

  renameFrame: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    get().updateElement(id, { name: trimmed });
  },

  duplicateFrame: (id, copyName) => {
    const st = get();
    const source = st.elements.find((e): e is FrameElement => e.type === 'frame' && e.id === id);
    if (!source) return;
    const name = copyName.trim() || source.name;
    const { frame, contents } = duplicateFrameBundle(source, frameContents(st.elements, source), name);
    // 页序：新帧插在源帧之后；内容 append 到末尾（层级在顶，视觉等价）
    const srcIdx = st.elements.findIndex((e) => e.id === source.id);
    const elements = [...st.elements];
    elements.splice(srcIdx + 1, 0, frame);
    elements.push(...contents);
    const ops: Operation[] = [
      { type: 'create', elementId: frame.id, after: frame },
      ...contents.map((c) => ({ type: 'create' as const, elementId: c.id, after: c })),
    ];
    set((s) => ({
      elements,
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
      activeFrameId: frame.id,
    }));
  },

  deleteFrame: (id) => {
    const st = get();
    const frame = st.elements.find((e): e is FrameElement => e.type === 'frame' && e.id === id);
    if (!frame) return;
    const contents = frameContents(st.elements, frame);
    const removedIds = new Set([id, ...contents.map((c) => c.id)]);
    const elements = st.elements.filter((e) => !removedIds.has(e.id));
    // 数组快照 op（reorder 机制，ZOO-183）：undo / redo 整体恢复数组——
    // 页序与内容层级精确回退（delete op 逐条回插会翻页序）
    const ops: Operation[] = [{
      type: 'reorder', elementId: frame.id,
      beforeElements: st.elements, afterElements: elements,
    }];
    // 活动页兜底：删除后落到原位次的最邻近页（末页删除落到前一页）
    const rest = framesOf(elements);
    const idx = framesOf(st.elements).findIndex((f) => f.id === id);
    const fallback = rest[Math.min(idx, rest.length - 1)]?.id ?? null;
    set((s) => ({
      elements,
      selectedId: s.selectedId != null && removedIds.has(s.selectedId) ? null : s.selectedId,
      polylineEditId: s.polylineEditId != null && removedIds.has(s.polylineEditId) ? null : s.polylineEditId,
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
      activeFrameId: s.activeFrameId === id ? fallback : s.activeFrameId,
    }));
  },

  moveFrameTo: (fromIndex, toIndex) => {
    const st = get();
    const frames = framesOf(st.elements);
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= frames.length || toIndex < 0 || toIndex >= frames.length) return;
    // 帧槽位重排：elements 中每个帧位置按序换成重排后的帧，内容元素原地不动
    const reordered = [...frames];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    let fi = 0;
    const elements = st.elements.map((el) => (el.type === 'frame' ? reordered[fi++] : el));
    const ops: Operation[] = [{
      type: 'reorder', elementId: moved.id,
      beforeElements: st.elements, afterElements: elements,
    }];
    set((s) => ({
      elements,
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
    }));
  },

  setActiveFrame: (id) => set({ activeFrameId: id }),

  // Viewport
  setViewport: (vp) => set((s) => ({ viewport: { ...s.viewport, ...vp } })),

  // History
  pushOperations: (ops) => {
    set((s) => ({
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
    }));
  },

  undo: () => {
    const { undoStack, redoStack, elements, polylineEditId } = get();
    if (undoStack.length === 0) return;
    const ops = undoStack[undoStack.length - 1];
    const newElements = [...elements];

    for (const op of [...ops].reverse()) {
      if (op.type === 'create' && op.after) {
        const idx = newElements.findIndex((e) => e.id === op.elementId);
        if (idx >= 0) newElements.splice(idx, 1);
      } else if (op.type === 'delete' && op.before) {
        newElements.push(op.before);
      } else if (op.type === 'update' && op.before) {
        const idx = newElements.findIndex((e) => e.id === op.elementId);
        if (idx >= 0) newElements[idx] = op.before;
      } else if (op.type === 'reorder' && op.beforeElements) {
        // 数组序即层级（ZOO-183）：整体恢复快照——快照与当前态仅差这一次重排
        newElements.length = 0;
        newElements.push(...op.beforeElements);
      }
    }

    // 折线编辑态守卫（ZOO-168）：撤销把编辑中的元素退回直线 / 撤没 → 退出编辑态
    const editCleared = polylineEditStale(polylineEditId, newElements);

    set({
      elements: newElements,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, ops],
      ...(editCleared ? { polylineEditId: null, polylineVertexIndex: null } : {}),
      isDirty: true,
    });
  },

  redo: () => {
    const { undoStack, redoStack, elements, polylineEditId } = get();
    if (redoStack.length === 0) return;
    const ops = redoStack[redoStack.length - 1];
    const newElements = [...elements];

    for (const op of ops) {
      if (op.type === 'create' && op.after) {
        newElements.push(op.after);
      } else if (op.type === 'delete') {
        const idx = newElements.findIndex((e) => e.id === op.elementId);
        if (idx >= 0) newElements.splice(idx, 1);
      } else if (op.type === 'update' && op.after) {
        const idx = newElements.findIndex((e) => e.id === op.elementId);
        if (idx >= 0) newElements[idx] = op.after;
      } else if (op.type === 'reorder' && op.afterElements) {
        // 数组序即层级（ZOO-183）：整体恢复快照
        newElements.length = 0;
        newElements.push(...op.afterElements);
      }
    }

    const editCleared = polylineEditStale(polylineEditId, newElements);

    set({
      elements: newElements,
      undoStack: [...undoStack, ops],
      redoStack: redoStack.slice(0, -1),
      ...(editCleared ? { polylineEditId: null, polylineVertexIndex: null } : {}),
      isDirty: true,
    });
  },

  // Document
  loadDocument: (doc) => {
    set({
      documentId: doc.id,
      documentTitle: doc.title,
      schemaVersion: doc.schemaVersion ?? 1, // 旧文档缺省 v1：无帧，行为零变化（ZOO-198）
      elements: doc.elements,
      viewport: doc.viewport,
      selectedId: null,
      selectedIds: [],
      polylineEditId: null,
      polylineVertexIndex: null,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      lastSavedAt: Date.now(),
      activeFrameId: null,
    });
  },

  newDocument: (title) => {
    set({
      documentId: uuidv4(),
      documentTitle: title ?? 'Untitled',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      elements: [],
      viewport: { offsetX: 0, offsetY: 0, scale: 1 },
      selectedId: null,
      selectedIds: [],
      polylineEditId: null,
      polylineVertexIndex: null,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      lastSavedAt: null,
      activeFrameId: null,
    });
  },

  setDocumentTitle: (title) => set({ documentTitle: title, isDirty: true }),
  applyDocumentRename: (id, title) =>
    set((s) => (s.documentId === id ? { documentTitle: title } : {})),
  markSaved: () => set({ isDirty: false, lastSavedAt: Date.now() }),
}));
