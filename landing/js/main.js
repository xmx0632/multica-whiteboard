/* ============================================================
   MulticaBoard 教学白板 · 落地页脚本（零依赖）
   1) 方程出图演示：网格坐标系 + 曲线采样绘制 + 打字机效果
   2) 滚动进场
   3) i18n 脚手架：applyI18n(dict) 按 data-i18n 键注入文案
   ============================================================ */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- 小工具 ---------- */

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG_NS, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  /* 方程排版：变量斜体、函数名与数字正体 —— 贴近真实数学排版习惯 */
  var FN_WORDS = { sin: 1, cos: 1, tan: 1, log: 1, ln: 1 };

  function mathFragment(text) {
    var frag = document.createDocumentFragment();
    var tokens = text.match(/[A-Za-z]+|[0-9.]+|[^A-Za-z0-9.]+/g) || [];
    tokens.forEach(function (tk) {
      if (/^[A-Za-z]+$/.test(tk)) {
        if (FN_WORDS[tk]) {
          frag.appendChild(document.createTextNode(tk));
        } else {
          for (var i = 0; i < tk.length; i++) {
            var it = document.createElement('i');
            it.textContent = tk[i];
            frag.appendChild(it);
          }
        }
      } else {
        frag.appendChild(document.createTextNode(tk));
      }
    });
    return frag;
  }

  /* ---------- 坐标系绘图 ---------- */

  function Plot(svg, view, options) {
    this.svg = svg;
    this.view = view; // {xmin, xmax, ymin, ymax}
    this.opts = options || {};
    this.w = options.width || 560;
    this.h = options.height || 360;
    this.pad = 10;
    svg.setAttribute('viewBox', '0 0 ' + this.w + ' ' + this.h);
    this.svg.innerHTML = '';
  }

  Plot.prototype.px = function (x) {
    var v = this.view;
    return this.pad + ((x - v.xmin) / (v.xmax - v.xmin)) * (this.w - 2 * this.pad);
  };
  Plot.prototype.py = function (y) {
    var v = this.view;
    return this.h - this.pad - ((y - v.ymin) / (v.ymax - v.ymin)) * (this.h - 2 * this.pad);
  };

  Plot.prototype.grid = function (xticks, yticks) {
    var v = this.view;
    var g = el('g', {}, this.svg);

    function stepRange(min, max, step) {
      var out = [];
      for (var s = Math.ceil(min / step) * step; s <= max + 1e-9; s += step) out.push(s);
      return out;
    }

    /* 细格（0.5）与粗格（1） */
    stepRange(v.xmin, v.xmax, 0.5).forEach(function (x) {
      el('line', {
        x1: this.px(x), y1: this.py(v.ymin), x2: this.px(x), y2: this.py(v.ymax),
        class: Math.abs(x % 1) < 1e-9 ? 'plot-grid-major' : 'plot-grid-minor'
      }, g);
    }, this);
    stepRange(v.ymin, v.ymax, 0.5).forEach(function (y) {
      el('line', {
        x1: this.px(v.xmin), y1: this.py(y), x2: this.px(v.xmax), y2: this.py(y),
        class: Math.abs(y % 1) < 1e-9 ? 'plot-grid-major' : 'plot-grid-minor'
      }, g);
    }, this);

    /* 坐标轴（夹在可视范围内） */
    var ax = Math.min(Math.max(0, v.xmin), v.xmax);
    var ay = Math.min(Math.max(0, v.ymin), v.ymax);
    el('line', { x1: this.px(ax), y1: this.py(v.ymin), x2: this.px(ax), y2: this.py(v.ymax), class: 'plot-axis' }, g);
    el('line', { x1: this.px(v.xmin), y1: this.py(ay), x2: this.px(v.xmax), y2: this.py(ay), class: 'plot-axis' }, g);

    /* 刻度标注 */
    (xticks || []).forEach((t) => {
      var tx = el('text', { x: this.px(t.x) + 3, y: this.py(ay) + 14, class: 'plot-tick-label' }, g);
      tx.textContent = t.label;
    }, this);
    (yticks || []).forEach((t) => {
      var ty = el('text', { x: this.px(ax) + 6, y: this.py(t.y) - 4, class: 'plot-tick-label' }, g);
      ty.textContent = t.label;
    }, this);
    return g;
  };

  /* 采样生成曲线路径：fn 型自动在间断/出界处断笔 */
  Plot.prototype.curvePath = function (def) {
    var v = this.view;
    var segs = [];
    var cur = [];
    var n = def.samples || 240;

    function pushSeg() { if (cur.length > 1) segs.push(cur); cur = []; }

    if (def.type === 'param') {
      var t0 = def.t[0], t1 = def.t[1];
      for (var i = 0; i <= n; i++) {
        var t = t0 + ((t1 - t0) * i) / n;
        cur.push([def.xt(t), def.yt(t)]);
      }
      pushSeg();
    } else {
      var x0 = def.domain ? def.domain[0] : v.xmin;
      var x1 = def.domain ? def.domain[1] : v.xmax;
      var margin = (v.ymax - v.ymin) * 0.5;
      var prevY = null;
      for (var j = 0; j <= n; j++) {
        var x = x0 + ((x1 - x0) * j) / n;
        var y = def.fn(x);
        if (!isFinite(y) || y < v.ymin - margin || y > v.ymax + margin ||
            (prevY !== null && Math.abs(y - prevY) > (v.ymax - v.ymin))) {
          pushSeg();
        } else {
          cur.push([x, y]);
        }
        prevY = isFinite(y) ? y : null;
      }
      pushSeg();
    }

    return segs.map(function (seg) {
      return seg.map(function (p) { return this.px(p[0]).toFixed(1) + ',' + this.py(p[1]).toFixed(1); }, this).join(' L ');
    }, this).map(function (d) { return 'M ' + d; });
  };

  Plot.prototype.drawCurve = function (def, animate) {
    var paths = [];
    this.curvePath(def).forEach(function (d) {
      var p = el('path', { d: d, class: 'plot-curve plot-curve-' + def.color }, this.svg);
      paths.push(p);
    }, this);
    if (def.label && def.labelX !== undefined) {
      var label = el('text', {
        x: this.px(def.labelX), y: this.py(def.labelY), class: 'plot-label', 'text-anchor': def.labelAnchor || 'start'
      }, this.svg);
      label.appendChild(mathFragment(def.label));
    }
    if (animate && !reduceMotion) {
      paths.forEach(function (p, i) {
        var len = p.getTotalLength();
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
        p.animate(
          [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
          { duration: 900, delay: i * 120, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }
        ).onfinish = function () { p.style.strokeDashoffset = 0; };
      });
    }
    return paths;
  };

  /* ---------- 演示数据 ---------- */

  var PI = Math.PI;
  var TAU = 2 * PI;

  var DEMOS = {
    sin: {
      eq: 'y = sin(x)',
      color: 'blue',
      view: { xmin: -6.9, xmax: 6.9, ymin: -2.1, ymax: 2.1 },
      xticks: [
        { x: -TAU, label: '−2π' }, { x: -PI, label: '−π' },
        { x: PI, label: 'π' }, { x: TAU, label: '2π' }
      ],
      yticks: [{ y: 1, label: '1' }, { y: -1, label: '−1' }],
      fn: Math.sin
    },
    poly: {
      eq: 'y = x² − 2x − 3',
      color: 'red',
      view: { xmin: -3.4, xmax: 5.4, ymin: -4.6, ymax: 6.4 },
      xticks: [{ x: -1, label: '−1' }, { x: 1, label: '1' }, { x: 3, label: '3' }],
      yticks: [{ y: -3, label: '−3' }],
      fn: function (x) { return x * x - 2 * x - 3; }
    },
    circle: {
      eq: '(x − 1)² + (y − 2)² = 9',
      color: 'green',
      view: { xmin: -3.1, xmax: 5.1, ymin: -1.7, ymax: 5.7 },
      xticks: [{ x: -2, label: '−2' }, { x: 1, label: '1' }, { x: 4, label: '4' }],
      yticks: [{ y: 2, label: '2' }, { y: 5, label: '5' }],
      type: 'param', t: [0, TAU],
      xt: function (t) { return 1 + 3 * Math.cos(t); },
      yt: function (t) { return 2 + 3 * Math.sin(t); }
    },
    recip: {
      eq: 'y = 1 / x',
      color: 'blue',
      view: { xmin: -5.4, xmax: 5.4, ymin: -5.4, ymax: 5.4 },
      xticks: [{ x: -4, label: '−4' }, { x: 4, label: '4' }],
      yticks: [{ y: 4, label: '4' }, { y: -4, label: '−4' }],
      fn: function (x) { return 1 / x; },
      samples: 400
    }
  };

  var HERO_ORDER = ['sin', 'poly', 'circle', 'recip'];

  /* ---------- Hero：打字机 + 出图 + 自动轮播 ---------- */

  var heroTimer = null;
  var autoPlay = !reduceMotion;
  var currentDemo = null;

  function typeEquation(container, text, done) {
    container.innerHTML = '';
    var caretDone = done || function () {};
    if (reduceMotion) {
      container.appendChild(mathFragment(text));
      caretDone();
      return;
    }
    /* 逐字符展示已排版的方程 */
    var full = mathFragment(text);
    var chars = [];
    full.childNodes.forEach(function (node) {
      if (node.nodeType === 3) {
        node.textContent.split('').forEach(function (c) { chars.push(document.createTextNode(c)); });
      } else {
        node.textContent.split('').forEach(function (c) {
          var wrap = node.cloneNode(false);
          wrap.textContent = c;
          chars.push(wrap);
        });
      }
    });
    var i = 0;
    (function step() {
      if (i < chars.length) {
        container.appendChild(chars[i++]);
        heroTimer = setTimeout(step, 52);
      } else {
        caretDone();
      }
    })();
  }

  function playDemo(key) {
    var def = DEMOS[key];
    if (!def || currentDemo === key) { if (def) return; }
    currentDemo = key;

    var svg = document.getElementById('heroPlot');
    var eq = document.getElementById('heroEq');
    var chips = document.querySelectorAll('#heroChips .chip');
    chips.forEach(function (c) { c.classList.toggle('is-active', c.dataset.demo === key); });

    var plot = new Plot(svg, def.view, { width: 560, height: 340 });
    plot.grid(def.xticks, def.yticks);
    eq.innerHTML = '';

    var delay = reduceMotion ? 0 : 600;
    heroTimer = setTimeout(function () {
      typeEquation(eq, def.eq, function () {
        heroTimer = setTimeout(function () {
          plot.drawCurve(def, true);
          if (autoPlay) {
            heroTimer = setTimeout(function () {
              var next = HERO_ORDER[(HERO_ORDER.indexOf(key) + 1) % HERO_ORDER.length];
              playDemo(next);
            }, 3800);
          }
        }, reduceMotion ? 0 : 260);
      });
    }, delay);
  }

  /* ---------- §1 多曲线共存展示 ---------- */

  function buildShowcase() {
    var svg = document.getElementById('showPlot');
    if (!svg) return;
    var view = { xmin: -7.3, xmax: 7.5, ymin: -5.2, ymax: 7.2 };
    var plot = new Plot(svg, view, { width: 760, height: 470 });
    plot.grid(
      [{ x: -6, label: '−6' }, { x: -2, label: '−2' }, { x: 2, label: '2' }, { x: 6, label: '6' }],
      [{ y: -4, label: '−4' }, { y: 4, label: '4' }]
    );

    var curves = [
      { def: DEMOS.sin, labelX: 4.4, labelY: 1.35 },
      { def: DEMOS.poly, labelX: 4.35, labelY: 6.3 },
      { def: { type: 'param', t: [0, TAU], color: 'green', samples: 200,
          xt: DEMOS.circle.xt, yt: DEMOS.circle.yt }, labelX: -3.0, labelY: 6.3 }
    ];
    curves.forEach(function (c, i) {
      var def = Object.assign({}, c.def, { labelX: c.labelX, labelY: c.labelY, label: c.def.eq });
      setTimeout(function () { plot.drawCurve(def, true); }, reduceMotion ? 0 : 350 + i * 450);
    });

    /* 输入行里的三条方程（静态排版） */
    [['showEq1', DEMOS.sin.eq, 'blue'], ['showEq2', DEMOS.poly.eq, 'red'], ['showEq3', '(x − 1)² + (y − 2)² = 9', 'green']]
      .forEach(function (row) {
        var node = document.getElementById(row[0]);
        if (node) node.appendChild(mathFragment(row[1]));
      });
  }

  /* ---------- H1 手绘下划线 ---------- */

  function drawSwoosh() {
    var path = document.querySelector('.underline-swoosh path');
    if (!path || reduceMotion) return;
    var len = path.getTotalLength();
    path.style.strokeDasharray = len;
    path.style.strokeDashoffset = len;
    requestAnimationFrame(function () {
      path.animate(
        [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
        { duration: 800, delay: 500, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }
      ).onfinish = function () { path.style.strokeDashoffset = 0; };
    });
  }

  /* ---------- 滚动进场 ---------- */

  function setupReveal() {
    var nodes = document.querySelectorAll('.reveal');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ---------- 交互绑定 ---------- */

  function bindChips() {
    var chips = document.querySelectorAll('#heroChips .chip');
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        autoPlay = false;                 /* 用户接管后停止轮播 */
        clearTimeout(heroTimer);
        currentDemo = null;
        playDemo(c.dataset.demo);
      });
    });
  }

  /* ---------- i18n 脚手架（预留） ----------
     用法：MulticaBoard.applyI18n({ 'hero.sub': 'English...' })
     值为纯文本走 textContent，含 '<' 视为富文本走 innerHTML。 */
  function applyI18n(dict) {
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      var v = dict[node.dataset.i18n];
      if (v == null) return;
      if (v.indexOf('<') >= 0) node.innerHTML = v;
      else node.textContent = v;
    });
  }
  window.MulticaBoard = { applyI18n: applyI18n };

  /* ---------- 启动 ---------- */

  function init() {
    setupReveal();
    drawSwoosh();
    buildShowcase();
    bindChips();
    playDemo('sin');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
