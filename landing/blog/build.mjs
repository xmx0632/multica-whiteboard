#!/usr/bin/env node
// ============================================================
// MulticaBoard 教学博客 · 静态生成器（零依赖，Node ≥ 18）
//
// 输入：blog/posts/*.md —— frontmatter + markdown 子集：
//   ---（frontmatter：title / description / date / tags / cover / author）
//   ## / ### 标题、段落、**粗体**、*斜体*、`行内代码`、``` 代码块、
//   - 无序列表、1. 有序列表、> 引用、--- 分隔线、[链接](url)、![题注](图片)
//   图片路径按「站点根相对」书写（如 assets/blog/xxx/fig1.png），
//   生成器按页面深度自动改写为正确的相对路径；http(s)/data: 原样保留。
//
// 输出（均不进入 git，由部署时构建，见 .gitignore 与 landing-pages.yml）：
//   blog/index.html           —— 列表页
//   blog/<slug>/index.html    —— 文章详情页（独立 URL / title / description /
//                                 canonical / og / JSON-LD BlogPosting）
//   blog/sitemap-urls.json    —— 博客全部 URL，供 sitemap 任务合并
//
// 用法：node blog/build.mjs（任意 cwd，路径基于本文件位置解析）
// ============================================================

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // …/landing/blog
const LANDING = dirname(HERE); // …/landing
const POSTS_DIR = join(HERE, "posts");

const SITE_URL = "https://multicaboard.com";
const SITE_NAME = "MulticaBoard 教学白板";
const BLOG_PATH = "/blog/";
const DEFAULT_OG = "assets/og.png";
const DEFAULT_AUTHOR = "MulticaBoard 团队";
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%232456A6'/%3E%3Cpath d='M10 36 C 20 12, 28 12, 34 32 S 48 54, 54 30' fill='none' stroke='%23EFEAD9' stroke-width='5' stroke-linecap='round'/%3E%3C/svg%3E";

