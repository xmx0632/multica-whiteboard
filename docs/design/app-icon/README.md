# 应用图标设计（ZOO-162）

教学白板（MulticaBoard）应用图标：3 个候选方案，**候选 A 已定稿接入**，B / C 留作备选。

## 候选 A — 蓝色画布 · 白色正弦（✅ 定稿，推荐）

`candidate-a-wave.svg`

- **意象**：品牌蓝圆角方板 = 白板/画布；白色正弦曲线横贯一个完整周期，曲线下衬 30% 透明白色坐标轴（一横一竖），即「方程 → 出图」的核心能力符号。
- **配色**：纵向渐变 `#60A5FA → #2563EB`（视觉均值 ≈ 品牌蓝 `#3B82F6`）。
- **小尺寸策略**：曲线笔画宽 10%（512 画布 52px），单周期对称构图，16px favicon 下仍可读出「蓝板白波」。
- **适用**：favicon / 标签页 / PWA / 主屏图标的全场景主图形。

### 定稿衍生文件

| 文件 | 用途 |
|---|---|
| `icon-square.svg` | 全出血方形（无圆角）：`apple-touch-icon.png` 源（iOS 自行裁圆角） |
| `icon-maskable.svg` | maskable 变体：内容缩至 78%，落在 80% 安全区圆内，适配 Android 自适应图标 |

## 候选 B — 白板卡片 + ƒ 角标（备选）

`candidate-b-board.svg`

- **意象**：浅灰蓝底上一张白色「白板卡片」（带投影），卡内蓝色正弦 + 灰色坐标轴；右下品牌蓝角标内白色斜体 ƒ；底部白色笔托放红/蓝/黄三色马克笔点。
- **优点**：「白板」隐喻最直白，教学氛围浓。
- **取舍**：细节多，16px 下卡片/角标/笔托全部糊掉，仅剩轮廓——不适合作 favicon 主图形。

## 候选 C — ƒ 与正弦波锁定（备选）

`candidate-c-fx.svg`

- **意象**：蓝→天蓝对角渐变底，左侧大号白色斜体 ƒ，右侧一段白色正弦波，两元素并置成「函数」标识。
- **优点**：ƒ 符号辨识度高，适合品牌传播物料。
- **取舍**：两元素在 16px 下互相挤压，曲线不完整；作 favicon 略弱于 A。

## 接入产物（由定稿 A 生成）

| 产物 | 路径 | 说明 |
|---|---|---|
| favicon.ico | `src/app/favicon.ico` | 16+32+48 多尺寸，Next.js 文件约定自动注入 `<link rel="icon">` |
| SVG favicon | `public/icons/icon.svg` | 现代浏览器矢量图标 |
| PNG 图标 | `public/icons/icon-192.png` / `icon-512.png` | PWA 常规图标 |
| maskable | `public/icons/icon-maskable-192.png` / `icon-maskable-512.png` | Android 自适应图标（安全区内完整显示） |
| Apple | `public/icons/apple-touch-icon.png` | 180×180，iOS 添加到主屏 |
| Manifest | `public/manifest.webmanifest` | name/theme_color(#3B82F6)/icons |

`src/app/layout.tsx` 的 `metadata.icons` 声明 SVG + 192 + 512，`metadata.manifest` 指向 webmanifest，`viewport.themeColor` 与品牌蓝一致。

## 再生成方式

图标由脚本生成（正弦曲线为数学采样 + Catmull-Rom 平滑路径，非手绘目测）：
`docs/design/app-icon/*.svg` 为唯一真源，修改后用 sharp（栅格化）+ png-to-ico（打包 ICO）重新产出上表文件。
