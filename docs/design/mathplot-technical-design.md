# 技术方案：MathPlot 数学方程输入与自动出图

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0（评审稿） |
| 关联 | Epic ZOO-128 · PRD ZOO-129 v1.0（已验收）· 交互原型 ZOO-130 v1.0（已验收）· 本 issue ZOO-131 |
| 输入基线 | PRD 拍板决策（OQ-1 元素即图形/创建即出图、OQ-2 局部坐标系）+ 原型 `interaction-spec.md` 交互基线 |
| 代码基线 | `main` @ `36a528b`（Next.js 16.2.6 / React 19.2.4 / TS 5 / Tailwind v4 / Zustand 5.0.13） |
| 下游 | ZOO-133 输入组件 / ZOO-134 解析 / ZOO-135 渲染出图 / ZOO-136 元素集成 / ZOO-137 测试 |

---

## 1. 现状架构盘点（方案依据的关键事实）

对 `main` 分支逐文件核对的结论，方案全部建立在这些事实上：

**渲染管线（`src/lib/renderer.ts`，298 行）**
- Canvas 2D 即时模式：`Canvas.tsx` 的 `render()` 每次状态变化全量重绘（网格 → 全部元素 → 选中框，`src/components/Canvas.tsx:26`）。
- 视口变换统一为 `world×scale+offset`，在各 `drawXxx` 内部逐点应用；无脏矩形、无分层画布。
- `renderElement` switch 分发（`src/lib/renderer.ts:183`）；`getElementBounds` 每类型返回世界坐标 bbox；`hitTest` 基于 bbox + margin（`renderer.ts:264`）。
- `renderSelection` 只画 **4 个角控点**（`renderer.ts:221`），且 `Canvas.tsx` 中**没有任何控点拖拽缩放的实现**（只有整体移动拖拽，`Canvas.tsx:164`）——见 §11 偏差 D-1。
- `exportToImage` 复用 `renderElement` 以 `{offsetX:-ox, offsetY:-oy, scale:1}` 视口离屏绘制（`src/lib/export.ts:139`）——**新增元素类型自动获得位图导出能力**。

**状态与历史（`src/lib/store.ts`，259 行）**
- Zustand 单 store；`elements: WhiteboardElement[]` + `selectedId` + `activeTool` + `viewport`。
- 撤销重做为**快照式** `Operation {create|update|delete, before, after}`（`src/lib/types.ts:83`），栈深 100；`addElement/updateElement/deleteElement` 自动入栈。
- 移动拖拽的既有模式：mousemove 期间用 `useStore.setState` 直改（不进历史），mouseup 时 `pushOperations` 提交**一条** update（`Canvas.tsx:164-229`）。属性面板调参将复用此模式（§4 D5）。

**持久化 / 导出 / 缩略图**
- `persistence.ts`：整文档 `JSON.stringify` 直通 localStorage 与 `/api/whiteboards`（无 schema 校验、无版本字段）——**新增元素类型零改动即兼容**。
- `export.ts`：SVG 导出为逐类型手写字符串拼接（`elementToSvg`），需新增 case；PNG/JPG 走 `renderElement` 复用。
- `thumbnail?` 字段只在 `types.ts:80` 声明，**全仓库无任何生成逻辑**——"缩略图兼容"实际为零工作量。

**组件与死代码**
- `src/app/page.tsx:3-7` 只 import `@/components/*`；`src/app/` 下 Canvas/LeftToolbar/PropertyPanel/TopMenuBar/HistoryPanel 五个组件与 `src/components/` 同名文件 **逐字节相同**（diff 验证 0 差异），确认死代码（§9）。
- `LeftToolbar.tsx` tools 数组 + `useShortcuts.ts` toolMap 是工具扩展点；shortcut 处理器在焦点位于 INPUT/TEXTAREA 时跳过（`useShortcuts.ts:12`），方程编辑器输入天然不受快捷键干扰。

**其他**
- 仓库 `AGENTS.md` 警告 Next.js 16 与训练数据可能不一致，开发前须读 `node_modules/next/dist/docs/`。本方案全部改动为 `'use client'` 组件与纯库，不触路由/服务端约定，风险已收敛（§12 R6）。
- 仓库目前**无测试框架**（package.json 无 test script）——ZOO-134 PR 引入 vitest（§10）。

