/* Myaku — the Body channel, read closely.
 *
 * The divergence engine reduces the body to one number a week, which is right
 * for setting it against the other two channels and too coarse for anyone trying
 * to understand it. This keeps the four measures apart and reads each one the way
 * its own research reads it: sleep against a goal and against its own schedule,
 * and heart rate variability and resting heart rate as seven-day averages against
 * a personal normal range, because a single morning of either is mostly noise.
 */

/* Eight hours, because adolescent athletes sleeping less than that were injured
   more often, and it sits inside the recommended range for both teenagers and
   adults. The athlete can change it. */
const DEFAULT_GOAL_MINUTES = 480;
const STAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/;

const MEASURES = { sleepMinutes: "sleep_minutes", sleepEfficiency: "sleep_efficiency", hrv: "hrv_ms", rhr: "rhr_bpm" };

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

function shift(d, days) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const round = (v, dp = 1) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/* Clock times on a line that does not break at midnight. Bedtimes count from
   noon, so 23:30 and 00:30 sit an hour apart rather than twenty-three; wake times
   count from six in the evening, for the same reason at the other end. */
function clockOf(stamp, pivotHour) {
  const m = STAMP.exec(stamp || "");
  if (!m) return null;
  let minutes = Number(m[2]) * 60 + Number(m[3]);
  if (minutes < pivotHour * 60) minutes += 1440;
  return minutes;
}

const hhmm = (minutes) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/* ---------------- sleep ---------------- */

function sleep(rows, goal) {
  const nights = rows.filter((r) => r.sleep_minutes != null);
  if (!nights.length) return null;

  const end = nights[nights.length - 1].date;
  const week = nights.filter((r) => r.date > shift(end, -7));
  const before = nights.filter((r) => r.date > shift(end, -35) && r.date <= shift(end, -7));

  const effs = nights.slice(-14).map((r) => r.sleep_efficiency).filter((v) => v != null);
  const efficiency = effs.length >= 3 ? median(effs) : null;

  /* Spread as a standard deviation in minutes, over the last two weeks of nights
     that arrived with a start and an end. */
  const timed = nights.slice(-14).filter((r) => STAMP.test(r.sleep_start || "") && STAMP.test(r.sleep_end || ""));
  let timing = null;
  if (timed.length >= 5) {
    const beds = timed.map((r) => clockOf(r.sleep_start, 12));
    const wakes = timed.map((r) => clockOf(r.sleep_end, 18));
    timing = {
      nights: timed.length,
      usualBedtime: hhmm(median(beds)),
      usualWake: hhmm(median(wakes)),
      bedtimeSpread: Math.round(sd(beds)),
      wakeSpread: Math.round(sd(wakes)),
    };
  }

  return {
    latestDate: end,
    week: {
      nights: week.length,
      average: round(mean(week.map((r) => r.sleep_minutes))),
      // Ten minutes of grace, so 7h 55m is not reported as a missed night.
      atGoal: week.filter((r) => r.sleep_minutes >= goal - 10).length,
      shortfall: Math.round(week.reduce((s, r) => s + Math.max(0, goal - r.sleep_minutes), 0)),
    },
    usualAverage: before.length >= 7 ? round(mean(before.map((r) => r.sleep_minutes))) : null,
    efficiency: round(efficiency),
    // Time asleep is always less than time in bed, so the goal is stretched by
    // the athlete's own efficiency to say how long the night needs to be.
    inBedNeeded: Math.round(efficiency ? goal / (efficiency / 100) : goal),
    timing,
    nights: nights.slice(-14).map((r) => ({
      date: r.date,
      minutes: r.sleep_minutes,
      efficiency: r.sleep_efficiency,
      start: STAMP.test(r.sleep_start || "") ? r.sleep_start : null,
      end: STAMP.test(r.sleep_end || "") ? r.sleep_end : null,
    })),
  };
}

/* ---------------- heart measures ---------------- */

/* Seven-day averages against a normal range, which is how heart rate variability
   is monitored in sport. Variability is averaged on a log scale because it is
   skewed, and one unusually high morning would otherwise drag the week up; on
   that scale the spread is close to the coefficient of variation. The normal
   range is half of the athlete's own spread either side of the four weeks before
   the current one. Half a coefficient of variation is a threshold sports
   scientists commonly use for the smallest change worth noticing, though nobody
   has shown that it is the right one, and the page says so. */
