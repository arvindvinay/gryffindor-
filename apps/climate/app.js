/* SafeAir Daily — UI, data fetching and storage. Scoring lives in risk.js. */
(function () {
  "use strict";

  var STORE_KEY = "safeair.v2";
  var OLD_KEY = "safeair.v1";
  var REFRESH_MS = 30 * 60 * 1000;
  var RING_C = 2 * Math.PI * 52;
  var MINI_C = 2 * Math.PI * 24;

  var $ = function (id) { return document.getElementById(id); };

  /* ======================= state & storage ======================= */

  var store = {
    people: [],            // [{ id, name, place:{name,admin1,country,lat,lon}, profiles:[], limits:{aqi,feelsLike} }]
    activeId: null,
    settings: { units: "c", theme: "system" },
    diary: [],             // [{ id, personId, date, feeling, symptoms:[], note, aqi, feelsLike, place }]
    activity: "walk",
    metric: "risk",
    tab: "today"
  };
  var cache = {};          // personId -> { data, at }  (kept in memory + storage for instant start)
  var notified = {};

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        Object.keys(store).forEach(function (k) { if (d[k] !== undefined) store[k] = d[k]; });
        cache = d.cache || {};
        return;
      }
      migrateV1();
    } catch (e) { /* storage unavailable: app still works for this visit */ }
  }

  function migrateV1() {
    var old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
    if (!old) return;
    var list = [];
    if (old.last && old.last.place) list.push(old.last);
    (old.family || []).forEach(function (f) { list.push(f); });
    var seen = {};
    list.forEach(function (f) {
      var key = (f.person || "") + "|" + f.place.lat + "|" + f.place.lon;
      if (seen[key]) return;
      seen[key] = true;
      store.people.push({
        id: uid(), name: f.person || f.place.name, place: f.place,
        profiles: f.profiles || [], limits: f.limits || {}
      });
    });
    if (store.people.length) store.activeId = store.people[0].id;
    save();
  }

  function save() {
    try {
      var slim = {};
      Object.keys(cache).forEach(function (id) { if (personById(id)) slim[id] = cache[id]; });
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign({}, store, { cache: slim })));
    } catch (e) { /* ignore quota / private mode */ }
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function personById(id) { return store.people.filter(function (p) { return p.id === id; })[0] || null; }
  function active() { return personById(store.activeId) || store.people[0] || null; }

  /* ======================= helpers ======================= */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function numOrNull(v) { if (v === "" || v == null) return null; var n = Number(v); return isFinite(n) ? n : null; }

  function cToUnit(c) { return store.settings.units === "f" ? c * 9 / 5 + 32 : c; }
  function unitToC(v) { return store.settings.units === "f" ? (v - 32) * 5 / 9 : v; }
  function unitLabel() { return store.settings.units === "f" ? "°F" : "°C"; }
  function fmtT(c) { return isNum(c) ? Math.round(cToUnit(c)) + "°" : "—"; }
  function fmtN(v, d) { return isNum(v) ? v.toFixed(d || 0) : "—"; }
  function hh(t) { return String(t).slice(11, 16); }

  function placeLabel(p) { return p ? [p.name, p.admin1, p.country].filter(Boolean).join(", ") : ""; }
  function placeShort(p) { return p ? [p.name, p.country].filter(Boolean).join(", ") : ""; }
  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join("").toUpperCase();
  }
  function lvlClass(l) { return l === null || l === undefined ? "lvl-na" : "lvl-" + l; }
  function lvlName(l) { return l === null || l === undefined ? "No data" : Risk.LEVEL_NAMES[l]; }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  var WX = {
    0: ["☀️", "Clear"], 1: ["🌤️", "Mainly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
    45: ["🌫️", "Fog"], 48: ["🌫️", "Fog"], 51: ["🌦️", "Drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌦️", "Drizzle"],
    56: ["🌧️", "Freezing drizzle"], 57: ["🌧️", "Freezing drizzle"], 61: ["🌧️", "Rain"], 63: ["🌧️", "Rain"],
    65: ["🌧️", "Heavy rain"], 66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"], 71: ["🌨️", "Snow"],
    73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"], 80: ["🌦️", "Showers"],
    81: ["🌧️", "Showers"], 82: ["⛈️", "Heavy showers"], 85: ["🌨️", "Snow showers"], 86: ["🌨️", "Snow showers"],
    95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm"], 99: ["⛈️", "Thunderstorm"]
  };
  function wxEmoji(code, isDay) {
    var w = WX[code];
    if (!w) return "🌡️";
    if (isDay === false && (code === 0 || code === 1)) return "🌙";
    return w[0];
  }
  function wxText(code) { return WX[code] ? WX[code][1] : ""; }

  /* ======================= data ======================= */

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " from " + new URL(url).hostname);
      return r.json();
    });
  }

  var POLLEN = ["alder", "birch", "grass", "mugwort", "olive", "ragweed"];

  function fetchConditions(place) {
    var ll = "latitude=" + place.lat + "&longitude=" + place.lon;
    var wxUrl = "https://api.open-meteo.com/v1/forecast?" + ll +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,uv_index,is_day,weather_code,wind_speed_10m" +
      "&hourly=temperature_2m,apparent_temperature,uv_index,is_day,weather_code,precipitation_probability" +
      "&timezone=auto&forecast_days=5";
    var aqUrl = "https://air-quality-api.open-meteo.com/v1/air-quality?" + ll +
      "&current=us_aqi,pm2_5,pm10," + POLLEN.map(function (p) { return p + "_pollen"; }).join(",") +
      "&hourly=us_aqi,pm2_5&timezone=auto&forecast_days=5";
    var since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19);
    var eqUrl = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&minmagnitude=4" +
      "&maxradiuskm=500&" + ll + "&starttime=" + since;

    return Promise.allSettled([getJSON(wxUrl), getJSON(aqUrl), getJSON(eqUrl)]).then(function (res) {
      var wx = res[0].status === "fulfilled" ? res[0].value : null;
      var aq = res[1].status === "fulfilled" ? res[1].value : null;
      var eq = res[2].status === "fulfilled" ? res[2].value : null;
      if (!wx && !aq) throw new Error("Can't reach the weather service right now. Check your connection and try again.");
      var failed = [];
      if (!wx) failed.push("weather");
      if (!aq) failed.push("air quality");
      if (!eq) failed.push("earthquakes");
      return normalise(place, wx, aq, eq, failed);
    });
  }

  function normalise(place, wx, aq, eq, failed) {
    var cur = {};
    if (wx && wx.current) {
      var c = wx.current;
      cur.time = c.time; cur.temp = c.temperature_2m; cur.feelsLike = c.apparent_temperature;
      cur.humidity = c.relative_humidity_2m; cur.uv = c.uv_index; cur.isDay = c.is_day === 1;
      cur.weatherCode = c.weather_code; cur.wind = c.wind_speed_10m;
    }
    if (aq && aq.current) {
      cur.usAqi = aq.current.us_aqi; cur.pm25 = aq.current.pm2_5; cur.pm10 = aq.current.pm10;
      var pollen = {}, any = false;
      POLLEN.forEach(function (p) {
        var v = aq.current[p + "_pollen"];
        if (isNum(v)) { pollen[p] = v; any = true; }
      });
      cur.pollen = any ? pollen : null;
      if (!cur.time) cur.time = aq.current.time;
    }
    cur.quakes = eq && Array.isArray(eq.features) ? eq.features.map(function (f) {
      var g = f.geometry && f.geometry.coordinates;
      return {
        mag: f.properties.mag, place: f.properties.place, time: f.properties.time, url: f.properties.url,
        distanceKm: g ? Risk.haversineKm(place.lat, place.lon, g[1], g[0]) : null
      };
    }) : null;

    var all = [];
    if (wx && wx.hourly) {
      var aqT = {};
      if (aq && aq.hourly) aq.hourly.time.forEach(function (t, i) { aqT[t] = { aqi: aq.hourly.us_aqi[i], pm: aq.hourly.pm2_5[i] }; });
      var H = wx.hourly;
      H.time.forEach(function (t, i) {
        all.push({
          time: t, temp: H.temperature_2m[i], feelsLike: H.apparent_temperature[i], uv: H.uv_index[i],
          isDay: H.is_day[i] === 1, weatherCode: H.weather_code[i], precip: H.precipitation_probability[i],
          usAqi: aqT[t] ? aqT[t].aqi : null, pm25: aqT[t] ? aqT[t].pm : null
        });
      });
    }
    var start = 0;
    if (cur.time) {
      var nowHour = cur.time.slice(0, 13) + ":00";
      var idx = all.findIndex(function (h) { return h.time === nowHour; });
      if (idx !== -1) start = idx;
    }
    return {
      place: place, current: cur, hoursAll: all, hours24: all.slice(start, start + 24),
      failed: failed, fetchedAt: Date.now()
    };
  }

  /* ======================= derived view model ======================= */

  function optsFor(person, extraProfiles) {
    var profiles = (person.profiles || []).slice();
    (extraProfiles || []).forEach(function (p) { if (profiles.indexOf(p) === -1) profiles.push(p); });
    return { profiles: profiles, limits: person.limits || {} };
  }

  function model(person, data) {
    var opts = optsFor(person);
    var result = Risk.assess(data.current, opts);
    var tl = Risk.timeline(data.hours24, opts);
    return { person: person, data: data, opts: opts, result: result, tl: tl };
  }

  /* ======================= theme ======================= */

  function applyTheme() {
    var t = store.settings.theme;
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    var dark = t === "dark" || (t === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    $("theme-btn").textContent = dark ? "☀️" : "🌙";
    $("theme-btn").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }

  function toggleTheme() {
    var dark = document.documentElement.getAttribute("data-theme") === "dark" ||
      (!document.documentElement.hasAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    store.settings.theme = dark ? "light" : "dark";
    save();
    applyTheme();
    if (current) renderPlan();
  }

  /* ======================= people bar ======================= */

  function renderPeople() {
    var bar = $("people");
    bar.innerHTML = store.people.map(function (p) {
      var c = cache[p.id];
      var lvl = c ? Risk.assess(c.data.current, optsFor(p)).overall : null;
      var sel = p.id === store.activeId;
      return '<button class="person-pill ' + lvlClass(lvl) + '" role="tab" aria-selected="' + sel + '" data-id="' + esc(p.id) + '">' +
        '<span class="dot">' + esc(initials(p.name)) + "</span>" + esc(p.name) + "</button>";
    }).join("") + '<button class="person-pill add" type="button" data-add="1">＋ Add</button>';
  }

  function switchTo(id) {
    if (!personById(id)) return;
    store.activeId = id;
    save();
    diaryDraft = null;
    renderPeople();
    showCachedThenRefresh();
  }

  /* ======================= hero ======================= */

  var current = null; // the model currently on screen

  function animateNumber(el, to) {
    if (!isNum(to)) { el.textContent = "–"; return; }
    var from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = to; return; }
    var t0 = performance.now();
    var dur = 900;
    function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function renderHero(m) {
    var r = m.result, d = m.data, cur = d.current;
    var hero = $("hero");
    hero.className = "hero " + lvlClass(r.overall) + (cur.isDay === false ? " night" : "");
    var v = Risk.VERDICTS[r.overall];
    $("verdict-emoji").textContent = v.emoji;
    $("verdict").textContent = v.title;
    $("headline").textContent = Risk.headline(r, m.tl);
    animateNumber($("score"), r.score);
    $("ring").style.strokeDashoffset = RING_C * (1 - (isNum(r.score) ? r.score : 0) / 100);

    var age = Math.round((Date.now() - d.fetchedAt) / 60000);
    var meta = [
      "👤 " + esc(m.person.name),
      "📍 " + esc(placeShort(d.place)),
      wxEmoji(cur.weatherCode, cur.isDay) + " " + esc(wxText(cur.weatherCode)) + (isNum(cur.temp) ? " · " + fmtT(cur.temp) : ""),
      "🕒 " + (age < 2 ? "just now" : age < 60 ? age + " min ago" : "earlier")
    ];
    $("hero-meta").innerHTML = meta.map(function (s) { return "<span>" + s + "</span>"; }).join("");
  }

  function renderHeroEmpty(message) {
    $("hero").className = "hero lvl-na";
    $("verdict-emoji").textContent = "👋";
    $("verdict").textContent = "Let's get started";
    $("headline").textContent = message || "Add yourself or someone you care about to see today's safety check.";
    $("score").textContent = "–";
    $("ring").style.strokeDashoffset = RING_C;
    $("hero-meta").innerHTML = "";
  }

  function renderAlerts(m) {
    var el = $("alerts");
    var lines = m.result.alerts.slice();
    if (m.data.failed.length) lines.push("Some data couldn't load: " + m.data.failed.join(", ") + ".");
    el.hidden = !lines.length;
    el.innerHTML = lines.map(function (a, i) {
      var isErr = i >= m.result.alerts.length;
      return "<p>" + (isErr ? "ℹ️ " : "⚠️ ") + esc(a) + "</p>";
    }).join("");
  }

  /* ======================= today tab ======================= */

  var HAZ = {
    heat:   { emoji: "🌡️", min: 0, max: 55, ticks: ["0°", "27°", "41°", "55°"], about: "How hot it feels on your body (temperature combined with humidity and wind)." },
    cold:   { emoji: "🥶", min: -40, max: 10, ticks: ["-40°", "-25°", "-10°", "10°"], about: "How cold it feels on your skin, including wind chill." },
    air:    { emoji: "🌫️", min: 0, max: 300, ticks: ["0", "100", "200", "300+"], about: "US Air Quality Index. Above 100 affects sensitive people; above 150 affects everyone." },
    uv:     { emoji: "🕶️", min: 0, max: 12, ticks: ["0", "3", "6", "8", "11+"], about: "Strength of the sun's UV rays. At 6+ unprotected skin can burn in under 30 minutes." },
    pollen: { emoji: "🌼", min: 0, max: 4, ticks: ["None", "High", "4× high"], about: "Tree, grass and weed pollen in the air. Forecasts cover Europe only." },
    quake:  { emoji: "🌍", min: 3, max: 8, ticks: ["M3", "M5", "M7", "M8"], about: "Earthquakes of magnitude 4+ within 500 km in the last 24 hours (USGS)." }
  };
  var SCALE_COLORS = ["var(--l0)", "var(--l1)", "var(--l2)", "var(--l3)", "var(--l4)"];

  function hazardValue(h, cur) {
    switch (h.key) {
      case "heat": case "cold": return "Feels " + fmtT(cur.feelsLike);
      case "air": return "AQI " + fmtN(cur.usAqi);
      case "uv": return "UV " + fmtN(cur.uv, 1);
      case "pollen": return h.value ? cap(h.value.type) : "—";
      case "quake":
        if (!cur.quakes) return "—";
        if (!cur.quakes.length) return "None";
        return "M" + fmtN(biggestQuake(cur.quakes).mag, 1);
    }
    return "";
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function biggestQuake(qs) { return qs.slice().sort(function (a, b) { return b.mag - a.mag; })[0]; }

  function scalePos(h, cur) {
    var cfg = HAZ[h.key];
    var v;
    if (h.key === "heat" || h.key === "cold") v = cur.feelsLike;
    else if (h.key === "air") v = cur.usAqi;
    else if (h.key === "uv") v = cur.uv;
    else if (h.key === "pollen") v = h.value ? h.value.ratio : null;
    else if (h.key === "quake") v = cur.quakes && cur.quakes.length ? biggestQuake(cur.quakes).mag : cfg.min;
    if (!isNum(v)) return null;
    return Math.max(0, Math.min(100, (v - cfg.min) / (cfg.max - cfg.min) * 100));
  }

  var openTile = null;

  function renderToday(m) {
    var cur = m.data.current;
    $("tiles").innerHTML = m.result.hazards.map(function (h, i) {
      return '<button class="tile ' + lvlClass(h.level) + '" type="button" data-key="' + h.key + '" aria-expanded="' + (openTile === h.key) + '" style="animation-delay:' + (i * 40) + 'ms">' +
        '<div class="t-top"><span>' + esc(h.label) + '</span><span class="t-emoji" aria-hidden="true">' + HAZ[h.key].emoji + "</span></div>" +
        '<div class="t-val">' + esc(hazardValue(h, cur)) + "</div>" +
        '<div class="t-lvl">' + lvlName(h.level) + "</div></button>";
    }).join("");
    renderTileDetail(m);

    // Smart tips
    var tips = [];
    var best = m.tl.best;
    if (best) tips.push({ i: "🕒", t: "Best time outside", s: Risk.windowText(best) + " · " + lvlName(best.level).toLowerCase() + " risk" });
    var vent = Risk.ventilationWindow(m.tl.points);
    if (vent) tips.push({ i: "🪟", t: "Air out your home", s: "Around " + hh(vent.time) + " when air is cleanest (AQI " + Math.round(vent.usAqi) + ")" });
    var mask = Risk.maskAdvice(cur.usAqi, m.result.sensitivity.air);
    if (mask) tips.push({ i: "😷", t: "Mask up", s: mask });
    if (isNum(cur.feelsLike) && cur.feelsLike >= 30) {
      var glasses = cur.feelsLike >= 38 ? "10–12" : "8–10";
      tips.push({ i: "💧", t: "Stay hydrated", s: "Aim for " + glasses + " glasses of water today" });
    }
    if (isNum(cur.uv) && cur.uv >= 6 && cur.isDay !== false) tips.push({ i: "🧴", t: "Sunscreen", s: "SPF 30+, reapply every 2 hours outside" });
    var rain = m.tl.points.filter(function (p) { return isNum(p.precip) && p.precip >= 60; })[0];
    if (rain) tips.push({ i: "☂️", t: "Take an umbrella", s: "Rain likely from about " + hh(rain.time) });
    if (!tips.length) tips.push({ i: "🌿", t: "All clear", s: "Nothing special to prepare for today" });
    $("tips").innerHTML = tips.map(function (t, i) {
      return '<div class="tip" style="animation-delay:' + (i * 50) + 'ms"><div class="ti" aria-hidden="true">' + t.i + "</div><div><b>" + esc(t.t) + "</b><span>" + esc(t.s) + "</span></div></div>";
    }).join("");

    $("advice").innerHTML = Risk.advice(m.result, m.opts).map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("");
  }

  function renderTileDetail(m) {
    var box = $("tile-detail");
    var h = openTile && m.result.hazards.filter(function (x) { return x.key === openTile; })[0];
    if (!h) { box.hidden = true; return; }
    var cfg = HAZ[h.key];
    var cur = m.data.current;
    var pos = scalePos(h, cur);
    var extra = "";
    if (h.key === "air" && isNum(cur.pm25)) extra = "<p class=\"small muted\">PM2.5: " + fmtN(cur.pm25) + " µg/m³ · PM10: " + fmtN(cur.pm10) + " µg/m³</p>";
    if (h.key === "quake" && cur.quakes && cur.quakes.length) {
      extra = "<p class=\"small\">" + cur.quakes.slice(0, 3).map(function (q) {
        return "M" + fmtN(q.mag, 1) + " · " + esc(q.place) + " (" + fmtN(q.distanceKm) + " km away)";
      }).join("<br>") + "</p>";
    }
    if ((h.key === "heat" || h.key === "cold") && isNum(cur.temp)) {
      extra = "<p class=\"small muted\">Actual " + fmtT(cur.temp) + " · humidity " + fmtN(cur.humidity) + "% · wind " + fmtN(cur.wind) + " km/h</p>";
    }
    box.innerHTML = "<h3>" + cfg.emoji + " " + esc(h.label) + ": " + lvlName(h.level) + "</h3>" +
      "<p>" + esc(cfg.about) + "</p>" +
      (pos === null ? "" :
        '<div class="scale-wrap"><div class="scale">' + SCALE_COLORS.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join("") +
        '</div><div class="scale-marker" style="left:' + pos + '%"></div></div>' +
        '<div class="scale-labels">' + cfg.ticks.map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("") + "</div>") +
      extra;
    box.hidden = false;
  }

  /* ======================= plan tab ======================= */

  var METRICS = {
    risk: { label: "Risk" },
    feels: { label: "Feels like" },
    aqi: { label: "Air" },
    uv: { label: "UV" }
  };
  var planHour = 0;

  function planModel() {
    var p = current.person;
    var opts = optsFor(p, Risk.ACTIVITIES[store.activity].adds);
    return { opts: opts, tl: Risk.timeline(current.data.hours24, opts) };
  }

  function renderPlanControls() {
    $("activities").innerHTML = Object.keys(Risk.ACTIVITIES).map(function (k) {
      var a = Risk.ACTIVITIES[k];
      return '<button type="button" role="radio" aria-checked="' + (store.activity === k) + '" data-act="' + k + '">' + a.emoji + " " + esc(a.label) + "</button>";
    }).join("");
    $("metrics").innerHTML = Object.keys(METRICS).map(function (k) {
      return '<button type="button" role="radio" aria-checked="' + (store.metric === k) + '" data-metric="' + k + '">' + METRICS[k].label + "</button>";
    }).join("");
  }

  function renderPlan() {
    if (!current) return;
    renderPlanControls();
    var pm = planModel();
    var act = Risk.ACTIVITIES[store.activity];
    var best = pm.tl.best;
    var nowLvl = pm.tl.points.length ? pm.tl.points[0].level : null;
    $("plan-verdict").innerHTML = act.emoji + " " + esc(act.label) + " now: <span style=\"color:var(--c)\" class=\"" + lvlClass(nowLvl) + "\">" + lvlName(nowLvl) + " risk</span>";
    $("plan-best").textContent = best ? "Best time: " + Risk.windowText(best) + " (" + lvlName(best.level).toLowerCase() + " risk, " + best.hours + "h window)" : "";
    $("scrub").max = Math.max(0, pm.tl.points.length - 1);
    if (planHour > pm.tl.points.length - 1) planHour = 0;
    $("scrub").value = planHour;
    drawChart(pm.tl);
    renderHourDetail(pm.tl);
  }

  function metricValue(p, metric) {
    if (metric === "feels") return isNum(p.feelsLike) ? cToUnit(p.feelsLike) : null;
    if (metric === "aqi") return p.usAqi;
    if (metric === "uv") return p.uv;
    return p.level;
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#999"; }

  function drawChart(tl) {
    var svg = $("chart");
    var pts = tl.points;
    var W = Math.max(300, Math.round(svg.getBoundingClientRect().width || 600));
    var H = 220, L = 34, R = 10, T = 22, B = 26;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    if (!pts.length) { svg.innerHTML = ""; return; }
    var n = pts.length;
    var bw = (W - L - R) / n;
    var x = function (i) { return L + (i + 0.5) * bw; };
    var colors = [cssVar("--l0"), cssVar("--l1"), cssVar("--l2"), cssVar("--l3"), cssVar("--l4")];
    var naColor = cssVar("--lna");
    var metric = store.metric;
    var out = [];

    // Y scale
    var vals = pts.map(function (p) { return metricValue(p, metric); }).filter(isNum);
    var lo, hi, ticks;
    if (metric === "risk") { lo = 0; hi = 5; ticks = []; }
    else {
      lo = Math.min.apply(null, vals.concat(metric === "feels" ? [] : [0]));
      hi = Math.max.apply(null, vals.concat([lo + 1]));
      var pad = (hi - lo) * 0.15;
      lo = metric === "feels" ? Math.floor(lo - pad) : 0;
      hi = Math.ceil(hi + pad);
      ticks = [lo, Math.round((lo + hi) / 2), hi];
    }
    var y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1)); };

    // Grid
    out.push('<g class="grid">');
    ticks.forEach(function (t) { out.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t) + '" y2="' + y(t) + '"></line>'); });
    out.push("</g><g class=\"axis\">");
    ticks.forEach(function (t) { out.push('<text x="' + (L - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + Math.round(t) + "</text>"); });
    pts.forEach(function (p, i) { if (i % 3 === 0) out.push('<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + hh(p.time).slice(0, 2) + "</text>"); });
    out.push("</g>");

    // Best window band
    if (tl.best) {
      var bi = pts.findIndex(function (p) { return p.time === tl.best.from; });
      var bj = pts.findIndex(function (p) { return p.time === tl.best.to; });
      if (bi !== -1 && bj !== -1) {
        out.push('<rect class="best-band" x="' + (L + bi * bw) + '" y="' + (T - 14) + '" width="' + ((bj - bi + 1) * bw) + '" height="' + (H - T - B + 14) + '" rx="6"></rect>');
        out.push('<text class="best-label" x="' + (L + bi * bw + 4) + '" y="' + (T - 4) + '">★ Best</text>');
      }
    }

    // Bars (risk level) — full-height when metric=risk, slim base strip otherwise
    pts.forEach(function (p, i) {
      var col = p.level === null ? naColor : colors[p.level];
      var op = p.isDay ? 1 : 0.55;
      if (metric === "risk") {
        var top = y(p.level + 1);
        out.push('<rect class="bar" x="' + (L + i * bw + 1.5) + '" y="' + top + '" width="' + Math.max(2, bw - 3) + '" height="' + (y(0) - top) + '" rx="4" fill="' + col + '" opacity="' + op + '"></rect>');
      } else {
        out.push('<rect class="bar" x="' + (L + i * bw + 1) + '" y="' + (H - B - 6) + '" width="' + Math.max(2, bw - 2) + '" height="6" rx="2" fill="' + col + '" opacity="' + op + '"></rect>');
      }
    });

    // Metric line
    if (metric !== "risk") {
      var d = "", area = "", started = false, lastX = 0, firstX = 0;
      pts.forEach(function (p, i) {
        var v = metricValue(p, metric);
        if (!isNum(v)) return;
        d += (started ? " L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
        if (!started) firstX = x(i);
        lastX = x(i);
        started = true;
      });
      if (d) {
        area = d + " L" + lastX.toFixed(1) + " " + y(lo) + " L" + firstX.toFixed(1) + " " + y(lo) + " Z";
        out.push('<path class="area" d="' + area + '"></path><path class="line" d="' + d + '"></path>');
      }
    }

    // Now label + cursor
    out.push('<text class="now" x="' + x(0) + '" y="' + (T - 4) + '" text-anchor="middle">NOW</text>');
    var cv = metricValue(pts[planHour], metric);
    var cy = metric === "risk" ? y((pts[planHour].level || 0) + 1) : (isNum(cv) ? y(cv) : y(lo));
    out.push('<line class="cursor" x1="' + x(planHour) + '" x2="' + x(planHour) + '" y1="' + (T - 6) + '" y2="' + (H - B) + '"></line>');
    out.push('<circle class="cursor-dot" cx="' + x(planHour) + '" cy="' + cy + '" r="5"></circle>');

    svg.innerHTML = out.join("");
    svg.dataset.l = L; svg.dataset.bw = bw; svg.dataset.n = n; svg.dataset.w = W;
  }

  function renderHourDetail(tl) {
    var p = tl.points[planHour];
    if (!p) { $("hour-detail").innerHTML = ""; return; }
    var items = [
      { k: hh(p.time) + (planHour === 0 ? " (now)" : ""), v: lvlName(p.level), l: p.level },
      { k: "Feels like", v: fmtT(p.feelsLike), l: Risk.heatLevel(p.feelsLike, false) },
      { k: "Air (AQI)", v: fmtN(p.usAqi), l: Risk.airLevel(p.usAqi, false) },
      { k: "UV", v: p.isDay ? fmtN(p.uv, 1) : "Night", l: p.isDay ? Risk.uvLevel(p.uv) : 0 },
      { k: "Rain chance", v: isNum(p.precip) ? p.precip + "%" : "—", l: null },
      { k: "Sky", v: wxEmoji(p.weatherCode, p.isDay) + " " + wxText(p.weatherCode), l: null }
    ];
    $("hour-detail").innerHTML = items.map(function (it) {
      return '<div class="hd ' + lvlClass(it.l) + '"><div class="k">' + esc(it.k) + '</div><div class="v">' + esc(it.v) + "</div></div>";
    }).join("");
  }

  function setPlanHour(i) {
    if (!current) return;
    var pm = planModel();
    i = Math.max(0, Math.min(pm.tl.points.length - 1, i));
    if (i === planHour) return;
    planHour = i;
    $("scrub").value = i;
    drawChart(pm.tl);
    renderHourDetail(pm.tl);
  }

  function chartPointer(ev) {
    var svg = $("chart");
    var rect = svg.getBoundingClientRect();
    var W = Number(svg.dataset.w), L = Number(svg.dataset.l), bw = Number(svg.dataset.bw);
    var vx = (ev.clientX - rect.left) * (W / rect.width);
    setPlanHour(Math.floor((vx - L) / bw));
  }

  /* ======================= week tab ======================= */

  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function renderWeek(m) {
    var days = Risk.dailySummaries(m.data.hoursAll, m.opts).slice(0, 5);
    if (!days.length) { $("week").innerHTML = '<div class="empty">No forecast available.</div>'; return; }
    var lows = days.map(function (d) { return d.minFeels; }).filter(isNum);
    var highs = days.map(function (d) { return d.maxFeels; }).filter(isNum);
    var gLo = Math.min.apply(null, lows), gHi = Math.max.apply(null, highs);
    var span = gHi - gLo || 1;
    $("week").innerHTML = days.map(function (d, i) {
      var dt = new Date(d.date + "T12:00:00");
      var name = i === 0 ? "Today" : i === 1 ? "Tomorrow" : DAYS[dt.getDay()];
      var left = isNum(d.minFeels) ? (d.minFeels - gLo) / span * 100 : 0;
      var width = isNum(d.maxFeels) && isNum(d.minFeels) ? Math.max(4, (d.maxFeels - d.minFeels) / span * 100) : 0;
      return '<div class="day ' + lvlClass(d.level) + '" style="animation-delay:' + (i * 60) + 'ms">' +
        '<div><div class="dname">' + name + '</div><div class="ddate">' + dt.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + "</div></div>" +
        '<div class="demoji" title="' + esc(wxText(d.weatherCode)) + '">' + wxEmoji(d.weatherCode, true) + "</div>" +
        '<div class="dstats">' +
          "<span>🌡️ <b>" + fmtT(d.minFeels) + " – " + fmtT(d.maxFeels) + "</b></span>" +
          "<span>🌫️ AQI <b>" + fmtN(d.maxAqi) + "</b></span>" +
          "<span>🕶️ UV <b>" + fmtN(d.maxUv, 0) + "</b></span>" +
          (isNum(d.precip) ? "<span>☔ <b>" + d.precip + "%</b></span>" : "") +
          '<div class="temp-bar" aria-hidden="true"><i style="left:' + left + "%;width:" + width + '%"></i></div>' +
        "</div>" +
        '<div class="dlvl">' + lvlName(d.level) + "</div>" +
        (d.best ? '<div class="dbest">★ Best time outside: ' + Risk.windowText(d.best) + "</div>" : "") +
      "</div>";
    }).join("");
  }

  /* ======================= diary tab ======================= */

  var diaryDraft = null;

  function todayKey() {
    if (current && current.data.current.time) return current.data.current.time.slice(0, 10);
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function entriesFor(personId) {
    return store.diary.filter(function (e) { return e.personId === personId; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }

  function renderDiary() {
    var p = active();
    if (!p) return;
    var entries = entriesFor(p.id);
    var today = todayKey();
    if (!diaryDraft) {
      var existing = entries.filter(function (e) { return e.date === today; })[0];
      diaryDraft = existing
        ? { feeling: existing.feeling, symptoms: existing.symptoms.slice(), note: existing.note || "" }
        : { feeling: null, symptoms: [], note: "" };
      $("diary-note").value = diaryDraft.note;
      $("diary-status").textContent = existing ? "You've logged today. Saving will update it." : "";
    }
    $("feelings").innerHTML = Risk.FEELINGS.map(function (f) {
      return '<button type="button" class="feeling" role="radio" aria-checked="' + (diaryDraft.feeling === f.key) + '" data-feel="' + f.key + '"><span aria-hidden="true">' + f.emoji + "</span>" + f.label + "</button>";
    }).join("");
    $("symptoms").innerHTML = Risk.SYMPTOMS.map(function (s) {
      return '<button type="button" class="chip" aria-pressed="' + (diaryDraft.symptoms.indexOf(s) !== -1) + '" data-sym="' + esc(s) + '">' + esc(s) + "</button>";
    }).join("");

    var ins = Risk.diaryInsight(entries);
    $("insight").textContent = ins.message;

    var recent = entries.slice(0, 14).reverse();
    var maxAqi = Math.max.apply(null, [150].concat(recent.map(function (e) { return e.aqi || 0; })));
    $("diary-chart").innerHTML = recent.length ? recent.map(function (e, i) {
      var f = Risk.FEELINGS.filter(function (x) { return x.key === e.feeling; })[0];
      var h = isNum(e.aqi) ? Math.max(4, e.aqi / maxAqi * 100) : 4;
      return '<div class="dbar ' + lvlClass(Risk.airLevel(e.aqi, false)) + '" title="' + esc(e.date + " · AQI " + fmtN(e.aqi) + " · feels " + fmtT(e.feelsLike)) + '">' +
        '<div class="track"><em>' + (f ? f.emoji : "•") + '</em><i style="height:' + h + "%;animation-delay:" + (i * 30) + 'ms"></i></div><small>' + e.date.slice(8, 10) + "</small></div>";
    }).join("") : '<span class="muted small">Your daily entries will appear here as a chart: bar height is that day\'s air quality, and the emoji is how you felt.</span>';

    $("diary-list").innerHTML = entries.length ? entries.slice(0, 30).map(function (e) {
      var f = Risk.FEELINGS.filter(function (x) { return x.key === e.feeling; })[0];
      var dt = new Date(e.date + "T12:00:00");
      return '<div class="entry"><div class="e-emoji" aria-hidden="true">' + (f ? f.emoji : "📝") + "</div><div>" +
        '<div class="e-date">' + dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) + " · " + esc(f ? f.label : "") + "</div>" +
        '<div class="e-meta">AQI ' + fmtN(e.aqi) + " · feels " + fmtT(e.feelsLike) +
        (e.symptoms.length ? " · " + esc(e.symptoms.join(", ")) : "") + (e.note ? " · “" + esc(e.note) + "”" : "") + "</div></div>" +
        '<button class="icon-btn" type="button" data-del="' + esc(e.id) + '" aria-label="Delete entry">🗑️</button></div>';
    }).join("") : '<div class="empty">No entries yet. Log how you feel each day, and SafeAir will show whether air or heat affects you.</div>';
  }

  function saveDiary() {
    var p = active();
    if (!p) return;
    if (!diaryDraft.feeling) { toast("Pick how you feel first"); return; }
    var today = todayKey();
    var cur = current ? current.data.current : {};
    store.diary = store.diary.filter(function (e) { return !(e.personId === p.id && e.date === today); });
    store.diary.push({
      id: uid(), personId: p.id, date: today, feeling: diaryDraft.feeling, symptoms: diaryDraft.symptoms.slice(),
      note: $("diary-note").value.trim().slice(0, 140), aqi: isNum(cur.usAqi) ? Math.round(cur.usAqi) : null,
      feelsLike: isNum(cur.feelsLike) ? Math.round(cur.feelsLike * 10) / 10 : null, place: placeShort(p.place)
    });
    save();
    diaryDraft = null;
    renderDiary();
    toast("Saved ✓ Thanks for checking in");
  }

  /* ======================= family tab ======================= */

  function miniRing(score) {
    var off = MINI_C * (1 - (isNum(score) ? score : 0) / 100);
    return '<div class="mini-ring"><svg viewBox="0 0 56 56" aria-hidden="true"><circle class="track" cx="28" cy="28" r="24"></circle>' +
      '<circle class="prog" cx="28" cy="28" r="24" stroke-dasharray="' + MINI_C.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"></circle></svg>' +
      "<b>" + (isNum(score) ? score : "–") + "</b></div>";
  }

  function renderFamily() {
    $("family").innerHTML = store.people.map(function (p, i) {
      var c = cache[p.id];
      var r = c ? Risk.assess(c.data.current, optsFor(p)) : null;
      var v = r ? Risk.VERDICTS[r.overall] : null;
      return '<button type="button" class="fam ' + lvlClass(r ? r.overall : null) + (p.id === store.activeId ? " active" : "") + '" data-id="' + esc(p.id) + '" style="animation-delay:' + (i * 50) + 'ms">' +
        miniRing(r ? r.score : null) +
        '<div><div class="f-name">' + esc(p.name) + '</div><div class="f-place">📍 ' + esc(placeShort(p.place)) + "</div>" +
        '<div class="f-verdict">' + (v ? v.emoji + " " + v.title : "Checking…") + "</div>" +
        (r && r.alerts.length ? '<div class="f-alert">⚠️ ' + esc(r.alerts[0]) + "</div>" : "") +
        "</div></button>";
    }).join("") + '<button type="button" class="fam add-card" data-add="1">＋ Add someone</button>';
  }

  function refreshFamily(force) {
    store.people.forEach(function (p) {
      if (p.id === store.activeId) return;
      var c = cache[p.id];
      if (!force && c && Date.now() - c.at < REFRESH_MS) return;
      fetchConditions(p.place).then(function (data) {
        cache[p.id] = { data: data, at: Date.now() };
        save();
        maybeNotify(p, Risk.assess(data.current, optsFor(p)));
        renderFamily();
        renderPeople();
      }).catch(function () { /* card keeps last known state */ });
    });
  }

  /* ======================= tabs ======================= */

  var TABS = ["today", "plan", "week", "diary", "family"];

  function setTab(name) {
    store.tab = name;
    save();
    TABS.forEach(function (t) {
      var on = t === name;
      $("t-" + t).setAttribute("aria-selected", on);
      $("t-" + t).tabIndex = on ? 0 : -1;
      $("tab-" + t).hidden = !on;
    });
    if (name === "plan") renderPlan();
    if (name === "diary") renderDiary();
    if (name === "family") { renderFamily(); refreshFamily(false); }
  }

  /* ======================= main flow ======================= */

  var loadSeq = 0;

  function renderAll(m) {
    current = m;
    renderHero(m);
    renderAlerts(m);
    renderToday(m);
    renderWeek(m);
    renderPeople();
    if (store.tab === "plan") renderPlan();
    if (store.tab === "diary") renderDiary();
    if (store.tab === "family") renderFamily();
  }

  function showCachedThenRefresh(force) {
    var p = active();
    if (!p) { current = null; renderHeroEmpty(); return; }
    store.activeId = p.id;
    var c = cache[p.id];
    if (c) renderAll(model(p, c.data));
    else { $("hero").classList.add("loading"); $("verdict").textContent = "Checking…"; $("headline").textContent = "Getting the latest conditions for " + placeShort(p.place) + "."; }
    if (!force && c && Date.now() - c.at < 5 * 60 * 1000) return;
    refreshActive();
  }

  function refreshActive() {
    var p = active();
    if (!p) return;
    var seq = ++loadSeq;
    var btn = $("refresh-btn");
    btn.disabled = true;
    btn.textContent = "↻ Updating…";
    fetchConditions(p.place).then(function (data) {
      if (seq !== loadSeq) return;
      cache[p.id] = { data: data, at: Date.now() };
      save();
      var m = model(p, data);
      renderAll(m);
      maybeNotify(p, m.result);
    }).catch(function (e) {
      if (seq !== loadSeq) return;
      if (!cache[p.id]) renderHeroEmpty(e.message);
      toast(e.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = "↻ Refresh";
    });
  }

  /* ======================= share & notifications ======================= */

  function share() {
    if (!current) return;
    var r = current.result, v = Risk.VERDICTS[r.overall];
    var text = v.emoji + " " + current.person.name + " in " + placeShort(current.data.place) + ": " + v.title +
      " (safety " + r.score + "/100). " + Risk.headline(r, current.tl) + " Checked with SafeAir Daily.";
    var url = location.href.split("#")[0];
    if (navigator.share) {
      navigator.share({ title: "SafeAir Daily", text: text, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + " " + url).then(function () { toast("Copied to clipboard ✓"); }, function () { toast("Couldn't copy"); });
    }
  }

  function maybeNotify(person, result) {
    if (!result.alerts.length || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    var title = "SafeAir: " + person.name + " · " + placeShort(person.place);
    var body = result.alerts.join(" ");
    var key = title + body;
    if (notified[key] && Date.now() - notified[key] < 3 * 3600 * 1000) return;
    notified[key] = Date.now();
    try { new Notification(title, { body: body, icon: "icon.svg" }); } catch (e) { /* needs a service worker on some platforms */ }
  }

  /* ======================= person dialog ======================= */

  var draft = null;     // { id?, name, place, profiles, limits }
  var dlgMode = "add";  // onboard | add | edit
  var dlgStep = 1;

  function openPerson(mode, person) {
    dlgMode = mode;
    draft = person
      ? JSON.parse(JSON.stringify(person))
      : { name: "", place: null, profiles: [], limits: { aqi: null, feelsLike: null } };
    $("person-title").textContent = mode === "edit" ? "Edit " + draft.name : mode === "onboard" ? "Welcome to SafeAir" : "Add someone";
    $("welcome").hidden = mode !== "onboard";
    $("p-name").value = draft.name;
    $("p-city").value = draft.place ? placeLabel(draft.place) : "";
    $("p-city-picked").textContent = draft.place ? "✓ " + placeLabel(draft.place) : "";
    $("p-aqi").value = isNum(draft.limits.aqi) ? draft.limits.aqi : "";
    $("p-heat").value = isNum(draft.limits.feelsLike) ? Math.round(cToUnit(draft.limits.feelsLike)) : "";
    $("p-limits-box").open = isNum(draft.limits.aqi) || isNum(draft.limits.feelsLike);
    document.querySelectorAll("#person-dlg .unit").forEach(function (u) { u.textContent = unitLabel(); });
    $("p-profiles").innerHTML = Object.keys(Risk.PROFILES).map(function (k) {
      return '<button type="button" class="chip" aria-pressed="' + (draft.profiles.indexOf(k) !== -1) + '" data-prof="' + k + '">' + esc(Risk.PROFILES[k].label) + "</button>";
    }).join("");
    $("p-delete").hidden = mode !== "edit";
    $("person-error").textContent = "";
    hideSuggestions();
    showStep(mode === "edit" ? 0 : 1);
    $("person-dlg").showModal();
    if (mode !== "edit") setTimeout(function () { $("p-name").focus(); }, 50);
  }

  function showStep(n) {
    dlgStep = n;
    var all = n === 0;
    document.querySelectorAll("#person-dlg .step").forEach(function (s) {
      s.hidden = !all && Number(s.dataset.step) !== n;
    });
    $("steps").hidden = all;
    $("steps").querySelectorAll("i").forEach(function (i, idx) { i.classList.toggle("on", idx < n); });
    $("p-back").hidden = all || n === 1;
    $("p-next").hidden = all || n === 2;
    $("p-save").hidden = !all && n !== 2;
    $("p-save").textContent = dlgMode === "edit" ? "Save" : dlgMode === "onboard" ? "Show my day →" : "Add";
  }

  function readDraft() {
    draft.name = $("p-name").value.trim();
    draft.limits = { aqi: numOrNull($("p-aqi").value), feelsLike: null };
    var h = numOrNull($("p-heat").value);
    if (h !== null) draft.limits.feelsLike = Math.round(unitToC(h) * 10) / 10;
  }

  function validateStep1() {
    readDraft();
    if (!draft.place) { $("person-error").textContent = "Pick a city from the list, or use your location."; $("p-city").focus(); return false; }
    if (!draft.name) draft.name = draft.place.name === "My location" ? "Me" : draft.place.name;
    $("person-error").textContent = "";
    return true;
  }

  function savePerson() {
    if (!validateStep1()) { if (dlgStep === 2) showStep(1); return; }
    readDraft();
    if (!draft.name) draft.name = draft.place.name;
    if (draft.id) {
      store.people = store.people.map(function (p) { return p.id === draft.id ? draft : p; });
      delete cache[draft.id];
    } else {
      draft.id = uid();
      store.people.push(draft);
    }
    store.activeId = draft.id;
    save();
    $("person-dlg").close();
    diaryDraft = null;
    renderPeople();
    showCachedThenRefresh(true);
    toast(dlgMode === "edit" ? "Saved ✓" : "Added " + draft.name + " ✓");
  }

  function deletePerson() {
    if (!draft || !draft.id) return;
    if (!confirm("Remove " + draft.name + " and their diary entries?")) return;
    store.people = store.people.filter(function (p) { return p.id !== draft.id; });
    store.diary = store.diary.filter(function (e) { return e.personId !== draft.id; });
    delete cache[draft.id];
    if (store.activeId === draft.id) store.activeId = store.people[0] ? store.people[0].id : null;
    save();
    $("person-dlg").close();
    renderPeople();
    renderFamily();
    showCachedThenRefresh();
  }

  /* City search with keyboard support */
  var searchTimer = null, searchSeq = 0, suggestions = [], activeSug = -1;

  function onCityInput() {
    draft.place = null;
    $("p-city-picked").textContent = "";
    var q = $("p-city").value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) { hideSuggestions(); return; }
    searchTimer = setTimeout(function () {
      var seq = ++searchSeq;
      getJSON("https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=" + encodeURIComponent(q))
        .then(function (d) { if (seq === searchSeq) showSuggestions(d.results || []); })
        .catch(function () { if (seq === searchSeq) $("person-error").textContent = "City search isn't available right now."; });
    }, 250);
  }

  function showSuggestions(results) {
    suggestions = results;
    activeSug = results.length ? 0 : -1;
    var ul = $("p-city-results");
    ul.innerHTML = results.length ? results.map(function (r, i) {
      return '<li role="option" id="sug-' + i + '" data-i="' + i + '" class="' + (i === 0 ? "active" : "") + '">' +
        esc(placeLabel({ name: r.name, admin1: r.admin1, country: r.country })) + "</li>";
    }).join("") : '<li class="muted">No matches</li>';
    ul.hidden = false;
    $("p-city").setAttribute("aria-expanded", "true");
  }

  function hideSuggestions() {
    $("p-city-results").hidden = true;
    $("p-city").setAttribute("aria-expanded", "false");
  }

  function pickSuggestion(i) {
    var r = suggestions[i];
    if (!r) return;
    draft.place = { name: r.name, admin1: r.admin1, country: r.country, lat: r.latitude, lon: r.longitude };
    $("p-city").value = placeLabel(draft.place);
    $("p-city-picked").textContent = "✓ " + placeLabel(draft.place);
    $("person-error").textContent = "";
    hideSuggestions();
  }

  function onCityKey(ev) {
    var ul = $("p-city-results");
    if (ul.hidden || !suggestions.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      activeSug = (activeSug + (ev.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
      ul.querySelectorAll("li").forEach(function (li, i) { li.classList.toggle("active", i === activeSug); });
      $("p-city").setAttribute("aria-activedescendant", "sug-" + activeSug);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      pickSuggestion(activeSug);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      hideSuggestions();
    }
  }

  function locate() {
    if (!navigator.geolocation) { $("person-error").textContent = "Location isn't available in this browser."; return; }
    $("p-city-picked").textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      draft.place = { name: "My location", lat: Math.round(pos.coords.latitude * 1000) / 1000, lon: Math.round(pos.coords.longitude * 1000) / 1000 };
      $("p-city").value = "My location";
      $("p-city-picked").textContent = "✓ Using your current location";
      $("person-error").textContent = "";
    }, function (err) {
      $("p-city-picked").textContent = "";
      $("person-error").textContent = "Couldn't get your location (" + err.message + "). Search for a city instead.";
    }, { timeout: 10000, maximumAge: 600000 });
  }

  /* ======================= settings ======================= */

  function openSettings() {
    syncSeg("set-units", store.settings.units);
    syncSeg("set-theme", store.settings.theme);
    $("settings-dlg").showModal();
  }

  function syncSeg(id, value) {
    $(id).querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-checked", b.dataset.v === value); });
  }

  /* ======================= events ======================= */

  function bind() {
    $("people").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.add) openPerson("add");
      else if (b.dataset.id === store.activeId) openPerson("edit", active());
      else switchTo(b.dataset.id);
    });

    $("theme-btn").addEventListener("click", toggleTheme);
    $("settings-btn").addEventListener("click", openSettings);
    $("share-btn").addEventListener("click", share);
    $("refresh-btn").addEventListener("click", function () { refreshActive(); refreshFamily(true); });

    TABS.forEach(function (t) { $("t-" + t).addEventListener("click", function () { setTab(t); }); });
    document.querySelector(".tabs").addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      var i = TABS.indexOf(store.tab) + (ev.key === "ArrowRight" ? 1 : -1);
      var next = TABS[(i + TABS.length) % TABS.length];
      setTab(next);
      $("t-" + next).focus();
    });

    $("tiles").addEventListener("click", function (ev) {
      var b = ev.target.closest(".tile");
      if (!b || !current) return;
      openTile = openTile === b.dataset.key ? null : b.dataset.key;
      document.querySelectorAll(".tile").forEach(function (t) { t.setAttribute("aria-expanded", t.dataset.key === openTile); });
      renderTileDetail(current);
    });

    $("activities").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-act]");
      if (!b) return;
      store.activity = b.dataset.act;
      save();
      renderPlan();
    });
    $("metrics").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-metric]");
      if (!b) return;
      store.metric = b.dataset.metric;
      save();
      renderPlan();
    });
    var chart = $("chart");
    chart.addEventListener("pointerdown", function (ev) { chart.setPointerCapture(ev.pointerId); chartPointer(ev); });
    chart.addEventListener("pointermove", function (ev) { if (ev.buttons || ev.pointerType === "mouse") chartPointer(ev); });
    $("scrub").addEventListener("input", function () { setPlanHour(Number($("scrub").value)); });

    $("feelings").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-feel]");
      if (!b) return;
      diaryDraft.feeling = b.dataset.feel;
      renderDiary();
    });
    $("symptoms").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-sym]");
      if (!b) return;
      var s = b.dataset.sym, i = diaryDraft.symptoms.indexOf(s);
      if (i === -1) diaryDraft.symptoms.push(s); else diaryDraft.symptoms.splice(i, 1);
      b.setAttribute("aria-pressed", i === -1);
    });
    $("diary-note").addEventListener("input", function () { if (diaryDraft) diaryDraft.note = $("diary-note").value; });
    $("diary-save").addEventListener("click", saveDiary);
    $("diary-list").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-del]");
      if (!b) return;
      store.diary = store.diary.filter(function (e) { return e.id !== b.dataset.del; });
      save();
      diaryDraft = null;
      renderDiary();
      toast("Entry deleted");
    });

    $("family").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.add) { openPerson("add"); return; }
      switchTo(b.dataset.id);
      setTab("today");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Person dialog
    $("p-city").addEventListener("input", onCityInput);
    $("p-city").addEventListener("keydown", onCityKey);
    $("p-city").addEventListener("blur", function () { setTimeout(hideSuggestions, 150); });
    $("p-city-results").addEventListener("mousedown", function (ev) {
      var li = ev.target.closest("li[data-i]");
      if (!li) return;
      ev.preventDefault();
      pickSuggestion(Number(li.dataset.i));
    });
    $("p-locate").addEventListener("click", locate);
    $("p-profiles").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-prof]");
      if (!b) return;
      var k = b.dataset.prof, i = draft.profiles.indexOf(k);
      if (i === -1) draft.profiles.push(k); else draft.profiles.splice(i, 1);
      b.setAttribute("aria-pressed", i === -1);
    });
    $("p-next").addEventListener("click", function () { if (validateStep1()) showStep(2); });
    $("p-back").addEventListener("click", function () { readDraft(); showStep(1); });
    $("p-save").addEventListener("click", savePerson);
    $("p-delete").addEventListener("click", deletePerson);
    $("person-form").addEventListener("submit", function (ev) {
      // Enter key in a text field: treat as Next / Save instead of closing.
      if (ev.submitter && ev.submitter.value === "cancel") return;
      ev.preventDefault();
      if (!$("p-next").hidden) $("p-next").click(); else savePerson();
    });

    // Settings
    $("set-units").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-v]");
      if (!b) return;
      store.settings.units = b.dataset.v;
      syncSeg("set-units", b.dataset.v);
      save();
      if (current) renderAll(current);
    });
    $("set-theme").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-v]");
      if (!b) return;
      store.settings.theme = b.dataset.v;
      syncSeg("set-theme", b.dataset.v);
      save();
      applyTheme();
      if (current) renderPlan();
    });
    $("set-notify").addEventListener("click", function () {
      if (typeof Notification === "undefined") { toast("Notifications aren't supported here"); return; }
      Notification.requestPermission().then(function (p) { toast(p === "granted" ? "Alerts on 🔔" : "Alerts not allowed"); });
    });
    $("set-reset").addEventListener("click", function () {
      if (!confirm("Delete all people, diary entries and settings from this device?")) return;
      try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(OLD_KEY); } catch (e) { /* ignore */ }
      location.reload();
    });

    if (window.matchMedia) {
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { applyTheme(); if (current) renderPlan(); });
    }
    var resizeT = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () { if (current && store.tab === "plan") renderPlan(); }, 150);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      var c = active() && cache[store.activeId];
      if (c && Date.now() - c.at > REFRESH_MS) { refreshActive(); refreshFamily(false); }
    });
  }

  /* ======================= init ======================= */

  function init() {
    load();
    if (TABS.indexOf(store.tab) === -1) store.tab = "today";
    if (!Risk.ACTIVITIES[store.activity]) store.activity = "walk";
    if (!METRICS[store.metric]) store.metric = "risk";
    applyTheme();
    bind();
    renderPeople();
    setTab(store.tab);
    if (!store.people.length) {
      renderHeroEmpty();
      openPerson("onboard");
    } else {
      showCachedThenRefresh();
      refreshFamily(false);
    }
    setInterval(function () {
      if (document.hidden) return;
      refreshActive();
      refreshFamily(true);
    }, REFRESH_MS);

    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline support is optional */ });
    }
  }

  init();
})();
