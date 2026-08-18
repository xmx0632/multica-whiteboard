# 教学白板开发指南（迭代一·单机版）

面向开发者的代码结构说明与运行/构建指南。基线：`main` @ `36a528b`（与技术方案 `docs/design/mathplot-technical-design.md` §1 的盘点一致）。

---

## 1. 技术栈与运行环境

| 项 | 版本/说明 |
|---|---|
| 框架 | Next.js **16.2.6**（App Router） |
| UI | React 19.2.4 / TypeScript 5 |
| 样式 | Tailwind CSS **v4**（`@tailwindcss/postcss`，无 `tailwind.config`，主题走 CSS `@theme`） |
| 状态 | Zustand 5.0.13（单 store） |
| 其他 | uuid 14（元素/文档 id） |
| 测试 | **暂无**（技术方案 PR1 引入 vitest，见设计文档 §10） |

**运行环境实测**（2026-08-18，macOS）：Node v26.0.0 + npm 11.12.1，`npm install` 与 `npm run build` 均通过。

> ⚠️ **Next.js 16 非标准版本**：仓库根 `AGENTS.md` 明确警告其 API/约定可能与既有认知不同，**写代码前先读 `node_modules/next/dist/docs/` 对应篇目**。好消息（技术方案 §12 R6 结论）：本项目改动面全部在 `'use client'` 组件与纯 TS 库，不触路由/服务端约定。