/* ---------- 基础工具 ---------- */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 站点根相对路径 → 按页面深度（../ 或 ../../）改写；外部/锚点/data: 原样保留
function relAsset(src, prefix) {
  if (/^(https?:)?\/\//i.test(src) || /^(data:|mailto:|#)/i.test(src)) {
    return src;
  }
  return prefix + String(src).replace(/^\//, "");
}

function absUrl(path) {
  return `${SITE_URL}/${String(path).replace(/^\//, "")}`;
}

function readingMinutes(markdown) {
  const chars = markdown.replace(/\s/g, "").length;
  return Math.max(1, Math.round(chars / 450));
}

/* ---------- frontmatter ---------- */

function parsePost(file) {
  const raw = readFileSync(join(POSTS_DIR, file), "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    throw new Error(`[blog] ${file}: 缺少 frontmatter（需要以 --- 开始的元信息块）`);
  }
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    // 成对的英文引号按 YAML 惯例剥掉，不引入完整 YAML 解析
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^"(.*)"$/, "$1");
  }
  const slug = file.replace(/\.md$/i, "");
  for (const key of ["title", "description", "date"]) {
    if (!meta[key]) throw new Error(`[blog] ${file}: frontmatter 缺少必填字段 ${key}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
    throw new Error(`[blog] ${file}: date 需为 YYYY-MM-DD，当前为 "${meta.date}"`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(
      `[blog] ${file}: 文件名需为小写字母/数字/连字符（URL slug），当前 "${slug}"`,
    );
  }
  return {
    slug,
    title: meta.title,
    description: meta.description,
    date: meta.date,
    author: meta.author || DEFAULT_AUTHOR,
    cover: meta.cover || null,
    tags: (meta.tags || "")
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean),
    markdown: m[2].trim(),
  };
}

/* ---------- markdown 子集渲染（renderInline 内部先整体转义，调用方传原文） ---------- */

function renderInline(text, prefix) {
  // 先整体转义再套用规则（调用方一律传原文）
  const escaped = escapeHtml(text);
  // 单趟扫描：行内代码 / 图片 / 链接 / 粗体（左先匹配，互不嵌套）
  const out = escaped.replace(
    /`([^`]+)`|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*([^*]+)\*\*/g,
    (_m, code, alt, src, label, href, bold) => {
      if (code !== undefined) return `<code>${code}</code>`;
      if (src !== undefined)
        return `<img src="${relAsset(src, prefix)}" alt="${alt}" loading="lazy" />`;
      if (href !== undefined) {
        const external = /^https?:\/\//i.test(href);
        return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ""}>${label}</a>`;
      }
      return `<strong>${bold}</strong>`;
    },
  );
  // 斜体（粗体已消费完毕，避免 **x** 被误判）
  return out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
}

function renderMarkdown(md, prefix) {
  const lines = md.split(/\r?\n/);
  const html = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (!buf.length) return;
    const rendered = renderInline(buf.join("\n"), prefix);
    // 整段只有一张图 → figure + figcaption（alt 即题注）
    const fig = rendered.match(/^(<img [^>]*>)$/);
    if (fig) {
      const alt = rendered.match(/alt="([^"]*)"/);
      if (alt && alt[1]) {
        html.push(
          `<figure class="post-fig">${fig[1]}<figcaption>${alt[1]}</figcaption></figure>`,
        );
        return;
      }
    }
    html.push(`<p>${rendered}</p>`);
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // 围栏代码块
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++; // 跳过收尾 ```
      html.push(
        `<pre class="post-code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}><code>${code
          .map((l) => escapeHtml(l))
          .join("\n")}</code></pre>`,
      );
      continue;
    }

    // 标题（# 留给页面主标题：单个 # 容错也映射为 h2，## → h2、### → h3）
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(Math.max(h[1].length, 2), 4);
      html.push(`<h${level}>${renderInline(h[2], prefix)}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      html.push("<hr />");
      i++;
      continue;
    }

    // 引用块
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      html.push(
        `<blockquote><p>${renderInline(quote.join("\n"), prefix)}</p></blockquote>`,
      );
      continue;
    }

    // 无序列表
    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^[-*+]\s+/, ""), prefix)}</li>`);
        i++;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\d+[.、)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+[.、)]\s+/.test(lines[i])) {
        items.push(
          `<li>${renderInline(lines[i].replace(/^\d+[.、)]\s+/, ""), prefix)}</li>`,
        );
        i++;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // 段落：连续非空行（原文收集，renderInline 统一转义）
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|```|>|[-*+]\s|\d+[.、)]\s|-{3,}\s*$|\*{3,}\s*$)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    flushParagraph(para);
  }
  return html.join("\n");
}

/* ---------- 页面骨架（导航 / 页脚与官网一致，按深度改写相对链接） ---------- */

const BRAND_SVG =
  '<svg class="brand-glyph" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="var(--blue)"/><path d="M10 36 C 20 12, 28 12, 34 32 S 48 54, 54 30" fill="none" stroke="var(--chalk)" stroke-width="5" stroke-linecap="round"/></svg>';
const BRAND_SVG_FOOTER =
  '<svg class="brand-glyph" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="var(--chalk)"/><path d="M10 36 C 20 12, 28 12, 34 32 S 48 54, 54 30" fill="none" stroke="var(--board)" stroke-width="5" stroke-linecap="round"/></svg>';

function chromeNav(prefix, { onBlog }) {
  const blogHref = prefix ? `${prefix}blog/` : "index.html";
  return `  <header class="nav">
    <div class="nav-inner">
      <a class="brand" href="${prefix}index.html" aria-label="MulticaBoard 教学白板 首页">
        ${BRAND_SVG}
        <span class="brand-name" data-i18n="brand.name">MulticaBoard</span>
        <span class="brand-sub" data-i18n="brand.sub">教学白板</span>
      </a>
      <nav class="nav-links" aria-label="页面导航">
        <a href="${prefix}index.html#equation" data-i18n="nav.equation">方程出图</a>
        <a href="${prefix}index.html#whiteboard" data-i18n="nav.whiteboard">白板能力</a>
        <a href="${prefix}index.html#scenes" data-i18n="nav.scenes">使用场景</a>
        <a href="${prefix}index.html#gallery" data-i18n="nav.gallery">产品实拍</a>
        <a href="${blogHref}"${onBlog ? ' aria-current="page"' : ""} data-i18n="nav.blog">博客</a>
      </nav>
      <!-- APP_URL：主应用入口 -->
      <a class="btn btn-primary btn-sm" href="https://board.multicaboard.com" data-i18n="nav.cta">免费开始使用</a>
    </div>
  </header>`;
}

function chromeFooter(prefix, { onBlog }) {
  const blogHref = prefix ? `${prefix}blog/` : "index.html";
  return `  <footer class="footer">
    <div class="footer-inner">
      <a class="brand brand-footer" href="${prefix}index.html" aria-label="MulticaBoard">
        ${BRAND_SVG_FOOTER}
        <span class="brand-name">MulticaBoard</span>
      </a>
      <nav class="footer-links" aria-label="页脚导航">
        <!-- APP_URL：主应用入口 -->
        <a href="https://board.multicaboard.com" data-i18n="footer.app">打开白板</a>
        <a href="${prefix}index.html#equation" data-i18n="footer.feature">方程出图</a>
        <a href="${blogHref}"${onBlog ? ' aria-current="page"' : ""} data-i18n="footer.blog">教学博客</a>
        <!-- DOCS_URL：产品文档（飞书） -->
        <a href="https://acn88pi8oldt.feishu.cn/docx/MLQodLJeqoeUgfxvszBcB1FZnDc" target="_blank" rel="noopener" data-i18n="footer.docs">使用文档</a>
        <a href="${prefix}contact.html" data-i18n="footer.contact">联系我们</a>
        <a href="https://github.com/xmx0632/multica-whiteboard" data-i18n="footer.repo">源码仓库</a>
      </nav>
      <p class="footer-copy">© 2026 MulticaBoard</p>
    </div>
  </footer>`;
}

function pageShell({
  prefix,
  onBlog,
  title,
  description,
  keywords,
  canonical,
  ogType,
  ogImage,
  extraMeta = "",
  jsonLd,
  body,
}) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <!-- 由 blog/build.mjs 生成 —— 请勿手改；源文件见 blog/posts/*.md -->
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
${keywords ? `  <meta name="keywords" content="${escapeHtml(keywords)}" />\n` : ""}  <!-- SITE_URL：canonical / og 与官网同一套替换点 -->
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="MulticaBoard" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${absUrl(ogImage)}" />
  <meta property="og:locale" content="zh_CN" />
  <meta name="twitter:card" content="summary_large_image" />
${extraMeta}  <link rel="icon" href="${FAVICON}" />

  <link rel="stylesheet" href="${prefix}css/style.css" />
  <link rel="stylesheet" href="${prefix}css/blog.css" />

  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>
</head>
<body>
  <a class="skip-link" href="#main">跳到主要内容</a>

${chromeNav(prefix, { onBlog })}

  <main id="main">
${body}
  </main>

${chromeFooter(prefix, { onBlog })}
</body>
</html>
`;
}

/* ---------- 列表页 / 详情页 ---------- */

function tagChips(tags) {
  return tags.length
    ? `<div class="post-tags">${tags
        .map((t) => `<span class="post-tag">${escapeHtml(t)}</span>`)
        .join("")}</div>`
    : "";
}

function buildListPage(posts) {
  const cards = posts
    .map(
      (p) => `        <a class="post-card" href="${p.slug}/">
          <p class="post-card-date">${p.date}${p.tags.length ? ` · ${escapeHtml(p.tags[0])}` : ""}</p>
          <h2>${escapeHtml(p.title)}</h2>
          <p class="post-card-desc">${escapeHtml(p.description)}</p>
          ${tagChips(p.tags)}
          <span class="post-card-more">阅读全文 →</span>
        </a>`,
    )
    .join("\n");

  const body = `    <section class="section blog-index">
      <div class="section-head">
        <p class="section-eyebrow"><span class="sec-no" aria-hidden="true">✎</span><span>博客 · 教程与实战</span></p>
        <h1 class="blog-title">教学博客</h1>
        <p class="section-sub">函数图像教学、白板备课技巧与课堂实战——面向一线教师的原创教程，每篇都可在一块白板上照着做。</p>
      </div>
      <div class="post-list">
${cards}
      </div>
    </section>`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: `${SITE_NAME} 教学博客`,
    url: absUrl(BLOG_PATH),
    inLanguage: "zh-CN",
    description: "函数图像教学、白板备课技巧与课堂实战——面向一线教师的原创教程。",
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      description: p.description,
      datePublished: p.date,
      url: absUrl(`blog/${p.slug}/`),
    })),
  };

  return pageShell({
    prefix: "../",
    onBlog: true,
    title: `教学博客 | ${SITE_NAME}`,
    description:
      "函数图像教学、白板备课技巧与课堂实战——面向一线教师的原创教程，配 MulticaBoard 教学白板实操截图。",
    keywords: "教学白板,数学教学工具,函数图像绘制,在线白板,教师教程",
    canonical: absUrl(BLOG_PATH),
    ogType: "website",
    ogImage: DEFAULT_OG,
    jsonLd,
    body,
  });
}