---

## 2. 总体架构

### 2.1 模块划分

```
src/lib/math/                    ← 新增纯函数层（ZOO-134 / ZOO-135）
  normalize.ts     Unicode/语法归一化（π→pi、²→^2、√→sqrt …）
  parse.ts         归一化 → 分类(y=f(x)|circle|ellipse|error) → mathjs compile
  sample.ts        采样 + 断笔 → 局部坐标折线段（纯数据，不碰 Canvas）
  templates.ts     13 个方程模板 + 符号按钮插入文本
  label.ts         方程文本 → Unicode 美化标签（画布 fillText 用）
  cache.ts         编译缓存 + Path2D 缓存（WeakMap，运行时态，不序列化）

src/lib/types.ts                 ← MathPlotElement 进联合类型（ZOO-136）
src/lib/renderer.ts              ← case 'mathPlot' + bounds/hitTest（ZOO-135）
src/lib/export.ts                ← elementToSvg 增 case（ZOO-136）
src/lib/store.ts                 ← 方程默认态 + 静默更新/提交（ZOO-136）
src/components/math/
  EquationEditor.tsx             ← 方程编辑面板（ZOO-133）
  MathPlotParams.tsx             ← 选中态参数面板（ZOO-133/136）
  MiniPreview.tsx                ← 240×96 实时预览，复用 sample+渲染（ZOO-133）
```

层次原则：**`src/lib/math/*` 是无 React、无 DOM 依赖的纯函数**（`cache.ts` 除外，仅依赖 Path2D），可独立单测；UI 组件只消费其结果。

### 2.2 数据流

**创建（按 F → 输入 → 回车）**

```
EquationEditor 输入 ──每键──▶ parse(normalize(input))
                                ├─ 成功 → ✓ 徽标 + MiniPreview 重采样重绘
                                └─ 失败 → ⚠ 原因（不产生元素）
回车确认 ──▶ addElement(MathPlotElement{equation, 解析结果或 error 态})
              + setSelected(新元素) + setTool('select')   // 原型决策 1
              Canvas render() → drawMathPlot：cache 查 Path2D（miss 则采样构建）→ stroke
```

**调参（选中 → 属性面板）**

```
滑杆拖动 onChange ──▶ updateElementTransient(id, updates)   // 直改 + isDirty，不进历史
onPointerUp      ──▶ pushOperations([update before/after])  // 一条快照，可整体撤销
颜色/开关/数字输入  ──▶ updateElement(id, updates)           // 离散操作，单条入栈
```

**每帧渲染（平移/缩放）**

```
viewport 变化 → render() 全量重绘 → drawMathPlot:
  signature(el) 命中 WeakMap 缓存 → 直接 ctx.stroke(cachedPath2D)   // 无重采样、无重求值
```

平移缩放**不触发**任何求值/采样——这是 60fps 约束的架构保证（§6.4）。

---

## 3. 关键技术决策总览

| # | 决策点 | 结论 | 否决项 |
|---|---|---|---|
| D1 | 输入编辑器 | **自研受控文本框 + 符号按钮 + 模板**，预览用 Mini canvas | MathLive、KaTeX |
| D2 | 方程解析 | **mathjs（number 构建）parse→compile→evaluate({x})**，禁 eval | 自研递归下降、eval/Function |
| D3 | 渲染路径 | **自绘 Canvas（renderer.ts case 'mathPlot'）+ Path2D 缓存** | function-plot、mafs |
| D4 | 数据模型 | `MathPlotElement` 增量进联合类型，运行时态全走旁路缓存 | 独立元素子系统 / 双 store |
| D5 | 调参历史 | 复用快照 Operation + "静默直改 + 提交一条" 模式 | 新增 Operation 类型（PM 约束禁止） |
| D6 | 死代码 | `src/app/` 5 个重复组件整体删除，独立 chore PR 先行 | 保留共存 |

---

## 4. 决策详解

### D1 输入编辑器：自研受控文本框（ADR）

**对比**

