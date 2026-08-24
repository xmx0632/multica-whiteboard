# 教学白板 · 项目文档集

教学白板是一个面向课堂教学的在线白板：具备常规白板的全部能力，并支持**输入数学方程自动生成对应矢量图形**（sin 曲线、二次函数、圆等），图形作为普通白板元素可编辑、可持久化。

本目录是项目的**开发与交付依据**，由 Stage 1–3 交付物整合而成（ZOO-129 PRD → ZOO-130 原型 → ZOO-131 技术方案 → ZOO-132 文档集），Stage 4/5 开发与测试直接以本文档集为基线。

## 文档地图

| 文档 | 内容 | 版本/状态 |
|---|---|---|
| [`prd/mathplot-prd.md`](./prd/mathplot-prd.md) | 产品需求：用户故事、方程类型分级（P0/P1/P2）、交互定义、MVP 边界、非功能需求、验收标准、评审拍板记录 | v1.0 · 已评审通过 |
| [`prototype/interaction-spec.md`](./prototype/interaction-spec.md) | 交互说明：核心流程、6 个关键状态、参数清单、方程语法、设计决策 | v1.0 · 已评审通过 |
| [`prototype/whiteboard-prototype.html`](./prototype/whiteboard-prototype.html) | 可交互原型（单文件零依赖，浏览器直接打开；内置「评审演示」面板一键切换状态） | v1.0 |
| [`design/mathplot-technical-design.md`](./design/mathplot-technical-design.md) | 技术方案：选型 ADR、MathPlotElement 数据模型、渲染管线、解析器设计、逐文件改动清单、PR0–PR5 计划、风险登记册 | v1.0 · 已评审通过 |
| [`dev/architecture.md`](./dev/architecture.md) | 开发指南：现有代码结构（迭代一单机版）、运行/构建说明、已知技术债、MathPlot 开发路标 | v1.0 |
| [`advanced-formula-guide.md`](./advanced-formula-guide.md) | 使用指南：高级公式面板四分区（微积分 / 物理模板 / 常量 / 参数式）的关系与组合用法、6 个实测例子、决策速查表 | v1.0 |

## 按角色的阅读路径

- **新加入的开发者**：`dev/architecture.md`（跑起来 + 代码地图）→ `design/mathplot-technical-design.md` §2/§10（做什么、按什么顺序）→ 按分配的 PR 精读对应章节。
- **产品/评审**：`prd/mathplot-prd.md` → 打开 `prototype/whiteboard-prototype.html` 体验 → 有出入时以 PRD §12 拍板记录为准。
- **测试**：`prd/mathplot-prd.md` §10 验收标准（6 条硬指标）→ `design/...` §6.4 性能预算与 §12 风险登记册（压测/注入用例来源）。

## 关键决策速查（已拍板，不再开放讨论）

| 决策 | 结论 | 出处 |
|---|---|---|
| 交互模型 | 元素即图形、**创建即出图**（非"选中才出图"）；"选中文本转图形"留 P1 | PRD §5.3 / §12 OQ-1 |
| 坐标系 | MathPlot **自带局部坐标系**，随元素移动缩放，与背景点阵解耦 | PRD §12 OQ-2 |
| 输入编辑器 | 自研受控文本框 + 符号按钮 + 13 模板（否决 MathLive/KaTeX） | 设计 §4 D1 |
| 解析器 | mathjs（number 构建），scope 只含 x，**禁 eval** | 设计 §4 D2 |
| 渲染 | 自绘 Canvas（`renderer.ts` case `mathPlot`）+ Path2D 缓存，平移缩放零重采样 | 设计 §4 D3 |
| 性能线 | 单曲线采样 ≤2000 点、平移缩放 60fps、同屏 ≤20 图形 | PRD §12 约束 3 |
| 死代码 | `src/app/` 5 个同名组件确认删除，PR0 先行；新代码一律基于 `src/components/` | 设计 §9 |
| P1 边界 | 导出 PNG/PDF、图片插入紧随主链路，不混入本期 | PRD §7 / §12 约束 5 |

## 文档维护约定

- **真源优先级**：代码 > 技术方案 > 原型说明 > PRD；文档间冲突时以更接近代码的一方为准，并回头修订另一方。
- 版本演进：各文档头部标注版本与状态；评审结论以「评审记录」章节追加，不回改正文结论性表述（保持决策可追溯）。
- Stage 4 各 PR 合入时，同步更新 `dev/architecture.md` 的目录结构与改动说明；功能行为与原型有偏差时在设计文档 §11 偏差表登记。
