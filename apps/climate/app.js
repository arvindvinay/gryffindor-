/* SafeAir Daily — UI and data fetching. Scoring lives in risk.js. */
(function () {
  "use strict";

  var STORE_KEY = "safeair.v1";
  var REFRESH_MS = 30 * 60 * 1000;

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    place: null,          // { name, lat, lon }
    family: [],           // [{ id, person, place, profiles, limits }]
    notified: {}          // alert text -> timestamp, to avoid repeat notifications
  };

  /* ---------- storage (best-effort) ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.family)) state.family = data.family;
      if (data && data.last) applyForm(data.last);
    } catch (e) { /* storage unavailable; app still works */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ family: state.family, last: readForm() }));
    } catch (e) { /* ignore */ }
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function num(v) {
    if (v === "" || v == null) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function setStatus(msg, isError) {
    var el = $("status");
    el.textContent = msg || "";
    el.className = "small " + (isError ? "error" : "muted");
  }

  function placeLabel(p) {
    return [p.name, p.admin1, p.country].filter(Boolean).join(", ");
  }

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " from " + new URL(url).hostname);
      return r.json();
    });
  }

  /* ---------- form ---------- */
  function buildProfileChips() {
    var box = $("profile-chips");
    Object.keys(Risk.PROFILES).forEach(function (key) {
      var lab = document.createElement("label");
      lab.className = "chip";
      lab.innerHTML = '<input type="checkbox" value="' + key + '"> ' + esc(Risk.PROFILES[key].label);
      box.appendChild(lab);
    });
  }

  function readForm() {
    var profiles = Array.prototype.map.call(
      document.querySelectorAll("#profile-chips input:checked"),
      function (i) { return i.value; }
    );
    return {
      person: $("person").value.trim(),
      place: state.place,
      profiles: profiles,
      limits: { aqi: num($("limit-aqi").value), feelsLike: num($("limit-heat").value) }
    };
  }

  function applyForm(f) {
    $("person").value = f.person || "";
    state.place = f.place || null;
    $("city").value = f.place ? placeLabel(f.place) : "";
    document.querySelectorAll("#profile-chips input").forEach(function (i) {
      i.checked = (f.profiles || []).indexOf(i.value) !== -1;
    });
    $("limit-aqi").value = f.limits && f.limits.aqi != null ? f.limits.aqi : "";
    $("limit-heat").value = f.limits && f.limits.feelsLike != null ? f.limits.feelsLike : "";
    updateButtons();
  }

  function updateButtons() {
    $("check").disabled = !state.place;
    $("save").disabled = !state.place;
  }

  /* ---------- city search ---------- */
  var searchTimer = null;
  var searchSeq = 0;

  function onCityInput() {
    state.place = null;
    updateButtons();
    var q = $("city").value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) { hideSuggestions(); return; }
    searchTimer = setTimeout(function () { searchCity(q); }, 300);
  }

  function searchCity(q) {
    var seq = ++searchSeq;
    var url = "https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=" + encodeURIComponent(q);
    getJSON(url).then(function (data) {
      if (seq !== searchSeq) return;
      showSuggestions(data.results || []);
    }).catch(function (e) {
      if (seq !== searchSeq) return;
      setStatus("City search failed: " + e.message, true);
    });
  }

  function showSuggestions(results) {
    var ul = $("city-results");
    ul.innerHTML = "";
    if (!results.length) {
      ul.innerHTML = '<li class="muted">No matches</li>';
      ul.hidden = false;
      return;
    }
    results.forEach(function (r) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.textContent = placeLabel(r);
      li.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
        pickPlace({ name: r.name, admin1: r.admin1, country: r.country, lat: r.latitude, lon: r.longitude });
      });
      ul.appendChild(li);
    });
    ul.hidden = false;
  }

  function hideSuggestions() { $("city-results").hidden = true; }

  function pickPlace(p) {
    state.place = p;
    $("city").value = placeLabel(p);
    hideSuggestions();
    updateButtons();
    save();
    runCheck();
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setStatus("Location is not available in this browser.", true); return; }
    setStatus("Getting your location…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      pickPlace({
        name: "My location",
        lat: Math.round(pos.coords.latitude * 1000) / 1000,
        lon: Math.round(pos.coords.longitude * 1000) / 1000
      });
    }, function (err) {
      setStatus("Couldn't get your location (" + err.message + "). Search for a city instead.", true);
    }, { timeout: 10000, maximumAge: 600000 });
  }

  /* ---------- data ---------- */
  var POLLEN_VARS = ["alder", "birch", "grass", "mugwort", "olive", "ragweed"];

  function fetchConditions(place) {
    var ll = "latitude=" + place.lat + "&longitude=" + place.lon;
    var forecastUrl = "https://api.open-meteo.com/v1/forecast?" + ll +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,uv_index,is_day,weather_code,wind_speed_10m" +
      "&hourly=apparent_temperature,uv_index,is_day&timezone=auto&forecast_days=2";
    var airUrl = "https://air-quality-api.open-meteo.com/v1/air-quality?" + ll +
      "&current=us_aqi,pm2_5,pm10," + POLLEN_VARS.map(function (p) { return p + "_pollen"; }).join(",") +
      "&hourly=us_aqi&timezone=auto&forecast_days=2";
    var since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19);
    var quakeUrl = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&minmagnitude=4" +
      "&maxradiuskm=500&" + ll + "&starttime=" + since;

    return Promise.allSettled([getJSON(forecastUrl), getJSON(airUrl), getJSON(quakeUrl)]).then(function (res) {
      var wx = res[0].status === "fulfilled" ? res[0].value : null;
      var aq = res[1].status === "fulfilled" ? res[1].value : null;
      var eq = res[2].status === "fulfilled" ? res[2].value : null;
      if (!wx && !aq) {
        throw new Error("Weather and air-quality services are unreachable right now (" + res[0].reason.message + ").");
      }
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
      cur.temp = wx.current.temperature_2m;
      cur.feelsLike = wx.current.apparent_temperature;
      cur.humidity = wx.current.relative_humidity_2m;
      cur.uv = wx.current.uv_index;
      cur.isDay = wx.current.is_day === 1;
      cur.weatherCode = wx.current.weather_code;
      cur.wind = wx.current.wind_speed_10m;
      cur.time = wx.current.time;
    }
    if (aq && aq.current) {
      cur.usAqi = aq.current.us_aqi;
      cur.pm25 = aq.current.pm2_5;
      cur.pm10 = aq.current.pm10;
      var pollen = {};
      var any = false;
      POLLEN_VARS.forEach(function (p) {
        var v = aq.current[p + "_pollen"];
        if (typeof v === "number") { pollen[p] = v; any = true; }
      });
      cur.pollen = any ? pollen : null;
      if (!cur.time) cur.time = aq.current.time;
    }
    if (eq && Array.isArray(eq.features)) {
      cur.quakes = eq.features.map(function (f) {
        var c = f.geometry && f.geometry.coordinates;
        return {
          mag: f.properties.mag,
          place: f.properties.place,
          time: f.properties.time,
          url: f.properties.url,
          distanceKm: c ? Risk.haversineKm(place.lat, place.lon, c[1], c[0]) : null
        };
      });
    } else {
      cur.quakes = null;
    }

    // Build the next 24 hours, aligning air quality to weather by timestamp.
    var hours = [];
    if (wx && wx.hourly && cur.time) {
      var aqByTime = {};
      if (aq && aq.hourly) {
        aq.hourly.time.forEach(function (t, i) { aqByTime[t] = aq.hourly.us_aqi[i]; });
      }
      var nowHour = cur.time.slice(0, 13) + ":00";
      var start = wx.hourly.time.indexOf(nowHour);
      if (start === -1) start = 0;
      for (var i = start; i < Math.min(start + 24, wx.hourly.time.length); i++) {
        var t = wx.hourly.time[i];
        hours.push({
          time: t,
          feelsLike: wx.hourly.apparent_temperature[i],
          uv: wx.hourly.uv_index[i],
          isDay: wx.hourly.is_day[i] === 1,
          usAqi: aqByTime[t]
        });
      }
    }

    return { place: place, current: cur, hours: hours, failed: failed };
  }

  /* ---------- rendering ---------- */
  var WEATHER = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog",
    51: "Drizzle", 53: "Drizzle", 55: "Drizzle", 61: "Rain", 63: "Rain", 65: "Heavy rain",
    71: "Snow", 73: "Snow", 75: "Heavy snow", 80: "Showers", 81: "Showers", 82: "Heavy showers",
    95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm"
  };

  function fmt(v, unit, digits) {
    if (typeof v !== "number" || !isFinite(v)) return "—";
    return v.toFixed(digits || 0) + (unit || "");
  }

  function levelClass(l) { return l === null || l === undefined ? "lvl-na" : "lvl-" + l; }
  function levelName(l) { return l === null || l === undefined ? "No data" : Risk.LEVEL_NAMES[l]; }

  function hazardValue(h, cur) {
    switch (h.key) {
      case "heat":
      case "cold": return "Feels " + fmt(cur.feelsLike, "°C");
      case "air": return "AQI " + fmt(cur.usAqi) + (typeof cur.pm25 === "number" ? '<div class="small muted">PM2.5 ' + fmt(cur.pm25, " µg/m³") + "</div>" : "");
      case "uv": return "UV " + fmt(cur.uv, "", 1);
      case "pollen": return h.value ? esc(h.value.type) : "Not covered";
      case "quake":
        if (!cur.quakes) return "—";
        if (!cur.quakes.length) return "None (24h)";
        var big = cur.quakes.slice().sort(function (a, b) { return b.mag - a.mag; })[0];
        return "M" + fmt(big.mag, "", 1) + '<div class="small muted">' + fmt(big.distanceKm, " km away") + "</div>";
    }
    return "";
  }

  function hh(t) { return String(t).slice(11, 16); }

  function renderReport(data, form) {
    var cur = data.current;
    var opts = { profiles: form.profiles, limits: form.limits };
    var result = Risk.assess(cur, opts);
    var tl = Risk.timeline(data.hours, opts);
    var tips = Risk.advice(result, opts);
    var who = form.person ? esc(form.person) + " · " : "";
    var place = esc(placeLabel(data.place));

    var html = '<div class="report-head">' +
      '<div class="score ' + levelClass(result.overall) + '" aria-label="Safety score ' + result.score + ' out of 100">' +
        '<div>' + (result.score === null ? "—" : result.score) + '<small>/100</small></div></div>' +
      '<div class="report-title"><h2>' + who + place + '</h2>' +
        '<p><span class="badge ' + levelClass(result.overall) + '">' + levelName(result.overall) + ' risk</span> ' +
        '<span class="muted">' + esc(WEATHER[cur.weatherCode] || "") + (typeof cur.temp === "number" ? " · " + fmt(cur.temp, "°C") : "") +
        (cur.time ? " · updated " + hh(cur.time) + " local" : "") + '</span></p></div></div>';

    if (result.alerts.length) {
      html += '<div class="alerts" role="alert">' + result.alerts.map(function (a) { return "<p>⚠️ " + esc(a) + "</p>"; }).join("") + "</div>";
    }

    html += '<div class="grid hazards">' + result.hazards.map(function (h) {
      return '<div class="hazard ' + levelClass(h.level) + '"><div class="name">' + esc(h.label) + '</div>' +
        '<div class="val">' + hazardValue(h, cur) + '</div><div class="lvl">' + levelName(h.level) + "</div></div>";
    }).join("") + "</div>";

    html += "<h3>What to do</h3><ul class=\"advice\">" + tips.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";

    if (tl.points.length) {
      var bestFrom = tl.best ? tl.points.findIndex(function (p) { return p.time === tl.best.from; }) : -1;
      var bestTo = tl.best ? tl.points.findIndex(function (p) { return p.time === tl.best.to; }) : -1;
      html += "<h3>Next 24 hours</h3><div class=\"timeline\" role=\"img\" aria-label=\"Hourly risk for the next 24 hours\">" +
        tl.points.map(function (p, i) {
          var cls = "h " + levelClass(p.level) + (p.isDay ? "" : " night") + (i >= bestFrom && i <= bestTo && bestFrom !== -1 ? " best" : "");
          var tip = hh(p.time) + " · " + levelName(p.level) + " · feels " + fmt(p.feelsLike, "°C") + " · AQI " + fmt(p.usAqi) + " · UV " + fmt(p.uv, "", 1);
          return '<div class="' + cls + '" title="' + esc(tip) + '"></div>';
        }).join("") + "</div>" +
        '<div class="timeline-labels">' + tl.points.map(function (p, i) {
          return "<span>" + (i % 3 === 0 ? hh(p.time).slice(0, 2) : "") + "</span>";
        }).join("") + "</div>" +
        '<div class="legend">' + [0, 1, 2, 3, 4].map(function (l) {
          return '<span><i class="' + levelClass(l) + '"></i>' + Risk.LEVEL_NAMES[l] + "</span>";
        }).join("") + "<span>faded = night</span></div>";
      if (tl.best) {
        html += '<p class="best-window">🕒 Best time to be outside: ' + hh(tl.best.from) + "–" +
          String((hourNum(tl.best.to) + 1) % 24).padStart(2, "0") + ":00 (" + levelName(tl.best.level).toLowerCase() + " risk)</p>";
      }
    }

    if (data.failed.length) {
      html += '<p class="small muted">Some data could not be loaded: ' + esc(data.failed.join(", ")) + ".</p>";
    }

    var el = $("report");
    el.innerHTML = html;
    el.hidden = false;
    maybeNotify(form, data.place, result);
    return result;
  }

  function hourNum(t) { return parseInt(String(t).slice(11, 13), 10); }

  /* ---------- notifications ---------- */
  function maybeNotify(form, place, result) {
    if (!result.alerts.length || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    var title = "SafeAir: " + (form.person ? form.person + " — " : "") + placeLabel(place);
    var body = result.alerts.join(" ");
    var key = title + body;
    var last = state.notified[key];
    if (last && Date.now() - last < 3 * 3600 * 1000) return; // at most every 3h for the same alert
    state.notified[key] = Date.now();
    try { new Notification(title, { body: body }); } catch (e) { /* some browsers need a service worker */ }
  }

  function enableNotifications() {
    if (typeof Notification === "undefined") { setStatus("This browser doesn't support notifications.", true); return; }
    Notification.requestPermission().then(function (p) {
      setStatus(p === "granted" ? "Notifications on. You'll be alerted while this page is open." : "Notifications were not allowed.", p !== "granted");
    });
  }

  /* ---------- main check ---------- */
  var checkSeq = 0;

  function runCheck() {
    var form = readForm();
    if (!form.place) return;
    save();
    var seq = ++checkSeq;
    $("check").disabled = true;
    setStatus("Checking conditions…");
    fetchConditions(form.place).then(function (data) {
      if (seq !== checkSeq) return;
      renderReport(data, form);
      setStatus("");
    }).catch(function (e) {
      if (seq !== checkSeq) return;
      setStatus(e.message, true);
    }).then(function () {
      updateButtons();
    });
  }

  /* ---------- family list ---------- */
  function addToFamily() {
    var f = readForm();
    if (!f.place) return;
    f.id = String(Date.now());
    if (!f.person) f.person = f.place.name;
    state.family.push(f);
    save();
    renderFamily();
    refreshFamily();
  }

  function renderFamily() {
    var box = $("family");
    $("family-empty").hidden = state.family.length > 0;
    $("refresh-family").hidden = state.family.length === 0;
    box.innerHTML = state.family.map(function (m) {
      return '<div class="fam lvl-na" data-id="' + esc(m.id) + '">' +
        '<div class="who">' + esc(m.person) + "</div>" +
        '<div class="where">' + esc(placeLabel(m.place)) + "</div>" +
        '<div class="sum muted">Not checked yet</div>' +
        '<div class="btns"><button class="secondary" data-act="open">Open</button>' +
        '<button class="secondary" data-act="remove" aria-label="Remove ' + esc(m.person) + '">Remove</button></div></div>';
    }).join("");
  }

  function refreshFamily() {
    state.family.forEach(function (m) {
      var card = document.querySelector('.fam[data-id="' + CSS.escape(m.id) + '"]');
      if (!card) return;
      var sum = card.querySelector(".sum");
      sum.textContent = "Checking…";
      fetchConditions(m.place).then(function (data) {
        var r = Risk.assess(data.current, { profiles: m.profiles, limits: m.limits });
        card.className = "fam " + levelClass(r.overall);
        var worst = r.hazards.filter(function (h) { return h.level !== null && h.level === r.overall && r.overall > 0; })
          .map(function (h) { return h.label.toLowerCase(); });
        sum.className = "sum";
        sum.innerHTML = "<strong>" + (r.score === null ? "—" : r.score) + "/100</strong> · " + levelName(r.overall) + " risk" +
          (worst.length ? " (" + esc(worst.join(", ")) + ")" : "") +
          (r.alerts.length ? '<div class="error small">⚠️ ' + esc(r.alerts[0]) + "</div>" : "");
        maybeNotify(m, m.place, r);
      }).catch(function (e) {
        sum.className = "sum error small";
        sum.textContent = e.message;
      });
    });
  }

  function onFamilyClick(ev) {
    var btn = ev.target.closest("button[data-act]");
    if (!btn) return;
    var id = btn.closest(".fam").getAttribute("data-id");
    var idx = state.family.findIndex(function (m) { return m.id === id; });
    if (idx === -1) return;
    if (btn.getAttribute("data-act") === "remove") {
      state.family.splice(idx, 1);
      save();
      renderFamily();
      refreshFamily();
    } else {
      applyForm(state.family[idx]);
      runCheck();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  /* ---------- init ---------- */
  function init() {
    buildProfileChips();
    load();
    renderFamily();

    $("city").addEventListener("input", onCityInput);
    $("city").addEventListener("blur", function () { setTimeout(hideSuggestions, 150); });
    $("locate").addEventListener("click", useMyLocation);
    $("check").addEventListener("click", runCheck);
    $("save").addEventListener("click", addToFamily);
    $("notify").addEventListener("click", enableNotifications);
    $("refresh-family").addEventListener("click", refreshFamily);
    $("family").addEventListener("click", onFamilyClick);
    $("profile-chips").addEventListener("change", function () { if (state.place) runCheck(); });
    ["limit-aqi", "limit-heat", "person"].forEach(function (id) { $(id).addEventListener("change", save); });

    if (state.place) runCheck();
    if (state.family.length) refreshFamily();

    setInterval(function () {
      if (document.hidden) return;
      if (state.place) runCheck();
      if (state.family.length) refreshFamily();
    }, REFRESH_MS);
  }

  init();
})();