| 候选 | 交互形态 | 与原型一致性 | 依赖成本 | 离线/体积 | 结论 |
|---|---|---|---|---|---|
| **自研受控文本框** | 纯文本输入 + 实时校验 + Mini 预览 + 模板/符号按钮 | **1:1**（原型即此形态） | 0 新依赖 | ✅ | **MVP 采用** |
| MathLive | WYSIWYG 公式区（LaTeX 语义树，分数上下标导航） | 改变已验证交互（输入即进入结构化编辑） | ~数百 KB + web component 样式定制 | ✅ 但重 | P2 升级项 |
| KaTeX | 仅渲染器，非编辑器 | 需另配输入框 | ~78KB gzip + 字体 | ✅ | MVP 不引入 |

**决定性理由**：① PM 已拍板"交互模型不再开放讨论"，原型（文本框 + 校验 + 预览 + 13 模板 + 符号按钮）是已验收基线，自研文本框与之零偏差；② MathLive 产出 LaTeX，而解析层是 mathjs 语法，需自建 LaTeX→mathjs 转换层——为一个被否决的交互形态引入转换风险，不值；③ 用户键入的即解析的（`2sin(2x+π/3)` 原文进 mathjs），**输入与求值同构**，校验/错误定位/重绘链路最短。

**预览实现**：MiniPreview 是 240×96 的小 canvas，直接调用 `sample()` + 与主画布同一套折线绘制函数。比 KaTeX 排版更优——**预览即真实渲染结果**（WYSIWYG），且零依赖。KaTeX/MathLive 留作 P2（若教学反馈需要"所见即所得公式排版"输入）。

### D2 解析器：mathjs（ADR）

- 选型：**mathjs `number` 构建**（number-only，无 BigNumber/Complex/Unit 开销）；若 bundle 仍超预算（§6.5 预算门），退到 `create()` + `xxxDependencies` 按需子集（官方 custom bundling 机制）。
- 求值模式：`parse(expr)` → AST → `.compile()` → `code.evaluate({ x })`，**scope 只含 x**。不使用 `math.evaluate(string)`。
- 安全论证（对应 PRD §8 禁 eval 硬约束）：AST compile 是结构化求值，非字符串注入路径；scope 受限使表达式无法访问全局对象；mathjs 历史上的原型污染 CVE 均针对 `evaluate` 宽松用法，本模式 + 固定版本 + 注入用例回归测试（`x);require('fs')`、`__proto__` 等，parse 阶段即语法失败）构成防线。CI 加 `npm audit` 门禁。
- **为什么不用原型内置的递归下降解析器**：原型 23 组用例只覆盖 MVP 语法演示；生产需要任意嵌套表达式、优先级、一元负号、常量折叠等完备性，mathjs 是久经测试的成熟实现，且 PRD/PM 均已建议 mathjs。原型的**分类规则与错误文案**（§7.2）平移复用。
- 圆/椭圆（P1）不走通用隐式求解，AST 模式匹配两个标准形（§7.3）。

### D3 渲染路径：自绘 Canvas（ADR）

- **function-plot / mafs 均为 SVG/DOM 管线**，与现有 Canvas 管线（`renderer.ts` + `exportToImage` 复用 + 选中框叠加）双轨并行，导出/缩略图/拾取都要做两遍，且 SVG 嵌入 canvas 需离屏栅格化——缩放模糊、性能反退。**否决**。
- 原型的 SVG 思路在 Canvas 下的等价实现：原型"采样点数组 → SVG `<path>`"；我们"采样点数组 → `Path2D` → `ctx.stroke`"。**采样逻辑与渲染目标解耦**（`sample.ts` 产纯数据），同一份数据既供主画布也供 MiniPreview，这正是等价策略的核心。
- 关键架构差异（也是性能优势）：function-plot 每帧按视口重采样；MathPlot **元素自带局部坐标系，采样发生在元素局部空间，与视口无关**——参数不变则折线永不重算，平移缩放只是对缓存的 Path2D 做仿射变换后的 stroke。

### D4 数据模型：增量进联合类型（见 §5）

### D5 调参与历史：复用快照 + 静默/提交两段式

PM 约束"无需新增历史类型"。方案：store 增一个**不入栈的** `updateElementTransient(id, updates)`（直改 elements + `isDirty:true`，供滑杆拖动实时预览），提交时用现有 `pushOperations` 压一条 update 快照。与 Canvas.tsx 移动拖拽的既有模式完全同构，历史语义与其他元素一致（一次拖动 = 一次撤销）。

