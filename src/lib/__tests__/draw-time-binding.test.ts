/**
 * 箭头绘制即吸附单测（ZOO-233）：
 * - bindableCandidatesInViewport 视口候选预筛：视口内 / 边际内保留、超出
 *   BIND_RELEASE_PX 外扩区剔除、非可绑类型不进候选、旋转元素按世界 AABB
 *   （旋出局部外框可达）、scale 换算世界余量；
 * - 绘制手势组合语义（Canvas 创建路径的同构纯函数复现）：落笔贴近轮廓 →
 *   起点吸附 + startBinding；落点空处 → 自由起点；拖动中终点实时捕获 /
 *   解绑（10px 捕获 / 14px 滞回），端点改写经 endpointResizePatch（折线
 *   防漂移同源）；松手 addElement 单条 create 快照——一次 undo 同时撤销
 *   箭头与两端绑定，无中间态；
 * - 画完即绑定验收：A 边缘画到 B 边缘松手，两端绑定就位，移动 B 箭头终点
 *   跟随（updateBindingsAfterMove，复验 ZOO-219 成果）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ArrowElement, CircleElement, DiamondElement, RectangleElement, TextElement, WhiteboardElement, Viewport,
} from '../types';
import {
  BIND_CAPTURE_PX, BIND_RELEASE_PX,
  bindableCandidatesInViewport, resolveEndpointBinding, updateBindingsAfterMove,
} from '../binding';
import { endpointResizePatch } from '../shapeResize';
import { useStore } from '../store';

const VP: Viewport = { offsetX: 0, offsetY: 0, scale: 1 };

const rect = (id: string, x = 100, y = 100, w = 200, h = 100): RectangleElement => ({
  id, type: 'rectangle', x, y, width: w, height: h,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

const circle = (id: string, x = 500, y = 100): CircleElement => ({
  id, type: 'circle', x, y, width: 200, height: 200,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

const diamond = (id: string): DiamondElement => ({
  id, type: 'diamond', x: 100, y: 100, width: 200, height: 200,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

const textEl = (id: string): TextElement => ({
  id, type: 'text', x: 0, y: 0, width: 50, height: 20,
  content: 'x', fontSize: 16, fontFamily: 'sans', color: '#000000',
  strokeColor: '#000000', strokeWidth: 2, opacity: 1,
});

const arrow = (over: Partial<ArrowElement> = {}): ArrowElement => ({
  id: 'a1', type: 'arrow', x: 0, y: 0, x2: 0, y2: 0,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, ...over,
});

const almost = (actual: number, expected: number, eps = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThan(eps);

describe('bindableCandidatesInViewport（视口候选预筛）', () => {
  it('视口内形状进候选；非可绑类型（arrow/text）一律不进', () => {
    const others: WhiteboardElement[] = [arrow({ id: 'ax' }), textEl('t1')];
    const cands = bindableCandidatesInViewport([rect('r1'), circle('c1'), ...others], VP, 800, 600);
    expect(cands.map((e) => e.id)).toEqual(['r1', 'c1']);
  });

  it('形状在视口外但距视口 ≤ 解绑阈值（外扩 margin 内）仍可达——不误筛', () => {
    // 视口 [0,800]，margin = 14：矩形 AABB 右缘 -10 ≥ left(-14) 保留
    expect(bindableCandidatesInViewport([rect('r1', -210, 100)], VP, 800, 600)).toHaveLength(1);
  });

  it('形状 AABB 整体超出外扩区被剔除（轮廓到视口内指针必 > BIND_RELEASE_PX）', () => {
    // AABB 右缘 -40 < left(-14)：距视口 40 世界 px，任何指针都够不到
    expect(bindableCandidatesInViewport([rect('r1', -240, 100)], VP, 800, 600)).toHaveLength(0);
  });

  it('旋转元素按世界 AABB：局部外框在视口外、旋出的角进入视口 → 保留', () => {
    // 横条 [650,950]×[-40,-20] 完全在视口上方（未旋转时剔除）；
    // 绕中心 (800,-30) 旋 45° 后角点旋到 y≈83 进入视口
    const flat = rect('r1', 650, -40, 300, 20);
    expect(bindableCandidatesInViewport([flat], VP, 800, 600)).toHaveLength(0);
    const turned: RectangleElement = { ...flat, rotation: 45 };
    expect(bindableCandidatesInViewport([turned], VP, 800, 600)).toHaveLength(1);
  });

  it('scale 换算：缩小视口下世界余量按 1/scale 放大', () => {
    // scale 0.5：margin = 14/0.5 = 28 世界 px
    const half: Viewport = { offsetX: 0, offsetY: 0, scale: 0.5 };
    expect(bindableCandidatesInViewport([rect('r1', -220, 100)], half, 800, 600)).toHaveLength(1);
    expect(bindableCandidatesInViewport([rect('r1', -240, 100)], half, 800, 600)).toHaveLength(0);
  });
});

/**
 * 绘制手势组合语义：与 Canvas.tsx 创建路径（pointerdown / pointermove /
 * pointerup）完全同构的纯函数复现——resolveEndpointBinding +
 * endpointResizePatch + addElement。
 */
