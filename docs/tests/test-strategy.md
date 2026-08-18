# 教学白板「数学方程智能出图」测试策略

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 关联 | Epic ZOO-128 · PRD ZOO-129 · 原型 ZOO-130 · 技术方案 ZOO-131 · 开发 ZOO-133–136 · 本 issue ZOO-137 |
| 被测版本 | 分支 `feat/equation-element-integration` @ `65bb8b2`（Stage 4 栈顶，PM 已验收：`npm test` 96/96、`npm run build` 通过） |
| 输入基线 | `docs/prd/mathplot-prd.md`（§5.2 方程族分级、§8 非功能、§10 验收标准）· `docs/prototype/interaction-spec.md`（交互基线）· `docs/design/mathplot-technical-design.md`（§6.4 性能预算、§12 风险登记册） |
| 配套用例 | `docs/tests/test-cases.md`（11 组 114 条，含已有自动化映射） |

---

## 1. 测试目标

1. **功能正确**：方程输入 → 解析 → 出图 → 元素生命周期（选中/移动/缩放/调参/撤销重做/复制/删除）全链路符合 PRD §10 验收标准 1–6。
2. **零回归**：现有白板 8 工具（选择/画笔/矩形/圆/直线/箭头/文本/橡皮擦）、视口、历史、持久化、导出行为与迭代一完全一致（PM 硬指标）。
3. **稳健安全**：非法/无界/注入输入不白屏、不崩溃、不执行代码（禁 eval 硬约束）。
4. **性能达标**：单方程出图 <50ms、平移缩放 60fps、同屏 20 图形流畅（PM 性能线）。
5. **覆盖衔接**：不重复建设已有 96 个 vitest 单测，自动化增量集中在**组件测试与 E2E**（PM 点名的空白）。

## 2. 范围

### 2.1 In Scope

| 模块 | 被测对象（代码落点） |
|---|---|
| 方程输入 | `EquationEditor` / `MiniPreview` / 模板与符号按钮（`src/components/math/`）、工具栏 ƒ 入口与 F 快捷键 |
| 归一化与解析 | `src/lib/math/normalize.ts` / `parse.ts` / `validate.ts`（mathjs 安全解析） |
| 采样与断笔 | `src/lib/math/sample.ts`（显式函数采样、圆/椭圆参数化、渐近线断笔） |
| 渲染出图 | `src/lib/math/plot.ts`（坐标系/刻度/曲线/错误占位）、`renderer.ts` case 'mathPlot'、双缓存（`cache.ts`） |
| 元素集成 | `MathPlotElement` 工厂、store 握手与 D5 两段式历史、Canvas 8 控点缩放、PropertyPanel 三态 |
| 持久化与导出 | localStorage + `/api/whiteboards` 双通道、SVG/PNG 导出、前向兼容（未知类型静默忽略） |
| 现有白板回归 | 上述 §1-2 全部既有功能 |
| 非功能 | 性能预算、安全（公式注入）、稳健性（模糊输入）、离线、跨浏览器/跨端 |
| 演示路由 | `/mathplot-demo`（MathPlotStage 全链路演示页）冒烟 |

### 2.2 Out of Scope（PRD §7 非目标，测到即提 bug 不设用例）

- 实时多人协同、云端多端同步、分享/权限（无并发编辑协议，见 §8 并发语义界定）；
- 多页/多画布管理、图片插入、PNG/PDF 导出增强（P1 后续迭代）；
- 手写识别（远期 P2）、隐式方程通用数值绘制 / 参数方程 / 极坐标（P2）；
- 关键点标注（零点/顶点/交点，P2）。

## 3. 被测对象分析

### 3.1 数据流与测试切入点

```
EquationEditor(每键) ─▶ normalize ─▶ parseEquation ─▶ validateEquation(薄适配)
                          │                              │ ✓/⚠ 状态行 + MiniPreview 实时预览
回车确认 ─▶ requestMathPlotInsert(store 握手) ─▶ Canvas 消费：createMathPlotElement(画布中心落点)
             ─▶ addElement + 自动选中 + 切回 select 工具
渲染每帧 ─▶ resolvePlotRender(sig 缓存命中则不重采样) ─▶ drawMathPlot(白底→网格→轴→曲线→标签chip)
调参 ─▶ onChange(直改 transient，实时重绘) ─▶ onCommit(压一条快照，可整体撤销)
```

