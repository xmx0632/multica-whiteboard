/**
 * 形状中心文字标签单测（ZOO-232 L1，纯函数库 shapeLabel.ts；ZOO-230 L2 增补）：
 * - measureShapeLabel：多行实度量（textElement 同一口径——最长行宽 / 行数 × 1.3 行高）；
 * - labelPatch：首次落笔（初始字号 + 描边色快照）/ 沿用现值 / opts 覆盖 /
 *   空串清除（label: undefined——store 浅合并 + JSON 直通丢弃键）；
 * - initialLabelFontSize：min(|w|,|h|) × 0.3 四舍五入 + 字号边界夹取（负宽高 / 极值）；
 * - labelFirstLineTop 垂直居中：文本块中心 = 形状中心（1 / 2 / 3 行，首行 top
 *   与末行 bottom 关于 cy 对称）；
 * - labelDraftOf（L2）：编辑草稿预填——已有标签沿用 / 无标签初始推导，
 *   与 labelPatch 首次落笔派生同源；
 * - labelOverlayAnchor（L2）：编辑浮层锚点——水平按实测宽居中到形状中心、
 *   垂直按首行 top，随视口 scale / offset 变换，随内容实时重算。
 *
 * 度量器注入假实现（字符数 × 10px）使宽度断言确定；渲染路径回归门 = 全量
 * 存量测试保持绿（无 label 路径零新增 canvas 操作，逐字节等价）。
 */
import { describe, expect, it } from 'vitest';
import { RectangleElement, CircleElement, DiamondElement, ShapeLabel, Viewport, TEXT_MIN_FONT_SIZE, TEXT_MAX_FONT_SIZE } from '../types';
import { TEXT_LINE_HEIGHT, TextWidthMeasurer } from '../textElement';
import {
  initialLabelFontSize,
  labelDraftOf,
  labelFirstLineTop,
  labelLineHeight,
  labelLines,
  labelOverlayAnchor,
  labelPatch,
  measureShapeLabel,
  SHAPE_LABEL_FONT_FAMILY,
} from '../shapeLabel';

// 假度量器：宽度 = 字符数 × 10px（与字号无关，断言可预测）
const measurer: TextWidthMeasurer = (text) => text.length * 10;

const label = (content: string, fontSize = 20, color = '#000000'): ShapeLabel => ({
  content,
  fontSize,
  color,
});

const host = (partial?: Partial<RectangleElement>): RectangleElement => ({
  id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 120,
  strokeColor: '#EF4444', strokeWidth: 2, opacity: 1, fillColor: null,
  ...partial,
});

describe('measureShapeLabel（textElement 同一口径实度量）', () => {
  it('单行：宽 = 行宽，高 = fontSize × 1.3', () => {
    expect(measureShapeLabel(label('hello', 20), measurer))
      .toEqual({ width: 50, height: 26 });
  });

  it('多行：宽取最长行，高按行数累加', () => {
    expect(measureShapeLabel(label('hello\nhi\nhey', 20), measurer))
      .toEqual({ width: 50, height: 78 });
  });

  it('空串：宽 0 高一行（编辑中空草稿无幻影宽度）', () => {
    expect(measureShapeLabel(label('', 20), measurer))
      .toEqual({ width: 0, height: 26 });
  });

  it('labelLines / labelLineHeight：与度量同源（行数 × 行高 = 度量高度）', () => {
    const l = label('a\nbb\nccc', 30);
    expect(labelLines(l)).toEqual(['a', 'bb', 'ccc']);
    expect(labelLineHeight(l)).toBe(30 * TEXT_LINE_HEIGHT);
    const { height } = measureShapeLabel(l, measurer);
    expect(height).toBe(labelLineHeight(l) * labelLines(l).length);
  });
});