### D6 死代码清理（见 §9）

---

## 5. MathPlotElement 数据模型

### 5.1 类型定义（`src/lib/types.ts` 新增）

```ts
export interface MathPlotElement extends BaseElement {
  type: 'mathPlot';
  width: number;                      // 元素外框（世界 px），语义同 rectangle
  height: number;

  // —— 方程 ——
  equation: string;                   // 用户原文，如 "y=2sin(2x+π/3)"、"(x-1)²+(y-2)²=9"
  kind: 'explicit' | 'circle' | 'ellipse' | 'error';   // 解析分类（P1 起 circle/ellipse 有值）
  error?: string | null;              // kind==='error' 时的用户可读原因

  // —— 数学视窗（局部坐标系定义，数学单位）——
  xAxis: { min: number; max: number };    // 显式函数定义域=绘制域，默认 {-10,10}
  yAxis: { min: number; max: number };    // equalRatio 时由宽高推导，否则可独立调整
  equalRatio: boolean;                    // x/y 单位等比；circle/ellipse 强制 true
  origin: { x: number; y: number };       // 原点在数学视窗中的位置，默认 (0,0)

  // —— 绘制参数 ——
  sampleCount: 160 | 320 | 640;           // 采样档位（硬上限 2000，见 §6.4）
  showAxis: boolean;                      // 轴+刻度
  showGrid: boolean;                      // 轻网格
  showLabel: boolean;                     // 左下角方程标签 chip
  // strokeColor / strokeWidth / opacity 继承 BaseElement，色板复用 COLORS
}
```

`WhiteboardElement` 联合类型加入 `MathPlotElement`。

**不序列化的运行时态**（放 `src/lib/math/cache.ts` 的 WeakMap，键为元素对象引用）：编译后的求值函数、采样折线、Path2D、渲染签名。理由：① 撤销重做的快照对比保持纯数据，序列化体积不膨胀（20 个元素 × 640 点若进 JSON ≈ 每元素 +20KB，不可接受）；② JSON 恢复后按 `signature` 重建，天然幂等。

### 5.2 坐标映射（三层）

```
数学坐标 (mx,my)  ──unitPx──▶  元素局部px (lx,ly)  ──el.x/y + viewport──▶  屏幕px (sx,sy)

unitPxX = width  / (xAxis.max - xAxis.min)
unitPxY = height / (yAxis.max - yAxis.min)      // equalRatio 时 unitPxY ≡ unitPxX

lx = (mx - xAxis.min) * unitPxX
ly = height - (my - yAxis.min) * unitPxY        // 数学 y 向上，canvas y 向下
sx = (el.x + lx) * viewport.scale + viewport.offsetX   // 与 drawRectangle 同构
```

**缩放语义（重要）**：拖角控点改 `width/height` → `unitPx` 变 → 数学视窗 `xAxis/yAxis` **不变**。即"缩放元素 = 改变单位像素密度，数学内容不变"（圆仍是正圆，`equalRatio` 下角拖拽锁定 `height = width × (yUnits/xUnits)` 保持单位密度相等）。这与"图形作为元素整体缩放"的白板心智一致，也使缩放永远不触发重采样（仅重建变换，Path2D 世界坐标缓存甚至可直接复用——见 §6.3 失效条件）。

### 5.3 兼容性核对表

| 系统 | 兼容方式 | 改动量 |
|---|---|---|
| 联合类型 | 增量成员，现有 6 类型零触碰 | types.ts +1 接口 |
| 撤销重做 | 快照 Operation 天然支持（before/after 全量元素对象） | 0（D5 模式复用） |
| persistence | JSON 直通；`error/kind` 等纯数据字段随序列化 | 0 |
| 前向兼容（旧版开新文档） | `renderElement` switch 无匹配即不绘制、`getElementBounds` default 返回 null、`hitTest` false——现有 default 分支已是"静默忽略未知类型"语义，PR5 补测试固化该行为 | +测试 |
| 旧文档进新版 | 无 mathPlot 元素，零影响；建议 PR2 顺手给 `WhiteboardDocument` 加可选 `schemaVersion?: number`（当前不写值，仅占位，为未来迁移预留） | +1 可选字段 |
| export PNG/JPG | `exportToImage` 复用 `renderElement`，自动获得 | 0 |
| export SVG | `elementToSvg` 增 case：轴/网格/曲线 → `<path>`+`<line>`，标签 → `<text>` | +1 case |
| 缩略图 | 现状根本未生成，无兼容面 | 0 |

