const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("stream");
const { parseAppleHealth, nightOf, wallClock } = require("../server/integrations/apple-health");
const whoop = require("../server/integrations/whoop");
const google = require("../server/integrations/google-health");
const { mergeByDate, plausible } = require("../server/integrations/oauth");

test("Apple Health: a night split across midnight is one night, and sources are not double counted", async () => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<HealthData>",
    ' <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" startDate="2026-09-02 10:00:00 -0500" endDate="2026-09-02 10:05:00 -0500" value="300"/>',
    ' <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Watch" startDate="2026-09-02 06:00:00 -0500" endDate="2026-09-02 06:01:00 -0500" value="40"/>',
    ' <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Watch" startDate="2026-09-02 13:00:00 -0500" endDate="2026-09-02 13:01:00 -0500" value="60"/>',
    ' <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Watch" startDate="2026-09-02 20:00:00 -0500" endDate="2026-09-02 20:01:00 -0500" value="50"/>',
    ' <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Watch" startDate="2026-09-02 00:00:00 -0500" endDate="2026-09-02 23:59:00 -0500" value="52"/>',
    ' <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="iPhone" startDate="2026-09-01 23:00:00 -0500" endDate="2026-09-02 07:00:00 -0500" value="HKCategoryValueSleepAnalysisInBed"/>',
    ' <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-09-01 23:20:00 -0500" endDate="2026-09-01 23:55:00 -0500" value="HKCategoryValueSleepAnalysisAsleepCore"/>',
    ' <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-09-02 00:00:00 -0500" endDate="2026-09-02 06:40:00 -0500" value="HKCategoryValueSleepAnalysisAsleepDeep"/>',
    ' <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-09-01 23:55:00 -0500" endDate="2026-09-02 00:00:00 -0500" value="HKCategoryValueSleepAnalysisAwake"/>',
    "</HealthData>",
  ].join("\n");

  const { records, rows } = await parseAppleHealth(Readable.from([xml]));
  assert.equal(records, 8);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.date, "2026-09-02");
  assert.equal(r.hrv, 50);
  assert.equal(r.rhr, 52);
  assert.equal(r.sleepMinutes, 435);
  assert.ok(Math.abs(r.sleepEfficiency - 90.625) < 1e-9);
});

test("Apple Health: timestamps keep the wall clock, and late segments join the next morning", () => {
  const w = wallClock("2026-09-01 23:40:00 -0500");
  assert.equal(w.date, "2026-09-01");
  assert.equal(nightOf(w.wall), "2026-09-02");
  assert.equal(nightOf(wallClock("2026-09-02 06:30:00 -0500").wall), "2026-09-02");
  assert.equal(wallClock("not a date"), null);
});

test("Whoop: naps and unscored sleeps are excluded, and recovery joins its sleep", () => {
  const hour = 3600000;
  const rows = whoop.mapWhoop(
    [
      {
        id: "s1", nap: false, score_state: "SCORED", end: "2026-09-02T12:00:00.000Z", timezone_offset: "-05:00",
        score: {
          stage_summary: { total_light_sleep_time_milli: 4 * hour, total_slow_wave_sleep_time_milli: 1.5 * hour, total_rem_sleep_time_milli: 1.5 * hour },
          sleep_efficiency_percentage: 91,
        },
      },
      { id: "nap", nap: true, score_state: "SCORED", end: "2026-09-02T19:00:00.000Z", timezone_offset: "-05:00", score: { stage_summary: { total_light_sleep_time_milli: 9 * hour } } },
      { id: "pending", score_state: "PENDING_SCORE", end: "2026-09-03T12:00:00.000Z" },
    ],
    [{ sleep_id: "s1", score_state: "SCORED", created_at: "2026-09-02T12:30:00.000Z", score: { hrv_rmssd_milli: 72.5, resting_heart_rate: 50 } }]
  );
  assert.deepEqual(rows, [{ date: "2026-09-02", sleepMinutes: 420, sleepEfficiency: 91, hrv: 72.5, rhr: 50 }]);
});

test("Whoop: the local date uses the offset supplied with each record", () => {
  assert.equal(whoop.localDate("2026-09-02T03:00:00Z", "-05:00"), "2026-09-01");
  assert.equal(whoop.localDate("2026-09-02T03:00:00Z", "+09:00"), "2026-09-02");
  assert.equal(whoop.localDate("garbage", "-05:00"), null);
});

test("Google Health: nested payloads and both date shapes are read, and older days are filtered out", () => {
  const rows = google.mapGoogle(
    {
      sleep: [
        { name: "a", sleep: { interval: { startTime: "2026-09-02T04:00:00Z", civilEndTime: { year: 2026, month: 9, day: 2 } }, summary: { minutesAsleep: 400, minutesInBed: 450 } } },
        { name: "b", sleep: { interval: { civilEndTime: "2026-08-01" }, summary: { minutesAsleep: 380 } } },
      ],
      restingHeartRate: [{ dailyRestingHeartRate: { date: { year: 2026, month: 9, day: 2 }, beatsPerMinute: 54 } }],
      heartRateVariability: [{ dailyHeartRateVariability: { date: "2026-09-02", averageHeartRateVariabilityMilliseconds: 61 } }],
    },
    "2026-08-15"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-09-02");
  assert.equal(rows[0].sleepMinutes, 400);
  assert.ok(Math.abs(rows[0].sleepEfficiency - 88.888) < 0.01);
  assert.equal(rows[0].rhr, 54);
  assert.equal(rows[0].hrv, 61);
});

test("merging never overwrites a value with nothing, and implausible rows are caught", () => {
  const merged = mergeByDate([{ date: "2026-09-01", hrv: 60 }], [{ date: "2026-09-01", hrv: null, rhr: 50 }]);
  assert.deepEqual(merged, [{ date: "2026-09-01", hrv: 60, rhr: 50 }]);
  assert.equal(plausible({ hrv: 60, rhr: 50, sleepMinutes: 420, sleepEfficiency: 90 }), true);
  assert.equal(plausible({ hrv: 900 }), false);
  assert.equal(plausible({ rhr: 10 }), false);
});
