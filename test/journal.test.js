const test = require("node:test");
const assert = require("node:assert/strict");

const journal = require("../server/journal");

const day = (offset, base = "2026-09-30") =>
  new Date(Date.parse(base + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);

const entry = (offset, extra = {}) => ({
  entry_date: day(offset),
  mode: "free",
  word_count: 120,
  valence: 0,
  ...extra,
});

test("every prompt says what it is for, and none of them ask why you feel this way", () => {
  assert.ok(journal.MODES.length >= 5);
  for (const mode of journal.MODES) {
    assert.ok(mode.name && mode.prompt && mode.why, `${mode.id} is missing its wording`);
    assert.ok(mode.minutes > 0);
    /* Those two questions sit on the rumination scale itself. */
    assert.doesNotMatch(mode.prompt, /why do (i|you) feel/i);
    assert.doesNotMatch(mode.prompt, /what.{0,6}s wrong with (me|you)/i);
  }
  /* The one with a short-term cost says so. */
  assert.match(journal.MODE_BY_ID.expressive.why, /worse/i);
});

test("the suggestion follows the hour, the day and what was already used", () => {
  const today = day(0);
  assert.equal(journal.suggest({ entries: [], today, hour: 22 }).mode, "tomorrow");
  assert.equal(journal.suggest({ entries: [], today, hour: 18, hadEvent: true }).mode, "performance");
  assert.equal(
    journal.suggest({ entries: [], today, hour: 18, lastCheckin: { load: 7, control: 2 } }).mode,
    "distanced"
  );
  const usedGood = [entry(-1, { mode: "good" }), entry(-2)];
  assert.notEqual(journal.suggest({ entries: usedGood, today, hour: 18 }).mode, "good");
  assert.equal(journal.suggest({ entries: [entry(-2)], today, hour: 18 }).mode, "good");
});

test("repeated hard writing on low days is noticed, and a quiet week is not", () => {
  const today = day(0);
  const heavy = [
    entry(-1, { mode: "expressive", valence: -0.5 }),
    entry(-2, { mode: "expressive", valence: -0.4 }),
    entry(-3, { mode: "free", valence: -0.3 }),
  ];
  const watch = journal.ruminationWatch(heavy, today);
  assert.equal(watch.raised, true);
  assert.equal(watch.suggestion, "distanced");

  const calm = [entry(-1, { valence: 0.3 }), entry(-2, { valence: 0.1 }), entry(-3, { valence: -0.4 })];
  assert.equal(journal.ruminationWatch(calm, today).raised, false);
});

test("a streak counts back from today, and yesterday still counts", () => {
  const today = day(0);
  assert.equal(journal.streak([entry(0), entry(-1), entry(-2)], today), 3);
  assert.equal(journal.streak([entry(-1), entry(-2)], today), 2);
  assert.equal(journal.streak([entry(-3)], today), 0);
});

test("an entry is measured against the athlete's own usual, and the night that followed", () => {
  const entries = [entry(0, { word_count: 400, valence: -0.5 }), entry(-1, { word_count: 100 }), entry(-2, { word_count: 100 })];
  const metrics = [
    { date: day(1), sleep_minutes: 400 },
    { date: day(-4), sleep_minutes: 460 },
    { date: day(-5), sleep_minutes: 470 },
    { date: day(-6), sleep_minutes: 450 },
    { date: day(-7), sleep_minutes: 455 },
    { date: day(-8), sleep_minutes: 465 },
  ];
  const insight = journal.entryInsight(entries[0], { entries, metrics });
  assert.equal(insight.words, 400);
  assert.equal(insight.usualWords, 100);
  assert.equal(insight.nightAfter, 400);
  assert.equal(insight.usualNight, 460);
});

test("insights compare nights after writing with nights without, once there are enough", () => {
  const entries = [];
  const metrics = [];
  /* Wrote on even days, did not on odd ones, over four weeks. */
  for (let i = 1; i <= 28; i++) {
    const wrote = i % 2 === 0;
    if (wrote) entries.push(entry(-i));
    metrics.push({ date: day(-i + 1), sleep_minutes: wrote ? 430 : 400 });
  }
  const data = journal.insights({ entries, metrics, daily: [], today: day(0) });
  assert.equal(data.total, 14);
  assert.ok(data.nights);
  assert.equal(data.nights.difference, 30);
  assert.equal(data.modes[0].mode, "free");
  assert.equal(data.modes[0].entries, 14);
});

test("a word count is a length, not a reading of the text", () => {
  assert.equal(journal.wordCount("  three words here  "), 3);
  assert.equal(journal.wordCount(""), 0);
  assert.equal(journal.wordCount(null), 0);
});
