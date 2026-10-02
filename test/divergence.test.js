const test = require("node:test");
const assert = require("node:assert/strict");
const { compute, PLAIN_STATES } = require("../server/divergence");

/* Deterministic noise, so a failure is reproducible. */
function rng(seed) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return (mean, sd) => {
    let z = 0;
    for (let i = 0; i < 6; i++) z += rnd();
    return mean + ((z - 3) / Math.sqrt(0.5)) * sd;
  };
}

const key = (i) => new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10);
const c10 = (v) => Math.max(0, Math.min(10, Math.round(v)));

/* Eight weeks of a steady athlete, optionally with the last three weeks under
   pressure on the brain and life channels only. */
function season({ pressure = false } = {}) {
  const g = rng(7);
  const metrics = [], sessions = [], daily = [];
  for (let i = 0; i < 56; i++) {
    const p = pressure && i >= 35 ? 1 : 0;
    metrics.push({ date: key(i), hrv_ms: g(68, 5), rhr_bpm: g(52, 2), sleep_minutes: g(450, 30), sleep_efficiency: g(92, 2) });
    if ([1, 3, 5].includes(new Date(key(i) + "T00:00:00Z").getUTCDay())) {
      const m = g(268 + p * 45, 11);
      sessions.push({ date: key(i), valid: 1, mean_rt: m, mean_reciprocal: 1000 / m, lapses: Math.max(0, Math.round(g(1 + p * 6, 1))) });
    }
    daily.push({
      date: key(i), load_0_10: c10(g(4.5 + p * 4, 1)), recovery_0_10: c10(g(7 - p * 4, 1)),
      control_0_10: c10(g(7 - p * 5, 1)), focus_0_10: c10(g(7 - p * 3, 1)), motivation_0_10: c10(g(8 - p * 3, 1)),
      valence: g(0.4 - p, 0.2), arousal: g(0.1, 0.2),
    });
  }
  return { metrics, sessions, daily, weekly: [], journal: [] };
}

test("a steady athlete reads as all clear at every sensitivity", () => {
  for (const sensitivity of ["light", "medium", "heavy"]) {
    const d = compute({ ...season(), sensitivity });
    assert.equal(d.state.key, "aligned", sensitivity);
    assert.equal(d.state.name, "All Clear");
    assert.equal(d.state.support, false);
  }
});

test("pressure on brain and life, with a steady body, is detected", () => {
  const d = compute({ ...season({ pressure: true }), sensitivity: "medium" });
  assert.ok(d.channels.cognitive.z > 1, `brain z ${d.channels.cognitive.z}`);
  assert.ok(d.channels.psychological.z > 1, `life z ${d.channels.psychological.z}`);
  assert.ok(Math.abs(d.channels.autonomic.z) < 1, `body z ${d.channels.autonomic.z}`);
  assert.notEqual(d.state.key, "aligned");
  assert.ok(d.state.guidance.length > 0);
});

test("a more sensitive setting never reports fewer disagreements", () => {
  const data = season({ pressure: true });
  const light = compute({ ...data, sensitivity: "light" });
  const heavy = compute({ ...data, sensitivity: "heavy" });
  assert.ok(heavy.readings.length >= light.readings.length);
});

test("readings use the last seven days, so a Monday is not judged on one day alone", () => {
  const data = season({ pressure: true });
  const monday = key(56);
  data.metrics.push({ date: monday, hrv_ms: 68, rhr_bpm: 52, sleep_minutes: 450, sleep_efficiency: 92 });

  const d = compute({ ...data, sensitivity: "medium", today: monday });
  const points = d.channels.autonomic.points;
  // The latest window runs from the Tuesday before through the Monday itself.
  assert.equal(points[points.length - 1].week, key(50));
  assert.equal(d.anchor, monday);

  assert.deepEqual(Object.keys(d.channels.cognitive.parts).sort(), ["lapses", "speed"]);
  assert.deepEqual(
    Object.keys(d.channels.psychological.parts).sort(),
    ["burnout", "connection", "control", "focus", "load", "mood", "motivation", "recovery", "strain", "writing"]
  );
  assert.ok(d.channels.cognitive.parts.speed > 1, `speed z ${d.channels.cognitive.parts.speed}`);
});

test("a weekly reflection counts toward the seven days it describes", () => {
  const data = season({ pressure: true });
  data.weekly = Array.from({ length: 8 }, (_, w) => ({
    week_start: key(w * 7), demand_training: 4, control_training: 5,
    abq_exhaustion: w >= 5 ? 4 : 2, abq_accomplishment: 4, abq_devaluation: 1,
  }));
  // A Tuesday, when the latest reflection's Monday has already left the window.
  const d = compute({ ...data, sensitivity: "medium", today: key(57) });
  assert.notEqual(d.channels.psychological.parts.burnout, null);
  assert.notEqual(d.channels.psychological.parts.strain, null);
});

test("the season timeline reads each past week the way the model would have at the time", () => {
  const { season: seasonTimeline } = require("../server/trends");
  const data = season({ pressure: true });
  const r = seasonTimeline({ ...data, sensitivity: "medium", today: key(55) });

  assert.equal(r.hasData, true);
  assert.equal(r.weeks.length, 8);
  assert.equal(r.weeks[r.weeks.length - 1].end, key(55));
  // The first week comes before any baseline exists, so it carries no pattern.
  assert.equal(r.weeks[0].state, null);
  // The quiet stretch is All Clear, and the pressured weeks at the end are not.
  assert.ok(r.patterns.some((p) => p.key === "aligned"));
  assert.notEqual(r.current.key, "aligned");
  assert.ok(r.heldWeeks >= 1);
  assert.ok(r.previous);
  assert.equal(seasonTimeline({ today: key(55) }).hasData, false);
});

test("pattern names and guidance follow the house copy rules", () => {
  for (const [key, s] of Object.entries(PLAIN_STATES)) {
    const words = s.name.split(/\s+/);
    assert.ok(words.length >= 2 && words.length <= 4, `${key} name length`);
    assert.ok(words.every((w) => /^[A-Z]/.test(w)), `${key} name is title case`);
    assert.match(s.detail, /\.$/, `${key} detail ends with a period`);
    s.guidance.forEach((g) => assert.match(g, /\.$/, `${key} guidance ends with a period`));
  }
});
