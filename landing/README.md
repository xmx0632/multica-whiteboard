# MulticaBoard 落地页（landing/）

教学白板产品官网（首页 + 联系/隐私/条款/关于/教学博客等多页）。**纯静态、零构建、零依赖**——与主应用（Next.js）完全隔离，
不进入主应用的构建、路由与依赖树；可部署到任意静态托管。

## 目录结构

```
landing/
├── index.html      # 单页主体（语义化标签 + SEO/OG 元数据 + JSON-LD）
├── contact.html    # 联系我们页（/contact，邮箱明文 + mailto，无脚本）
├── privacy.html    # 隐私政策页（/privacy，法务长文版式，无脚本）
├── terms.html      # 服务条款页（/terms，法务长文版式，无脚本）
├── sitemap.xml     # 站点地图（ZOO-423，只收录已上线页面，见下方「SEO 基础设施」）
├── robots.txt      # 全站允许抓取 + Sitemap 引用（ZOO-423）
├── css/style.css   # 全部样式（坐标纸设计系统、响应式、reduced-motion）
├── css/blog.css    # /blog 博客排版（文章卡片、正文、代码块、图片题注）
├── js/main.js      # 方程出图演示（采样绘图 + 打字机）、滚动进场、i18n 脚手架
├── blog/           # 教学博客（ZOO-422）：posts/*.md 投稿 + build.mjs 静态生成
├── assets/         # og.png（分享图）与主应用实拍截图（博客配图放 assets/blog/）
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

## SEO 基础设施（sitemap / robots / GSC，ZOO-423）

- **`sitemap.xml`**：只收录**已上线**的页面，当前为 `/`、`/contact`、`/privacy`、`/terms`、`/about`、`/blog/` 及文章页。
  **新页面合并上线时，必须同步把 `<url>` 条目追加进该文件**
  （文件头注释里有维护规则），避免搜索引擎抓到 404。GSC 提交过一次后无需重复提交，Google 会自动重抓。
  博客文章页的 URL 清单可直接取构建产物 `blog/sitemap-urls.json`。
- **`robots.txt`**：全站允许抓取 + `Sitemap: https://multicaboard.com/sitemap.xml` 引用。
  源站提供本文件后，Cloudflare 不再用默认 content-signals 文本兜底（若仍在其前追加注释块属正常，不影响解析）。
- **Google Search Console 验证**：需所有者人工操作（DNS TXT 或 HTML 验证文件），
  完整步骤与记录值格式见 [`docs/dev/gsc-verification.md`](../docs/dev/gsc-verification.md)。
  HTML 文件方式无需改任何代码——把 `google<token>.html` 放进本目录部署即可。
- **重提门槛监控**：GSC 已编入索引页数 ≥ 15–20 时在 ZOO-423 评论报告，项目经理确认后才重提 AdSense。

## 教学博客 /blog（ZOO-422）

多页面静态生成：**投稿只写 markdown，不碰任何 HTML**。部署时 CI 会执行
`node blog/build.mjs`（零依赖，仅 Node 内置模块），从 `blog/posts/*.md` 生成：

- `blog/index.html` —— 列表页 `https://multicaboard.com/blog/`
- `blog/<slug>/index.html` —— 每篇文章独立 URL，自动带上各自的
  title / description / keywords / canonical / og / article 元数据与
  JSON-LD `BlogPosting` 结构化数据
- `blog/sitemap-urls.json` —— 博客全部 URL 清单，供 sitemap 任务合并
- 列表页按 `category` 分组展示，顶部分类筛选 chips（渐进增强）

生成产物不进 git（见根 `.gitignore`）；本地预览先跑一次 `node blog/build.mjs`
再起静态服务即可。

### 投稿规范（内容运营直接照此执行）

1. 在 `blog/posts/` 新建 `<slug>.md`，**文件名即 URL**（小写字母/数字/连字符，
   如 `sin-graph-teaching.md` → `/blog/sin-graph-teaching/`）；
2. 文件头是 frontmatter（title / description / date 三项必填）：

   ```
   ---
   title: "用教学白板画 y=sin(x)：把三角函数图像变换讲成看得见的一节课"
   description: "50-160 字，进 meta description 与 og:description"
   date: 2026-09-09
   category: 函数图像教学
   tags: [教学白板, 三角函数, 函数图像绘制]
   cover: assets/blog/<slug>/board-sin-plot.png
   ogimage: assets/blog/<slug>/og.png
   summary: 列表卡片与文章导语用的摘要（可长于 description；缺省回落 description）
   author: MulticaBoard 团队
   ---

   正文从这里开始（## 二级标题起，# 留给文章主标题）……
   ```

   - `category` 枚举：**函数图像教学 / 白板使用教程 / 工具选型**（列表页按此
     分组并支持筛选，未列值自动追加分组）
   - `tags` 逗号或 YAML 数组写法均可
   - `ogimage`：1200×630 分享图（缺省回落 cover → 站点 og.png）；封面截图
     建议 1200×786，og 版由封面中心裁切 1200×630（`sips -c 630 1200`）
   - 文内以「【待补：…】」开头的段落是**作者生产备注，构建时自动剔除**，
     不会出现在发布页面
   - 完整示例见 `posts/sin-function-graph-teaching.md`

3. 配图放 `assets/blog/<slug>/`，正文里按**站点根相对路径**引用
   （`![题注会显示在图下方](assets/blog/<slug>/fig1.png)`）；整段单图自动
   转成带题注的 figure，**PNG/JPEG 的宽高会被生成器自动读出**写进
   `width`/`height`（防 CLS），并支持点击放大；截图用
   board.multicaboard.com 实操截取；
4. 正文支持 markdown 子集：`## / ###` 标题、段落、**粗体**、*斜体*、
   `` `行内代码` ``、``` 围栏代码块、无序/有序列表、`>` 引用、`---` 分隔线、
   `[链接](url)` 与 `![题注](图片)`；
5. 本地验证：`cd landing && node blog/build.mjs`，再按上方方式起静态服务预览；
6. 提交 `posts/<slug>.md`（连同 `assets/blog/<slug>/` 配图）推送即可，
   合并到 `main` 后由 CI 自动生成并发布；**文章上线时记得同步把 URL 追加进
   `sitemap.xml`**（可直接取 `blog/sitemap-urls.json` 清单）。

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
