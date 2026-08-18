import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  WhiteboardElement,
  ToolType,
  Viewport,
  Operation,
  WhiteboardDocument,
  DEFAULT_STROKE_COLOR,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_FONT_SIZE,
} from './types';
import type { EquationDraftPayload } from './math/types';

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
  setFillColor: (color: string | null) => void;
  setFontSize: (size: number) => void;

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
  setFillColor: (color) => set({ fillColor: color }),
  setFontSize: (size) => set({ fontSize: size }),

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
  markSaved: () => set({ isDirty: false, lastSavedAt: Date.now() }),
}));