function buildPostPage(post, newer, older) {
  const prefix = "../../"; // blog/<slug>/index.html
  const minutes = readingMinutes(post.markdown);
  const coverAbs = post.cover || DEFAULT_OG;

  const navCells = [];
  if (newer) {
    navCells.push(
      `<a class="post-nav-item post-nav-newer" href="../${newer.slug}/"><span>← 较新一篇</span><strong>${escapeHtml(newer.title)}</strong></a>`,
    );
  }
  if (older) {
    navCells.push(
      `<a class="post-nav-item post-nav-older" href="../${older.slug}/"><span>较旧一篇 →</span><strong>${escapeHtml(older.title)}</strong></a>`,
    );
  }

  const body = `    <article class="post">
      <header class="post-head">
        <p class="post-eyebrow"><span class="sec-no" aria-hidden="true">✎</span>博客 · ${post.date} · 约 ${minutes} 分钟</p>
        <h1 class="post-title">${escapeHtml(post.title)}</h1>
        <p class="post-meta">${escapeHtml(post.author)} · <a href="../index.html">返回博客</a></p>
        ${tagChips(post.tags)}
      </header>
${post.cover ? `      <figure class="post-cover"><img src="${relAsset(post.cover, prefix)}" alt="${escapeHtml(post.title)}" /></figure>\n` : ""}      <div class="prose">
${renderMarkdown(post.markdown, prefix)}
      </div>
${navCells.length ? `      <nav class="post-nav" aria-label="相邻文章">\n        ${navCells.join("\n        ")}\n      </nav>` : ""}
    </article>

    <section class="cta-board">
      <div class="cta-inner">
        <p class="cta-eyebrow">下一节课</p>
        <h2>在白板上试一试。</h2>
        <p class="cta-sub">打开浏览器，写下你今天要讲的第一个式子。</p>
        <!-- APP_URL：主应用入口 -->
        <a class="btn btn-chalk" href="https://board.multicaboard.com">打开白板</a>
      </div>
      <svg class="cta-curve" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 120 C 150 20, 300 20, 450 90 S 750 160, 900 70 S 1120 10, 1200 60" />
      </svg>
    </section>`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    image: absUrl(coverAbs),
    url: absUrl(`blog/${post.slug}/`),
    mainEntityOfPage: absUrl(`blog/${post.slug}/`),
    inLanguage: "zh-CN",
    keywords: post.tags.join(", "),
    author: { "@type": "Organization", name: post.author },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };

  return pageShell({
    prefix,
    onBlog: true,
    title: `${post.title} | ${SITE_NAME}`,
    description: post.description,
    keywords: [...post.tags, "教学白板", "数学教学工具"].filter(Boolean).join(","),
    canonical: absUrl(`blog/${post.slug}/`),
    ogType: "article",
    ogImage: coverAbs,
    extraMeta: `  <meta property="article:published_time" content="${post.date}" />\n`,
    jsonLd,
    body,
  });
}