describe('labelPatch（内容 / 字号 / 颜色变更补丁）', () => {
  it('首次落笔（el 无 label）：初始字号按外框推导，颜色 = 当时描边色快照', () => {
    const patch = labelPatch(host(), '起点');
    expect(patch).toEqual({
      label: { content: '起点', fontSize: initialLabelFontSize(200, 120), color: '#EF4444' },
    });
  });

  it('非首次：内容更新，字号 / 颜色沿用现值（与描边色完全解耦）', () => {
    const el = host({ label: label('旧', 36, '#3B82F6') });
    const patch = labelPatch({ ...el, strokeColor: '#22C55E' }, '新内容');
    expect(patch).toEqual({ label: { content: '新内容', fontSize: 36, color: '#3B82F6' } });
  });

  it('opts 显式覆盖字号 / 颜色（面板改字号场景）', () => {
    const el = host({ label: label('旧', 36, '#3B82F6') });
    expect(labelPatch(el, '旧', { fontSize: 48, color: '#000000' })).toEqual({
      label: { content: '旧', fontSize: 48, color: '#000000' },
    });
    // 单项覆盖：未覆盖项沿用
    expect(labelPatch(el, '旧', { fontSize: 48 })).toEqual({
      label: { content: '旧', fontSize: 48, color: '#3B82F6' },
    });
  });

  it('content 空串 → { label: undefined }（清除；浅合并 + JSON 直通语义）', () => {
    const el = host({ label: label('将清除', 36, '#3B82F6') });
    const patch = labelPatch(el, '');
    expect(patch).toEqual({ label: undefined });
    // store Object.assign 浅合并后 JSON 序列化丢弃 undefined 键 → 净清除
    const merged = JSON.parse(JSON.stringify(Object.assign({}, el, patch)));
    expect('label' in merged).toBe(false);
    expect(merged).toEqual(host());
  });

  it('三形状宿主均可入参（结构类型，circle / diamond 同构）', () => {
    const circle: CircleElement = {
      id: 'c1', type: 'circle', x: 0, y: 0, width: 100, height: 100,
      strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
    };
    const diamond: DiamondElement = {
      id: 'd1', type: 'diamond', x: 0, y: 0, width: 160, height: 80,
      strokeColor: '#A855F7', strokeWidth: 2, opacity: 1, fillColor: null,
    };
    expect(labelPatch(circle, '圆')).toEqual({
      label: { content: '圆', fontSize: initialLabelFontSize(100, 100), color: '#000000' },
    });
    expect(labelPatch(diamond, '菱')).toEqual({
      label: { content: '菱', fontSize: initialLabelFontSize(160, 80), color: '#A855F7' },
    });
  });
});

describe('initialLabelFontSize（min 边 × 0.3 + 边界夹取）', () => {
  it('常规：min 边主导（200×120 → 36，120×200 → 36）', () => {
    expect(initialLabelFontSize(200, 120)).toBe(36);
    expect(initialLabelFontSize(120, 200)).toBe(36);
  });

  it('四舍五入：min 边 × 0.3 非整（123 → 36.9 → 37）', () => {
    expect(initialLabelFontSize(123, 400)).toBe(37);
  });

  it('min 边夹取下限：过小外框 → TEXT_MIN_FONT_SIZE（10）', () => {
    expect(initialLabelFontSize(10, 500)).toBe(TEXT_MIN_FONT_SIZE);
    expect(initialLabelFontSize(0, 0)).toBe(TEXT_MIN_FONT_SIZE);
  });

  it('min 边夹取上限：巨大外框 → TEXT_MAX_FONT_SIZE（200）', () => {
    expect(initialLabelFontSize(2000, 3000)).toBe(TEXT_MAX_FONT_SIZE);
  });

  it('负宽高：取绝对值后同式（翻转拖拽中间态不变式）', () => {
    expect(initialLabelFontSize(-200, 120)).toBe(36);
    expect(initialLabelFontSize(-200, -120)).toBe(36);
    expect(initialLabelFontSize(200, -120)).toBe(36);
  });
});

describe('labelFirstLineTop（垂直居中：文本块中心 = 形状中心）', () => {
  const cases: [number, number, number][] = [
    [150, 26, 1],   // 单行
    [150, 26, 2],   // 两行
    [150, 26, 3],   // 三行
  ];

  it.each(cases)('cy=150 lineHeight=%i 行数=%i：首行 top 与末行 bottom 关于 cy 对称', (cy, lineHeight, lineCount) => {
    const top = labelFirstLineTop(cy, lineHeight, lineCount);
    const bottom = top + lineHeight * lineCount;
    expect(top + bottom).toBeCloseTo(cy * 2, 10);
    expect((top + bottom) / 2).toBeCloseTo(cy, 10);
  });

  it('三行用例（fontSize=20）：top = cy - 1.5 行高，块中心恰为形状中心', () => {
    const cy = 100;
    const lineHeight = 20 * TEXT_LINE_HEIGHT; // 26
    const top = labelFirstLineTop(cy, lineHeight, 3);
    expect(top).toBeCloseTo(100 - 39, 10); // cy - 26×3/2
    // 各行中心：top + (i + 0.5)×lineHeight；三行中心均值 = cy
    const centers = [0, 1, 2].map((i) => top + (i + 0.5) * lineHeight);
    expect(centers.reduce((a, b) => a + b, 0) / 3).toBeCloseTo(cy, 10);
  });

  it('偶数行（2 行）：行间缝中心 = cy；奇偶行同式无特判', () => {
    const lineHeight = 30;
    const top = labelFirstLineTop(60, lineHeight, 2);
    expect(top).toBe(30);            // 60 - 30
    expect(top + lineHeight).toBe(60); // 末行 top 即 cy
  });
});