describe('绘制即吸附（创建路径组合语义）', () => {
  const scale = 1;
  let scene: WhiteboardElement[];
  /** Canvas pointerdown 的 arrow 分支同构 */
  const drawStart = (world: { x: number; y: number }): ArrowElement => {
    const el = arrow({ x: world.x, y: world.y, x2: world.x, y2: world.y });
    const res = resolveEndpointBinding({ elements: scene, arrow: el, endpoint: 'start', world, scale });
    if (res.binding) {
      Object.assign(el, endpointResizePatch('p1', el, res.point));
      el.startBinding = res.binding;
    }
    return el;
  };
  /** Canvas pointermove 的 arrow 分支同构（传当前 temp：endBinding 即最近捕获态） */
  const drawMove = (temp: ArrowElement, world: { x: number; y: number }) => {
    const res = resolveEndpointBinding({ elements: scene, arrow: temp, endpoint: 'end', world, scale });
    Object.assign(temp, endpointResizePatch('p2', temp, res.point));
    temp.endBinding = res.binding ?? undefined;
  };

  beforeEach(() => {
    useStore.setState({ elements: [], undoStack: [], redoStack: [] });
    scene = [rect('A'), circle('B'), diamond('D')];
  });

  it('验收主链路：A 边缘落笔 → B 边缘松手，两端绑定就位；移动 B 终点跟随；一次 undo 整体撤销', () => {
    useStore.setState({ elements: [...scene] });
    // 落笔在 A 右缘外 5px（≤ 捕获阈值 10px）
    const temp = drawStart({ x: 305, y: 150 });
    expect(temp.startBinding?.elementId).toBe('A');
    expect(temp.x).toBe(300); // 吸附到右边缘（中心射线与 bbox 边交点）
    expect(temp.y).toBe(150);

    // 拖到 B（中心 (600,200) r=100）圆周外 4px：径向吸附回圆周
    drawMove(temp, { x: 704, y: 200 });
    expect(temp.endBinding?.elementId).toBe('B');
    almost(temp.x2, 700, 1e-9);
    expect(temp.y2).toBe(200);

    // 松手：addElement 单条 create 快照，箭头带两端绑定入档
    useStore.getState().addElement(temp);
    const committed = useStore.getState().elements.find((e) => e.id === temp.id) as ArrowElement;
    expect(committed.startBinding?.elementId).toBe('A');
    expect(committed.endBinding?.elementId).toBe('B');

    // 复验 ZOO-219：B 移动后箭头终点沿新中心→旧端点射线重投影到新圆周
    const movedB = circle('B', 560, 40); // 新中心 (660,140)
    const followed = updateBindingsAfterMove(
      useStore.getState().elements.map((e) => (e.id === 'B' ? movedB : e)),
      new Set(['B']),
    ).find((e) => e.id === temp.id) as ArrowElement;
    expect(followed.endBinding?.elementId).toBe('B');
    const t2 = 1 / Math.sqrt(0.4 ** 2 + 0.6 ** 2); // 方向 (40,60)/r=100 的圆周参数
    almost(followed.x2, 660 + 40 * t2, 1e-9);
    almost(followed.y2, 140 + 60 * t2, 1e-9);
    almost(((followed.x2 - 660) / 100) ** 2 + ((followed.y2 - 140) / 100) ** 2, 1, 1e-9);

    // 一次 undo：箭头连同两端绑定整体消失，三形状原样（无中间态）
    useStore.getState().undo();
    const after = useStore.getState().elements;
    expect(after.find((e) => e.id === temp.id)).toBeUndefined();
    expect(after).toHaveLength(3);
  });

  it('落点 / 松手在空处 → 自由端点，行为与现状一致（不产生绑定字段）', () => {
    const temp = drawStart({ x: 1000, y: 900 });
    expect(temp.startBinding).toBeUndefined();
    expect(temp.x).toBe(1000);
    drawMove(temp, { x: 1200, y: 1000 });
    expect(temp.endBinding).toBeUndefined();
    expect(temp.x2).toBe(1200);
    expect(temp.y2).toBe(1000);
    // 序列化口径：undefined 字段 JSON 化自动剔除，存档不添绑定键
    expect(JSON.parse(JSON.stringify(temp)).endBinding).toBeUndefined();
  });

  it('终点滞回：捕获后 10–14px 过渡带维持绑定，超出 14px 解绑', () => {
    const temp = drawStart({ x: 0, y: 0 });
    // 捕获：A 上缘外 6px
    drawMove(temp, { x: 150, y: 94 });
    expect(temp.endBinding?.elementId).toBe('A');
    expect(temp.y2).toBe(100); // 吸附到上缘
    // 拖离到 12px（> 10 捕获、≤ 14 解绑）：滞回维持
    drawMove(temp, { x: 150, y: 88 });
    expect(temp.endBinding?.elementId).toBe('A');
    // 拖离到 20px（> 14）：解绑成自由端点
    drawMove(temp, { x: 150, y: 80 });
    expect(temp.endBinding).toBeUndefined();
    expect(temp.y2).toBe(80); // 原样跟随指针
  });

  it('菱形对角方向同样捕获（精确轮廓在创建路径可用，非 bbox 悬空）', () => {
    // D 中心 (200,200) 右顶点 (300,200)；沿近水平对角方向轮廓外 5px 落笔
    const temp = drawStart({ x: 305, y: 205 });
    expect(temp.startBinding?.elementId).toBe('D');
    // 中心射线方向 (105,5)：L1 交点 t = 1/(105/100 + 5/100)
    const t = 1 / (105 / 100 + 5 / 100);
    almost(temp.x, 200 + 105 * t, 1e-9);
    almost(temp.y, 200 + 5 * t, 1e-9);
    // bbox 近似会把起点悬空在 x=300 之外——精确轮廓吸附点必在 |x'|/a+|y'|/b=1 上
    almost(Math.abs((temp.x - 200) / 100) + Math.abs((temp.y - 200) / 100), 1, 1e-9);
  });
});

describe('阈值口径（与端点拖拽路径共用同一套常量，无第二套逻辑）', () => {
  it('捕获 / 解绑阈值沿用 ZOO-218 语义', () => {
    expect(BIND_CAPTURE_PX).toBe(10);
    expect(BIND_RELEASE_PX).toBe(14);
  });
});
