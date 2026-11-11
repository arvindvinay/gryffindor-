const test = require("node:test");
const assert = require("node:assert/strict");
const Risk = require("../apps/climate/risk.js");

test("heat bands follow NWS categories", () => {
  assert.equal(Risk.heatLevel(20, false), 0);
  assert.equal(Risk.heatLevel(28, false), 1);
  assert.equal(Risk.heatLevel(35, false), 2);
  assert.equal(Risk.heatLevel(45, false), 3);
  assert.equal(Risk.heatLevel(55, false), 4);
  assert.equal(Risk.heatLevel(null, false), null);
});

test("heat-sensitive people are bumped up one level once it is warm", () => {
  assert.equal(Risk.heatLevel(20, true), 0);
  assert.equal(Risk.heatLevel(35, true), 3);
  assert.equal(Risk.heatLevel(60, true), 4);
});

test("air quality uses US AQI bands, stricter for sensitive groups", () => {
  assert.equal(Risk.airLevel(40, false), 0);
  assert.equal(Risk.airLevel(80, false), 0);
  assert.equal(Risk.airLevel(80, true), 1);
  assert.equal(Risk.airLevel(120, false), 1);
  assert.equal(Risk.airLevel(120, true), 2);
  assert.equal(Risk.airLevel(180, false), 2);
  assert.equal(Risk.airLevel(250, false), 3);
  assert.equal(Risk.airLevel(350, false), 4);
  assert.equal(Risk.airLevel(undefined, false), null);
});

test("UV and pollen levels", () => {
  assert.equal(Risk.uvLevel(1), 0);
  assert.equal(Risk.uvLevel(6.5), 2);
  assert.equal(Risk.uvLevel(11), 4);
  assert.equal(Risk.pollenLevel(null, true), null);
  assert.equal(Risk.pollenLevel({ grass: 120 }, true), 3);
  assert.equal(Risk.pollenLevel({ grass: 120 }, false), 1, "non-allergic users only get an informational level");
});

test("earthquakes: magnitude and distance", () => {
  assert.equal(Risk.quakeLevel([]), 0);
  assert.equal(Risk.quakeLevel([{ mag: 5.5, distanceKm: 50 }]), 2);
  assert.equal(Risk.quakeLevel([{ mag: 5.5, distanceKm: 450 }]), 1);
  assert.ok(Math.abs(Risk.haversineKm(28.61, 77.21, 19.08, 72.88) - 1150) < 20, "Delhi–Mumbai ≈ 1150 km");
});

test("assess: overall is the worst hazard; alerts respect user limits", () => {
  const r = Risk.assess(
    { feelsLike: 36, usAqi: 160, uv: 3, isDay: true, quakes: [] },
    { profiles: ["asthma"], limits: { aqi: 100, feelsLike: 40 } }
  );
  const air = r.hazards.find((h) => h.key === "air");
  assert.equal(air.level, 3);
  assert.equal(r.overall, 3);
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0], /AQI 160/);
  assert.ok(r.score < 30);
});

test("assess: night time ignores UV, cold replaces heat when freezing", () => {
  const night = Risk.assess({ feelsLike: 20, usAqi: 10, uv: 9, isDay: false });
  assert.equal(night.overall, 0);
  assert.equal(night.score, 100);
  const cold = Risk.assess({ feelsLike: -15, usAqi: 10, uv: 0, isDay: true });
  assert.ok(cold.hazards.some((h) => h.key === "cold" && h.level === 2));
});

test("timeline picks the longest lowest-risk daylight window", () => {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const hot = h >= 11 && h <= 17;
    hours.push({
      time: "2026-07-01T" + String(h).padStart(2, "0") + ":00",
      feelsLike: hot ? 43 : 25,
      usAqi: 40,
      uv: hot ? 9 : 1,
      isDay: h >= 6 && h <= 19
    });
  }
  const tl = Risk.timeline(hours, {});
  assert.equal(tl.points.length, 24);
  assert.equal(tl.best.level, 0);
  assert.equal(tl.best.from, "2026-07-01T05:00");
  assert.equal(tl.best.to, "2026-07-01T10:00");
});

