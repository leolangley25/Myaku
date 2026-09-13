/* Myaku — trends analytics.
 *
 * Everything here is descriptive unless it is explicitly marked as a test.
 * Describing what happened needs no correction for multiple comparisons;
 * claiming a relationship does, so the only inferential item in this file is
 * the single pre-registered caffeine hypothesis. The lead-and-lag scan is
 * labelled exploratory precisely because it searches fifteen lags and would
 * find something in noise if it were allowed to call that a finding.
 */

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ---------------- small statistics ---------------- */

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
}

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pearson(x, y) {
  const n = x.length;
  if (n < 4) return null;
  const mx = mean(x), my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (!dx || !dy) return null;
  return num / Math.sqrt(dx * dy);
}

function rank(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

/* Rank correlation, because these distributions are skewed and wearable data
   throws the occasional impossible value. */
const spearman = (x, y) => pearson(rank(x), rank(y));

/* Abramowitz and Stegun 7.1.26, good to about 1e-7, which is far more than
   this needs. */
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

/* Two-sided p for a correlation, via the usual t transform and a normal
   approximation. At the sample sizes here the difference is immaterial. */
function correlationP(r, n) {
  if (r == null || n < 5) return null;
  const t = Math.abs(r) * Math.sqrt((n - 2) / Math.max(1e-9, 1 - r * r));
  return 2 * (1 - 0.5 * (1 + erf(t / Math.SQRT2)));
}

/* ---------------- shaping ---------------- */

function byDate(rows, key, valueFn) {
  const m = {};
  rows.forEach((r) => {
    const v = valueFn(r);
    if (v == null || Number.isNaN(v)) return;
    const d = String(r[key]).slice(0, 10);
    (m[d] = m[d] || []).push(v);
  });
  const out = {};
  Object.keys(m).forEach((d) => (out[d] = mean(m[d])));
  return out;
}

/* Align two date-keyed maps, optionally shifting the second by a lag in days. */
function align(a, b, lagDays = 0) {
  const x = [], y = [];
  Object.keys(a).sort().forEach((d) => {
    const shifted = new Date(d + "T00:00:00Z");
    shifted.setUTCDate(shifted.getUTCDate() + lagDays);
    const key = shifted.toISOString().slice(0, 10);
    if (b[key] != null) { x.push(a[d]); y.push(b[key]); }
  });
  return { x, y };
}

/* ---------------- analyses ---------------- */

/* 1. Which channel moves first. Exploratory by construction. */
function leadLag(daily, metrics, sessions) {
  const load = byDate(daily, "date", (r) => r.load_0_10);
  const sleepEff = byDate(metrics, "date", (r) => r.sleep_efficiency);
  const rt = byDate(sessions.filter((s) => s.valid), "date", (r) => r.mean_rt);

  function scan(a, b) {
    const out = [];
    for (let lag = -7; lag <= 7; lag++) {
      const { x, y } = align(a, b, lag);
      if (x.length < 8) { out.push({ lag, r: null, n: x.length }); continue; }
      out.push({ lag, r: spearman(x, y), n: x.length });
    }
    const usable = out.filter((o) => o.r != null);
    const best = usable.length ? usable.reduce((m, o) => (Math.abs(o.r) > Math.abs(m.r) ? o : m)) : null;
    return { series: out, best };
  }

  return {
    exploratory: true,
    pairs: [
      { key: "loadSleep", label: "Load And Sleep Quality", ...scan(load, sleepEff) },
      { key: "loadReaction", label: "Load And Reaction Time", ...scan(load, rt) },
    ],
  };
}

/* 2. Day-of-week rhythm. Eight weeks gives eight samples per weekday, which
   is enough to describe a pattern even though it is not a test. */
function dayOfWeek(daily, sessions) {
  const buckets = DOW.map(() => ({ load: [], recovery: [], rt: [] }));
  daily.forEach((r) => {
    const d = new Date(r.date + "T00:00:00").getDay();
    if (r.load_0_10 != null) buckets[d].load.push(r.load_0_10);
    if (r.recovery_0_10 != null) buckets[d].recovery.push(r.recovery_0_10);
  });
  sessions.filter((s) => s.valid).forEach((r) => {
    const d = new Date(r.date + "T00:00:00").getDay();
    if (r.mean_rt != null) buckets[d].rt.push(r.mean_rt);
  });

  const days = DOW.map((name, i) => ({
    day: name,
    short: name.slice(0, 3),
    load: mean(buckets[i].load),
    recovery: mean(buckets[i].recovery),
    rt: mean(buckets[i].rt),
    n: buckets[i].load.length,
  }));

  const withLoad = days.filter((d) => d.load != null);
  const heaviest = withLoad.length ? withLoad.reduce((m, d) => (d.load > m.load ? d : m)) : null;
  const lightest = withLoad.length ? withLoad.reduce((m, d) => (d.load < m.load ? d : m)) : null;
  return { days, heaviest, lightest };
}

/* 3. Marked periods as a natural experiment: inside versus outside. */
function phaseComparison(phases, daily, sessions, metrics) {
  const inPhase = (date, p) => date >= p.start_date && date <= p.end_date;

  return phases.map((p) => {
    const pick = (rows, key, fn) => {
      const inside = [], outside = [];
      rows.forEach((r) => {
        const v = fn(r);
        if (v == null) return;
        (inPhase(String(r[key]).slice(0, 10), p) ? inside : outside).push(v);
      });
      return { inside: mean(inside), outside: mean(outside), nIn: inside.length, nOut: outside.length };
    };

    return {
      label: p.label,
      start: p.start_date,
      end: p.end_date,
      load: pick(daily, "date", (r) => r.load_0_10),
      recovery: pick(daily, "date", (r) => r.recovery_0_10),
      reaction: pick(sessions.filter((s) => s.valid), "date", (r) => r.mean_rt),
      sleep: pick(metrics, "date", (r) => r.sleep_minutes),
    };
  });
}

/* 4. The one pre-registered test in the file: caffeine taken after two in the
   afternoon against that night's sleep efficiency. A night that begins on one
   day is recorded on the next, so the pairing carries a one-day lag. */
function caffeineSleep(caffeine, metrics) {
  const lateByDay = {};
  caffeine.forEach((c) => {
    const h = Number(String(c.logged_at).split(":")[0]);
    if (Number.isNaN(h)) return;
    const d = String(c.date).slice(0, 10);
    lateByDay[d] = (lateByDay[d] || 0) + (h >= 14 ? c.mg : 0);
  });

  const sleepEff = byDate(metrics, "date", (r) => r.sleep_efficiency);
  const { x, y } = align(lateByDay, sleepEff, 1);

  const r = x.length >= 10 ? spearman(x, y) : null;
  const nextDay = (d) => {
    const t = new Date(d + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10);
  };

  return {
    hypothesis: "Caffeine after two in the afternoon lowers sleep efficiency that night.",
    preRegistered: true,
    n: x.length,
    rho: r,
    p: correlationP(r, x.length),
    /* A busy week raises both late caffeine and poor sleep on its own, so even
       a clean result here is a correlation with an obvious third cause. */
    confound: "Busy stretches raise late caffeine and disturb sleep independently.",
    points: Object.keys(lateByDay).sort().filter((d) => sleepEff[nextDay(d)] != null)
      .map((d) => ({ date: d, mg: lateByDay[d], sleep: sleepEff[nextDay(d)] })),
  };
}

/* 4b. Felt sleep against measured sleep. The point is not which is right, it is
   how often they disagree and in which direction, because a wearable that
   reports a good night after a bad one is the single most common complaint
   about this category of product. */
function sleepPerception(daily, metrics) {
  const rated = byDate(daily, "date", (r) => r.sleep_quality_0_10);
  const measured = byDate(metrics, "date", (r) => r.sleep_efficiency);

  const dates = Object.keys(rated).sort().filter((d) => measured[d] != null);
  if (dates.length < 6) return { n: dates.length, points: [], rho: null };

  const rx = dates.map((d) => rated[d]);
  const my = dates.map((d) => measured[d]);
  const rMean = mean(rx), mMean = mean(my);
  const rSd = sd(rx) || 1, mSd = sd(my) || 1;

  /* Standardised so a ten-point rating and a percentage can be subtracted. */
  const points = dates.map((d) => ({
    date: d,
    rated: rated[d],
    measured: measured[d],
    gap: (rated[d] - rMean) / rSd - (measured[d] - mMean) / mSd,
  }));

  const worseThanMeasured = points.filter((p) => p.gap <= -1).length;
  const betterThanMeasured = points.filter((p) => p.gap >= 1).length;

  return {
    n: dates.length,
    rho: spearman(rx, my),
    points,
    worseThanMeasured,
    betterThanMeasured,
    agreed: dates.length - worseThanMeasured - betterThanMeasured,
  };
}

/* 4c. Load against control, day by day. High demand with low say over it is the
   corner the occupational literature keeps finding, and it is worth counting
   rather than describing. */
function controlMap(daily) {
  const rows = daily.filter((r) => r.load_0_10 != null && r.control_0_10 != null);
  if (rows.length < 6) return { n: rows.length, points: [], weeks: [] };

  const strained = (r) => r.load_0_10 >= 6 && r.control_0_10 <= 4;

  const weeks = {};
  rows.forEach((r) => {
    const d = new Date(r.date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const wk = d.toISOString().slice(0, 10);
    (weeks[wk] = weeks[wk] || []).push(r);
  });

  return {
    n: rows.length,
    strainDays: rows.filter(strained).length,
    points: rows.map((r) => ({ date: r.date, load: r.load_0_10, control: r.control_0_10 })),
    weeks: Object.keys(weeks).sort().map((wk) => ({
      week: wk,
      share: weeks[wk].filter(strained).length / weeks[wk].length,
      n: weeks[wk].length,
    })),
  };
}

/* 5. What shows up on heavy days that does not show up on light ones. */
function attribution(daily) {
  const withLoad = daily.filter((r) => r.load_0_10 != null && r.attribution);
  if (withLoad.length < 8) return { tags: [], n: withLoad.length };

  const sorted = [...withLoad].sort((a, b) => a.load_0_10 - b.load_0_10);
  const cut = Math.max(1, Math.floor(sorted.length / 3));
  const light = sorted.slice(0, cut);
  const heavy = sorted.slice(-cut);

  const share = (rows, tag) =>
    rows.filter((r) => r.attribution.split(",").includes(tag)).length / rows.length;

  const tags = [...new Set(withLoad.flatMap((r) => r.attribution.split(",").filter(Boolean)))];
  return {
    n: withLoad.length,
    nHeavy: heavy.length,
    tags: tags
      .map((t) => ({ tag: t, heavy: share(heavy, t), light: share(light, t) }))
      .sort((a, b) => b.heavy - b.light - (a.heavy - a.light)),
  };
}

/* 6. Where the weeks sit on the circumplex, and whether that is moving. */
function affectMap(daily) {
  const weeks = {};
  daily.forEach((r) => {
    if (r.valence == null || r.arousal == null) return;
    const d = new Date(r.date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const wk = d.toISOString().slice(0, 10);
    (weeks[wk] = weeks[wk] || []).push(r);
  });

  const quadrant = (v, a) =>
    v >= 0 ? (a >= 0 ? "Activated And Positive" : "Settled And Positive")
           : (a >= 0 ? "Activated And Negative" : "Depleted And Negative");

  const points = daily
    .filter((r) => r.valence != null && r.arousal != null)
    .map((r) => ({ date: r.date, valence: r.valence, arousal: r.arousal }));

  const counts = {};
  points.forEach((p) => {
    const q = quadrant(p.valence, p.arousal);
    counts[q] = (counts[q] || 0) + 1;
  });

  return {
    points,
    counts,
    weekly: Object.keys(weeks).sort().map((wk) => ({
      week: wk,
      valence: mean(weeks[wk].map((r) => r.valence)),
      arousal: mean(weeks[wk].map((r) => r.arousal)),
      n: weeks[wk].length,
    })),
  };
}

/* 7. Demand against control per domain, tracked across the season. Strain is
   the high-demand, low-control corner. */
function demandControl(weekly) {
  const domains = ["training", "academic", "personal"];
  return domains.map((d) => ({
    domain: d,
    points: weekly
      .filter((w) => w["demand_" + d] != null && w["control_" + d] != null)
      .map((w) => ({ week: w.week_start, demand: w["demand_" + d], control: w["control_" + d] })),
  }));
}

/* 7b. The three burnout dimensions as separate lines. They are shown apart
   rather than summed because the order they move in is the whole point:
   exhaustion first is a workload problem, devaluation first is not. */
function burnoutDimensions(weekly) {
  const rows = weekly.filter(
    (w) => w.abq_exhaustion != null || w.abq_accomplishment != null || w.abq_devaluation != null
  );
  return rows.map((w) => ({
    week: w.week_start,
    exhaustion: w.abq_exhaustion,
    accomplishment: w.abq_accomplishment,
    devaluation: w.abq_devaluation,
  }));
}

/* 8. Is the week itself getting more erratic, independent of its average. */
function volatility(daily) {
  const weeks = {};
  daily.forEach((r) => {
    if (r.load_0_10 == null) return;
    const d = new Date(r.date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    (weeks[d.toISOString().slice(0, 10)] ||= []).push(r.load_0_10);
  });
  return Object.keys(weeks).sort()
    .filter((wk) => weeks[wk].length >= 3)
    .map((wk) => ({ week: wk, spread: sd(weeks[wk]), mean: mean(weeks[wk]), n: weeks[wk].length }));
}

/* 9. Acute against chronic psychological load, borrowing the shape of the
   ratio used for physical workload. The physical original is contested and
   this extension is unvalidated, so it is presented as description only. */
function loadRatio(daily) {
  const byDay = byDate(daily, "date", (r) => r.load_0_10);
  const dates = Object.keys(byDay).sort();
  if (dates.length < 28) return { ready: false, series: [], sweetSpot: [0.8, 1.3] };

  const valueOn = (d) => byDay[d];
  const window = (endIdx, days) => {
    const out = [];
    const end = new Date(dates[endIdx] + "T00:00:00Z");
    for (let k = 0; k < days; k++) {
      const d = new Date(end);
      d.setUTCDate(d.getUTCDate() - k);
      const v = valueOn(d.toISOString().slice(0, 10));
      if (v != null) out.push(v);
    }
    return out;
  };

  const series = [];
  for (let i = 27; i < dates.length; i++) {
    const acute = mean(window(i, 7));
    const chronic = mean(window(i, 28));
    if (acute == null || !chronic) continue;
    series.push({ date: dates[i], ratio: acute / chronic, acute, chronic });
  }
  return { ready: true, series, sweetSpot: [0.8, 1.3] };
}

/* 10. Journaling as behaviour rather than content. Nothing here reads a word
   of what was written, because inferring mood from personal writing is not
   something this app is entitled to claim. Length is counted, the rating the
   person attached is carried through, and the writing itself is left alone. */
function journalEngagement(journal) {
  const weeks = {};
  journal.forEach((j) => {
    const d = new Date(j.entry_date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const wk = d.toISOString().slice(0, 10);
    (weeks[wk] = weeks[wk] || []).push(j);
  });

  const domains = {};
  journal.forEach((j) =>
    String(j.domains || "").split(",").filter(Boolean).forEach((t) => (domains[t] = (domains[t] || 0) + 1))
  );

  return {
    total: journal.length,
    rated: journal.filter((j) => j.valence != null).length,
    domains: Object.keys(domains).sort((a, b) => domains[b] - domains[a]).map((t) => ({ tag: t, n: domains[t] })),
    weeks: Object.keys(weeks).sort().map((wk) => ({
      week: wk,
      entries: weeks[wk].length,
      medianLength: Math.round(median(weeks[wk].map((j) => (j.content || "").length)) || 0),
    })),
  };
}

/* 11. The raw weekly shape of what was reported, kept next to the channel view
   because a z-score hides whether a five became a four or a nine became a two. */
function selfReport(daily) {
  const weeks = {};
  daily.forEach((r) => {
    const d = new Date(r.date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    (weeks[d.toISOString().slice(0, 10)] ||= []).push(r);
  });

  const avg = (rows, key) => mean(rows.map((r) => r[key]).filter((v) => v != null));

  return Object.keys(weeks).sort().map((wk) => ({
    week: wk,
    load: avg(weeks[wk], "load_0_10"),
    recovery: avg(weeks[wk], "recovery_0_10"),
    control: avg(weeks[wk], "control_0_10"),
    focus: avg(weeks[wk], "focus_0_10"),
    motivation: avg(weeks[wk], "motivation_0_10"),
    sleepQuality: avg(weeks[wk], "sleep_quality_0_10"),
    n: weeks[wk].length,
  }));
}

function compute({ daily = [], weekly = [], sessions = [], metrics = [], caffeine = [], phases = [], journal = [] }) {
  return {
    leadLag: leadLag(daily, metrics, sessions),
    dayOfWeek: dayOfWeek(daily, sessions),
    phases: phaseComparison(phases, daily, sessions, metrics),
    caffeineSleep: caffeineSleep(caffeine, metrics),
    sleepPerception: sleepPerception(daily, metrics),
    controlMap: controlMap(daily),
    attribution: attribution(daily),
    affect: affectMap(daily),
    demandControl: demandControl(weekly),
    burnout: burnoutDimensions(weekly),
    volatility: volatility(daily),
    loadRatio: loadRatio(daily),
    selfReport: selfReport(daily),
    journal: journalEngagement(journal),
  };
}

module.exports = { compute, spearman, correlationP, mean, sd, median };
