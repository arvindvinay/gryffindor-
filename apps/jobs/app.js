/* Job Radar — UI and data fetching. Matching lives in fit.js. */
(function () {
  "use strict";

  var STORE_KEY = "jobradar.v1";
  var PAGE = 25;

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    added: [],      // skills the user added by hand
    removed: [],    // auto-detected skills the user removed
    saved: {},      // id -> job (saved jobs survive reloads)
    jobs: null,     // fetched jobs (normalised)
    ranked: [],
    shown: PAGE
  };

  /* ---------- storage (best-effort) ---------- */
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!d) return;
      $("resume").value = d.resume || "";
      $("roles").value = d.roles || "";
      state.added = d.added || [];
      state.removed = d.removed || [];
      state.saved = d.saved || {};
    } catch (e) { /* storage unavailable */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        resume: $("resume").value,
        roles: $("roles").value,
        added: state.added,
        removed: state.removed,
        saved: state.saved
      }));
    } catch (e) { /* ignore */ }
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function safeUrl(u) {
    try {
      var url = new URL(u);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "#";
    } catch (e) { return "#"; }
  }

  function setStatus(msg, isError) {
    var el = $("status");
    el.textContent = msg || "";
    el.className = "small " + (isError ? "error" : "muted");
  }

  function ago(ms) {
    if (!ms) return "";
    var d = Math.floor((Date.now() - ms) / 86400000);
    if (d <= 0) return "today";
    if (d === 1) return "1 day ago";
    if (d < 30) return d + " days ago";
    var m = Math.floor(d / 30);
    return m + (m === 1 ? " month ago" : " months ago");
  }

  /* ---------- skills ---------- */
  function mySkills() {
    var auto = Fit.extractSkills($("resume").value).filter(function (s) { return state.removed.indexOf(s) === -1; });
    state.added.forEach(function (s) { if (auto.indexOf(s) === -1) auto.push(s); });
    return auto;
  }

  function renderSkills() {
    var skills = mySkills();
    var box = $("my-skills");
    if (!skills.length) {
      box.innerHTML = '<span class="small muted">No skills found yet. Paste your résumé above or add skills below.</span>';
      return;
    }
    box.innerHTML = skills.map(function (s) {
      return '<span class="chip skill">' + esc(s) +
        '<button type="button" data-skill="' + esc(s) + '" aria-label="Remove ' + esc(s) + '">×</button></span>';
    }).join("");
  }

  function removeSkill(s) {
    var i = state.added.indexOf(s);
    if (i !== -1) state.added.splice(i, 1);
    if (state.removed.indexOf(s) === -1) state.removed.push(s);
    save();
    renderSkills();
    if (state.jobs) rerank();
  }

  function addSkill() {
    var raw = $("skill-add").value.trim();
    if (!raw) return;
    // Map to a canonical skill name when we recognise it, otherwise keep what they typed.
    var canon = Object.keys(Fit.SKILLS).find(function (k) { return k.toLowerCase() === raw.toLowerCase(); }) ||
      Fit.extractSkills(raw)[0] || raw;
    var r = state.removed.indexOf(canon);
    if (r !== -1) state.removed.splice(r, 1);
    if (mySkills().indexOf(canon) === -1) state.added.push(canon);
    $("skill-add").value = "";
    save();
    renderSkills();
    if (state.jobs) rerank();
  }

  /* ---------- data ---------- */
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function fetchJobs() {
    var sources = [
      { name: "Arbeitnow", url: "https://www.arbeitnow.com/api/job-board-api?page=1", map: Fit.fromArbeitnow },
      { name: "Arbeitnow", url: "https://www.arbeitnow.com/api/job-board-api?page=2", map: Fit.fromArbeitnow },
      { name: "Remote OK", url: "https://remoteok.com/api", map: Fit.fromRemoteOK }
    ];
    return Promise.allSettled(sources.map(function (s) { return getJSON(s.url).then(s.map); })).then(function (res) {
      var jobs = [];
      var failed = [];
      res.forEach(function (r, i) {
        if (r.status === "fulfilled") jobs = jobs.concat(r.value);
        else if (failed.indexOf(sources[i].name) === -1) failed.push(sources[i].name);
      });
      if (!jobs.length) throw new Error("Couldn't reach any job board right now. Please try again in a minute.");
      return { jobs: Fit.dedupe(jobs), failed: failed };
    });
  }

  /* ---------- ranking & rendering ---------- */
  function opts() { return { roles: Fit.parseRoles($("roles").value) }; }

  function rerank() {
    state.ranked = Fit.rank(state.jobs, mySkills(), opts());
    state.shown = PAGE;
    renderGaps();
    renderResults();
  }

  function renderGaps() {
    var gaps = Fit.skillGaps(state.ranked, 8);
    $("gaps").hidden = !gaps.length;
    $("gap-list").innerHTML = gaps.map(function (g) {
      return '<span class="gap"><b>' + esc(g.skill) + "</b> · in " + g.jobs + (g.jobs === 1 ? " match" : " matches") + "</span>";
    }).join("");
  }

  function filtered() {
    var q = $("q").value.trim().toLowerCase();
    var min = Number($("min-score").value);
    var remoteOnly = $("remote-only").checked;
    var savedOnly = $("saved-only").checked;
    return state.ranked.filter(function (j) {
      if (savedOnly && !state.saved[j.id]) return false;
      if (remoteOnly && !j.remote) return false;
      if (min > 0 && (j.fit.score === null || j.fit.score < min)) return false;
      if (q) {
        var hay = (j.title + " " + j.company + " " + j.tags.join(" ") + " " + j.fit.jobSkills.join(" ")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function fitClass(s) { return s === null ? "" : s >= 75 ? "hi" : s >= 50 ? "mid" : "lo"; }

  function jobHtml(j) {
    var f = j.fit;
    var saved = !!state.saved[j.id];
    var showRemote = j.remote && !/remote/i.test(j.location || "");
    var meta = [j.company, j.location, showRemote ? "Remote" : "", j.salary, ago(j.postedAt), "via " + j.source]
      .filter(Boolean).map(esc).join(" · ");
    var tags = f.matched.map(function (s) { return '<span class="tag have" title="You have this">✓ ' + esc(s) + "</span>"; })
      .concat(f.missing.slice(0, 6).map(function (s) { return '<span class="tag need" title="Skill to learn">+ ' + esc(s) + "</span>"; }))
      .join("");
    var desc = j.description ? j.description.slice(0, 3000) + (j.description.length > 3000 ? "…" : "") : "";
    return '<article class="job">' +
      '<div class="fit ' + fitClass(f.score) + '" title="Fit score">' + (f.score === null ? "?" : f.score + "%") + "</div>" +
      "<div>" +
        '<h3><a href="' + esc(safeUrl(j.url)) + '" target="_blank" rel="noopener">' + esc(j.title) + "</a></h3>" +
        '<div class="meta">' + meta + "</div>" +
        (tags ? '<div class="tags">' + tags + "</div>" : '<div class="small muted">No recognisable skills in this post.</div>') +
        (desc ? "<details><summary>Description</summary><p>" + esc(desc) + "</p></details>" : "") +
        '<div class="job-actions"><a href="' + esc(safeUrl(j.url)) + '" target="_blank" rel="noopener">Apply ↗</a>' +
        '<button type="button" class="secondary" data-save="' + esc(j.id) + '">' + (saved ? "★ Saved" : "☆ Save") + "</button></div>" +
      "</div></article>";
  }

  function renderResults() {
    var list = filtered();
    $("results-card").hidden = false;
    $("count").textContent = list.length + " of " + state.ranked.length + " jobs match your filters" +
      (state.failed && state.failed.length ? " (couldn't load: " + state.failed.join(", ") + ")" : "") + ".";
    $("results").innerHTML = list.slice(0, state.shown).map(jobHtml).join("") ||
      '<p class="muted">No jobs match these filters. Try lowering the minimum fit or turning off “Remote only”.</p>';
    $("more").hidden = list.length <= state.shown;
  }

  function toggleSave(id) {
    if (state.saved[id]) {
      delete state.saved[id];
    } else {
      var j = state.ranked.find(function (x) { return x.id === id; });
      if (!j) return;
      var copy = Object.assign({}, j);
      delete copy.fit;
      copy.description = copy.description.slice(0, 3000);
      state.saved[id] = copy;
    }
    save();
    renderResults();
  }

  /* ---------- actions ---------- */
  var findSeq = 0;

  function find() {
    save();
    renderSkills();
    if (state.jobs) { rerank(); return; }
    var seq = ++findSeq;
    $("find").disabled = true;
    setStatus("Fetching the latest jobs…");
    fetchJobs().then(function (res) {
      if (seq !== findSeq) return;
      // Keep saved jobs visible even if they've dropped off the boards.
      var ids = {};
      res.jobs.forEach(function (j) { ids[j.id] = true; });
      Object.keys(state.saved).forEach(function (id) { if (!ids[id]) res.jobs.push(state.saved[id]); });
      state.jobs = res.jobs;
      state.failed = res.failed;
      rerank();
      setStatus("Loaded " + res.jobs.length + " jobs.");
    }).catch(function (e) {
      if (seq !== findSeq) return;
      setStatus(e.message, true);
    }).then(function () {
      $("find").disabled = false;
    });
  }

  function loadFile(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (file.size > 500000) { setStatus("That file is too large. Paste the text instead.", true); return; }
    file.text().then(function (t) {
      $("resume").value = t;
      save();
      renderSkills();
    });
    ev.target.value = "";
  }

  function init() {
    load();
    $("skill-list").innerHTML = Object.keys(Fit.SKILLS).map(function (s) { return '<option value="' + esc(s) + '">'; }).join("");
    renderSkills();

    var typing = null;
    $("resume").addEventListener("input", function () {
      clearTimeout(typing);
      typing = setTimeout(function () { save(); renderSkills(); }, 300);
    });
    $("roles").addEventListener("change", function () { save(); if (state.jobs) rerank(); });
    $("resume-file").addEventListener("change", loadFile);
    $("my-skills").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-skill]");
      if (b) removeSkill(b.getAttribute("data-skill"));
    });
    $("skill-add-btn").addEventListener("click", addSkill);
    $("skill-add").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); addSkill(); } });
    $("find").addEventListener("click", find);
    ["q", "min-score", "remote-only", "saved-only"].forEach(function (id) {
      $(id).addEventListener(id === "q" ? "input" : "change", function () { state.shown = PAGE; renderResults(); });
    });
    $("more").addEventListener("click", function () { state.shown += PAGE; renderResults(); });
    $("results").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-save]");
      if (b) toggleSave(b.getAttribute("data-save"));
    });
  }

  init();
})();
