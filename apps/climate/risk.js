/*
 * Risk engine for the climate-health app.
 * Pure functions only (no DOM, no network) so they can be unit-tested in Node.
 *
 * Levels: 0 Low, 1 Moderate, 2 High, 3 Very high, 4 Extreme, null = no data.
 */
(function (root) {
  "use strict";

  var LEVEL_NAMES = ["Low", "Moderate", "High", "Very high", "Extreme"];

  var PROFILES = {
    asthma:   { label: "Asthma / lung condition", air: true,  heat: false, pollen: true  },
    heart:    { label: "Heart condition",         air: true,  heat: true,  pollen: false },
    elderly:  { label: "65+ years old",            air: true,  heat: true,  pollen: false },
    kids:     { label: "Young children",           air: true,  heat: true,  pollen: false },
    pregnant: { label: "Pregnant",                 air: true,  heat: true,  pollen: false },
    outdoor:  { label: "Outdoor worker",           air: false, heat: true,  pollen: false },
    runner:   { label: "Runner / exercises outside", air: true, heat: true, pollen: false },
    allergy:  { label: "Pollen allergy",           air: false, heat: false, pollen: true  }
  };

  function sensitivity(profiles) {
    var s = { air: false, heat: false, pollen: false };
    (profiles || []).forEach(function (p) {
      var def = PROFILES[p];
      if (!def) return;
      if (def.air) s.air = true;
      if (def.heat) s.heat = true;
      if (def.pollen) s.pollen = true;
    });
    return s;
  }

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  function clampLevel(n) { return Math.max(0, Math.min(4, n)); }

  /* Heat, based on "feels like" (apparent) temperature in °C.
   * Bands follow the US NWS heat-index categories:
   * <27 low, 27–32 caution, 32–41 extreme caution, 41–54 danger, >=54 extreme danger.
   * Sensitive people are shifted up one level once it is at least warm. */
  function heatLevel(feelsLikeC, sensitive) {
    if (!isNum(feelsLikeC)) return null;
    var lvl;
    if (feelsLikeC >= 54) lvl = 4;
    else if (feelsLikeC >= 41) lvl = 3;
    else if (feelsLikeC >= 32) lvl = 2;
    else if (feelsLikeC >= 27) lvl = 1;
    else lvl = 0;
    if (sensitive && feelsLikeC >= 27) lvl += 1;
    return clampLevel(lvl);
  }

  /* Cold, based on feels-like temperature in °C. */
  function coldLevel(feelsLikeC, sensitive) {
    if (!isNum(feelsLikeC)) return null;
    var lvl;
    if (feelsLikeC <= -35) lvl = 4;
    else if (feelsLikeC <= -25) lvl = 3;
    else if (feelsLikeC <= -10) lvl = 2;
    else if (feelsLikeC <= 0) lvl = 1;
    else lvl = 0;
    if (sensitive && feelsLikeC <= 0) lvl += 1;
    return clampLevel(lvl);
  }

  /* Air quality, based on US AQI.
   * 0–50 good, 51–100 moderate, 101–150 unhealthy for sensitive groups,
   * 151–200 unhealthy, 201–300 very unhealthy, 301+ hazardous. */
  function airLevel(usAqi, sensitive) {
    if (!isNum(usAqi)) return null;
    if (usAqi > 300) return 4;
    if (usAqi > 200) return sensitive ? 4 : 3;
    if (usAqi > 150) return sensitive ? 3 : 2;
    if (usAqi > 100) return sensitive ? 2 : 1;
    if (usAqi > 50) return sensitive ? 1 : 0;
    return 0;
  }

  /* UV index (WHO scale). */
  function uvLevel(uv) {
    if (!isNum(uv)) return null;
    if (uv >= 11) return 4;
    if (uv >= 8) return 3;
    if (uv >= 6) return 2;
    if (uv >= 3) return 1;
    return 0;
  }

  /* Pollen in grains/m³. Only matters for allergy/asthma profiles.
   * Thresholds are per-plant "high" levels commonly used in European forecasts. */
  var POLLEN_HIGH = { grass: 50, birch: 100, alder: 100, olive: 100, mugwort: 50, ragweed: 30 };

  function pollenLevel(pollen, sensitive) {
    if (!pollen) return null;
    var worst = null;
    Object.keys(POLLEN_HIGH).forEach(function (k) {
      var v = pollen[k];
      if (!isNum(v)) return;
      var ratio = v / POLLEN_HIGH[k];
      var lvl = ratio >= 4 ? 4 : ratio >= 2 ? 3 : ratio >= 1 ? 2 : ratio >= 0.3 ? 1 : 0;
      if (worst === null || lvl > worst) worst = lvl;
    });
    if (worst === null) return null;
    if (!sensitive) worst = Math.min(worst, 1); // informational only for everyone else
    return worst;
  }

  function topPollen(pollen) {
    if (!pollen) return null;
    var best = null;
    Object.keys(POLLEN_HIGH).forEach(function (k) {
      var v = pollen[k];
      if (!isNum(v)) return;
      var ratio = v / POLLEN_HIGH[k];
      if (!best || ratio > best.ratio) best = { type: k, value: v, ratio: ratio };
    });
    return best;
  }

  /* Earthquakes: list of {mag, distanceKm, hoursAgo, place}. */
  function quakeLevel(quakes) {
    if (!quakes) return null;
    var lvl = 0;
    quakes.forEach(function (q) {
      var l = 0;
      if (q.mag >= 7) l = 4;
      else if (q.mag >= 6) l = 3;
      else if (q.mag >= 5) l = 2;
      else if (q.mag >= 4) l = 1;
      if (q.distanceKm > 300 && l > 0) l -= 1;
      if (l > lvl) lvl = l;
    });
    return lvl;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* Assess one moment in time.
   * conditions: { feelsLike, temp, usAqi, pm25, uv, isDay, pollen:{...}, quakes:[...] }
   * opts: { profiles:[], limits:{ aqi, feelsLike } } */
  function assess(conditions, opts) {
    opts = opts || {};
    var s = sensitivity(opts.profiles);
    var c = conditions || {};
    var hazards = [];

    function push(key, label, level, value) {
      hazards.push({ key: key, label: label, level: level, value: value });
    }

    var heat = heatLevel(c.feelsLike, s.heat);
    var cold = coldLevel(c.feelsLike, s.heat);
    if (cold !== null && cold > (heat || 0)) {
      push("cold", "Cold", cold, c.feelsLike);
    } else {
      push("heat", "Heat", heat, c.feelsLike);
    }
    push("air", "Air quality", airLevel(c.usAqi, s.air), c.usAqi);
    push("uv", "UV", c.isDay === false ? 0 : uvLevel(c.uv), c.uv);
    if (c.pollen !== undefined) push("pollen", "Pollen", pollenLevel(c.pollen, s.pollen), topPollen(c.pollen));
    if (c.quakes !== undefined) push("quake", "Earthquakes", quakeLevel(c.quakes), c.quakes);

    var overall = 0;
    hazards.forEach(function (h) { if (h.level !== null && h.level > overall) overall = h.level; });

    var limits = opts.limits || {};
    var alerts = [];
    if (isNum(limits.aqi) && isNum(c.usAqi) && c.usAqi > limits.aqi) {
      alerts.push("Air quality (AQI " + Math.round(c.usAqi) + ") is above your limit of " + limits.aqi + ".");
    }
    if (isNum(limits.feelsLike) && isNum(c.feelsLike) && c.feelsLike > limits.feelsLike) {
      alerts.push("Feels-like temperature (" + Math.round(c.feelsLike) + "°C) is above your limit of " + limits.feelsLike + "°C.");
    }

    return {
      overall: overall,
      overallName: LEVEL_NAMES[overall],
      score: safetyScore(hazards),
      hazards: hazards,
      alerts: alerts,
      sensitivity: s
    };
  }

  /* 0–100, higher is safer. Driven by the worst hazard, with a small
   * penalty for each additional hazard at Moderate or above. */
  function safetyScore(hazards) {
    var levels = hazards.map(function (h) { return h.level; }).filter(function (l) { return l !== null; });
    if (!levels.length) return null;
    levels.sort(function (a, b) { return b - a; });
    var base = [100, 75, 50, 25, 5][levels[0]];
    var extra = levels.slice(1).filter(function (l) { return l >= 1; }).length * 5;
    return Math.max(0, base - extra);
  }

  /* Hourly series: array of { time:"YYYY-MM-DDTHH:MM", feelsLike, usAqi, uv, isDay }.
   * Returns per-hour levels and the best window to be outside (daylight preferred). */
  function timeline(hours, opts) {
    var points = hours.map(function (h) {
      var a = assess({ feelsLike: h.feelsLike, usAqi: h.usAqi, uv: h.uv, isDay: h.isDay, pollen: h.pollen }, opts);
      return { time: h.time, level: a.overall, isDay: h.isDay, feelsLike: h.feelsLike, usAqi: h.usAqi, uv: h.uv };
    });
    return { points: points, best: bestWindow(points) };
  }

  function hourOf(time) { return parseInt(String(time).slice(11, 13), 10); }

  /* Longest run of consecutive hours sharing the lowest level, restricted to
   * 05:00–21:59 (when people realistically go out). Ties go to the earliest run. */
  function bestWindow(points) {
    var usable = points.map(function (p, i) { return { p: p, i: i }; }).filter(function (x) {
      var h = hourOf(x.p.time);
      return h >= 5 && h <= 21;
    });
    if (!usable.length) return null;
    var minLevel = Math.min.apply(null, usable.map(function (x) { return x.p.level; }));
    var best = null;
    var run = null;
    usable.forEach(function (x) {
      var ok = x.p.level === minLevel;
      var contiguous = run && x.i === run.end + 1;
      if (ok && contiguous) {
        run.end = x.i;
      } else if (ok) {
        run = { start: x.i, end: x.i };
      } else {
        run = null;
      }
      if (run && (!best || run.end - run.start > best.end - best.start)) {
        best = { start: run.start, end: run.end };
      }
    });
    if (!best) return null;
    return {
      level: minLevel,
      from: points[best.start].time,
      to: points[best.end].time,
      hours: best.end - best.start + 1
    };
  }

  /* Plain-language advice for the current assessment. */
  function advice(result, opts) {
    var tips = [];
    var s = result.sensitivity;
    var byKey = {};
    result.hazards.forEach(function (h) { byKey[h.key] = h; });
    var profiles = (opts && opts.profiles) || [];

    var heat = byKey.heat;
    if (heat && heat.level !== null && heat.level >= 1) {
      if (heat.level >= 3) tips.push("Dangerous heat. Stay indoors in a cool place between late morning and evening, and check on older neighbours and relatives.");
      else if (heat.level === 2) tips.push("It feels very hot. Avoid hard effort in the afternoon, rest in shade and drink water every 15–20 minutes when outside.");
      else tips.push("Warm. Carry water and take breaks in the shade.");
      if (profiles.indexOf("outdoor") !== -1 && heat.level >= 2) tips.push("Outdoor work: schedule heavy tasks for early morning and take a cool-down break every hour.");
    }

    var cold = byKey.cold;
    if (cold && cold.level !== null && cold.level >= 1) {
      tips.push(cold.level >= 2
        ? "Severe cold. Cover skin, wear layers and limit time outside to avoid frostbite."
        : "Cold. Dress in layers and keep hands and head covered.");
    }

    var air = byKey.air;
    if (air && air.level !== null && air.level >= 1) {
      if (air.level >= 3) tips.push("Air is unhealthy. Stay indoors with windows closed and use an air purifier if you have one. If you must go out, wear a well-fitted N95/FFP2 mask.");
      else if (air.level === 2) tips.push("Air quality is poor. Cut back on long or intense outdoor activity" + (s.air ? ", and keep your medication with you." : "."));
      else tips.push("Air is acceptable, but people sensitive to pollution should take it easy outdoors.");
      if (profiles.indexOf("asthma") !== -1 && air.level >= 2) tips.push("Asthma: keep your reliever inhaler on you and follow your action plan if symptoms start.");
    }

    var uv = byKey.uv;
    if (uv && uv.level !== null && uv.level >= 2) {
      tips.push(uv.level >= 3
        ? "Very strong sun. Avoid direct sun around midday; use SPF 30+, a hat and sunglasses."
        : "Strong sun. Use sunscreen and seek shade around midday.");
    }

    var pollen = byKey.pollen;
    if (pollen && pollen.level !== null && pollen.level >= 2 && s.pollen) {
      tips.push("High pollen" + (pollen.value ? " (mainly " + pollen.value.type + ")" : "") + ". Take your allergy medication early, keep windows closed and shower after being outside.");
    }

    var quake = byKey.quake;
    if (quake && quake.level !== null && quake.level >= 1) {
      tips.push("A notable earthquake was recorded nearby. Follow local authority guidance and be ready for aftershocks.");
    }

    if (!tips.length) tips.push("Conditions look fine right now. Enjoy your day outside.");
    return tips;
  }

  var api = {
    LEVEL_NAMES: LEVEL_NAMES,
    PROFILES: PROFILES,
    sensitivity: sensitivity,
    heatLevel: heatLevel,
    coldLevel: coldLevel,
    airLevel: airLevel,
    uvLevel: uvLevel,
    pollenLevel: pollenLevel,
    quakeLevel: quakeLevel,
    haversineKm: haversineKm,
    assess: assess,
    safetyScore: safetyScore,
    timeline: timeline,
    bestWindow: bestWindow,
    advice: advice
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Risk = api;
})(this);
