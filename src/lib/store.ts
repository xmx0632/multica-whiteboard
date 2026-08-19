import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  WhiteboardElement,
  ToolType,
  Viewport,
  Operation,
  WhiteboardDocument,
  StrokeDashStyle,
  DEFAULT_STROKE_COLOR,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_STROKE_DASH,
  DEFAULT_FONT_SIZE,
} from './types';
import type { EquationDraftPayload } from './math/types';
import { strokeColorPatch, canRestyleFromToolPanel, canDashFromToolPanel, elementStrokeColor } from './stroke';
import { measureTextElement } from './textElement';

interface WhiteboardState {
  // Document
  documentId: string;
  documentTitle: string;

  // Elements
  elements: WhiteboardElement[];
  selectedId: string | null;

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

  // Actions - Document
  loadDocument: (doc: WhiteboardDocument) => void;
  newDocument: () => void;
  setDocumentTitle: (title: string) => void;
  /** 列表侧重命名联动当前打开文档（ZOO-158）：写穿已持久化，不置 isDirty */
  applyDocumentRename: (id: string, title: string) => void;
  markSaved: () => void;
}

export const useStore = create<WhiteboardState>((set, get) => ({
  // Document defaults
  documentId: uuidv4(),
  documentTitle: 'Untitled',

  // Elements
  elements: [],
  selectedId: null,

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
    set((s) => ({
      elements: s.elements.filter((e) => e.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
    }));
  },

  deleteSelected: () => {
    const { selectedId, deleteElement } = get();
    if (selectedId) deleteElement(selectedId);
  },

  clearAll: () => {
    const els = get().elements;
    if (els.length === 0) return;
    const ops: Operation[] = els.map((el) => ({ type: 'delete' as const, elementId: el.id, before: el }));
    set((s) => ({
      elements: [],
      selectedId: null,
      undoStack: [...s.undoStack.slice(-99), ops],
      redoStack: [],
      isDirty: true,
    }));
  },

  // Selection
  setSelected: (id) => set({ selectedId: id }),

  // Tool
  setTool: (tool) => set({ activeTool: tool, selectedId: null }),
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
    const { undoStack, redoStack, elements } = get();
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
      }
    }

    set({
      elements: newElements,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, ops],
      isDirty: true,
    });
  },

  redo: () => {
    const { undoStack, redoStack, elements } = get();
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
      }
    }

    set({
      elements: newElements,
      undoStack: [...undoStack, ops],
      redoStack: redoStack.slice(0, -1),
      isDirty: true,
    });
  },

  // Document
  loadDocument: (doc) => {
    set({
      documentId: doc.id,
      documentTitle: doc.title,
      elements: doc.elements,
      viewport: doc.viewport,
      selectedId: null,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      lastSavedAt: Date.now(),
    });
  },

  newDocument: () => {
    set({
      documentId: uuidv4(),
      documentTitle: 'Untitled',
      elements: [],
      viewport: { offsetX: 0, offsetY: 0, scale: 1 },
      selectedId: null,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      lastSavedAt: null,
    });
  },

  setDocumentTitle: (title) => set({ documentTitle: title, isDirty: true }),
  applyDocumentRename: (id, title) =>
    set((s) => (s.documentId === id ? { documentTitle: title } : {})),
  markSaved: () => set({ isDirty: false, lastSavedAt: Date.now() }),
}));
