# 教学白板（MulticaBoard）

面向课堂教学的在线白板：具备常规白板的全部能力，并支持**在白板上输入数学方程，自动生成对应的矢量图形**——如 `y=sin(x)`、`y=x²-2x-3`、`(x-1)²+(y-2)²=9`——图形作为普通白板元素存在，可选中、移动、缩放、撤销重做、持久化。

## 功能

**迭代一（已交付，单机版）**

- 自由画笔、矩形、圆、直线、箭头、文本、橡皮
- 选择/移动、视口平移缩放（滚轮 + Space 拖拽）
- 撤销/重做（快照式历史，栈深 100）
- 持久化：浏览器 localStorage + 本地文件（服务端 API）/ 自动保存
- 导出：PNG / JPG / SVG

**进行中（方程智能出图，Stage 4）**

- ƒ 方程工具（快捷键 `F`）：输入即校验、实时预览、13 个方程模板
- MathPlot 元素：自带局部坐标系（轴/刻度/轻网格），创建即出图
- 可调参数：定义域、采样精度、轴/网格显隐、颜色/线宽/不透明度
- P0 方程族：一次/多项式(n≤4)/三角/幂/根/反比例；P1：指数/对数、绝对值、圆、椭圆
- 详见 [docs/README.md](./docs/README.md) 文档集

## 快速开始

```bash
npm install    # 安装依赖（实测 Node v26 / npm 11）
npm run dev    # 开发服务器 → http://localhost:3000
```

```bash
npm run build  # 生产构建（含 TypeScript 检查）
npm run start  # 运行生产构建
npm run lint   # ESLint
```

无环境变量、无外部服务依赖。「保存到服务器」将文档 JSON 写入项目根下 `.whiteboard-data/`（自动创建，已 gitignore）。

常用快捷键：`V/B/R/C/L/A/T/E` 切换工具，`F` 方程工具（开发中），`Ctrl+Z / Ctrl+Shift+Z` 撤销重做，`Delete` 删除选中，Space 拖拽平移画布。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16（App Router）+ React 19 |
| 语言 | TypeScript 5 |
| 样式 | Tailwind CSS v4 |
| 状态 | Zustand（单 store，快照式撤销重做） |
| 渲染 | Canvas 2D 即时模式（无第三方绘图库） |

> 注意：本项目使用的 Next.js 16 为非标准版本，API/约定可能与公开文档不同——写代码前先读 `node_modules/next/dist/docs/`（见 `AGENTS.md`）。

## 项目结构

```
src/
├── components/   # UI 组件（Canvas / LeftToolbar / PropertyPanel / TopMenuBar / HistoryPanel）
├── lib/          # 核心逻辑：types 数据模型 · store 状态与历史 · renderer 渲染与命中 · persistence 持久化 · export 导出
└── app/          # 路由层：page.tsx 入口 + api/whiteboards 文件存储 API
docs/             # 项目文档集（PRD / 交互原型 / 技术方案 / 开发指南）
```

完整的代码结构说明、架构机制（数据模型、渲染管线、撤销重做、持久化）与技术债清单见 [docs/dev/architecture.md](./docs/dev/architecture.md)。

## 文档

所有产品与技术文档集中在 [`docs/`](./docs/README.md)：

- [产品需求 PRD](./docs/prd/mathplot-prd.md) —— 方程类型分级、交互定义、MVP 边界、验收标准
- [交互原型](./docs/prototype/interaction-spec.md) —— 交互说明（原型 HTML 同目录，浏览器直接打开）
- [技术方案](./docs/design/mathplot-technical-design.md) —— 选型决策（ADR）、数据模型、渲染/解析设计、PR 计划
- [开发指南](./docs/dev/architecture.md) —— 代码结构、运行构建、已知技术债

## 参与开发

- 分支命名：`feat/` `fix/` `chore/` `docs/` + 主题；提交后推送并从 Gitee 建 PR，人工合并。
- 方程出图迭代按技术方案 §10 的 PR0–PR5 顺序推进（PR0 死代码清理先行）。
- **新代码一律基于 `src/components/` 与 `src/lib/`**；`src/app/` 下同名组件为待清理的死代码，勿引用。
