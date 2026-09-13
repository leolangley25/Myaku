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

test("pattern names and guidance follow the house copy rules", () => {
  for (const [key, s] of Object.entries(PLAIN_STATES)) {
    const words = s.name.split(/\s+/);
    assert.ok(words.length >= 2 && words.length <= 4, `${key} name length`);
    assert.ok(words.every((w) => /^[A-Z]/.test(w)), `${key} name is title case`);
    assert.match(s.detail, /\.$/, `${key} detail ends with a period`);
    s.guidance.forEach((g) => assert.match(g, /\.$/, `${key} guidance ends with a period`));
  }
});
