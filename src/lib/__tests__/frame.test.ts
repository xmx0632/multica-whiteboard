/**
 * 分页帧单测（ZOO-198）：
 * - 纯函数：页内归属（包围盒中心规则）、帧缩放联动、跳转视口对齐、导出裁剪区；
 * - store：addFrame / duplicateFrame / deleteFrame / moveFrameTo 的页序、置脏与
 *   单快照撤销（undo 精确恢复数组序——页序不翻转）；
 * - 序列化：帧 + 页序 JSON 往返（刷新后不丢）、schemaVersion 新旧文档读写；
 * - 裁剪导出：exportFrameToSvg 的 viewBox = 帧边界 + 标题条、页外元素不入图、
 *   页名随页导出、clipPath 边界。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { FrameElement, WhiteboardElement, WhiteboardDocument, CURRENT_SCHEMA_VERSION } from '../types';
import {
  framesOf, elementInFrame, frameContents, nextFrameRect, frameFocusViewport,
  scaleFrameContents, frameExportRegion, FRAME_TITLE_HEIGHT,
} from '../frame';
import { hitTest } from '../renderer';
import { exportFrameToSvg, exportToSvg } from '../export';

const frame = (id: string, name: string, x = 0, y = 0, w = 400, h = 300): FrameElement => ({
  id, type: 'frame', x, y, width: w, height: h, name,
  strokeColor: '#94a3b8', strokeWidth: 2, opacity: 1,
});

const rect = (id: string, x: number, y: number): WhiteboardElement => ({
  id, type: 'rectangle', x, y, width: 100, height: 60,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

const textEl = (id: string, x: number, y: number): WhiteboardElement => ({
  id, type: 'text', x, y, content: 'hi', fontSize: 20,
  fontFamily: 'sans-serif', color: '#000000', strokeColor: '#000000',
  strokeWidth: 1, opacity: 1, width: 24, height: 26,
});

const pageIds = () => framesOf(useStore.getState().elements).map((f) => f.id);
const allIds = () => useStore.getState().elements.map((e) => e.id);

beforeEach(() => {
  useStore.setState({
    elements: [],
    selectedId: null,
    activeFrameId: null,
    undoStack: [],
    redoStack: [],
    isDirty: false,
    viewport: { offsetX: 0, offsetY: 0, scale: 1 },
  });
});

// ========== 纯函数 ==========

describe('页内归属（包围盒中心规则）', () => {
  const f = frame('f', '第 1 页');

  it('中心在帧内 → 属于该页（含右/下边界）；中心在外 → 不属于', () => {
    expect(elementInFrame(rect('a', 10, 10), f)).toBe(true);   // 中心 (60,40)
    expect(elementInFrame(rect('b', 350, 240), f)).toBe(true); // 中心恰在右下边界 (400,270)
    expect(elementInFrame(rect('c', 351, 240), f)).toBe(false); // 中心 (401,270) 出界
    expect(elementInFrame(rect('d', -200, 0), f)).toBe(false); // 大半在帧外、中心在外
  });

  it('中心在内即属该页（元素可跨出帧边界）；帧永不属于另一帧', () => {
    expect(elementInFrame(rect('e', 330, 0), f)).toBe(true); // 中心 (380,30) 在内，右半越界
    expect(elementInFrame(frame('f2', '第 2 页', 50, 50), f)).toBe(false);
  });

  it('frameContents 取帧内内容、排除帧与页外元素', () => {
    const els = [f, rect('in', 10, 10), rect('out', 1000, 1000), frame('f2', '第 2 页', 50, 50)];
    expect(frameContents(els, f).map((e) => e.id)).toEqual(['in']);
  });
});

describe('nextFrameRect 新页落位', () => {
  it('无帧 → 视口中心', () => {
    const r = nextFrameRect([], { offsetX: 0, offsetY: 0, scale: 1 }, { width: 1200, height: 800 });
    expect(r).toEqual({ x: 120, y: 80, width: 960, height: 640 }); // (600-480, 400-320)
  });

  it('有帧 → 最右帧右侧 + 间隙，纵坐标对齐', () => {
    const r = nextFrameRect(
      [frame('f1', '一', 0, 40, 400, 300), frame('f2', '二', 1000, 0, 400, 300)],
      { offsetX: 0, offsetY: 0, scale: 1 },
    );
    expect(r.x).toBe(1000 + 400 + 80);
    expect(r.y).toBe(0);
  });
});

describe('frameFocusViewport 跳转对齐', () => {
  it('整帧带边距完整可见且居中（宽裕时不放大过 1）', () => {
    const vp = frameFocusViewport(frame('f', '一', 0, 0, 400, 300), 1200, 800);
    // 帧中心 (200,150) 落在视口中心 (600,400)
    expect(vp.scale).toBe(1);
    expect(0 * vp.scale + vp.offsetX).toBe(400);
    expect(0 * vp.scale + vp.offsetY).toBe(250);
  });

  it('大帧缩小到可见；小帧不超过 maxScale', () => {
    const big = frameFocusViewport(frame('f', '一', 0, 0, 4000, 3000), 1200, 800);
    expect(big.scale).toBeLessThan(1);
    expect(4000 * big.scale).toBeLessThanOrEqual(1200 - 144 + 1e-9);
    const tiny = frameFocusViewport(frame('f', '一', 0, 0, 50, 50), 1200, 800);
    expect(tiny.scale).toBe(1); // maxScale 兜底，不无限放大
  });
});

describe('scaleFrameContents 帧缩放联动', () => {
  const before = frame('f', '一', 0, 0, 400, 300);

  it('等比放大：位置与外框尺寸同步翻倍', () => {
    const after = { ...before, width: 800, height: 600 };
    const [out] = scaleFrameContents(before, after, [rect('r', 50, 40)]);
    expect(out).toMatchObject({ x: 100, y: 80, width: 200, height: 120 });
  });

  it('path 点集 / line 端点 / text 字号跟随（text 按纵横均值并夹边界）', () => {
    const els: WhiteboardElement[] = [
      { id: 'p', type: 'path', x: 100, y: 90, points: [{ x: 100, y: 90 }, { x: 300, y: 210 }], strokeColor: '#000', strokeWidth: 2, opacity: 1 },
      { id: 'l', type: 'line', x: 10, y: 20, x2: 390, y2: 280, strokeColor: '#000', strokeWidth: 2, opacity: 1 },
      textEl('t', 20, 20),
    ];
    const after = { ...before, x: 400, y: 300, width: 800, height: 600 }; // 平移 + 2 倍
    const out = scaleFrameContents(before, after, els);
    const p = out[0] as typeof els[0] & { points: { x: number; y: number }[] };
    expect(p.points).toEqual([{ x: 600, y: 480 }, { x: 1000, y: 720 }]);
    const l = out[1] as { x: number; y: number; x2: number; y2: number };
    // 平移 + 2 倍（锚定新帧原点 (400,300)）：x' = 400 + v·2, y' = 300 + v·2
    expect(l).toMatchObject({ x: 420, y: 340, x2: 1180, y2: 860 });
    const tx = out[2] as { fontSize: number };
    expect(tx.fontSize).toBe(40); // 20 × (2+2)/2
  });

  it('入参不可变：原元素对象不被改动', () => {
    const el = rect('r', 50, 40);
    scaleFrameContents(before, { ...before, width: 800, height: 600 }, [el]);
    expect(el).toMatchObject({ x: 50, y: 40, width: 100, height: 60 });
  });
});

describe('frameExportRegion 导出裁剪区', () => {
  it('帧矩形向上扩标题条', () => {
    expect(frameExportRegion(frame('f', '一', 10, 20, 400, 300))).toEqual({
      x: 10, y: 20 - FRAME_TITLE_HEIGHT, width: 400, height: 300 + FRAME_TITLE_HEIGHT,
    });
  });
});

// ========== store 页操作 ==========

describe('addFrame 新增页', () => {
  it('落元素、置脏、置当前页；undo 移除', () => {
    const id = useStore.getState().addFrame('第 1 页', { width: 1200, height: 800 });
    const st = useStore.getState();
    expect(framesOf(st.elements)).toHaveLength(1);
    expect(st.isDirty).toBe(true);
    expect(st.activeFrameId).toBe(id);
    expect(st.undoStack).toHaveLength(1);

    st.undo();
    expect(useStore.getState().elements).toHaveLength(0);
  });

  it('两次新增页序 = 添加序，第二页落在第一页右侧', () => {
    useStore.getState().addFrame('第 1 页', { width: 1200, height: 800 });
    useStore.getState().addFrame('第 2 页');
    const pages = framesOf(useStore.getState().elements);
    expect(pages.map((f) => f.name)).toEqual(['第 1 页', '第 2 页']);
    expect(pages[1].x).toBeGreaterThan(pages[0].x + pages[0].width - 1);
  });
});

describe('moveFrameTo 页序重排', () => {
  const setup = () => {
    // 数组交织帧与内容：f1, r, f2, f3（r 的层级位置重排后必须不动）
    useStore.setState({
      elements: [frame('f1', '一'), rect('r', 10, 10), frame('f2', '二', 1000, 0), frame('f3', '三', 2000, 0)],
      isDirty: false, undoStack: [], redoStack: [],
    });
  };

  it('帧槽位重排、内容元素位置不动、单快照可撤销/重做', () => {
    setup();
    useStore.getState().moveFrameTo(0, 2);
    expect(pageIds()).toEqual(['f2', 'f3', 'f1']);
    expect(allIds()).toEqual(['f2', 'r', 'f3', 'f1']); // r 仍在第 2 位
    expect(useStore.getState().isDirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(allIds()).toEqual(['f1', 'r', 'f2', 'f3']); // 数组序精确回退
    useStore.getState().redo();
    expect(pageIds()).toEqual(['f2', 'f3', 'f1']);
  });

  it('同位 / 越界空转：不置脏、不压栈', () => {
    setup();
    useStore.getState().moveFrameTo(1, 1);
    useStore.getState().moveFrameTo(-1, 0);
    useStore.getState().moveFrameTo(0, 99);
    expect(useStore.getState().isDirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

describe('duplicateFrame 复制页', () => {
  it('帧 + 页内内容换新 id 落源帧右侧，页外内容不复制；单 undo 全移除', () => {
    useStore.setState({
      elements: [frame('f1', '第 1 页'), rect('in', 10, 10), rect('out', 1000, 1000)],
    });
    useStore.getState().duplicateFrame('f1', '第 1 页（副本）');

    const st = useStore.getState();
    const pages = framesOf(st.elements);
    expect(pages.map((f) => f.name)).toEqual(['第 1 页', '第 1 页（副本）']);
    expect(pages[1].x).toBe(pages[0].x + pages[0].width + 80);
    // in 复制（新 id，随帧位移到新帧内）、out 不复制
    const ids = st.elements.map((e) => e.id);
    expect(ids).toContain('out');
    expect(ids.filter((i) => i === 'in')).toHaveLength(1);
    const rects = st.elements.filter((e) => e.type === 'rectangle');
    expect(rects).toHaveLength(3); // in + out + 副本
    const copy = rects.find((r) => r.id !== 'in' && r.id !== 'out')!;
    expect(copy.x).toBe(10 + 480); // 内容随帧位移（源帧宽 400 + 间隙 80）
    expect(frameContents(st.elements, pages[1]).map((e) => e.id)).toEqual([copy.id]);
    expect(st.undoStack).toHaveLength(1);

    st.undo();
    expect(allIds().sort()).toEqual(['f1', 'in', 'out']);
  });
});

describe('deleteFrame 删除页', () => {
  it('帧 + 页内内容一并删除，页外保留；undo 精确恢复数组序（页序不翻转）', () => {
    useStore.setState({
      elements: [frame('f1', '一'), rect('in', 10, 10), rect('out', 1000, 1000), frame('f2', '二', 1000, 0)],
      activeFrameId: 'f1',
    });
    useStore.getState().deleteFrame('f1');

    const st = useStore.getState();
    expect(allIds()).toEqual(['out', 'f2']);
    expect(st.activeFrameId).toBe('f2'); // 活动页落到邻页

    st.undo();
    expect(allIds()).toEqual(['f1', 'in', 'out', 'f2']); // 页序与层级精确回退
  });
});

describe('renameFrame 页重命名', () => {
  it('空名忽略不压栈；有效名单条快照可撤销', () => {
    useStore.setState({ elements: [frame('f1', '第 1 页')] });
    useStore.getState().renameFrame('f1', '   ');
    expect(useStore.getState().undoStack).toHaveLength(0);

    useStore.getState().renameFrame('f1', '第 1 页 · 二次函数导入');
    expect(framesOf(useStore.getState().elements)[0].name).toBe('第 1 页 · 二次函数导入');
    useStore.getState().undo();
    expect(framesOf(useStore.getState().elements)[0].name).toBe('第 1 页');
  });
});

// ========== 序列化与 schemaVersion ==========

describe('帧序列化与 schemaVersion（持久化兼容）', () => {
  it('newDocument 写当前版本；旧文档（无 schemaVersion / 无帧）读作 v1', () => {
    useStore.getState().newDocument('x');
    expect(useStore.getState().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    const legacy: WhiteboardDocument = {
      id: 'legacy', title: '旧板', elements: [rect('r', 0, 0)],
      viewport: { offsetX: 0, offsetY: 0, scale: 1 },
      createdAt: 1, updatedAt: 2, // 无 schemaVersion 字段
    };
    useStore.getState().loadDocument(legacy);
    expect(useStore.getState().schemaVersion).toBe(1);
  });

  it('旧文档打开 / 编辑 / 撤销零回归（无帧路径行为不变）', () => {
    const legacy: WhiteboardDocument = {
      id: 'legacy', title: '旧板', elements: [rect('r', 0, 0)],
      viewport: { offsetX: 0, offsetY: 0, scale: 1 },
      createdAt: 1, updatedAt: 2,
    };
    useStore.getState().loadDocument(legacy);
    useStore.getState().updateElement('r', { x: 100 });
    expect(useStore.getState().elements[0]).toMatchObject({ x: 100 });
    useStore.getState().undo();
    expect(useStore.getState().elements[0]).toMatchObject({ x: 0 });
    expect(framesOf(useStore.getState().elements)).toHaveLength(0);
  });

  it('帧与页序 JSON 往返不丢（刷新等价）', () => {
    const doc: WhiteboardDocument = {
      id: 'd', title: '板书',
      elements: [frame('f2', '二', 1000, 0), rect('r', 1010, 10), frame('f1', '一'), frame('f3', '三', 2000, 0)],
      viewport: { offsetX: 0, offsetY: 0, scale: 1 },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: 1, updatedAt: 2,
    };
    const restored = JSON.parse(JSON.stringify(doc)) as WhiteboardDocument;
    expect(framesOf(restored.elements).map((f) => f.id)).toEqual(['f2', 'f1', 'f3']); // 页序保持

    useStore.getState().loadDocument(restored);
    expect(pageIds()).toEqual(['f2', 'f1', 'f3']); // 载入后页序不变
  });
});

// ========== 裁剪导出边界 ==========

describe('exportFrameToSvg 按帧边界裁剪', () => {
  const f = frame('f1', '第 1 页 · 二次函数', 0, 0, 400, 300);

  it('viewBox = 帧边界 + 标题条（padding 缺省 0）', () => {
    const svg = exportFrameToSvg(f, [f, rect('in', 50, 50)]);
    expect(svg).toContain(`viewBox="0 ${-FRAME_TITLE_HEIGHT} 400 ${300 + FRAME_TITLE_HEIGHT}"`);
    expect(svg).toContain(`width="400" height="${300 + FRAME_TITLE_HEIGHT}"`);
  });

  it('只含帧内元素与帧标题，无帧外内容；内容 clip 到帧矩形', () => {
    const svg = exportFrameToSvg(f, [f, rect('in', 50, 50), rect('out', 1000, 1000), textEl('t', 60, 60)]);
    expect(svg).toContain('<rect x="50" y="50"');       // 帧内 rect 入图
    expect(svg).toContain('x="60"');                    // 帧内 text 入图
    expect(svg).not.toContain('x="1000"');              // 帧外 rect 不入图
    expect(svg).toContain('第 1 页 · 二次函数');         // 帧标题随页导出
    expect(svg).toContain('<clipPath id="frame-clip-f1"><rect x="0" y="0" width="400" height="300"');
    expect(svg).toContain('clip-path="url(#frame-clip-f1)"');
  });

  it('padding 透传可加白边', () => {
    const svg = exportFrameToSvg(f, [f], undefined, { padding: 10 });
    expect(svg).toContain(`viewBox="-10 ${-FRAME_TITLE_HEIGHT - 10} 420 ${300 + FRAME_TITLE_HEIGHT + 20}"`);
  });
});

describe('exportToSvg 帧分层（全板导出）', () => {
  it('帧作底图先画，内容后画——与数组序无关', () => {
    const svg = exportToSvg([rect('r', 10, 10), frame('f', '一')]); // 内容在数组前
    const framePos = svg.indexOf('fill="#ffffff" stroke="#cbd5e1"');
    const contentPos = svg.indexOf('<rect x="10" y="10"');
    expect(framePos).toBeGreaterThanOrEqual(0);
    expect(contentPos).toBeGreaterThan(framePos);
  });
});

// ========== 帧命中 ==========

describe('hitTest 帧（边框带 + 标题条）', () => {
  const f = frame('f', '第 1 页', 0, 0, 400, 300);
  const vp = { offsetX: 0, offsetY: 0, scale: 1 };

  it('帧内部空白不命中（不挡内容）；边框带与标题条命中', () => {
    expect(hitTest(f, { x: 200, y: 150 }, vp)).toBe(false); // 内部
    expect(hitTest(f, { x: 2, y: 150 }, vp)).toBe(true);    // 左边框带
    expect(hitTest(f, { x: 200, y: 299 }, vp)).toBe(true);  // 下边框带
    expect(hitTest(f, { x: 5, y: -10 }, vp)).toBe(true);    // 上缘标题条
  });
});