## 2. 快速开始

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器 → http://localhost:3000
npm run build      # 生产构建（构建时会跑 TypeScript 检查）
npm run start      # 运行生产构建（需先 build）
npm run lint       # ESLint（eslint-config-next）
```

- 无环境变量、无外部服务依赖；启动即用。
- 服务端持久化（「保存到服务器」）把 JSON 写入项目根下 `.whiteboard-data/` 目录（已 gitignore），首次保存时自动创建。

## 3. 目录结构总览

```
├── docs/                        ← 项目文档集（本指南所在，见 docs/README.md）
├── src/
│   ├── app/                     ← Next.js App Router 路由层
│   │   ├── page.tsx             ← 唯一页面入口：组装 5 个 UI 组件 + useShortcuts
│   │   ├── layout.tsx           ← 根布局（Geist 字体、metadata）
│   │   ├── globals.css          ← Tailwind v4 入口 + @theme 主题变量
│   │   ├── api/whiteboards/     ← 服务端持久化 REST 接口（文件系统 JSON 存储）
│   │   └── Canvas.tsx 等 5 个组件  ← ⚠️ 死代码（见 §9），禁止引用
│   ├── components/              ← ★ UI 组件真源（page.tsx 只从这里 import）
│   │   ├── Canvas.tsx           ← 画布：渲染调度 + 全部鼠标交互（272 行）
│   │   ├── LeftToolbar.tsx      ← 左侧工具栏（8 工具，tools 数组即扩展点）
│   │   ├── PropertyPanel.tsx    ← 右侧属性面板（按 activeTool 条件展示）
│   │   ├── TopMenuBar.tsx       ← 顶栏：标题/撤销重做/导出/保存/新建/清空
│   │   └── HistoryPanel.tsx     ← 历史文档面板（本地/服务器两 Tab，加载/删除）
│   └── lib/                     ← ★ 核心逻辑（纯 TS，多数可独立单测）
│       ├── types.ts             ← 数据模型：元素类型/文档/Operation/常量（97 行）
│       ├── store.ts             ← Zustand store：状态 + 动作 + 撤销重做（259 行）
│       ├── renderer.ts          ← Canvas 渲染：网格/元素/选中框 + 命中检测（298 行）
│       ├── persistence.ts       ← 持久化：localStorage/自动保存/服务端 API 封装（143 行）
│       ├── export.ts            ← 导出：PNG/JPG（离屏 canvas）/SVG（字符串拼接）（172 行）
│       └── useShortcuts.ts      ← 全局键盘快捷键 hook（51 行）
└── .whiteboard-data/            ← 运行时生成：服务端文档 JSON（gitignore）
```

**分层原则**：`lib/` 不依赖 React 组件（`useShortcuts.ts` 除外），`components/` 只消费 `lib/`。新功能照此分层（MathPlot 的 `src/lib/math/*` 纯函数层即按此原则设计）。

## 4. 数据模型（`src/lib/types.ts`）

```ts
BaseElement { id, type, x, y, strokeColor, strokeWidth, opacity }
  ├─ PathElement      type:'path'      points: Point[]           // 画笔（二次贝塞尔平滑）
  ├─ RectangleElement type:'rectangle' width, height, fillColor  // 坐标可为负（拖拽方向）
  ├─ CircleElement    type:'circle'    width, height, fillColor  // 外接框定义的椭圆
  ├─ LineElement      type:'line'      x2, y2
  ├─ ArrowElement     type:'arrow'     x2, y2                    // 带箭头帽
  └─ TextElement      type:'text'      content, fontSize, fontFamily, color, width, height
```

- `WhiteboardElement` = 上述六者的联合类型。**新增元素类型 = 新增接口 + 加入联合**（MathPlot 即此路径）。
- `WhiteboardDocument { id, title, elements, viewport, createdAt, updatedAt, thumbnail? }` —— 整文档序列化的单元。
- `Operation { type:'create'|'update'|'delete', elementId, before?, after? }` —— 撤销重做的快照单元（见 §6）。
- 常量：`COLORS`（12 色板，属性面板与 MathPlot 曲线共用）、`DEFAULT_STROKE_COLOR/WIDTH/FONT_SIZE`。

## 5. 状态管理（`src/lib/store.ts`）

Zustand 单 store（`useStore`），无 middleware、无 persist 插件——持久化由 `persistence.ts` 显式驱动。

**State**

| 域 | 字段 |
|---|---|
| 文档 | `documentId`、`documentTitle` |
| 元素 | `elements: WhiteboardElement[]`、`selectedId`（单选） |
| 工具 | `activeTool: ToolType`、`strokeColor/strokeWidth/fillColor/fontSize`（新元素默认样式） |
| 视口 | `viewport { offsetX, offsetY, scale }` |
| 历史 | `undoStack/redoStack: Operation[][]`（栈深 100，`slice(-99)` 截断） |
| 持久化 | `isDirty`、`lastSavedAt` |

**关键 action 语义（开发必读）**

- `addElement/updateElement/deleteElement/clearAll`：变更元素**并自动入撤销栈**（`clearAll` 把全部删除打包为一组）。任何元素变更走这三个，历史自动正确。
- `pushOperations(ops)`：只入栈、不改元素——给"先直改、后补历史"的交互用（拖拽提交模式，见 §7）。
- `setTool(tool)`：**切换工具会清空选中**（`selectedId: null`）——新工具接入时注意此副作用。
- `updateElement` 是浅合并（`Object.assign({}, el, updates)`）。

## 6. 撤销重做机制

快照式（非 command 式）：每个 `Operation` 记录元素的完整 before/after 快照；`Operation[]` 一组 = 一次用户操作 = 一次撤销步。

- `undo`：逆序回放组内 op（create→删除、delete→恢复、update→还原 before），整组移入 redoStack。
- `redo`：正序回放 after。
- 新交互接入历史的标准姿势：**交互期间不进栈，交互结束时压一条**（现有拖拽移动即如此，见 §7）；MathPlot 滑杆调参的 `updateElementTransient` 两段式是同一模式的推广（设计文档 §4 D5）。

## 7. 渲染管线与交互（`src/lib/renderer.ts` + `src/components/Canvas.tsx`）

**渲染：Canvas 2D 即时模式，无脏矩形、无分层画布。** 每次状态变化全量重绘：

```
render()（Canvas.tsx:26，useCallback 依赖 [elements, selectedId, viewport]）
  1. renderGrid       点阵背景（20px 网格，scale<0.15 时省略点阵）
  2. renderElements   顺序遍历元素 → renderElement switch 分发到 drawPath/drawRectangle/...
  3. 临时元素         tempElementRef 中的预览元素（绘制中未提交）
  4. renderSelection  选中框（蓝色虚线框 + 4 个 8px 角控点）
```

**视口变换**：统一为 `屏幕 = 世界坐标 × scale + offset`，在各 `drawXxx` 内部逐点应用；逆变换 `screenToCanvas` 供交互命中换算。无独立 camera 抽象——viewport 就是 store 里的三个数。

**坐标语义**：元素坐标为**世界坐标**（画布逻辑坐标，与屏幕解耦）；rectangle/circle 的 width/height 可为负（终点在起点左/上方时），渲染用 `Math.min/abs` 归一。

**交互（全在 Canvas.tsx 的鼠标/滚轮 handler）**

| 交互 | 实现要点 |
|---|---|
| 绘制（画笔/形状/文本） | mousedown 建 tempElement → mousemove 改 temp + 手动 `render()`（不进 store）→ mouseup `addElement` 提交（一次入栈） |
| 选择拖动 | mousemove 期间 `useStore.setState` **直改 elements 不进栈** → mouseup 时若有位移 `pushOperations` 压一条 update（`Canvas.tsx:164-229`） |
| 视口平移 | 按住 Space（或中键）拖拽，改 `viewport.offset` |
| 缩放 | 滚轮，以鼠标位置为锚点 `scale ∈ [0.1, 5]` |
| 橡皮 | 拖拽中逐点 `hitTest` 命中即 `deleteElement`（每次删除各占一条历史） |

**命中检测**：`hitTest` 基于 `getElementBounds` 的 bbox + margin（`max(8/scale, strokeWidth/2+4/scale)`），非像素级——新增元素类型只要 `getElementBounds` 返回外框，选中/移动/橡皮自动工作。`getElementBounds` 的 `default` 分支返回 null、`renderElement` 无匹配 case 即不绘制——**未知元素类型被静默忽略**（旧版本打开新文档的前向兼容语义，设计文档 §5.3 决定用测试固化）。

## 8. 持久化与导出

**持久化（`persistence.ts`）三条通道，均整文档 JSON 直通（无 schema 校验、无版本字段）**

1. localStorage：`saveToLocal/loadFromLocal/deleteFromLocal`，key `whiteboard_<id>`；文档列表 `whiteboard_documents`。
2. 自动保存：`autoSave/loadAutoSave`，key `whiteboard_autosave`（TopMenuBar 触发）。
3. 服务端：`saveToServer` 等 → `/api/whiteboards`（POST 列表保存 / GET 列表 / `[id]` GET·DELETE）；实现为 **`.whiteboard-data/<id>.json` 文件读写**，无数据库。

**新增元素类型对持久化零改动**——elements 数组 `JSON.stringify` 直通，这是 MathPlot 兼容性结论的依据（设计文档 §5.3）。

**导出（`export.ts`）**

- PNG/JPG：`exportToImage` 离屏 canvas 以 `{offsetX:-ox, offsetY:-oy, scale:1}` 视口复用 `renderElement` 绘制——**新增元素类型自动获得位图导出**。
- SVG：`exportToSvg` 逐类型手写字符串拼接（`elementToSvg`）——新增类型需**手动加 case**（MathPlot 待办，设计文档 §8）。
- 缩略图：`WhiteboardDocument.thumbnail?` 仅类型声明，**全仓库无生成逻辑**。

## 9. 已知问题与技术债（开发前必读）

| # | 事项 | 状态/计划 |
|---|---|---|
| 1 | **`src/app/` 下 5 个死代码组件**（Canvas/LeftToolbar/PropertyPanel/TopMenuBar/HistoryPanel 与 `src/components/` 同名文件逐字节相同；`page.tsx` 只 import `@/components/*`） | 已确认（技术方案 §9），**PR0 `chore/remove-app-dead-code` 在所有功能分支前合入**；此前开发**一律基于 `src/components/`**，勿引用/勿编辑 `src/app/` 下同名文件 |
| 2 | 无测试框架 | PR1 引入 vitest + 解析层用例（设计文档 §10） |
| 3 | `renderSelection` 仅画 4 角控点，且**无任何控点拖拽缩放实现**（只有整体移动） | MathPlot 按 8 控点实现（设计文档 §11 D-1），其他元素维持现状守"零回归" |
| 4 | 无多页/多画布、无图片插入、导出仅 PNG/JPG/SVG（无 PDF） | PRD §7 划为 P1，不混入方程出图迭代 |
| 5 | 橡皮逐点删除，一次拖擦产生多条撤销记录 | 现状保留；如优化需与"一次拖动一条历史"语义对齐 |

## 10. MathPlot（方程出图）开发指引

本迭代核心功能的完整设计见 **`docs/design/mathplot-technical-design.md`**，此处只给入口路标：

| 要做什么 | 读设计文档哪节 |
|---|---|
| 了解模块划分与数据流 | §2（`src/lib/math/*` 纯函数层 + `src/components/math/*`） |
| 数据模型 `MathPlotElement` | §5（类型定义、三层坐标映射、兼容性核对表） |
| 渲染/采样/缓存/性能预算 | §6（drawMathPlot 层次、断笔、Path2D 双缓存、60fps 预算表） |
| 解析器（mathjs、归一化、圆/椭圆识别） | §7 |
| 逐文件改动清单 | §8 |
| 分支与 PR 顺序（PR0–PR5） | §10 |
| 与 PRD/原型的偏差决策 | §11（D-1~D-4） |

交互行为基线：`docs/prototype/interaction-spec.md`（参数清单、状态流转、错误文案、视觉决策）。产品需求与验收标准：`docs/prd/mathplot-prd.md`（§10 验收标准 6 条为 Stage 4/5 的验收依据）。

## 11. 分支与提交约定

- 分支命名：`feat/<topic>`、`fix/<topic>`、`chore/<topic>`、`docs/<topic>`。
- 集成流程：分支开发 → 推送 → Gitee 建 PR → 人工合并（仓库未配 API token，PR 从推送后的 Gitee 页面入口创建）。
- 方程出图迭代按设计文档 §10 的 PR0–PR5 顺序推进，**main 在 PR5 合入前保持零感知**。
- commit message 用英文短句（现有历史风格：`feat:` / `docs:` 前缀）。
