/* Small pure modules: validation, token sealing, statistics, and the
   browser-side interpretation layer loaded into a sandbox. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const v = require("../server/validate");
const { tokenSealer, passwordProblem } = require("../server/security");
const analytics = require("../server/analytics");

test("validation clamps, rejects, and cleans", () => {
  assert.equal(v.isDate("2026-02-29"), false);
  assert.equal(v.isDate("2028-02-29"), true);
  assert.equal(v.intIn("11", 0, 10), 10);
  assert.equal(v.intIn("abc", 0, 10), null);
  assert.equal(v.numIn(-3, -1, 1), -1);
  assert.equal(v.time("24:00", "07:30"), "07:30");
  assert.equal(v.tags(["School, Work", "School, Work", ""]), "School  Work");
  assert.equal(v.timezone("Mars/Olympus"), "UTC");
  assert.equal(v.timezone("America/Chicago"), "America/Chicago");
  assert.equal(v.weekdays([6, 1, 1, 9]), "1,6");
});

test("the body reading keeps schedules continuous across midnight and reads averages against a normal range", () => {
  const body = require("../server/body");
  const divergence = require("../server/divergence");
  const day = (i) => new Date(Date.parse("2026-08-01T00:00:00Z") + i * 86400000).toISOString().slice(0, 10);

  const metrics = [];
  const daily = [];
  for (let i = 0; i < 42; i++) {
    const late = i % 2 === 1;
    metrics.push({
      date: day(i),
      hrv_ms: i < 35 ? 60 + (i % 3) - 1 : 40,
      rhr_bpm: 50 + (i % 3) - 1,
      sleep_minutes: i >= 35 ? 420 : 480,
      sleep_efficiency: 90,
      sleep_start: late ? `${day(i)} 00:30` : `${day(i - 1)} 23:30`,
      sleep_end: `${day(i)} 07:30`,
      source: "whoop",
    });
    daily.push({ date: day(i), load_0_10: i % 2 ? 8 : 3 });
  }

  assert.equal(body.clockOf("2026-09-01 00:30", 12), 1470);
  assert.equal(body.clockOf("2026-09-01 23:30", 12), 1410);

  const r = body.compute({ metrics, daily });
  assert.equal(r.goal, 480);
  assert.equal(r.goalSaved, false);
  assert.deepEqual(r.sleep.week, { nights: 7, average: 420, atGoal: 0, shortfall: 420 });
  // Half the nights at 23:30 and half at 00:30 is a midnight bedtime, not noon.
  assert.equal(r.sleep.timing.usualBedtime, "00:00");
  assert.equal(r.sleep.timing.bedtimeSpread, 31);
  assert.equal(r.sleep.inBedNeeded, 533);

  assert.equal(r.hrv.status, "below");
  assert.equal(r.hrv.current, 40);
  assert.equal(r.rhr.status, "within");
  assert.equal(r.afterHardDays.hardDays, 20);
  assert.equal(r.afterHardDays.easyDays, 21);
  assert.equal(r.sources.sdnn, false);

  assert.equal(body.compute({ metrics, daily, goalMinutes: 540 }).goal, 540);

  const d = divergence.compute({ metrics });
  assert.deepEqual(Object.keys(d.channels.autonomic.parts).sort(), ["hrv_ms", "rhr_bpm", "sleep_efficiency", "sleep_minutes"]);
});

test("the brain reading pools the last seven days and separates caffeine, sleep, and felt sharpness", () => {
  const brain = require("../server/brain");
  const day = (i) => new Date(Date.parse("2026-08-01T00:00:00Z") + i * 86400000).toISOString().slice(0, 10);

  const sessions = [];
  const metrics = [];
  const daily = [];
  for (let i = 0; i <= 40; i += 2) {
    const late = i >= 35;
    const shortNight = i % 4 === 0;
    sessions.push({
      date: day(i), valid: 1, n_trials: 40, sem_rt: 10,
      mean_rt: 260 + (late ? 30 : 0) + (shortNight ? 10 : 0),
      lapses: late ? 5 : 1,
      local_time: i % 6 === 0 ? "18:00" : "07:30",
      caffeine_minutes_prior: i % 8 === 0 ? 60 : null,
      device: "iPhone · Touch · 120 Hz",
    });
    metrics.push({ date: day(i), sleep_minutes: shortNight ? 380 : 480 });
    daily.push({ date: day(i), focus_0_10: shortNight ? 3 : 8 });
  }

  const r = brain.compute({ sessions, metrics, daily, today: day(41) });
  assert.equal(r.week.sessions, 3);
  assert.equal(r.week.meanRt, 296.7);
  // Three tests with a ten millisecond error each pool to about 5.8.
  assert.equal(r.week.precision, 5.8);
  assert.deepEqual([r.usual.meanRt, r.usual.low, r.usual.high], [265, 260, 270]);
  assert.equal(r.timing.usualTime, "07:30");
  assert.deepEqual([r.timing.withinHour, r.timing.of], [7, 10]);
  assert.deepEqual([r.caffeine.withN, r.caffeine.withoutN], [6, 15]);
  assert.ok(r.sleep.short.rt > r.sleep.long.rt);
  assert.deepEqual([r.felt.foggyRt, r.felt.sharpRt], [270, 260]);
  assert.equal(r.devices.mixedRecently, false);
  assert.equal(brain.compute({ sessions: [] }).hasData, false);
});

test("the life reading counts strain days, mood, and burnout movement against the weeks before", () => {
  const life = require("../server/life");
  const day = (i) => new Date(Date.parse("2026-08-01T00:00:00Z") + i * 86400000).toISOString().slice(0, 10);

  const daily = [];
  for (let i = 0; i < 35; i++) {
    const late = i >= 28;
    daily.push({
      date: day(i), load_0_10: late ? 8 : 4, control_0_10: late ? 2 : 7,
      recovery_0_10: 6, focus_0_10: 6, motivation_0_10: 7,
      valence: late ? -0.5 : 0.4, arousal: 0.3, attribution: late ? "School" : "Training",
    });
  }
  const weekly = [0, 7, 14, 21, 28].map((i, k) => ({
    week_start: day(i), demand_academic: k === 4 ? 6 : 3, control_academic: k === 4 ? 2 : 5,
    abq_exhaustion: 1 + k, abq_accomplishment: 4, abq_devaluation: 1,
  }));

  const r = life.compute({ daily, weekly, journal: [], metrics: [], today: day(34) });
  assert.deepEqual([r.strain.days, r.strain.of, r.strain.usualShare], [7, 7, 0]);
  assert.deepEqual([r.measures.load.now, r.measures.load.usual], [8, 4]);
  assert.equal(r.checkins.days, 7);
  assert.deepEqual([r.mood.recent.roughWired, r.mood.recent.goodWired], [7, 7]);
  assert.equal(r.domains.find((d) => d.key === "academic").strained, true);
  assert.equal(r.burnout.moves.exhaustion, 2);
  assert.equal(r.burnout.moves.accomplishment, 0);
  assert.equal(r.drivers.tags[0].tag, "School");
  assert.equal(life.compute({}).hasData, false);
});

test("caffeine left at bedtime is paired with the night that follows", () => {
  const caffeine = [
    { date: "2026-03-02", label: "Coffee", mg: 100, logged_at: "08:00" },
    { date: "2026-03-03", label: "Coffee", mg: 100, logged_at: "08:00" },
    { date: "2026-03-03", label: "Celsius", mg: 200, logged_at: "18:00" },
  ];
  const metrics = [
    { date: "2026-03-03", sleep_minutes: 480, sleep_efficiency: 93, hrv_ms: 70, rhr_bpm: 50 },
    { date: "2026-03-04", sleep_minutes: 400, sleep_efficiency: 85, hrv_ms: 60, rhr_bpm: 54 },
  ];
  const r = analytics.caffeineNights(caffeine, metrics, { bedtime: "23:00", today: "2026-03-05" });
  assert.equal(r.hasBodyData, true);
  assert.equal(r.pairedNights, 2);
  // 100 mg fifteen hours before bed is three half-lives.
  assert.equal(r.nights[0].bedMg, 12.5);
  assert.equal(r.nights[0].zone, "clear");
  assert.equal(r.nights[0].sleepMinutes, 480);
  // One half-life of 200 mg, the morning coffee, and a trace of the day before.
  assert.equal(r.nights[1].bedMg, 112.9);
  assert.equal(r.nights[1].zone, "high");
  assert.equal(r.nights[1].sleepMinutes, 400);
  assert.deepEqual(r.zones.map((z) => z.n), [1, 0, 1]);
  assert.equal(r.topDrinks[0].label, "Coffee");

  // A bedtime after midnight belongs to the evening before it.
  assert.equal(analytics.caffeineNights(caffeine, metrics, { bedtime: "00:30" }).bedHour, 24.5);

  // A drink just before bed is counted at its peak, not at the minute it was logged.
  const late = analytics.caffeineNights([{ date: "2026-03-02", mg: 100, logged_at: "22:45" }], [], { bedtime: "23:00" });
  assert.ok(late.days[0].bedMg > 85, String(late.days[0].bedMg));
  assert.equal(late.days[0].zone, "high");
  assert.equal(late.hasBodyData, false);
});

test("sealed tokens open with the right secret and fail when tampered", () => {
  const sealer = tokenSealer("a secret");
  const sealed = sealer.seal("access-token-value");
  assert.notEqual(sealed, "access-token-value");
  assert.equal(sealer.open(sealed), "access-token-value");
  const [iv, tag, data] = sealed.split(".");
  const tampered = [iv, tag, Buffer.from("x" + Buffer.from(data, "base64url").toString("latin1"), "latin1").toString("base64url")].join(".");
  assert.throws(() => sealer.open(tampered));
  assert.throws(() => tokenSealer("another secret").open(sealed));
});

test("password rules catch short, huge, and common passwords", () => {
  assert.ok(passwordProblem("short"));
  assert.ok(passwordProblem("x".repeat(201)));
  assert.ok(passwordProblem("Password123"));
  assert.equal(passwordProblem("correct horse battery"), null);
});

test("rank correlation and its chance estimate behave at the extremes", () => {
  assert.equal(analytics.spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1);
  assert.equal(analytics.spearman([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]), -1);
  assert.equal(analytics.correlationP(0.5, 4), null);
  assert.ok(analytics.correlationP(0, 30) > 0.99);
  assert.ok(analytics.correlationP(0.9, 30) < 0.001);
});

/* explain.js is written for the browser, so it is evaluated in a sandbox. */
function loadExplain() {
  const code = fs.readFileSync(path.join(__dirname, "..", "js", "explain.js"), "utf8");
  const sandbox = {};
  vm.runInNewContext(`${code}\nthis.Explain = Explain;`, sandbox);
  return sandbox.Explain;
}

