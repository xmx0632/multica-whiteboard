# MulticaBoard 落地页（landing/）

教学白板产品官网单页。**纯静态、零构建、零依赖**——与主应用（Next.js）完全隔离，
不进入主应用的构建、路由与依赖树；可部署到任意静态托管。

## 目录结构

```
landing/
├── index.html      # 单页主体（语义化标签 + SEO/OG 元数据 + JSON-LD）
├── css/style.css   # 全部样式（坐标纸设计系统、响应式、reduced-motion）
├── js/main.js      # 方程出图演示（采样绘图 + 打字机）、滚动进场、i18n 脚手架
├── assets/         # og.png（分享图）与主应用实拍截图
└── README.md       # 本文件
```

## 本地预览

无需安装任何东西，任选其一：

```bash
# 方式一：Python
cd landing && python3 -m http.server 8080     # → http://localhost:8080

# 方式二：Node
cd landing && npx serve .                      # → http://localhost:3000
```

直接双击 `index.html` 用浏览器打开也能看（无服务端逻辑），但建议走本地静态服务，
更接近真实部署行为。

## 独立部署

`landing/` 目录本身即完整产物，**没有构建步骤**，把目录内容原样上传即可：

- **GitHub Pages（已配置，推荐）**：仓库自带 `.github/workflows/landing-pages.yml`，
  `main` 分支上 `landing/**` 有变更即自动发布。默认地址 https://xmx0632.github.io/multica-whiteboard/ ，
  已绑定自定义域名 **https://multicaboard.com/**（Cloudflare 托管 DNS；旧域名 b.readpodcast.top 已 301 跳转至此）。
  首次启用需做一次性设置：仓库 **Settings → Pages → Build and deployment → Source 选 "GitHub Actions"**，
  并在 Settings → Pages → Custom domain 填入 `multicaboard.com`；DNS 侧在 Cloudflare 加
  A 记录：根域 `@` → `185.199.108.153` / `185.199.109.153` / `185.199.110.153` / `185.199.111.153`，
  CNAME 记录：`www` → `xmx0632.github.io`（不带仓库名，建议先 DNS only 灰云，证书签发后再按需开代理）。
  注意：GitHub Free 账户 Pages 仅支持公开仓库；Actions 部署方式无需 CNAME 文件（官方文档明确会被忽略）。
- **Vercel / Netlify**：新建独立项目，Root Directory 指向 `landing/`（或把该目录作为独立仓库推送），Framework Preset 选 "Other / Static"。
- **Nginx / 任意虚拟主机**：`root` 指向 `landing/`，`try_files $uri $uri/ /index.html;`。

### 部署前需要确认的两处

1. **主应用入口链接**：搜索 `APP_URL` 注释（`index.html` 中共 5 处 `<a href="https://board.multicaboard.com">`），
   落地页启用独立域名后如需改指向，统一替换即可。
2. **SEO 规范地址**：搜索 `SITE_URL` 注释——canonical / og:url / og:image / JSON-LD url 四处
   当前指向自定义域名 multicaboard.com；换独立域名时统一替换（og:image 必须是绝对地址，SEO 深度优化见 ZOO-181）。

> 子路径说明：GitHub Pages 项目站点带 `/multica-whiteboard/` 前缀；页面内所有资源引用均为
> 相对路径（`css/…`、`js/…`、`assets/…`），子路径下直接可用，无需改 base。

## 与主应用的关系（零影响）

- 主应用的 `package.json`、`next.config.ts`、`src/` 均未因落地页改动；
- 落地页不 import 主应用任何代码，字体走系统字体栈，**无外部 CDN / 字体 / 图片请求**；
- 删除 `landing/` 目录不影响主应用构建与运行，反之亦然。

## i18n 预留

正文节点均带 `data-i18n="键名"` 属性（如 `hero.title`、`wb.f1t`）。控制台暴露：

```js
MulticaBoard.applyI18n({ 'hero.sub': 'An online whiteboard for teaching…' })
```

纯文本值走 `textContent`，含 `<` 的值视为富文本走 `innerHTML`。后续做多语言时，
把字典放到 `landing/i18n/*.json` 并在页面加载时调用一次即可，无需改结构。

## 截图素材说明

`assets/app-*.png` 截自当前版本主应用真实界面（白板主页与 `/mathplot-demo` 方程演示页），
`assets/og.png` 为 1200×630 分享图。均为本项目自产素材，无版权风险。