function rolling(rows, key, { log = false } = {}) {
  const values = {};
  rows.forEach((r) => {
    const v = Number(r[key]);
    if (r[key] != null && Number.isFinite(v) && v > 0) values[String(r.date).slice(0, 10)] = v;
  });
  const dates = Object.keys(values).sort();
  if (!dates.length) return null;

  const to = log ? Math.log : (v) => v;
  const from = log ? Math.exp : (v) => v;
  const end = dates[dates.length - 1];

  const windowMean = (d) => {
    const vals = [];
    for (let k = 0; k < 7; k++) {
      const v = values[shift(d, -k)];
      if (v != null) vals.push(to(v));
    }
    return vals.length >= 3 ? from(mean(vals)) : null;
  };

  const baseline = [];
  for (let k = 7; k < 35; k++) {
    const v = values[shift(end, -k)];
    if (v != null) baseline.push(to(v));
  }
  let normal = null;
  if (baseline.length >= 10) {
    const m = mean(baseline);
    const s = sd(baseline);
    normal = { mid: round(from(m)), low: round(from(m - 0.5 * s)), high: round(from(m + 0.5 * s)), days: baseline.length };
  }

  const current = windowMean(end);
  let status = null;
  if (current != null && normal) status = current < normal.low ? "below" : current > normal.high ? "above" : "within";

  const days = [];
  for (let k = 41; k >= 0; k--) {
    const d = shift(end, -k);
    days.push({ date: d, value: values[d] ?? null, average: round(windowMean(d)) });
  }

  return { latestDate: end, current: round(current), normal, status, readings: dates.length, days };
}

/* ---------------- life against body ---------------- */

/* The nights after days the athlete rated as hard, against the nights after easy
   ones. This is where the Life channel and the Body channel meet on a single
   night, and it is labelled a description on the page, since a hard day brings
   late finishes and early starts along with it. */
function afterHardDays(daily, rows) {
  const nightAfter = {};
  rows.forEach((r) => { nightAfter[shift(String(r.date).slice(0, 10), -1)] = r; });

  const hard = [];
  const easy = [];
  daily.forEach((c) => {
    const night = nightAfter[String(c.date).slice(0, 10)];
    if (c.load_0_10 == null || !night) return;
    if (c.load_0_10 >= 7) hard.push(night);
    else if (c.load_0_10 <= 4) easy.push(night);
  });

  const measures = {};
  Object.entries(MEASURES).forEach(([key, column]) => {
    const h = hard.map((r) => r[column]).filter((v) => v != null);
    const e = easy.map((r) => r[column]).filter((v) => v != null);
    measures[key] = { hard: round(median(h)), easy: round(median(e)), hardN: h.length, easyN: e.length };
  });

  return { hardDays: hard.length, easyDays: easy.length, measures };
}

/* ---------------- entry point ---------------- */

function compute({ metrics = [], daily = [], goalMinutes = null }) {
  const rows = [...metrics].sort((a, b) => (a.date < b.date ? -1 : 1));
  const saved = Number(goalMinutes);
  const goal = saved >= 360 && saved <= 660 ? saved : DEFAULT_GOAL_MINUTES;
  const hrvSources = [...new Set(rows.filter((r) => r.hrv_ms != null).map((r) => r.source || "unknown"))];

  return {
    hasData: rows.length > 0,
    goal,
    goalSaved: goal === saved,
    sleep: sleep(rows, goal),
    hrv: rolling(rows, "hrv_ms", { log: true }),
    rhr: rolling(rows, "rhr_bpm"),
    afterHardDays: afterHardDays(daily, rows),
    sources: {
      latest: rows.length ? rows[rows.length - 1].source : null,
      hrv: hrvSources,
      // Apple Watch reports SDNN, which is not the RMSSD the other devices report.
      sdnn: hrvSources.includes("apple_health"),
    },
  };
}

module.exports = { compute, rolling, clockOf, DEFAULT_GOAL_MINUTES };
