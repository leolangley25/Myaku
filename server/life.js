/* Myaku — the Life channel, read closely.
 *
 * Ten parts feed this channel, and one number cannot say which of them moved.
 * This keeps them apart in the athlete's own words: how the week compares with the
 * weeks before, how often a heavy day came with little say over it, where mood has
 * been sitting, which burnout sign is moving, and what shows up on heavy days. The
 * last part sets felt sleep against measured sleep, where Life meets Body.
 */

const { attribution, sleepPerception } = require("./analytics");
const { themes } = require("./journal");

const FIELDS = {
  load: "load_0_10",
  control: "control_0_10",
  recovery: "recovery_0_10",
  focus: "focus_0_10",
  motivation: "motivation_0_10",
  sleepQuality: "sleep_quality_0_10",
};

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const round = (v, dp = 1) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

function shift(d, days) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

function mondayOf(d) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

function compute({ daily = [], weekly = [], journal = [], metrics = [], today = null }) {
  const rows = [...daily].map((r) => ({ ...r, date: String(r.date).slice(0, 10) })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const weeks = [...weekly].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
  const readEntries = journal.filter((j) => j.reading);
  if (!rows.length && !weeks.length && !readEntries.length) return { hasData: false };

  const latest = [
    rows.length ? rows[rows.length - 1].date : null,
    weeks.length ? weeks[weeks.length - 1].week_start : null,
    readEntries.length ? String(readEntries[readEntries.length - 1].entry_date).slice(0, 10) : null,
  ].filter(Boolean).sort().pop();
  const end = today || latest;
  // Between `from` days ago (exclusive) and `to` days ago (inclusive).
  const within = (d, from, to) => d > shift(end, -from) && d <= shift(end, -to);

  const recent = rows.filter((r) => within(r.date, 7, 0));
  const before = rows.filter((r) => within(r.date, 35, 7));

  const avg = (list, column) => {
    const values = list.map((r) => r[column]).filter((v) => v != null);
    return values.length ? round(mean(values)) : null;
  };
  const measures = {};
  Object.entries(FIELDS).forEach(([key, column]) => {
    measures[key] = { now: avg(recent, column), usual: before.length >= 7 ? avg(before, column) : null };
  });

  /* The strain corner: a heavy day with little say over it, the combination the
     demand and control research keeps finding behind strain. */
  const rated = (list) => list.filter((r) => r.load_0_10 != null && r.control_0_10 != null);
  const isStrain = (r) => r.load_0_10 >= 6 && r.control_0_10 <= 4;
  const beforeRated = rated(before);
  const strain = {
    days: rated(recent).filter(isStrain).length,
    of: rated(recent).length,
    usualShare: beforeRated.length >= 7 ? round(beforeRated.filter(isStrain).length / beforeRated.length, 2) : null,
    points: rated(rows.filter((r) => within(r.date, 28, 0))).map((r) => ({
      date: r.date, load: r.load_0_10, control: r.control_0_10, recent: r.date > shift(end, -7),
    })),
  };

  /* Mood pools the check-in square and any journal entry the athlete rated.
     What a model read from the words is kept apart, in the writing section. */
  const moodByDay = {};
  [
    ...rows.map((r) => ({ date: r.date, valence: r.valence, arousal: r.arousal })),
    ...journal.map((j) => ({ date: String(j.entry_date).slice(0, 10), valence: j.valence, arousal: j.arousal })),
  ].forEach((m) => {
    if (m.valence == null) return;
    (moodByDay[m.date] = moodByDay[m.date] || []).push(m);
  });

  const byDay = {};
  rows.forEach((r) => { byDay[r.date] = r; });
  const rolling = (d, get) => {
    const values = [];
    for (let k = 0; k < 7; k++) {
      const v = get(shift(d, -k));
      if (v != null) values.push(v);
    }
    return values.length >= 3 ? round(mean(values), 2) : null;
  };
  const trend = [];
  for (let k = 41; k >= 0; k--) {
    const d = shift(end, -k);
    trend.push({
      date: d,
      load: rolling(d, (x) => (byDay[x] ? byDay[x].load_0_10 : null)),
      control: rolling(d, (x) => (byDay[x] ? byDay[x].control_0_10 : null)),
      mood: rolling(d, (x) => (moodByDay[x] ? mean(moodByDay[x].map((m) => m.valence)) : null)),
    });
  }

  const moods = Object.entries(moodByDay).flatMap(([date, list]) =>
    list.filter((m) => m.arousal != null).map((m) => ({ date, valence: m.valence, arousal: m.arousal }))
  );
  const quadrant = (m) => (m.valence >= 0 ? (m.arousal >= 0 ? "goodWired" : "goodCalm") : (m.arousal >= 0 ? "roughWired" : "roughCalm"));
  const tally = (list) => list.reduce((t, m) => { t[quadrant(m)]++; return t; }, { goodWired: 0, goodCalm: 0, roughWired: 0, roughCalm: 0 });
  const mood = {
    recent: tally(moods.filter((m) => within(m.date, 14, 0))),
    before: tally(moods.filter((m) => within(m.date, 42, 14))),
  };

  const latestWeek = weeks[weeks.length - 1] || null;
  const domains = ["training", "academic", "personal"].map((key) => {
    const demand = latestWeek ? latestWeek["demand_" + key] : null;
    const control = latestWeek ? latestWeek["control_" + key] : null;
    return {
      key,
      demand,
      control,
      feeling: latestWeek ? latestWeek["feeling_" + key] : null,
      strained: demand != null && control != null && demand >= 5 && control <= 3,
    };
  });

  /* The three burnout signs, compared between the first and last three reflections
     in the window. Accomplishment is flipped, so a positive move is always worse. */
  const burnWeeks = weeks
    .filter((w) => w.abq_exhaustion != null || w.abq_accomplishment != null || w.abq_devaluation != null)
    .slice(-10)
    .map((w) => ({ week: w.week_start, exhaustion: w.abq_exhaustion, accomplishment: w.abq_accomplishment, devaluation: w.abq_devaluation }));
  let moves = null;
  if (burnWeeks.length >= 4) {
    const part = (list, k) => mean(list.map((r) => r[k]).filter((v) => v != null));
    const delta = (k) => {
      const a = part(burnWeeks.slice(0, 3), k);
      const b = part(burnWeeks.slice(-3), k);
      return a == null || b == null ? null : round(b - a);
    };
    const accomplishment = delta("accomplishment");
    moves = {
      exhaustion: delta("exhaustion"),
      accomplishment: accomplishment == null ? null : round(0 - accomplishment),
      devaluation: delta("devaluation"),
    };
  }

  const felt = sleepPerception(rows, metrics);

  /* Feeling connected, from the weekly reflection. The latest week against the
     average of the ones before it. */
  const linked = weeks.filter((w) => w.social_connection != null);
  const connection = linked.length
    ? {
        now: linked[linked.length - 1].social_connection,
        usual: linked.length >= 4 ? round(mean(linked.slice(-9, -1).map((w) => w.social_connection))) : null,
        week: linked[linked.length - 1].week_start,
      }
    : null;

  return {
    hasData: true,
    today: end,
    checkins: { days: recent.length, target: 7 },
    weeklyDone: weeks.some((w) => w.week_start === mondayOf(end)),
    measures,
    strain,
    trend,
    mood,
    domains,
    latestWeekStart: latestWeek ? latestWeek.week_start : null,
    burnout: { weeks: burnWeeks, moves },
    drivers: attribution(rows.filter((r) => within(r.date, 56, 0))),
    sleepFelt: felt.n >= 6
      ? { n: felt.n, worse: felt.worseThanMeasured, better: felt.betterThanMeasured, agreed: felt.agreed }
      : null,
    connection,
    writing: readEntries.length ? themes(journal, end) : null,
  };
}

module.exports = { compute };