/* ---------- 主流程 ---------- */

function main() {
  if (!existsSync(POSTS_DIR)) {
    console.error("[blog] 未找到 posts/ 目录，无事可做");
    process.exit(1);
  }
  const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md")).sort();
  if (!files.length) {
    console.error("[blog] posts/ 内没有 .md 文章");
    process.exit(1);
  }

  const posts = files.map(parsePost);
  // 日期倒序（新→旧），同日按 slug 稳定排序
  posts.sort((a, b) =>
    a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1,
  );

  // 1) 列表页
  writeFileSync(join(HERE, "index.html"), buildListPage(posts));

  // 2) 详情页 + 清理已删除文章的遗留目录
  const slugs = new Set(posts.map((p) => p.slug));
  for (const name of readdirSync(HERE, { withFileTypes: true })) {
    if (name.isDirectory() && name.name !== "posts" && !slugs.has(name.name)) {
      const dir = join(HERE, name.name);
      if (existsSync(join(dir, "index.html"))) {
        rmSync(dir, { recursive: true, force: true });
        console.log(`[blog] 移除失效文章目录：${name.name}/`);
      }
    }
  }
  posts.forEach((p, idx) => {
    const dir = join(HERE, p.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "index.html"),
      buildPostPage(p, posts[idx - 1] || null, posts[idx + 1] || null),
    );
  });

  // 3) sitemap URL 清单（供 sitemap 任务合并）
  writeFileSync(
    join(HERE, "sitemap-urls.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        urls: [
          { loc: absUrl(BLOG_PATH) },
          ...posts.map((p) => ({ loc: absUrl(`blog/${p.slug}/`), lastmod: p.date })),
        ],
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`[blog] 生成完毕：列表页 1 + 文章 ${posts.length} 篇`);
  for (const p of posts) console.log(`       ${p.date}  ${p.slug}/  ${p.title}`);
}

main();
