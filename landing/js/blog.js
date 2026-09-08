// ============================================================
// MulticaBoard 教学博客 · 文章配图点击放大（零依赖，渐进增强）
// 文章页内容完全静态可读，本脚本仅提供 lightbox 交互：
//   点击/回车图片 → <dialog> 原尺寸查看，Esc 或点击背景关闭，
//   关闭后焦点还给原图片。prefers-reduced-motion 下不做过渡。
// ============================================================
(function () {
  "use strict";

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