**分层可测性**（技术方案 §2.1 的直接红利）：
- `src/lib/math/*` 为无 React、无 DOM 依赖的纯函数（`cache.ts` 仅依赖 Path2D，Node 下自动回退）——单测可全覆盖，**已基本建设完毕（96 用例）**；
- 组件层消费纯函数结果，可通过 props 注入/替换采样函数（`createPreviewPolylines` 注入点）——组件测试无需真实 Canvas 求值；
- 绘制函数接受 `CanvasRenderingContext2D`——单测用**记录调用的 mock ctx** 断言分层绘制（现有 `plot.test.ts` 已验证此法可行）。

### 3.2 已有测试资产盘点（96 用例，勿重复建设）

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `src/lib/math/__tests__/normalize.test.ts` | 12 | Unicode 归一、隐式乘法拆分、未知段保留 |
| `src/lib/math/__tests__/parse.test.ts` | 41 | 13 模板全解析、P0/P1 方程族求值、五类错误文案、注入与 AST 白名单 |
| `src/lib/math/__tests__/sample.test.ts` | 32 | 定义域校验、断笔（tan/1/x/√x/ln/x³-R3）、y 视窗自适应、几何参数化、预览适配 |
| `src/lib/math/__tests__/plot.test.ts` | 19 | niceStep/π 轴、坐标映射、Path2D、resolvePlotRender 缓存签名、drawGraphCore/drawMathPlot 分层 |
| `src/lib/math/__tests__/cache.test.ts` | 3 | 编译缓存 LRU |
| `src/lib/math/__tests__/label.test.ts` | 4 | Unicode 美化 |
| `src/lib/__tests__/mathplot-integration.test.ts` | 18 | 元素工厂、渲染管线接入、8/4 控点、前向兼容、store 全链路、SVG 导出 |

**空白（本策略自动化增量）**：组件测试（EquationEditor / MathPlotParams / MiniPreview / PropertyPanel 三态 / Canvas 交互）、E2E（创建→出图→调参→撤销→持久化主链路）、性能压测、兼容矩阵、并发竞态。**用例文档中逐条标注「已覆盖→映射文件 / 待补」。**

## 4. 测试分层与方法

| 层 | 工具/环境 | 对象 | 现状→目标 |
|---|---|---|---|
| L1 单元 | vitest 4（node 环境，现状） | `src/lib/math/*`、`mathplotElement.ts`、store、export | ✅ 96 用例，回归保留；增量仅补发现的边界（见用例 B-11/E-08 等） |
| L2 组件 | vitest + **@testing-library/react + jsdom**（新增 devDependency） | EquationEditor、MathPlotParams、MiniPreview、PropertyPanel 三态路由 | ❌→建议 ~20 用例（§9.2） |
| L3 E2E | **Playwright**（新增，chromium 基准 + webkit/firefox 矩阵） | 两路由端到端主链路、回归冒烟集、性能采样 | ❌→建议 ~30 用例（§9.3） |
| 性能 | 微基准（vitest 风格 bench 脚本）+ Playwright 帧采样 | 出图延迟、帧预算、20 图形压测 | ❌→建议 4 项（§9.4） |
| 手工/探索 | 浏览器 + 触屏一体机台架 | 视觉、兼容、离线、并发、可访问性、模糊探索 | 计划见用例 J/K 组 |

**Canvas 断言策略**（L2/L3 的共性难点，统一约定）：
- L2：mock `HTMLCanvasElement.prototype.getContext` 返回记录调用的假 ctx（复用 `plot.test.ts` 的 mock 思路），断言分层调用序列与参数；组件行为（状态行文案、按钮 disabled、patch 上抛）直接查 DOM；
- L3：三级断言——① **DOM 可观测面**（状态行/面板控件值/历史面板条目数）；② **store 状态**（建议增加 dev-only 测试钩子 `window.__WHITEBOARD_STORE__`，E2E `page.evaluate` 读元素数/字段，避免脆弱的像素断言成为主手段）；③ **像素抽检**（读 canvas dataURL，断言曲线色 `#3B82F6` 像素数 > 阈值，用于「确实画出图」的最终仲裁）+ 可选截图快照（`toHaveScreenshot`，按浏览器分目录存基线）。

## 5. 风险驱动 priorities

优先级定义：**P0** 阻断发布（PRD 验收/安全/崩溃级）；**P1** 发布前应通过；**P2** 可延后/探索。测试重点按技术方案 §12 风险登记册映射：