describe('SHAPE_LABEL_FONT_FAMILY（度量与渲染共用单一字体源）', () => {
  it('常量兜底 sans-serif（label 不落 fontFamily 字段）', () => {
    expect(SHAPE_LABEL_FONT_FAMILY).toBe('sans-serif');
  });
});

describe('labelDraftOf（L2 编辑草稿预填）', () => {
  it('已有标签：整只沿用（浮层预填 = 现值，编辑不改样式）', () => {
    const existing = label('现有', 36, '#3B82F6');
    expect(labelDraftOf(host({ label: existing }))).toBe(existing);
  });

  it('无标签：空内容 + 初始字号 + 当前描边色起稿', () => {
    expect(labelDraftOf(host())).toEqual({
      content: '',
      fontSize: initialLabelFontSize(200, 120),
      color: '#EF4444',
    });
  });

  it('与 labelPatch 首次落笔派生同源：字号 / 颜色逐字段相等（预览 = 落笔）', () => {
    const draft = labelDraftOf(host());
    const patch = labelPatch(host(), '内容', { fontSize: draft.fontSize, color: draft.color });
    expect(patch.label).toEqual({ content: '内容', fontSize: draft.fontSize, color: draft.color });
  });
});

describe('labelOverlayAnchor（L2 编辑浮层锚点：居中到形状中心）', () => {
  const identity: Viewport = { offsetX: 0, offsetY: 0, scale: 1 };

  it('单行：水平按实测宽居中，垂直 = cy - 半行高（首行 top）', () => {
    // 度量宽 'abcd' = 40；中心 (100, 60)；行高 20×1.3 = 26
    expect(labelOverlayAnchor(label('abcd', 20), { x: 100, y: 60 }, identity, measurer))
      .toEqual({ x: 100 - 20, y: 60 - 13 });
  });

  it('多行：行数 × 行高参与垂直居中，宽取最长行', () => {
    // 'ab\ncdef'：宽 = 40（最长行），2 行 → top = cy - 26
    expect(labelOverlayAnchor(label('ab\ncdef', 20), { x: 0, y: 100 }, identity, measurer))
      .toEqual({ x: -20, y: 100 - 26 });
  });

  it('空内容：宽 0 → 锚点水平即中心（无幻影偏移）', () => {
    expect(labelOverlayAnchor(label('', 20), { x: 50, y: 50 }, identity, measurer))
      .toEqual({ x: 50, y: 50 - 13 });
  });

  it('视口变换：世界中心 → 屏幕坐标，宽度 / 行高同乘 scale', () => {
    const vp: Viewport = { offsetX: 10, offsetY: 20, scale: 2 };
    // 世界中心 (50, 50) → 屏幕 (110, 120)；'abc' 世界宽 30 → 屏幕 60 → x = 110 - 30；
    // 行高 10×1.3×2 = 26 → y = 120 - 13
    expect(labelOverlayAnchor(label('abc', 10), { x: 50, y: 50 }, vp, measurer))
      .toEqual({ x: 110 - 30, y: 120 - 13 });
  });

  it('随内容实时重算（输入即预览）：内容变宽 → 锚点左移保持居中', () => {
    const center = { x: 100, y: 100 };
    const short = labelOverlayAnchor(label('ab', 20), center, identity, measurer);
    const long = labelOverlayAnchor(label('abcdef', 20), center, identity, measurer);
    expect(short.x).toBe(100 - 10);
    expect(long.x).toBe(100 - 30);
    expect(long.y).toBe(short.y); // 行数不变 → 垂直不动
  });

  it('锚点与渲染落位同式：确认后画布标签视觉零跳变（同一垂直居中口径）', () => {
    const cy = 80;
    const l = label('x\ny\nz', 20);
    const anchor = labelOverlayAnchor(l, { x: 0, y: cy }, identity, measurer);
    const lineHeight = labelLineHeight(l);
    expect(anchor.y).toBe(labelFirstLineTop(cy, lineHeight, labelLines(l).length));
  });
});