---

## 6. 渲染管线设计

### 6.1 绘制层次（`drawMathPlot`，自底向上）

1. **半透明白底**：`rgba(255,255,255,0.88)` 圆角矩形（原型决策 3），在点阵背景上保证可读。
2. **轻网格**：整数刻度细线 `#e5e7eb`（`showGrid`），随视窗缩放隐藏亚像素网格（线距 < 8px 时降频/隐藏）。
3. **坐标轴 + 刻度**：过 `origin` 的十字轴 `#9ca3af`，整数刻度 + 数字标签（`showAxis`）；刻度数字用 `label.ts` 的 Unicode 美化（π 的倍数显示 `2π` 等，原型行为）。
4. **曲线**：采样折线 `strokeColor/strokeWidth`（同现有体系，`lineWidth = strokeWidth * scale`）。
5. **方程标签 chip**：左下角，`label.ts` 产出美化文本（`x²`、`π`、`√`）后 `fillText`，带浅底色块。

错误态（`kind==='error'`）：红色虚线占位框 + ⚠ 原因 + 原方程 + "点击重新编辑"提示；点击元素（hitTest 命中 + dblclick 或单击选中后面板引导）回编辑器，修正后**原位替换**（update 同一元素，原型行为，天然可撤销）。

### 6.2 采样与断笔（`sample.ts`）

```
输入: fn(x), xAxis 定义域, sampleCount, yAxis 视窗
for i in 0..N-1:  x = lerp(min,max,i/(N-1));  y = fn(x)
  y 非有限(NaN/±Inf)        → 断笔（moveTo 下一有效点）
  |y[i+1]-y[i]| > (yAxis.max - yAxis.min)     → 疑似渐近线，断笔   // tan/1/x 不穿渐近线
输出: Polyline[]（数学单位），供 Path2D 构建 / MiniPreview / SVG 导出三处共用
```

- 采样数取档位 160/320/640（原型基线），硬上限 2000（PM 硬约束，UI 不暴露超限入口，`sample()` 内 clamp）。
- 定义域校验：`min < max` 且 `max-min ∈ [0.1, 1000]`，越界报参数错误（错误态承接，不崩溃）。
- 求值异常（mathjs throw）逐点捕获计为断笔；整段全无效 → "定义域内无有效值"错误态（原型错误文案）。

### 6.3 缓存（`cache.ts`）

| 缓存 | 结构 | 失效条件 |
|---|---|---|
| 编译缓存 | `Map<exprString, CompiledFn>`（LRU 100） | 表达式字符串变化 |
| 折线/Path2D 缓存 | `WeakMap<MathPlotElement对象, {sig, polylines, path2d}>` | `sig = JSON(equation,kind,xAxis,yAxis,sampleCount)` 变化 |

store 不可变更新会换元素对象引用 → WeakMap 旧条目失联自动回收；同对象引用 + 同 sig（平移/缩放/改颜色线宽透明度/轴显隐）→ 直接命中，**不重采样**。注意颜色/线宽不在 sig 中：颜色变化只需重 stroke 既有 Path2D。

### 6.4 性能预算（对应 PM 硬约束）

| 操作 | 成本路径 | 预算 | 保证机制 |
|---|---|---|---|
| 平移/缩放每帧 | 网格点阵 + 20 元素 bbox culling + 缓存 Path2D stroke（最坏 20×640=12.8k 段） | **16ms 内** | Path2D 缓存命中、无求值无采样；culling 跳过视口外元素 |
| 方程确认/改方程 | parse+compile（~1ms）+ 采样 640 点（mathjs evaluate ~1-5µs/点 ≈ <5ms）+ Path2D 构建 | < 50ms | "出图中"过渡态覆盖（原型决策 5） |
| 滑杆调参每帧 | sig 含 yAxis/sampleCount 的项会重采样；颜色线宽不重采样 | < 10ms | 调参期间 MiniPreview 降档（160）预览，松手提交时恢复目标档位 |
| 同屏 20 图形 | 全部走缓存 | — | §12 R4 压测用例固化 |