test("plain-language bands follow the chosen sensitivity", () => {
  const E = loadExplain();
  const medium = { notable: 1.0, marked: 1.5 };
  assert.equal(E.band(0.2, medium).word, "Typical For You");
  assert.equal(E.band(1.2, medium).word, "Worse Than Usual");
  assert.equal(E.band(2, medium).short, "Much Worse");
  assert.equal(E.band(1.2, { notable: 1.5, marked: 2.2 }).word, "Typical For You");
  assert.equal(E.band(2, medium).tone, "bad");
});

test("readings are compared in the right direction for each measure", () => {
  const E = loadExplain();
  const history = [52, 53, 52, 54, 53, 52, 53];
  const rhrUp = E.compare(58, history, { higherIsWorse: true, unit: " bpm" });
  assert.equal(rhrUp.tone, "warn");
  assert.match(rhrUp.sentence, /above your usual 53 bpm\./);
  const hrvUp = E.compare(80, [60, 62, 61, 63, 60], { higherIsWorse: false, unit: " ms" });
  assert.equal(hrvUp.tone, "good");
  assert.equal(E.compare(53, history, { higherIsWorse: true }).word, "Typical For You");
});

test("ranks are stated as counts, and correlations never say less quality", () => {
  const E = loadExplain();
  const points = [0.1, 0.4, 0.2, 1.8].map((z) => ({ z }));
  assert.equal(E.rankSentence(points), "This is the highest of your 4 recorded weeks.");
  assert.match(E.correlationSentence(-0.35, 55, { xLabel: "late caffeine", yLabel: "sleep quality" }), /lower sleep quality/);
  assert.match(E.correlationSentence(0.05, 55, { xLabel: "a", yLabel: "b" }), /almost no pattern/);
  assert.equal(E.duration(432), "7h 12m");
});
