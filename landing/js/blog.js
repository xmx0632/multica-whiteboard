// ============================================================
// MulticaBoard 教学博客 · 交互增强（零依赖，渐进增强）
// · 列表页：分类筛选 chips（.blog-filter + .post-group）
// · 文章页：配图点击放大 lightbox（dialog：Esc/背景关闭、键盘可达）
// 两类页面内容均完全静态可读；本脚本缺失时只是少了交互。
// ============================================================
(function () {
  "use strict";

  /* ---------- 列表页：分类筛选 ---------- */

  var filter = document.querySelector(".blog-filter");
  if (filter) {
    filter.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-cat]");
      if (!btn) return;
      filter.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      var cat = btn.getAttribute("data-cat");
      document.querySelectorAll(".post-group").forEach(function (g) {
        g.hidden = cat !== "" && g.getAttribute("data-cat") !== cat;
      });
    });
  }

  /* ---------- 文章页：配图放大 ---------- */

  var dialog = null;

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "lightbox";
    var img = document.createElement("img");
    img.alt = "";
    dialog.appendChild(img);
    dialog.addEventListener("click", function (e) {
      // 点背景（非图片）即关闭；Esc 由 <dialog> 原生处理
      if (e.target === dialog) dialog.close();
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  function open(img) {
    var box = ensureDialog();
    box.querySelector("img").src = img.currentSrc || img.src;
    box.querySelector("img").alt = img.alt || "";
    box.showModal();
  }

  document.querySelectorAll(".post-fig img, .post-cover img").forEach(function (img) {
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.setAttribute("aria-label", "放大查看图片" + (img.alt ? "：" + img.alt : ""));
    img.addEventListener("click", function () {
      open(img);
    });
    img.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open(img);
      }
    });
  });
})();