配套共享优化（放进 ZOO-135，收益全元素）：`renderElements` 增视口 culling；pan 期间 mousemove 用 rAF 合并重绘（现每 move 全量 setState+render，高 DPI 大屏有裕量但顺手加保险）。

### 6.5 依赖与体积预算

新增运行时依赖 **仅 mathjs 一个**（number 构建，预估 gzip 增量 ~60-120KB；若超 `next build` 首屏 +150KB gzip 门槛则退依赖子集构建，为编辑面板懒加载：`parse` 仅在编辑器与元素创建时使用，可 `dynamic import` 切出主 chunk）。KaTeX/MathLive MVP 均不引入（D1）。vitest 仅 devDependency。

---

## 7. 解析器设计（`src/lib/math/parse.ts`）

### 7.1 归一化（parse 前置，`normalize.ts`）

```
π→pi  ²→^2  ³→^3  ⁴→^4  ˣ→^x  √(...)→sqrt(...)  ·/×→*  ÷→/  ，→,
大写 SIN/COS/TAN → 小写；全角括号 → 半角
```

mathjs 原生支持隐式乘法（`2x`、`2sin(2x+π/3)`、`2πx`）与常量 `pi/e`，归一化只做数学符号翻译，不改语义。

### 7.2 分类流程

```
输入 → 顶层 '=' 分割（括号深度=0 处手工 split，mathjs 不解析裸等式）
 ├─ 无 '=' 且含 x        → rhs=原文                       → explicit
 ├─ lhs='y' | 'f(x)'     → rhs                            → explicit
 ├─ 双侧均含 x,y → AST 模式匹配（§7.3）
 │    ├─ (x-a)²+(y-b)²=r² → circle{cx,cy,r}
 │    └─ x²/A+y²/B=1      → ellipse{cx,cy,rx,ry}
 │    └─ 其余             → error("暂不支持隐式方程（除圆/椭圆）")   // 原型文案
 └─ parse/compile 抛错 → error(映射后的人话原因)
```

错误文案沿用原型五类：无法识别的符号 / 括号未闭合 / 表达式不完整 / 定义域内无有效值 / 暂不支持隐式方程。mathjs 异常 → 关键字映射到该五类（兜底"无法识别的表达式"）。

返回值：

```ts
type ParseResult =
  | { kind: 'explicit'; fn: (x:number)=>number }        // compile 缓存
  | { kind: 'circle' | 'ellipse'; params: {...} }        // P1
  | { kind: 'error'; message: string };
```

### 7.3 圆/椭圆识别（P1，AST 模式匹配）

对 lhs-rhs=0 的 AST 做 `simplify` 后匹配两个标准形（x²、y²、xy 项、一次项、常数项的系数提取），命中则解析出圆心/半径/长短轴，`sample.ts` 对 circle/ellipse 走参数化精确路径（`ctx.ellipse` 一条路径，零采样），`equalRatio` 强制 true（PM 拍板，几何不失真）。不匹配 → 既有 error 文案。**不引入通用隐式方程数值绘制**（P2 再评估，PRD §11 已列风险）。

---

## 8. 集成点改动清单（逐文件）

| 文件 | 改动 | issue |
|---|---|---|
| `src/lib/types.ts` | `MathPlotElement` + 联合类型 + `schemaVersion?` 占位 + 方程默认常量（导出 `DEFAULT_MATHPLOT`） | ZOO-136 |
| `src/lib/store.ts` | `ToolType` 加 `'equation'`；`updateElementTransient()`；（`setTool` 清选中的既有语义保持） | ZOO-136 |
| `src/lib/math/*` | 新模块（§2.1） | ZOO-134/135 |
| `src/lib/renderer.ts` | `drawMathPlot` + `case 'mathPlot'`；`getElementBounds` 返回 `{x,y,width,height}`（外框即 bbox，hitTest 零改动命中）；`renderSelection` 控点参数化（§11 D-1） | ZOO-135/136 |
| `src/lib/export.ts` | `elementToSvg` 增 `mathPlot` case | ZOO-136 |
| `src/lib/useShortcuts.ts` | toolMap 加 `f: 'equation'` | ZOO-136 |
| `src/components/LeftToolbar.tsx` | tools 数组加分隔线 + ƒ Equation 项 | ZOO-136 |
| `src/components/PropertyPanel.tsx` | 三态路由：`activeTool==='equation'` → EquationEditor（加宽 264px）；选中 mathPlot → MathPlotParams；否则现状 | ZOO-133/136 |
| `src/components/Canvas.tsx` | equation 工具的画布空态引导（ƒ 提示）；mathPlot 点击选中（复用 hitTest）+ 控点拖拽缩放（§11 D-1） | ZOO-136 |
| `src/components/math/*` | 新组件（§2.1） | ZOO-133 |

