/*
  Presentation engine for this deck — no framework, no dependencies.

  Markup contract: .deck > .deck-slides > <section>. A <section> that contains
  further <section>s is a vertical stack; everything else is a single slide.
  This file adds the .deck-slide / .deck-stack classes, so index.html stays
  plain content.

  Handles: fit-to-viewport scaling, keyboard and touch navigation, #/n/v
  routing (1-based, matching the counter), overview, blanking, fullscreen,
  the portrait-phone hint, stepped code lines (pre[data-lines]), warming
  the next slide's images and the speaker view (?speaker / the s key).
*/
(function () {
  "use strict";

  var W = 1280; // design size — keep in sync with --slide-w / --slide-h
  var H = 720;
  var GAP = 70; // gap between slides in overview, in design pixels
  var OVERVIEW_ZOOM = 0.18; // overview scale, relative to the fit scale

  var deck = document.querySelector(".deck");
  var stage = deck && deck.querySelector(".deck-slides");
  if (!deck || !stage) return;

  /* ---------- model ----------------------------------------------------- */

  var grid = Array.prototype.filter
    .call(stage.children, function (el) {
      return el.tagName === "SECTION";
    })
    .map(function (column) {
      var inner = Array.prototype.filter.call(column.children, function (el) {
        return el.tagName === "SECTION";
      });
      if (!inner.length) {
        column.classList.add("deck-slide");
        return [column];
      }
      column.classList.add("deck-stack");
      inner.forEach(function (slide) {
        slide.classList.add("deck-slide");
      });
      return inner;
    });

  if (!grid.length) return;

  var flat = [];
  grid.forEach(function (column, h) {
    column.forEach(function (el, v) {
      flat.push({ el: el, h: h, v: v });
    });
  });

  var h = 0;
  var v = 0;
  var overview = false;
  var blanked = false;
  var ignoreHashChange = false;
  var animationTimer = null;

  /* ?speaker renders this same page as the presenter console (see the
     speaker-view section near the end). A query string survives writeHash,
     which rewrites the hash part on every slide change. */
  var SPEAKER = /[?&]speaker\b/.test(location.search);

  /* ---------- chrome ---------------------------------------------------- */

  var chrome = document.createElement("div");
  chrome.className = "deck-chrome";
  chrome.innerHTML =
    '<button class="deck-help-btn" type="button" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>' +
    '<span class="deck-counter"></span>';

  var progress = document.createElement("div");
  progress.className = "deck-progress";
  progress.innerHTML =
    '<span class="deck-progress-fill"></span>' +
    '<div class="deck-progress-commits" aria-hidden="true">' +
    flat
      .map(function (_, index) {
        var position = flat.length > 1 ? (index / (flat.length - 1)) * 100 : 100;
        return '<i style="--commit-position:' + position + '%"></i>';
      })
      .join("") +
    "</div>";

  var help = document.createElement("div");
  help.className = "deck-help";
  help.hidden = true;
  help.innerHTML =
    "<table><caption>Keyboard</caption><tbody>" +
    [
      ["&rarr; &nbsp; space", "next slide"],
      ["&larr;", "previous slide"],
      ["&darr; &nbsp; &uarr;", "within a vertical stack"],
      ["home &nbsp; end", "first / last slide"],
      ["o &nbsp; esc", "overview"],
      ["b &nbsp; .", "blank the screen"],
      ["f", "fullscreen"],
      ["s", "speaker view (toggle)"],
      ["?", "this help"],
    ]
      .map(function (row) {
        return (
          "<tr><td>" +
          row[0]
            .split(" &nbsp; ")
            .map(function (key) {
              return "<kbd>" + key + "</kbd>";
            })
            .join(" ") +
          "</td><td>" +
          row[1] +
          "</td></tr>"
        );
      })
      .join("") +
    "</tbody></table>";

  // The chrome rides in the stage's coordinate system — see deck.css — so both
  // elements go into a layer that is scaled the same way the slides are.
  var chromeLayer = document.createElement("div");
  chromeLayer.className = "deck-chrome-layer";
  chromeLayer.appendChild(chrome);
  chromeLayer.appendChild(progress);

  var rotate = document.createElement("div");
  rotate.className = "deck-rotate";
  rotate.innerHTML =
    "<div>" +
    '<svg viewBox="0 0 64 48" width="64" height="48" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10 24 A 22 22 0 0 1 54 24" />' +
    '<polyline points="48 18 54 24 60 18" />' +
    '<rect x="24" y="16" width="16" height="28" rx="3" />' +
    '<path d="M29 40 h6" />' +
    "</svg>" +
    "<p>Rotate your phone</p>" +
    "<small>The slides are 16:9 &mdash; portrait leaves them a third of the " +
    "screen tall. Tap to look anyway.</small>" +
    "</div>";

  deck.appendChild(chromeLayer);
  deck.appendChild(help);
  deck.appendChild(rotate);

  var counterEl = chrome.querySelector(".deck-counter");
  var progressEl = progress.querySelector(".deck-progress-fill");
  var progressCommitEls = progress.querySelectorAll(".deck-progress-commits i");

  /* ---------- helpers --------------------------------------------------- */

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function currentEl() {
    return grid[h][v];
  }

  function currentIndex() {
    for (var i = 0; i < flat.length; i++) {
      if (flat[i].h === h && flat[i].v === v) return i;
    }
    return 0;
  }

  function fragments(el) {
    return Array.prototype.slice.call(el.querySelectorAll(".fragment"));
  }

  function setFragments(el, visible) {
    fragments(el).forEach(function (fragment) {
      fragment.classList.toggle("is-visible", visible);
    });
  }

  /*
    Line-group fragments share a data-group number (from pre[data-lines]);
    a step reveals the whole group at once, not one line at a time. Regular
    fragments have no group and step alone.
  */
  function toggleGroup(all, target, visible) {
    var group = target.getAttribute("data-group");
    all.forEach(function (fragment) {
      if (fragment === target || (group && fragment.getAttribute("data-group") === group)) {
        fragment.classList.toggle("is-visible", visible);
      }
    });
  }

  function nextFragment() {
    var all = fragments(currentEl());
    var pending = all.filter(function (fragment) {
      return !fragment.classList.contains("is-visible");
    });
    if (!pending.length) return false;
    toggleGroup(all, pending[0], true);
    return true;
  }

  function previousFragment() {
    var all = fragments(currentEl());
    var shown = all.filter(function (fragment) {
      return fragment.classList.contains("is-visible");
    });
    if (!shown.length) return false;
    toggleGroup(all, shown[shown.length - 1], false);
    return true;
  }

  /* How many fragments of the current slide are visible, and set that count.
     The speaker windows exchange state as a plain number, which keeps the
     two windows' fragment progress in lockstep without shipping DOM. */
  function visibleFragmentCount() {
    return fragments(currentEl()).filter(function (fragment) {
      return fragment.classList.contains("is-visible");
    }).length;
  }

  function setFragmentCount(count) {
    fragments(currentEl()).forEach(function (fragment, index) {
      fragment.classList.toggle("is-visible", index < count);
    });
  }

  /*
    Warm the images of a slide that is about to be shown: decode() hands the
    browser the bitmap ahead of time, so a heavy GIF or screenshot paints
    instantly on first show instead of hiccuping.
    Each image is warmed once; after that the raster is in cache.
  */
  function warm(slide) {
    if (!slide) return;
    Array.prototype.forEach.call(slide.el.querySelectorAll("img"), function (img) {
      if (img.getAttribute("data-deck-warmed")) return;
      img.setAttribute("data-deck-warmed", "1");
      if (img.decode) img.decode().catch(function () {});
    });
  }

  /* ---------- rendering ------------------------------------------------- */

  function render(backwards) {
    flat.forEach(function (slide) {
      var present = slide.h === h && slide.v === v;
      slide.el.classList.toggle("is-present", present);
      if (present) setFragments(slide.el, !!backwards);
    });

    stage.style.setProperty("--pan-x", -(h * (W + GAP)) + "px");
    stage.style.setProperty("--pan-y", -(v * (H + GAP)) + "px");

    var index = currentIndex();
    deck.setAttribute(
      "data-slide-state",
      currentEl().getAttribute("data-state") || "content"
    );
    // The chrome is a sibling of the stage, so a slide that wants no counter
    // and no help button in its corners has to say so through the deck.
    deck.classList.toggle(
      "is-unlabelled",
      currentEl().hasAttribute("data-no-labels")
    );
    counterEl.textContent = index + 1 + " / " + flat.length;
    progressEl.style.width =
      (flat.length > 1 ? (index / (flat.length - 1)) * 100 : 100) + "%";
    Array.prototype.forEach.call(progressCommitEls, function (commit, commitIndex) {
      commit.classList.toggle("is-complete", commitIndex <= index);
      commit.classList.toggle("is-current", commitIndex === index);
    });

    warm(flat[index + 1]);

    if (SPEAKER) {
      updateSpeakerPanels();
      /* A remote-driven render must not echo back, or the two windows
         would ping-pong the same state forever. */
      if (!syncingRemote) notifyOpener();
    } else {
      broadcastState();
    }

    writeHash();
  }

  function go(nextH, nextV, backwards) {
    nextH = clamp(nextH, 0, grid.length - 1);
    nextV = clamp(nextV, 0, grid[nextH].length - 1);
    if (nextH === h && nextV === v) return;
    h = nextH;
    v = nextV;
    /*
      In overview, slide changes pan the whole grid — animate that pan with
      the same easing as the zoom in and out, instead of jumping instantly.
      The class times out on its own, so a resize outside overview still
      repositions without animating.
    */
    if (overview) {
      stage.classList.add("is-animating");
      clearTimeout(animationTimer);
      animationTimer = setTimeout(function () {
        stage.classList.remove("is-animating");
      }, 330);
    }
    render(backwards);
  }

  function next() {
    if (!overview && nextFragment()) return;
    if (v + 1 < grid[h].length) go(h, v + 1, false);
    else if (h + 1 < grid.length) go(h + 1, 0, false);
  }

  function previous() {
    if (!overview && previousFragment()) return;
    if (v > 0) go(h, v - 1, true);
    else if (h > 0) go(h - 1, grid[h - 1].length - 1, true);
  }

  /* ---------- scaling --------------------------------------------------- */

  function layout() {
    // The speaker bar claims the right of the window; the stage fits what's left.
    var availW = SPEAKER
      ? Math.max(360, window.innerWidth - SPEAKER_BAR)
      : window.innerWidth;
    var scale = Math.min(availW / W, window.innerHeight / H);
    // On the deck, not the stage: the chrome layer is a sibling of the stage
    // and needs to inherit the same scale.
    deck.style.setProperty("--scale", scale);
    deck.style.setProperty("--overview-scale", scale * OVERVIEW_ZOOM);
  }

  function setOverview(on) {
    if (on === overview) return;
    overview = on;
    stage.classList.add("is-animating");
    deck.classList.toggle("is-overview", on);
    clearTimeout(animationTimer);
    animationTimer = setTimeout(function () {
      stage.classList.remove("is-animating");
    }, 330);
  }

  function setBlank(on) {
    blanked = on;
    deck.classList.toggle("is-blank", on);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }

  /* ---------- routing --------------------------------------------------- */

  /*
    The URL uses 1-based slide numbers so it always matches the counter in
    the corner (#/8 is slide 8). Internally h and v stay 0-based.
  */
  function writeHash() {
    var target = "#/" + (h + 1) + (v ? "/" + (v + 1) : "");
    if (location.hash === target) return;
    ignoreHashChange = true;
    location.hash = target;
  }

  function readHash() {
    var match = /^#\/(\d+)(?:\/(\d+))?/.exec(location.hash);
    if (!match) return null;
    var nextH = clamp(parseInt(match[1], 10) - 1, 0, grid.length - 1);
    var nextV = clamp(
      (parseInt(match[2] || "1", 10) || 1) - 1,
      0,
      grid[nextH].length - 1
    );
    return { h: nextH, v: nextV };
  }

  window.addEventListener("hashchange", function () {
    if (ignoreHashChange) {
      ignoreHashChange = false;
      return;
    }
    var target = readHash();
    if (target) go(target.h, target.v, false);
  });

  /* ---------- input ----------------------------------------------------- */

  function handleKey(key, shift, repeat) {
    switch (key) {
      case "ArrowRight":
      case "PageDown":
      case "n":
        next();
        return true;
      case "ArrowLeft":
      case "PageUp":
      case "p":
        previous();
        return true;
      case " ":
        if (shift) previous();
        else next();
        return true;
      case "ArrowDown":
        if (overview || v + 1 < grid[h].length) go(h, v + 1, false);
        return true;
      case "ArrowUp":
        if (overview || v > 0) go(h, v - 1, true);
        return true;
      case "Home":
        go(0, 0, false);
        return true;
      case "End":
        go(grid.length - 1, grid[grid.length - 1].length - 1, false);
        return true;
      case "o":
      case "O":
        setOverview(!overview);
        return true;
      case "Escape":
        if (!help.hidden) help.hidden = true;
        else setOverview(!overview);
        return true;
      case "Enter":
        if (overview) setOverview(false);
        return true;
      case "b":
      case "B":
      case ".":
        setBlank(!blanked);
        return true;
      case "f":
      case "F":
        toggleFullscreen();
        return true;
      case "s":
      case "S":
        // The deck opens (or focuses) the console; closing is the sidebar
        // button's job, or s inside the speaker window itself. Ignore
        // hold-down auto-repeat.
        if (!repeat) {
          if (SPEAKER) window.close();
          else openSpeakerView();
        }
        return true;
      case "r":
      case "R":
        if (SPEAKER && !repeat) {
          resetTimerStart(Date.now());
          return true;
        }
        return false;
      case "?":
        help.hidden = !help.hidden;
        return true;
      default:
        return false;
    }
  }

  document.addEventListener("keydown", function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    var target = event.target;
    if (
      target &&
      (target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }
    if (handleKey(event.key, event.shiftKey, event.repeat)) event.preventDefault();
  });

  help.addEventListener("click", function () {
    help.hidden = true;
  });

  rotate.addEventListener("click", function () {
    rotate.hidden = true;
  });

  chrome.querySelector(".deck-help-btn").addEventListener("click", function () {
    help.hidden = !help.hidden;
  });

  stage.addEventListener("click", function (event) {
    if (!overview) return;
    var slide = event.target.closest(".deck-slide");
    if (!slide) return;
    for (var i = 0; i < flat.length; i++) {
      if (flat[i].el === slide) {
        go(flat[i].h, flat[i].v, false);
        break;
      }
    }
    setOverview(false);
  });

  var touch = null;

  deck.addEventListener(
    "touchstart",
    function (event) {
      if (event.touches.length !== 1) return;
      touch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    },
    { passive: true }
  );

  deck.addEventListener(
    "touchend",
    function (event) {
      if (!touch || !event.changedTouches.length) return;
      var dx = event.changedTouches[0].clientX - touch.x;
      var dy = event.changedTouches[0].clientY - touch.y;
      touch = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 60) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) next();
        else previous();
      } else if (dy < 0) {
        go(h, v + 1, false);
      } else {
        go(h, v - 1, true);
      }
    },
    { passive: true }
  );

  /*
    Wheel navigation. A mouse notch arrives as one big event, a trackpad flick
    as a long tail of small ones — so accumulate the delta and step once per
    gesture, then stay locked until the wheel has been quiet for a moment.
    Without the lock a single flick would run through half the deck.
  */
  var WHEEL_STEP = 40; // accumulated delta that counts as one step
  var WHEEL_QUIET = 120; // ms of silence that ends a gesture

  var wheelDelta = 0;
  var wheelTime = 0;
  var wheelLocked = false;
  var wheelStepAt = 0; // when a step last fired, for the overview cadence

  deck.addEventListener(
    "wheel",
    function (event) {
      var now = Date.now();
      if (now - wheelTime > WHEEL_QUIET) {
        wheelDelta = 0;
        wheelLocked = false;
      }
      wheelTime = now;

      // deltaMode 1 is lines, 2 is pages — normalise both to rough pixels.
      var dy = event.deltaY;
      if (event.deltaMode === 1) dy *= 16;
      else if (event.deltaMode === 2) dy *= H;

      if (wheelLocked) {
        /*
          In overview the 120ms-silence requirement swallows continuous
          scrolling whole: one step, then nothing until the wheel goes
          quiet — which a fast spin or a trackpad glide never does.
          Reopen the lock on a fixed cadence there (the pan runs 280ms,
          so ~1 step / 160ms keeps the grid readable), while slide mode
          keeps the original one-step-per-gesture feel.
        */
        if (overview && now - wheelStepAt >= 160) {
          wheelDelta = 0;
          wheelLocked = false;
        } else {
          return;
        }
      }

      // A change of direction starts a new count rather than cancelling out.
      if (wheelDelta && (wheelDelta > 0) !== (dy > 0)) wheelDelta = 0;
      wheelDelta += dy;
      if (Math.abs(wheelDelta) < WHEEL_STEP) return;

      if (wheelDelta > 0) next();
      else previous();
      wheelStepAt = now;
      wheelDelta = 0;
      wheelLocked = true;
    },
    { passive: true }
  );

  window.addEventListener("resize", layout);

  /* ---------- speaker view ----------------------------------------------- */

  /*
    ?speaker (the s key toggles this window) renders this same page as a
    presenter console: the deck squeezed into the left of the window, a bar
    on the right with the next slide, the notes and a timer. Both windows run
    the engine; whichever one navigates posts its state to the other, so keys
    work in either and the projector follows along.
  */
  var SPEAKER_BAR = 340; // keep in sync with --speaker-bar-w in deck.css
  var speakerWindow = null;
  var syncingRemote = false;
  var speakerRefs = null;

  /*
    The timer outlives the speaker window: its start anchor lives in
    localStorage, so closing and reopening the popup mid-talk does not reset
    the clock — only r (or the reset button) does. Anchors older than a day
    are leftovers from a previous talk and get discarded. localStorage can
    be unavailable (some file:// setups); then the timer simply runs from
    this page load, as it did before.
  */
  var TIMER_KEY = "deck-speaker-timer-start";
  var TIMER_STALE_MS = 24 * 60 * 60 * 1000;

  function readTimerStart() {
    try {
      var saved = +localStorage.getItem(TIMER_KEY);
      if (saved && Date.now() - saved < TIMER_STALE_MS) return saved;
    } catch (e) {}
    return Date.now();
  }

  function resetTimerStart(when) {
    timerStartAt = when;
    try {
      localStorage.setItem(TIMER_KEY, String(when));
    } catch (e) {}
  }

  var timerStartAt = readTimerStart();

  function syncPayload() {
    return { deckSync: true, h: h, v: v, frags: visibleFragmentCount() };
  }

  function broadcastState() {
    if (!speakerWindow || speakerWindow.closed) return;
    speakerWindow.postMessage(syncPayload(), "*");
  }

  function notifyOpener() {
    if (window.opener) window.opener.postMessage(syncPayload(), "*");
  }

  function openSpeakerView() {
    if (speakerWindow && !speakerWindow.closed) {
      speakerWindow.focus();
      return;
    }
    var url = location.href.split("#")[0];
    url += (url.indexOf("?") > -1 ? "&" : "?") + "speaker";
    speakerWindow = window.open(
      url + "#/" + (h + 1),
      "deck-speaker",
      "width=1120,height=740"
    );
    if (speakerWindow) broadcastState();
    else {
      /*
        Popup blocked (some in-app browsers do this by default). Say so,
        and point at the address that opens the console in a plain tab.
      */
      var hint = document.createElement("div");
      hint.className = "deck-toast";
      hint.textContent =
        "弹窗被浏览器拦下了——可直接新开标签页访问 index.html?speaker";
      deck.appendChild(hint);
      setTimeout(function () {
        hint.remove();
      }, 4000);
    }
  }

  /*
    The close button. A popup opened by window.open can close itself; a tab
    the user opened directly cannot (browser policy) — and popup blockers can
    stop the deck from opening the console at all. So "close" falls back to
    turning this very window back into the plain deck at the current slide.
  */
  function exitSpeakerView() {
    window.close();
    var url = location.href
      .split("#")[0]
      .replace(/([?&])speaker&?/, "$1")
      .replace(/[?&]$/, "");
    location.href = url + "#/" + (h + 1);
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || !data.deckSync) return;
    if (data.hello) {
      broadcastState(); // a freshly loaded speaker window asking for state
      return;
    }
    if (typeof data.h !== "number" || typeof data.v !== "number") return;
    if (data.h === h && data.v === v) {
      setFragmentCount(data.frags || 0);
      return;
    }
    syncingRemote = true;
    go(data.h, data.v, false);
    setFragmentCount(data.frags || 0);
    syncingRemote = false;
  });

  function buildSpeakerBar() {
    deck.classList.add("deck-speaker");
    var bar = document.createElement("aside");
    bar.className = "deck-speaker-bar";
    bar.innerHTML =
      '<div class="sp-head"><strong>演讲者视图</strong>' +
      '<span class="sp-head-right"><span class="sp-counter"></span>' +
      '<button class="sp-close" type="button" title="关闭演讲者视图（回到放映）">&times;</button></span></div>' +
      '<div class="sp-next"><span class="sp-label">下一页</span>' +
      '<div class="sp-next-frame"><div class="sp-next-stage"></div>' +
      '<div class="sp-next-empty" hidden>已是最后一页</div></div></div>' +
      '<div class="sp-notes"><span class="sp-label">备注</span>' +
      '<div class="sp-notes-body"></div></div>' +
      '<div class="sp-foot"><span class="sp-timer">00:00</span>' +
      '<button class="sp-reset" type="button">重置 (r)</button>' +
      '<span class="sp-clock"></span></div>';
    document.body.appendChild(bar);

    bar.querySelector(".sp-close").addEventListener("click", exitSpeakerView);

    speakerRefs = {
      counter: bar.querySelector(".sp-counter"),
      nextStage: bar.querySelector(".sp-next-stage"),
      nextEmpty: bar.querySelector(".sp-next-empty"),
      notes: bar.querySelector(".sp-notes-body"),
      timer: bar.querySelector(".sp-timer"),
      clock: bar.querySelector(".sp-clock"),
    };

    function tick() {
      var elapsed = Math.max(0, Math.floor((Date.now() - timerStartAt) / 1000));
      var minutes = Math.floor(elapsed / 60);
      speakerRefs.timer.textContent =
        minutes >= 60
          ? Math.floor(minutes / 60) +
            ":" +
            ("0" + (minutes % 60)).slice(-2) +
            ":" +
            ("0" + (elapsed % 60)).slice(-2)
          : ("0" + minutes).slice(-2) + ":" + ("0" + (elapsed % 60)).slice(-2);
      speakerRefs.clock.textContent = new Date().toTimeString().slice(0, 5);
    }
    tick();
    setInterval(tick, 500);

    bar.querySelector(".sp-reset").addEventListener("click", function () {
      resetTimerStart(Date.now());
      tick();
    });
  }

  /*
    Refresh the sidebar from the current position. The next-slide preview is a
    clone with every fragment lit, so the speaker sees what is coming in full,
    not the dimmed before-state.
  */
  function updateSpeakerPanels() {
    if (!SPEAKER || !speakerRefs) return;
    speakerRefs.counter.textContent = currentIndex() + 1 + " / " + flat.length;
    var next = flat[currentIndex() + 1];
    speakerRefs.nextStage.innerHTML = "";
    speakerRefs.nextEmpty.hidden = !!next;
    if (next) {
      var clone = next.el.cloneNode(true);
      clone.classList.add("is-present");
      Array.prototype.forEach.call(
        clone.querySelectorAll(".fragment"),
        function (fragment) {
          fragment.classList.add("is-visible");
        }
      );
      speakerRefs.nextStage.appendChild(clone);
    }
    var notes = currentEl().querySelector(".notes");
    speakerRefs.notes.innerHTML = notes
      ? notes.innerHTML
      : '<p class="sp-notes-empty">这页没写备注。在 index.html 的 section 里加 ' +
        '<code>&lt;aside class="notes"&gt;</code>，就会出现在这里。</p>';
  }

  /* ---------- stepped code lines ----------------------------------------- */

  /*
    pre[data-lines="1-2,3,7-10"] turns each listed range into one step: deck.js
    wraps those lines in .fragment spans after highlighting has run, so a step
    lights up on the same → press as any other fragment, in listed order.
    Splitting innerHTML on newlines is safe here because the highlighter's
    tokens never cross a line boundary — that must stay true in highlight.js.
  */
  function prepareLineSteps() {
    Array.prototype.forEach.call(
      document.querySelectorAll("pre[data-lines]"),
      function (pre) {
        var code = pre.querySelector("code");
        if (!code) return;
        var groups = {};
        pre
          .getAttribute("data-lines")
          .split(",")
          .forEach(function (part, order) {
            var match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part.trim());
            if (!match) return;
            for (var line = +match[1]; line <= +(match[2] || match[1]); line++) {
              groups[line] = order + 1;
            }
          });
        code.innerHTML = code.innerHTML
          .split("\n")
          .map(function (line, index) {
            var group = groups[index + 1];
            return group
              ? '<span class="fragment deck-line-group" data-group="' +
                  group +
                  '">' +
                  line +
                  "</span>"
              : line;
          })
          .join("\n");
      }
    );
  }

  /* ---------- start ----------------------------------------------------- */

  if (window.DeckHighlight) window.DeckHighlight.all(document);
  prepareLineSteps();

  flat.forEach(function (slide) {
    slide.el.style.setProperty("--ox", slide.h * (W + GAP) + "px");
    slide.el.style.setProperty("--oy", slide.v * (H + GAP) + "px");
  });

  var start = readHash();
  if (start) {
    h = start.h;
    v = start.v;
  }

  if (SPEAKER) {
    buildSpeakerBar();
    // Anchor the timer on this load unless a fresh one was restored, so a
    // closed-and-reopened popup keeps counting from the original start.
    resetTimerStart(timerStartAt);
    /* Ask the opening window for its state; opened directly (no opener),
       this window stands alone and drives itself. */
    if (window.opener) {
      window.opener.postMessage({ deckSync: true, hello: true }, "*");
    }
  }

  layout();
  render(false);
  deck.classList.add("is-ready");
})();
