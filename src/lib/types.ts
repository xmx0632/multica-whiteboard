export type ToolType = 'select' | 'pen' | 'rectangle' | 'circle' | 'line' | 'arrow' | 'text' | 'eraser';

export interface Point {
  x: number;
  y: number;
}

export interface BaseElement {
  id: string;
  type: string;
  x: number;
  y: number;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
}

export interface PathElement extends BaseElement {
  type: 'path';
  points: Point[];
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  width: number;
  height: number;
  fillColor: string | null;
}

export interface CircleElement extends BaseElement {
  type: 'circle';
  width: number;
  height: number;
  fillColor: string | null;
}

export interface LineElement extends BaseElement {
  type: 'line';
  x2: number;
  y2: number;
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  x2: number;
  y2: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  content: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  width: number;
  height: number;
}

export type WhiteboardElement =
  | PathElement
  | RectangleElement
  | CircleElement
  | LineElement
  | ArrowElement
  | TextElement;

export interface Viewport {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface WhiteboardDocument {
  id: string;
  title: string;
  elements: WhiteboardElement[];
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
}

export interface Operation {
  type: 'create' | 'update' | 'delete';
  elementId: string;
  before?: WhiteboardElement;
  after?: WhiteboardElement;
}

export const COLORS = [
  '#000000', '#FFFFFF', '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#14B8A6', '#3B82F6', '#6366F1', '#A855F7', '#EC4899', '#78716C',
];

export const DEFAULT_STROKE_COLOR = '#000000';
export const DEFAULT_STROKE_WIDTH = 2;
export const DEFAULT_FONT_SIZE = 20;