| 风险 | 测试响应 | 用例组 |
|---|---|---|
| R3 断笔阈值误杀陡峭曲线 | tan/1/x/x³/e^x 断笔与视窗自适应矩阵（已覆盖，回归保留） | C |
| R4 20×640 最坏帧预算 | 压测脚本固化验收（待补） | H |
| R5 mathjs 供应链/注入 | 注入回归用例 + `npm audit` CI 门禁（前者已覆盖） | I |
| 安全硬约束（禁 eval） | AST 白名单、scope 只含 x、注入载荷（已覆盖） | I |
| 稳健性（不白屏） | 五类错误态 + 模糊输入批测（部分待补） | E |
| 零回归 | 全工具 E2E 冒烟集（待补） | G |
| Next.js 16 非标准版本 | E2E 走真实 `next build && start`（不依赖 dev server 差异） | 全局 |
| 老文档互开 | 前向兼容已固化（已覆盖） | F |

## 6. 测试环境与兼容矩阵

### 6.1 浏览器（PRD §8：优先桌面 + 教学触屏一体机）

| 平台 | 版本 | 级别 | 方式 |
|---|---|---|---|
| Chrome | 最新 ×2 个大版本 | **P0 基准** | Playwright chromium，全量 E2E |
| Edge | 最新 | P1 | Playwright chromium（同内核）冒烟 + 手工 |
| Safari | 最新 | P1 | Playwright webkit 主链路 + 手工（重点：Path2D/`roundRect` 回退已手工实现 `roundedRectPath`，需实测） |
| Firefox | 最新 | P1 | Playwright firefox 主链路 |
| iOS Safari / Android Chrome | 最新 | P2 | 手工：只读浏览 + 基本可用（打开/查看/平移缩放），不强求精细编辑 |

### 6.2 设备

| 设备 | 分辨率/DPR | 级别 | 关注点 |
|---|---|---|---|
| 桌面开发机 | ≥1920×1080 @1x | P0 | 全量 |
| 教学触屏一体机 | 1080p–4K，触摸输入 | P1 | 触摸拖拽移动/缩放、面板触控、大屏帧率 |
| 高 DPR 笔记本 | @2x | P1 | canvas dpr 缩放渲染清晰度（`MathPlotStage`/`Canvas` 均已乘 devicePixelRatio） |
| 移动端 | 视口 <768px | P2 | 工具栏响应式（PRD「不强求精细编辑」） |

### 6.3 网络与数据环境

- **离线**：纯前端无外部 API，断网全功能可用（手工断网验证，含字体/图标无外链依赖）；
- **本地服务**：`/api/whiteboards` 为本机 Next 路由，E2E 用 `next build && next start` 起真实产物；
- **localStorage 异常态**（禁用/配额满/被篡改 JSON）：优雅降级不崩溃（P2 手工）。

## 7. 测试数据设计

| 数据集 | 内容 | 用于 |
|---|---|---|
| P0 方程族 | `y=2x+1` `y=x²-2x-3` `y=x³-2x` `y=sin(x)` `y=2sin(2x+π/3)` `y=tan(x)` `y=√x` `y=1/x` | 解析/出图/主链路（PRD 验收 2） |
| P1 方程族 | `y=2ˣ` `y=eˣ` `y=ln(x)` `y=|x-1|` `(x-1)²+(y-2)²=9` `x²/9+y²/4=1` | 同上 |
| 13 模板集 | `templates.ts` 全量（测试数据与产品数据同源，防漂移） | 输入/出图数据驱动 |
| Unicode 输入面 | π ² ³ ⁴ ˣ √ · × ÷ 全角括号/逗号 大写函数名 | 归一化 |
| 非法输入集 | 空串、`y=`、`y=sin(x`、`y=#1`、`x²-y²=1`、`y=foo(x)`、圆半径 0、超长/深嵌套、emoji、换行粘贴 | 错误态/稳健性 |
| 注入载荷 | `x);require('fs')`、`__proto__.x`、`constructor`、赋值/三目/块节点 | 安全 |
| 定义域边界 | min≥max、宽度 0.09/1000.01、[-2π,2π]/[-5,5]/[-10,10] 预设 | 采样/调参 |
| 场景集 | 同屏 20 图形（sin/抛物线/圆交替）、mathPlot+手绘+文本混排 | 性能/共存 |

## 8. 并发编辑语义界定（重要）

单机版**无实时协同**（PRD 非目标），「并发」在本期界定为三类，用例按此设计（K 组）：

