/* Apple Health, through the export file an iPhone produces.
 *
 * HealthKit lives on the device and has no web API, so a web server cannot read it
 * directly; only a native iOS app can. Until that app exists, the Health app's
 * "Export All Health Data" archive is the one route that works today, and it
 * contains the full history rather than a sync window.
 *
 * The export can run to hundreds of megabytes, so it is read line by line from the
 * upload stream and never held in memory. Each Record element sits on one line.
 *
 * Heart rate variability here is SDNN, which Apple Watch reports, not the RMSSD
 * that Whoop and Google Health report. The two are different statistics and are
 * not interchangeable, so these rows keep their own source label.
 */

const readline = require("readline");

const TYPES = {
  hrv: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  rhr: "HKQuantityTypeIdentifierRestingHeartRate",
  sleep: "HKCategoryTypeIdentifierSleepAnalysis",
};

function attr(line, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(line);
  return m ? m[1] : null;
}

/* Export timestamps look like "2026-09-01 23:10:00 -0500". The wall-clock parts
   are what matter for naming a night, so they are read directly rather than
   converted through UTC. */
function wallClock(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(stamp || "");
  if (!m) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = m;
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const offset = (sign === "-" ? -1 : 1) * (+oh * 60 + +om);
  return { wall, instant: wall - offset * 60000, date: `${y}-${mo}-${d}` };
}

/* A night is named for the morning it ends on. Shifting by six hours before taking
   the date means a segment ending at 23:40 and one ending at 06:30 land on the same
   night instead of being split across two days. */
const nightOf = (wall) => new Date(wall + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function parseAppleHealth(stream) {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const hrv = {};
  const rhr = {};
  const sleep = {}; // night -> source -> { asleep, inBed }
  let records = 0;

  for await (const line of rl) {
    if (!line.includes("<Record ")) continue;
    const type = attr(line, "type");
    if (type !== TYPES.hrv && type !== TYPES.rhr && type !== TYPES.sleep) continue;
    records++;

    if (type === TYPES.hrv || type === TYPES.rhr) {
      const start = wallClock(attr(line, "startDate"));
      const value = Number(attr(line, "value"));
      if (!start || !Number.isFinite(value)) continue;
      const bucket = type === TYPES.hrv ? hrv : rhr;
      (bucket[start.date] = bucket[start.date] || []).push(value);
      continue;
    }

    const start = wallClock(attr(line, "startDate"));
    const end = wallClock(attr(line, "endDate"));
    const value = attr(line, "value") || "";
    if (!start || !end || end.instant <= start.instant) continue;

    const minutes = (end.instant - start.instant) / 60000;
    const night = nightOf(end.wall);
    const source = attr(line, "sourceName") || "unknown";
    const slot = ((sleep[night] = sleep[night] || {})[source] = sleep[night][source] || { asleep: 0, inBed: 0 });

    if (value === "HKCategoryValueSleepAnalysisInBed") slot.inBed += minutes;
    else if (value.startsWith("HKCategoryValueSleepAnalysisAsleep")) slot.asleep += minutes;
    // Awake segments are ignored; they are already the gap between asleep and in bed.
  }

  const rows = {};
  const row = (date) => (rows[date] = rows[date] || { date });

  Object.entries(hrv).forEach(([date, values]) => (row(date).hrv = median(values)));
  Object.entries(rhr).forEach(([date, values]) => (row(date).rhr = values.reduce((a, b) => a + b, 0) / values.length));

  /* A watch and a phone often both record the same night. Summing them would
     double it, so the most complete single source is taken for asleep time, and
     efficiency is only reported when some source actually recorded time in bed. */
  Object.entries(sleep).forEach(([night, sources]) => {
    const slots = Object.values(sources);
    const asleep = Math.max(...slots.map((s) => s.asleep));
    const inBed = Math.max(...slots.map((s) => s.inBed));
    if (asleep < 30) return;
    const r = row(night);
    r.sleepMinutes = asleep;
    if (inBed >= asleep) r.sleepEfficiency = Math.min(100, (asleep / inBed) * 100);
  });

  return {
    records,
    rows: Object.values(rows).sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

module.exports = { parseAppleHealth, wallClock, nightOf, TYPES };
