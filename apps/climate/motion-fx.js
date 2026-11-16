/* SafeAir Daily — animations with Motion (assets/vendor/motion).
 * Progressive enhancement: app.js never calls this file. It watches the containers
 * app.js renders into and animates whatever appears. If Motion fails to load, or the
 * user prefers reduced motion, the CSS fallback animations (or none) are used instead. */
(function () {
  "use strict";

  var M = window.Motion;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!M || reduce) return;

  document.documentElement.classList.add("fx");

  var animate = M.animate;
  var stagger = M.stagger;
  // Gentle spring for things that arrive; quick ease for things that leave or respond.
  var ENTER = { type: "spring", stiffness: 260, damping: 26, mass: 0.9 };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- staggered entrance for rendered lists ---------- */
  function revealChildren(el, from) {
    var items = Array.prototype.filter.call(el.children, function (c) { return !c.hidden; });
    if (!items.length) return;
    animate(items, { opacity: [0, 1], y: [from || 14, 0], scale: [0.97, 1] },
      Object.assign({}, ENTER, { delay: stagger(0.045, { startDelay: 0.02 }) }));
  }

  // Lists app.js re-renders with innerHTML. Animate only when the set of items changes
  // (not on every 30-minute refresh of identical content) to keep motion meaningful.
  ["tiles", "tips", "advice", "week", "family", "diary-list"].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    var lastSig = "";
    new MutationObserver(function () {
      var sig = el.children.length + ":" + Array.prototype.map.call(el.children, function (c) {
        return c.className + (c.dataset.key || c.dataset.id || "");
      }).join("|");
      if (sig === lastSig) return;
      lastSig = sig;
      revealChildren(el);
    }).observe(el, { childList: true });
  });

  /* ---------- tile detail opens with a soft drop ---------- */
  var detail = $("tile-detail");
  if (detail) {
    new MutationObserver(function () {
      if (!detail.hidden) animate(detail, { opacity: [0, 1], y: [-8, 0] }, { duration: 0.25, ease: [0.22, 1, 0.36, 1] });
    }).observe(detail, { attributes: true, attributeFilter: ["hidden"], childList: true });
  }

  /* ---------- tab panels slide in from the side of the chosen tab ---------- */
  var order = ["today", "plan", "week", "diary", "family"];
  var current = null;
  order.forEach(function (name) {
    var panel = $("tab-" + name);
    if (!panel) return;
    if (!panel.hidden) current = name;
    new MutationObserver(function () {
      if (panel.hidden || current === name) return;
      var dir = current && order.indexOf(name) < order.indexOf(current) ? -1 : 1;
      current = name;
      animate(panel, { opacity: [0, 1], x: [dir * 24, 0] }, ENTER);
    }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  });

  /* ---------- hero: entrance, then a gentle pulse when the risk level changes ---------- */
  var hero = $("hero");
  if (hero) {
    animate(hero, { opacity: [0, 1], y: [18, 0], scale: [0.98, 1] }, Object.assign({}, ENTER, { delay: 0.05 }));
    var lastLvl = hero.className.match(/lvl-\w+/);
    lastLvl = lastLvl && lastLvl[0];
    new MutationObserver(function () {
      var lvl = hero.className.match(/lvl-\w+/);
      lvl = lvl && lvl[0];
      if (lvl === lastLvl) return;
      var first = lastLvl === "lvl-na";
      lastLvl = lvl;
      if (lvl === "lvl-na") return;
      animate(".hero-ring", { scale: first ? [0.85, 1] : [1, 1.06, 1] }, { type: "spring", stiffness: 300, damping: first ? 18 : 14 });
      animate(".hero-body > *", { opacity: [0, 1], y: [10, 0] }, Object.assign({}, ENTER, { delay: stagger(0.06) }));
    }).observe(hero, { attributes: true, attributeFilter: ["class"] });
  }

  /* ---------- the moving pill behind the selected tab ---------- */
  var tabs = document.querySelector(".tabs");
  if (tabs) {
    var ink = document.createElement("span");
    ink.className = "tab-ink";
    ink.setAttribute("aria-hidden", "true");
    tabs.insertBefore(ink, tabs.firstChild);
    var placed = false;
    function moveInk() {
      var sel = tabs.querySelector('[aria-selected="true"]');
      if (!sel) return;
      var target = { x: sel.offsetLeft, y: sel.offsetTop, width: sel.offsetWidth, height: sel.offsetHeight };
      if (!placed) {
        Object.assign(ink.style, { width: target.width + "px", height: target.height + "px",
          transform: "translate(" + target.x + "px," + target.y + "px)" });
        placed = true;
        return;
      }
      animate(ink, { x: target.x, y: target.y, width: target.width + "px", height: target.height + "px" },
        { type: "spring", stiffness: 420, damping: 34 });
    }
    new MutationObserver(moveInk).observe(tabs, { attributes: true, subtree: true, attributeFilter: ["aria-selected"] });
    window.addEventListener("resize", function () { placed = false; moveInk(); });
    requestAnimationFrame(moveInk);
  }

  /* ---------- tactile press feedback on buttons ---------- */
  if (M.press) {
    M.press(".tile, .fam, .btn, .pill-btn, .icon-btn, .chip, .feeling, .person-pill, .seg button, .tabs button", function (el) {
      animate(el, { scale: 0.96 }, { type: "spring", stiffness: 600, damping: 30 });
      return function () { animate(el, { scale: 1 }, { type: "spring", stiffness: 500, damping: 18 }); };
    });
  }

  /* ---------- sections below the fold fade up as they scroll in ---------- */
  if (M.inView) {
    M.inView(".section-title, .card, .foot", function (el) {
      animate(el, { opacity: [0, 1], y: [12, 0] }, ENTER);
    }, { margin: "0px 0px -8% 0px" });
  }
})();