创建落点：新元素置于**当前视口中心**（`screenToCanvas(视口中心)`），默认尺寸 480×360 世界 px，`strokeColor/strokeWidth` 继承当前工具栏取值，曲线默认色 `#3B82F6`（原型基线）。

---

## 9. `src/app/` 死代码清理（PR0）

**证据**：`page.tsx` 仅 import `@/components/*`；五组件与 `src/components/` 同名文件 diff 为 0（逐字节相同）；全仓库无 `@/app/` 或相对路径引用这五个文件（PR0 中以 grep + `next build` 双重验证）。`src/app/` 保留 `layout.tsx`、`page.tsx`、`api/`（路由约定文件，不可动）。

**PR0 计划**：分支 `chore/remove-app-dead-code`，仅删 5 文件（Canvas/HistoryPanel/LeftToolbar/PropertyPanel/TopMenuBar.tsx），+20 行/−570 行，验证 `next build` 通过 + 全工具冒烟。**在所有功能分支之前合入**，避免后续 diff 混淆与误引用。删除属于 Next.js 非路由模块（app 目录下非 page/layout/route 文件不参与路由），与 AGENTS.md 的 Next 16 警告无冲突，但仍按仓库要求先读 `node_modules/next/dist/docs/` 核对。

---

## 10. 分支拆分与集成顺序（Stage 4 执行计划）

四个开发子 issue 映射为 **6 个 PR、两层并行**：

```
main ──▶ PR0 chore/remove-app-dead-code            (ZOO-131 收尾，立即执行)
      └─▶ PR1 feat/math-expr        (ZOO-134)  ┐ 两者无依赖，可并行
      └─▶ PR2 feat/mathplot-model   (ZOO-136前半) ┘
            ├─▶ PR3 feat/mathplot-render     (ZOO-135)  ← 依赖 PR1+PR2
            ├─▶ PR4 feat/math-input-panel    (ZOO-133)  ← 依赖 PR1
            └─▶ PR5 feat/mathplot-integration (ZOO-136) ← 汇总 PR3+PR4，最后合入
```

| PR | 分支 | 内容 | 完成定义 |
|---|---|---|---|
| PR1 | `feat/math-expr` | mathjs 依赖 + `normalize/parse/sample/templates/label` + **vitest 引入** + 解析测试（原型 23 用例 + 注入用例 + 断笔/边界用例） | 纯函数全绿，无 UI |
| PR2 | `feat/mathplot-model` | types.ts 模型 + 联合类型 + store 默认态/`updateElementTransient` + `schemaVersion` 占位 | `next build` 绿，现有行为零变化 |
| PR3 | `feat/mathplot-render` | renderer `case 'mathPlot'` + 采样断笔 + 双缓存 + culling + rAF 合并 + MiniPreview 渲染函数 | 硬编码元素出图正确，性能预算达标 |
| PR4 | `feat/math-input-panel` | EquationEditor（输入/校验/预览/符号按钮/13 模板）+ MathPlotParams 面板骨架，**暂不接入工具栏** | 组件 storybook 式本地验证 |
| PR5 | `feat/mathplot-integration` | 工具栏 ƒ + F 快捷键 + 创建流程（回车→addElement→自动选中→切回 select）+ 面板三态接线 + 控点缩放 + SVG 导出 case + 前向兼容测试 | PRD §10 验收标准 1-6 全过 |

