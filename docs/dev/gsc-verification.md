# Google Search Console 验证与提交操作手册（ZOO-423）

> 面向：项目所有者（域名 multicaboard.com 的 Cloudflare / GitHub 账号持有人）
> 目的：完成 GSC 所有权验证 → 提交 sitemap → 建立每周索引监控，为 AdSense 重新申请提供数据依据。
> 现状（2026-09-09）：`https://multicaboard.com/sitemap.xml` 与 `/robots.txt` 已随 ZOO-423 部署上线，等待所有者完成下面的验证与提交。

---

## 为什么必须所有者本人操作

GSC 的验证 token（DNS TXT 记录值 / HTML 验证文件名）由 Google **按发起验证的账号**即时生成，
且 DNS 控制台（Cloudflare）与仓库 main 分支均为所有者权限。开发/代理账号既拿不到 token，也无权改 DNS。
这一步没有任何可以绕过人工的方式，预计耗时 5–10 分钟。

## 第一步：验证所有权（二选一，推荐方式 A）

### 方式 A（推荐）：网域属性 + DNS TXT 记录

一次验证覆盖 `multicaboard.com` 及**全部子域**（含 `board.multicaboard.com`），且与代码部署解耦，换托管不受影响。

1. 打开 [Google Search Console](https://search.google.com/search-console)，用所有者 Google 账号登录；
2. 「添加资源」→ 选 **「网域」(Domain)** → 输入 `multicaboard.com` → 继续；
3. Google 显示一条 TXT 记录，格式形如：
   ```
   google-site-verification=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```
   （X 部分 = 随机 token，以页面实际显示为准）复制完整一行；
4. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → 选择 `multicaboard.com` 域 → **DNS → 记录 → 添加记录**：

   | 项 | 值 |
   |---|---|
   | 类型 | `TXT` |
   | 名称 | `@`（根域） |
   | 内容 | 粘贴第 3 步复制的完整 `google-site-verification=...` |
   | TTL | Auto |

5. 保存后回到 GSC 点 **「验证」**。DNS 生效通常几分钟内，最长可能需等 48 小时后重试点验证。

> 注意：该域名 DNS 里已存在的 TXT 记录（如域名所有权/邮箱 SPF）不要动，**新增一条**即可。

### 方式 B（备选）：URL 前缀属性 + HTML 验证文件

只覆盖 `https://multicaboard.com` 单个前缀，且验证文件进入仓库（适合不想动 DNS 的情况）。

1. GSC → 「添加资源」→ 选 **「网址前缀」(URL prefix)** → 输入 `https://multicaboard.com`；
2. 验证方式列表选 **「HTML 标记」** 展开，会看到形如下面的元标记：
   ```html
   <meta name="google-site-verification" content="XXXXXXXXXXXXXXXXXXXXXXXX" />
   ```
   其中的 `XXXX` 即 token，对应的验证文件为 `googleXXXX.html`（GSC 部分入口提供直接下载）；
3. 在仓库 `landing/` 根目录新建该文件（文件名 = `google` + token + `.html`），内容一行：
   ```
   google-site-verification: googleXXXX
   ```
4. 提交合并部署后，确认 `https://multicaboard.com/googleXXXX.html` 返回 200 且内容如上；
5. 回 GSC 点「验证」。

## 第二步：提交 sitemap

验证通过后（任一方式）：

1. GSC 左侧菜单 → **「站点地图」(Sitemaps)**；
2. 输入框填 `sitemap.xml`（前缀已带 `https://multicaboard.com/`）→ 「提交」；
3. 预期：状态「成功」，**已发现的网址 = 2**（当前收录 `/` 与 `/contact`）。9 月 12 日合规页上线后为 5+，9 月 15 日 blog 上线后持续增长。

## 第三步：每周索引监控与 AdSense 重提门槛

每周一次（建议固定周几，5 分钟）：

1. GSC → 「索引」→ **「页面」(Pages)**，记录「已编入索引」页数；
   （或「站点地图」页看「已发现的网址」，两者口径接近，前者为准）
2. 把数字回贴到 ZOO-423 评论区（格式：日期 + 已索引 N 页 + 已发现 M 页）；
3. **重提门槛**：当已编入索引 ≥ **15–20 页** 时，在 ZOO-423 评论区报告索引数据，
   由项目经理（ZOO-416）确认后才能触发 AdSense 重新申请——过早重提会再次被拒。

页面供给节奏（索引增长来源）：

| 时间 | 上线内容 | sitemap 预计页数 |
|---|---|---|
| 09-12 | /privacy /terms /about（ZOO-418/419/420） | 5 |
| 09-15 | /blog 板块（ZOO-422） | 6 + 文章数 |
| 9 月下旬起 | 博客文章持续发布 | 逐步逼近 15–20 门槛 |

## 常见问题

- **提交 sitemap 后「已发现」长时间为 0/不动**：新站正常，Google 抓取节奏以天计；确保
  `https://multicaboard.com/robots.txt` 里 `Sitemap:` 行存在（已部署），并保持外链活跃。
- **索引数远小于发现数**：查看「页面」报告里「已抓取–尚未编入索引」的原因分布（多为内容单薄/重复），
  博客文章质量是主要变量。
- **主应用 board.multicaboard.com**：若采用方式 A（网域属性），子域自动纳入同一 GSC 资源，
  无需单独验证；主应用自有 sitemap（`https://board.multicaboard.com/sitemap.xml`，ZOO-181）可在
  GSC 同一资源下补充提交。

---

*维护：索引数据回贴 ZOO-423；AdSense 重提决策归 ZOO-416。文档随页面结构变化同步更新（docs/README.md 索引）。*
