/* Myaku — the Brain channel, read closely.
 *
 * The divergence engine pools a week of reaction tests into one number. This keeps
 * the tests visible and checks what decides whether that number can be trusted:
 * enough tests, a steady hour, the same phone, and no caffeine just beforehand.
 * Then it sets the channel against the other two, the night before from the Body
 * channel and how sharp the athlete felt from the Life channel.
 */

const { spearman } = require("./analytics");

const TARGET_PER_WEEK = 3;
// Caffeine speeds responses for hours, so a test inside this window is flagged.
const CAFFEINE_WINDOW_MINUTES = 180;

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(a, q) {
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function shift(d, days) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const round = (v, dp = 1) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

function clockMinutes(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const hhmm = (minutes) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const afterCaffeine = (s) => s.caffeine_minutes_prior != null && s.caffeine_minutes_prior <= CAFFEINE_WINDOW_MINUTES;

function compute({ sessions = [], metrics = [], daily = [], today = null }) {
  const valid = sessions
    .filter((s) => s.valid && s.mean_rt != null)
    .sort((a, b) => (a.date === b.date ? (a.id || 0) - (b.id || 0) : a.date < b.date ? -1 : 1));
  const end = today || (valid.length ? valid[valid.length - 1].date : null);
  if (!valid.length || !end) return { hasData: false, target: TARGET_PER_WEEK };

  const recent = valid.filter((s) => s.date > shift(end, -7) && s.date <= end);
  const before = valid.filter((s) => s.date <= shift(end, -7)).slice(-24);

  /* Pooling tests narrows the uncertainty on their average by the square root of
     how many there are, which is the whole reason the channel reads weeks. */
  const week = {
    sessions: recent.length,
    meanRt: recent.length ? round(mean(recent.map((s) => s.mean_rt))) : null,
    lapses: recent.length ? round(mean(recent.map((s) => s.lapses || 0))) : null,
    precision: recent.length && recent.every((s) => s.sem_rt != null)
      ? round(Math.sqrt(recent.reduce((t, s) => t + s.sem_rt ** 2, 0)) / recent.length)
      : null,
  };

  /* The usual range is the middle half of earlier tests, which one strange
     morning cannot stretch. */
  const usual = before.length >= 4
    ? {
      sessions: before.length,
      meanRt: round(median(before.map((s) => s.mean_rt))),
      low: round(quantile(before.map((s) => s.mean_rt), 0.25)),
      high: round(quantile(before.map((s) => s.mean_rt), 0.75)),
      lapses: round(median(before.map((s) => s.lapses || 0))),
    }
    : null;

  const timed = valid.slice(-20).filter((s) => clockMinutes(s.local_time) != null);
  let timing = null;
  if (timed.length >= 3) {
    const usualMinute = median(timed.map((s) => clockMinutes(s.local_time)));
    const last = timed.slice(-10);
    timing = {
      usualTime: hhmm(usualMinute),
      withinHour: last.filter((s) => Math.abs(clockMinutes(s.local_time) - usualMinute) <= 60).length,
      of: last.length,
    };
  }

  const withCaffeine = valid.filter(afterCaffeine);
  const withoutCaffeine = valid.filter((s) => !afterCaffeine(s));
  const caffeine = {
    withN: withCaffeine.length,
    withoutN: withoutCaffeine.length,
    withRt: round(median(withCaffeine.map((s) => s.mean_rt))),
    withoutRt: round(median(withoutCaffeine.map((s) => s.mean_rt))),
    withLapses: round(mean(withCaffeine.map((s) => s.lapses || 0))),
    withoutLapses: round(mean(withoutCaffeine.map((s) => s.lapses || 0))),
    recentWith: recent.filter(afterCaffeine).length,
  };

  /* The night before each test, split into the athlete's own shortest and longest
     thirds, so the comparison exists whatever their usual sleep is. */
  const sleptBefore = {};
  metrics.forEach((m) => {
    if (m.sleep_minutes != null) sleptBefore[String(m.date).slice(0, 10)] = Number(m.sleep_minutes);
  });
  const paired = valid.filter((s) => sleptBefore[s.date] != null)
    .map((s) => ({ sleep: sleptBefore[s.date], rt: s.mean_rt, lapses: s.lapses || 0 }));
  let sleep = null;
  if (paired.length >= 9) {
    const sorted = [...paired].sort((a, b) => a.sleep - b.sleep);
    const third = Math.floor(sorted.length / 3);
    const summary = (list) => ({
      sleep: round(median(list.map((p) => p.sleep))),
      rt: round(median(list.map((p) => p.rt))),
      lapses: round(mean(list.map((p) => p.lapses))),
    });
    sleep = { n: paired.length, groupSize: third, short: summary(sorted.slice(0, third)), long: summary(sorted.slice(-third)) };
  }

  /* Felt sharpness from the same day's check-in against what the test measured.
     This is the Brain against Life gap, made concrete. */
  const focusOn = {};
  daily.forEach((c) => {
    if (c.focus_0_10 != null) focusOn[String(c.date).slice(0, 10)] = c.focus_0_10;
  });
  const feltPairs = valid.filter((s) => focusOn[s.date] != null).map((s) => ({ focus: focusOn[s.date], rt: s.mean_rt }));
  let felt = null;
  if (feltPairs.length >= 6) {
    const sharp = feltPairs.filter((p) => p.focus >= 7);
    const foggy = feltPairs.filter((p) => p.focus <= 4);
    felt = {
      n: feltPairs.length,
      sharpN: sharp.length,
      foggyN: foggy.length,
      sharpRt: round(median(sharp.map((p) => p.rt))),
      foggyRt: round(median(foggy.map((p) => p.rt))),
      // Focus against speed, so a positive value means feeling sharper went with testing faster.
      rho: feltPairs.length >= 8 ? round(spearman(feltPairs.map((p) => p.focus), feltPairs.map((p) => 1000 / p.rt)), 2) : null,
    };
  }

  const counts = {};
  valid.forEach((s) => {
    if (s.device) counts[s.device] = (counts[s.device] || 0) + 1;
  });
  const devices = {
    list: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
    mixedRecently: new Set(valid.slice(-10).map((s) => s.device).filter(Boolean)).size > 1,
  };

  return {
    hasData: true,
    today: end,
    target: TARGET_PER_WEEK,
    total: valid.length,
    week,
    usual,
    timing,
    caffeine,
    sleep,
    felt,
    devices,
    sessions: valid.filter((s) => s.date > shift(end, -60) && s.date <= end).map((s) => ({
      date: s.date,
      meanRt: round(s.mean_rt),
      lapses: s.lapses || 0,
      caffeine: afterCaffeine(s),
    })),
  };
}

module.exports = { compute, TARGET_PER_WEEK };
