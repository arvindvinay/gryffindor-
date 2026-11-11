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