**顺序理由**：解析层（PR1）是输入校验与渲染采样的共同依赖，先行落库；模型（PR2）小而独立，并行推进；渲染（PR3）与输入面板（PR4）在解析之上再并行；集成（PR5）最后一次性点亮功能，保证 **main 在 PR5 之前始终零感知、零回归**。每个 PR 均独立可回滚。

依赖偏差说明：PM 原排序"输入→解析→渲染→集成"，本方案调整为"解析→(输入∥渲染)→集成"——输入组件的实时校验依赖解析器接口稳定，先定接口（PR1 含 TypeScript 类型 `ParseResult` 契约）再写 UI，避免返工；四个 issue 的交付物边界不变。

---

## 11. 与 PRD/原型的偏差与遗留决策

| # | 事项 | 现状/矛盾 | 本方案 | 说明 |
|---|---|---|---|---|
| D-1 | 控点缩放 | 原型与 PM 验收为"8 控点缩放"，但**现有代码 `renderSelection` 仅画 4 角控点且无任何拖拽缩放实现**（§1）；交互说明自称"与现有 renderSelection 一致"存在内部矛盾 | ZOO-136 为 mathPlot 实现 8 控点（4 角+4 边中点）拖拽缩放；其他元素维持现状（零回归），通用化留给 P1 | mathPlot 达到已验收基线；老元素不动以守住"零回归"硬指标 |
| D-2 | 出图中过渡态 | 实际解析 <50ms | 保留 0.6s 过渡动画（原型决策 5），首帧即真图 | 视觉预期问题，非技术需要 |
| D-3 | 错误占位元素 | — | 确认为正常元素（可移动/删除/撤销，原型决策 4），`kind:'error'` 承载 | 编辑器实时校验拦截大部分非法输入，占位承接确认后/定义域无解等场景 |
| D-4 | yAxis 独立缩放 | PRD 提"x/y 单位比例" | 模型支持（`equalRatio:false`），MVP UI 只给开关；几何强制等比 | 功能位预留，交互成本后置 |

---

## 12. 风险登记册

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | mathjs bundle 体积超预算 | 中 | number 构建 → 依赖子集 → dynamic import 三级降级；`next build` 体积门禁固化 |
| R2 | mathjs 求值性能不达 640 点/50ms | 低 | 编译缓存 + 档位限流；实测不达则退 "AST→受限代码生成"（白名单函数直接映射 JS闭包），接口不变 |
| R3 | 渐近线断笔阈值误杀陡峭曲线（如 `y=x³` 大定义域） | 中 | 阈值取视窗高度且要求双侧跨越；配合采样档位提升缓解；测试用例覆盖 tan/1/x/x³ |
| R4 | 20 图形 × 640 点最坏帧预算 | 低 | Path2D 缓存 + culling；ZOO-137 压测脚本验收 |
| R5 | mathjs 供应链（CVE/版本漂移） | 低 | 锁版本 + `npm audit` CI 门禁 + 注入回归用例 |
| R6 | Next.js 16 非标准版本行为差异 | 低 | 改动全在 client 组件与纯库；每个 PR 前读 `node_modules/next/dist/docs/`；PR0 独立验证 build |
| R7 | 老文档/新文档互开 | 低 | 未知类型静默忽略已固化（§5.3）+ 测试；`schemaVersion` 占位 |
| R8 | 调参历史粒度争议（一次拖动一条 vs 更细） | 低 | 与现有移动拖拽粒度一致，PM 已认可该模式 |

---

## 13. PRD 验收标准落点对照

| PRD §10 | 方案落点 |
|---|---|
| 1. F 输入 `y=sin(x)` 即出图并选中 | §8 创建流程 + PR5 |
| 2. P0 方程族正确出图 | §7 解析 + PR1 测试矩阵 |
| 3. 属性面板实时调参重绘 | D5 两段式 + PR4 |
| 4. 选中/移动/缩放/撤销/持久化 | §5.3 兼容表 + D-1 控点 |
| 5. 非法输入错误态不崩溃 | §6.1 错误态 + §7.2 错误文案 |
| 6. 现有工具零回归 | PR0 先行清理 + PR1-4 不触现有行为 + PR5 集成验收 |

---

*本方案评审通过后作为 ZOO-133/134/135/136 的实施基线；PR0（死代码清理）建议随 Stage 4 启动立即执行。*
