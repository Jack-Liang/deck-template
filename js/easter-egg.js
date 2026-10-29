/*
 * 源码彩蛋 · 给翻源码的人
 * ----------------------
 * 这份幻灯片是纯静态的，没有构建、没有依赖，双击 index.html 就能看。
 * 所以这个文件也就老老实实地待在那儿：按 Shift + E 打开一扇小门，Esc 关上。
 * 门后面没有后门，也没有埋点，只有一句谢谢。
 *
 * 触发键选 Shift + E 是因为它跟引擎里已有的快捷键（方向键、o、f、b、?）
 * 都不冲突，演讲时误触的概率也最低。想把卡片内容换成自己的彩蛋，
 * 改下面的 CARD 字符串即可，样式在 css/custom.css 的「彩蛋」一节。
 */
(function () {
  "use strict";

  var TRIGGER = "e";
  var CLOSE_MS = 180; // 与 CSS 退场时长对齐（140ms + 余量），走完再 display:none

  var CARD = [
    '<p class="egg-eyebrow">源码彩蛋</p>',
    '<h2 class="egg-title">你翻到了源码。</h2>',
    '<p class="egg-lead">这套幻灯片没有构建步骤，改完刷新就能看；',
    "十分钟能讲完的题，值得花十分钟把它做漂亮。彩蛋也一样：</p>",
    '<pre class="egg-code"><code>',
    "  <span class=\"tok-com\">&lt;!-- 给翻源码的观众 --&gt;</span>",
    '  <span class="tok-key">&lt;section</span> <span class="tok-sub">class</span>=<span class="tok-str">"slide-content"</span><span class="tok-key">&gt;</span>',
    "    <span class=\"tok-key\">&lt;h2&gt;</span>你的下一场分享<span class=\"tok-key\">&lt;/h2&gt;</span>",
    '  <span class="tok-key">&lt;/section&gt;</span>',
    "</code></pre>",
    '<p class="egg-foot">按 <kbd>Esc</kbd> 关闭 · 提示埋在 index.html 开头的注释里</p>',
  ].join("\n");

  var overlay = null;
  var card = null;
  var lastFocus = null;
  var closeTimer = null;

  function build() {
    overlay = document.createElement("div");
    overlay.className = "egg";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "源码彩蛋");
    overlay.innerHTML = '<div class="egg-backdrop"></div>' +
      '<div class="egg-card" tabindex="-1">' + CARD + "</div>";

    document.body.appendChild(overlay);
    card = overlay.querySelector(".egg-card");

    // 点背景关门，点卡片不关
    overlay.addEventListener("click", function (event) {
      if (!card.contains(event.target)) close();
    });

    // 兜底：焦点在卡片里时，事件停在卡片上，deck.js 收不到
    card.addEventListener("keydown", function (event) {
      if (!isOpen()) return;
      event.stopPropagation();
    });
  }

  function open() {
    if (!overlay) build();
    // 半途反悔（关到一半又开）：撤销挂起的隐藏
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    lastFocus = document.activeElement;
    overlay.hidden = false;
    // 强刷一次布局，浏览器才认得出「从无到有」的过渡
    void overlay.offsetWidth;
    overlay.classList.add("is-open");
    card.focus();
  }

  function close() {
    if (!isOpen()) return;
    overlay.classList.remove("is-open");
    // 等退场动画走完再隐藏——门是慢慢合上的，不是闪没
    closeTimer = window.setTimeout(function () {
      closeTimer = null;
      overlay.hidden = true;
      if (lastFocus && lastFocus.focus && document.contains(lastFocus)) {
        lastFocus.focus();
      }
    }, CLOSE_MS);
  }

  function isOpen() {
    return !!overlay && !overlay.hidden && overlay.classList.contains("is-open");
  }

  document.addEventListener("keydown", function (event) {
    if (isOpen()) return;
    var key = (event.key || "").toLowerCase();
    // Shift + E 开门；带 Ctrl/Alt/⌘ 的组合让给浏览器
    if (key === TRIGGER && event.shiftKey &&
        !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      open();
    }
  }, true);

  /*
   * 拦截分两层，缺一不可：
   *   window 捕获阶段 —— 门开着时事件连 document 都到不了，deck.js 自然收不到，
   *     演讲时按方向键不会误翻页（只 stopPropagation 在 document 上是拦不住的：
   *     同一个节点上的冒泡监听照跑）
   *   卡片冒泡阶段 —— 焦点在卡片里时的兜底
   *
   * Ctrl/⌘/Alt 组合和 F 功能键放行——那是浏览器和系统的地盘；
   * 门只拦 deck.js 用得着的裸键（方向键、o/f/b/?、空格这些）。
   */
  window.addEventListener("keydown", function (event) {
    if (!isOpen()) return;
    var key = event.key || "";
    if (key.toLowerCase() === "escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || /^F\d{1,2}$/.test(key)) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // 给翻源码的人留个门把手：控制台里敲 egg() 也能开
  window.egg = function () {
    if (isOpen()) close();
    else open();
  };

  // 控制台里也道一声好——会开 devtools 的人，值得单独一句
  if (window.console && window.console.log) {
    window.console.log(
      "%cHello, deck%c  按住 Shift 敲 E，或在这里敲 egg()",
      "color:#f03c2e;font:700 13px/1.7 'Cascadia Mono',Consolas,monospace",
      "color:#7f98a7;font:12px/1.7 'Cascadia Mono',Consolas,monospace"
    );
  }
})();