test("advice is personalised", () => {
  const opts = { profiles: ["asthma", "outdoor"] };
  const r = Risk.assess({ feelsLike: 38, usAqi: 170, uv: 2, isDay: true }, opts);
  const tips = Risk.advice(r, opts).join(" ");
  assert.match(tips, /inhaler/);
  assert.match(tips, /Outdoor work/);
  const calm = Risk.assess({ feelsLike: 22, usAqi: 20, uv: 1, isDay: true }, {});
  assert.match(Risk.advice(calm, {})[0], /look fine/);
});

test("activities add their exposure profile", () => {
  assert.deepEqual(Risk.activityProfiles(["asthma"], "run"), ["asthma", "runner"]);
  assert.deepEqual(Risk.activityProfiles([], "walk"), []);
  const hot = { feelsLike: 30, usAqi: 20, uv: 1, isDay: true };
  const walk = Risk.assess(hot, { profiles: Risk.activityProfiles([], "walk") }).overall;
  const work = Risk.assess(hot, { profiles: Risk.activityProfiles([], "work") }).overall;
  assert.ok(work > walk, "outdoor work in heat is riskier than a walk");
});

test("headline mentions the worst hazards and a better window", () => {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const t = (13 + h) % 24;
    hours.push({ time: "2026-07-01T" + String(t).padStart(2, "0") + ":00", feelsLike: t >= 11 && t <= 17 ? 42 : 24, usAqi: 30, uv: 1, isDay: true });
  }
  const r = Risk.assess({ feelsLike: 42, usAqi: 30, uv: 1, isDay: true });
  const text = Risk.headline(r, Risk.timeline(hours, {}));
  assert.match(text, /^Dangerous heat right now\. Better window: \d\d:00–\d\d:00\.$/);
  const calm = Risk.assess({ feelsLike: 20, usAqi: 10, uv: 1, isDay: true });
  assert.match(Risk.headline(calm, null), /Clear skies/);
});

test("ventilation window picks the cleanest, not-too-hot hour", () => {
  const v = Risk.ventilationWindow([
    { time: "2026-07-01T05:00", usAqi: 60, feelsLike: 25 },
    { time: "2026-07-01T14:00", usAqi: 40, feelsLike: 38 },
    { time: "2026-07-01T20:00", usAqi: 90, feelsLike: 28 }
  ]);
  assert.equal(v.time, "2026-07-01T05:00");
  assert.equal(Risk.maskAdvice(160, false) !== null, true);
  assert.equal(Risk.maskAdvice(120, false), null);
  assert.notEqual(Risk.maskAdvice(120, true), null);
});

test("dailySummaries groups hours into days with worst values", () => {
  const hours = [];
  for (let d = 0; d < 2; d++) for (let h = 0; h < 24; h++) {
    hours.push({ time: `2026-07-0${d + 1}T${String(h).padStart(2, "0")}:00`, feelsLike: d === 0 ? 30 + (h === 14 ? 12 : 0) : 22, usAqi: 40, uv: d === 0 && h === 13 ? 9 : 1, isDay: h >= 6 && h <= 19, weatherCode: 1, precip: 20 });
  }
  const days = Risk.dailySummaries(hours, {});
  assert.equal(days.length, 2);
  assert.equal(days[0].maxFeels, 42);
  assert.equal(days[0].maxUv, 9);
  assert.equal(days[0].level, 3);
  assert.equal(days[1].level, 0);
});

test("diary insight needs enough data, then compares unwell vs good days", () => {
  assert.equal(Risk.diaryInsight([]).ready, false);
  const entries = [
    { feeling: "bad", symptoms: ["Cough"], aqi: 180, feelsLike: 30 },
    { feeling: "meh", symptoms: ["Cough", "Headache"], aqi: 160, feelsLike: 31 },
    { feeling: "great", symptoms: [], aqi: 50, feelsLike: 29 },
    { feeling: "good", symptoms: [], aqi: 70, feelsLike: 30 }
  ];
  const r = Risk.diaryInsight(entries);
  assert.equal(r.ready, true);
  assert.match(r.message, /AQI 170, compared with 60/);
  assert.match(r.message, /most common symptom: cough/);
  assert.equal(Risk.isUnwell({ feeling: "good", symptoms: ["Sneezing"] }), true);
});