1. **多标签页数据竞争**：同浏览器两标签页开同一白板，双通道（localStorage / API）均为后写覆盖（last-write-wins）——验收标准是**不产生损坏 JSON、不崩溃**，数据覆盖为已接受的产品现状（记录在案，P1 协同立项时重审）；
2. **单会话快速操作竞态**：连按回车批量插入、拖拽/缩放进行中 Ctrl+Z、滑杆未松手时撤销——状态机一致性（无卡死、无悬空选中、历史栈完整）；
3. **刷新竞态**：autosave 写入进行中刷新页面，重开后文档结构完整。

## 9. 自动化建设建议（本 issue 交付的核心增量）

### 9.1 原则

- **只加不改**：现有 `npm test`（node 环境、`src/**/*.test.ts`）零改动；新层全部增量挂载；
- 与 Stage 4 各 PR 的分支约定一致：自动化代码随功能分支演进，文档（本目录）先行固化用例与断言策略。

### 9.2 L2 组件测试（建议 ~20 用例）

```
新增 devDependency：@testing-library/react @testing-library/user-event jsdom
vitest.config.ts：test.environment 保持 'node'，
组件测试文件顶部注释 // @vitest-environment jsdom 局部启用（不动现有 96 用例环境）
目录：src/components/math/__tests__/*.test.tsx（include 放开 'src/**/*.test.{ts,tsx}'）
Canvas mock：HTMLCanvasElement.prototype.getContext → 记录调用的假 ctx
```

覆盖：编辑器状态行（等待/✓/⚠）与按钮 disabled、回车/插入确认载荷（含 error 态允许确认）、符号插入与模板填充、MiniPreview 三态、参数面板各控件 patch/commit 上抛矩阵、几何方程控件隐藏（定义域/采样/等比开关）、错误态「重新编辑方程」回调、PropertyPanel 三态路由。

### 9.3 L3 E2E（建议 ~30 用例，Playwright）

```
新增 devDependency：@playwright/test
playwright.config.ts：webServer = npm run build && npm start（真实产物，规避 Next16 dev 差异）
目录：e2e/*.spec.ts；projects：chromium（全量）/ webkit、firefox（主链路 smoke）
npm scripts：test:e2e（chromium）、test:e2e:all
测试钩子（建议，dev only）：window.__WHITEBOARD_STORE__ = useStore —— page.evaluate 直读状态
```

六个套件：① 创建主链路（PRD 验收 1）；② P0/P1 方程族出图数据驱动（验收 2）；③ 调参与元素生命周期（验收 3–4）；④ 错误态与原位重编辑（验收 5）；⑤ 白板回归冒烟集（验收 6，8 工具数据驱动）；⑥ 持久化/导出/双路由冒烟。

### 9.4 性能与 CI

- **微基准**（node 脚本，CI 跑）：单方程确认全管线（parse+compile+640 采样+Path2D 构建）<50ms；滑杆调参帧（改样式不重采样，用 `plotRenderWriteCount` 差分断言零重采样——单测已有此手法，扩为预算断言）；
- **帧率压测**（Playwright + CDP/rAF 采样）：20 图形（640 档）平移/缩放帧预算 ≤16ms（60fps）；
- **CI 门禁**：`npm test` + `npm run build` + `test:e2e`（chromium）+ `npm audit --omit=dev`（mathjs CVE，对应技术方案 R5）+ build 体积记录（mathjs gzip 增量，对应 R1）。

### 9.5 视觉回归（可选，P2）

Playwright `toHaveScreenshot`：两路由 × 关键状态（空态/出图/错误态/多图形/选中编辑，对齐原型 6 截图状态）基线截图，按浏览器分目录；仅作告警不阻断（教学场景对像素级还原无硬承诺）。

## 10. 准入 / 准出

**准入**（本轮已满足）：Stage 4 全部合入栈顶、`npm test` 96/96、`npm run build` 通过、可本地起服务复现。

**准出**：
1. P0 用例 100% 通过（含 PRD §10 验收标准 1–6 逐条对应）；
2. P1 用例 ≥95% 通过，失败项均有 bug 单与风险说明；
3. 白板回归冒烟集（G 组 P0）零失败；
4. 性能预算三项（出图 <50ms / 60fps / 20 图形）达标或挂豁免说明；
5. 发现的缺陷全部录入 issue 并分级；P0/P1 缺陷修复后回归通过。

## 11. 交付物

| 交付物 | 位置 |
|---|---|
| 测试策略（本文） | `docs/tests/test-strategy.md` |
| 测试用例（11 组 114 条，含分层与自动化映射） | `docs/tests/test-cases.md` |
| 自动化落地建议（L2/L3/性能/CI） | 本文 §9，供后续迭代开卡执行 |
