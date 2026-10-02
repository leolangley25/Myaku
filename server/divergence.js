/* Myaku — the divergence engine.
 *
 * Every channel is reduced to a weekly value, converted to a robust deviation
 * from that person's own history, and oriented so that positive always means
 * worse. The output is not a score: it is the set of gaps between channels,
 * and the named pattern those gaps make.
 *
 * The cognitive channel is deliberately weekly rather than per session. A
 * three-minute session carries a standard error around ten milliseconds, which
 * can only resolve a shift of roughly forty; pooling a week of sessions brings
 * that under twenty, which is below the effect partial sleep restriction
 * produces. A single session is not reportable on its own.
 */

/* Sensitivity trades false alarms against late warnings, and there is no
   correct setting — it depends whether someone wants a nudge on the first sign
   of drift or only wants to hear about a problem that is already large.
   Gaps always sit above the channel bar, because the difference of two noisy
   numbers is noisier than either one. */
const { heaviness } = require("./reader");

const SENSITIVITY = {
  light: { notable: 1.5, marked: 2.2, gap: 2.0, persistence: 3 },
  medium: { notable: 1.0, marked: 1.5, gap: 1.4, persistence: 2 },
  heavy: { notable: 0.7, marked: 1.1, gap: 1.0, persistence: 1 },
};
const DEFAULT_SENSITIVITY = "medium";

const MIN_BASELINE_WEEKS = 3;
const CLAMP = 3;
const MIN_SCALE_FRACTION = 0.04; // floor on the spread, as a share of the median
const DAY_MS = 24 * 60 * 60 * 1000;

function weekStart(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/* Median absolute deviation rather than standard deviation, because wearable
   and reaction-time data both produce occasional garbage readings and one bad
   night should not inflate the spread everything else is judged against. */
function robustZ(value, history) {
  if (value == null || history.length < MIN_BASELINE_WEEKS) return null;
  const med = median(history);
  const mad = median(history.map((h) => Math.abs(h - med)));

  /* A very consistent athlete produces a near-zero spread, and dividing by it
     turns ordinary wobble into a large deviation. Flooring the scale at a
     small fraction of the metric's own magnitude keeps steady data reading as
     steady, which is the failure direction that matters most: nobody should
     be told they are degraded because their numbers are reliable. */
  const floor = Math.max(1e-6, Math.abs(med) * MIN_SCALE_FRACTION);
  const scale = Math.max(mad, floor);

  return clamp((0.6745 * (value - med)) / scale);
}

function clamp(z) {
  return Math.max(-CLAMP, Math.min(CLAMP, z));
}

/* Seven-day windows counted back from the anchor day, keyed by the first day of
   each window, so "this week" always means the last seven days. Calendar weeks
   made a Monday reading one day of data judged against full weeks, which is noise
   dressed up as a finding. Days after the anchor are left out. */
function windowStart(dateStr, anchor) {
  const d = Date.parse(String(dateStr).slice(0, 10) + "T00:00:00Z");
  const a = Date.parse(anchor + "T00:00:00Z");
  if (Number.isNaN(d) || Number.isNaN(a) || d > a) return null;
  const back = Math.floor((a - d) / (7 * DAY_MS));
  return new Date(a - (back * 7 + 6) * DAY_MS).toISOString().slice(0, 10);
}

/* A weekly reflection describes the seven days from its Monday, so it is placed on
   the last of those days, or on the anchor day for a week still in progress. Placed
   on the Monday, last week's reflection would fall out of the current seven-day
   window on every day but one. */
function reflectionDate(weekStartStr, anchor) {
  if (!anchor) return weekStartStr;
  const end = new Date(Date.parse(String(weekStartStr).slice(0, 10) + "T00:00:00Z") + 6 * DAY_MS).toISOString().slice(0, 10);
  return end < anchor ? end : anchor;
}

/* Group rows into seven-day buckets. Without an anchor they fall back to calendar
   weeks, which only happens when there is no data to anchor on. */
function bucket(rows, dateKey, valueFn, anchor) {
  const out = {};
  rows.forEach((r) => {
    const d = r[dateKey];
    if (!d) return;
    const v = valueFn(r);
    if (v == null || Number.isNaN(v)) return;
    const wk = anchor ? windowStart(d, anchor) : weekStart(String(d).slice(0, 10));
    if (!wk) return;
    (out[wk] = out[wk] || []).push(v);
  });
  return out;
}

/* Turn a weekly bucket map into an ordered series of { week, value } means. */
function series(buckets) {
  return Object.keys(buckets)
    .sort()
    .map((wk) => ({ week: wk, value: mean(buckets[wk]) }));
}

/* Z-score the most recent week of a series against the weeks before it, and
   return the whole oriented series so the client can plot it. */
function channelFromSeries(seriesList, invert) {
  if (!seriesList.length) return { z: null, weeks: [], points: [] };
  const points = seriesList.map((p) => ({ week: p.week, raw: p.value }));
  const zs = [];
  for (let i = 0; i < seriesList.length; i++) {
    const history = seriesList.slice(0, i).map((p) => p.value);
    let z = robustZ(seriesList[i].value, history);
    if (z != null && invert) z = -z;
    zs.push(z);
    points[i].z = z;
  }
  return { z: zs[zs.length - 1], weeks: seriesList.length, points };
}

/* Combine several oriented sub-series into one channel by averaging the z of
   each component week by week. */
function combine(components, weights = components.map(() => 1)) {
  const weeks = new Set();
  components.forEach((c) => c.points.forEach((p) => weeks.add(p.week)));
  const ordered = [...weeks].sort();
  const points = ordered.map((wk) => {
    let sum = 0;
    let total = 0;
    components.forEach((c, i) => {
      const z = (c.points.find((p) => p.week === wk) || {}).z;
      if (z != null) {
        sum += z * weights[i];
        total += weights[i];
      }
    });
    return { week: wk, z: total ? sum / total : null };
  });
  const last = points.length ? points[points.length - 1].z : null;
  const usable = points.filter((p) => p.z != null).length;
  return { z: last, weeks: usable, points };
}

/* A channel built from named parts, keeping each part's own deviation for the week
   the channel reports. A channel page can then say which part is moving it rather
   than only that it has moved. A part with no data is reported as null. */
function channelFrom(parts) {
  const built = parts.filter((p) => p.channel.points.length);
  if (!built.length) return { z: null, weeks: 0, points: [], parts: Object.fromEntries(parts.map((p) => [p.key, null])) };
  const combined = combine(built.map((b) => b.channel), built.map((b) => b.weight || 1));
  const lastWeek = combined.points.length ? combined.points[combined.points.length - 1].week : null;
  combined.parts = Object.fromEntries(
    parts.map((p) => [p.key, (p.channel.points.find((q) => q.week === lastWeek) || {}).z ?? null])
  );
  return combined;
}

/* ---------------- channels ---------------- */

function autonomicChannel(metrics, anchor) {
  const from = (key, invert) => channelFromSeries(series(bucket(metrics, "date", (r) => r[key], anchor)), invert);
  return channelFrom([
    { key: "hrv_ms", channel: from("hrv_ms", true) },          // lower HRV is worse
    { key: "rhr_bpm", channel: from("rhr_bpm", false) },       // higher resting heart rate is worse
    { key: "sleep_minutes", channel: from("sleep_minutes", true) },
    { key: "sleep_efficiency", channel: from("sleep_efficiency", true) },
  ]);
}

/* Response speed counts twice as much as lapses. On a three-minute test, lapse
   counts agree poorly with the ten-minute laboratory version while speed agrees
   better, so the steadier measure gets the larger say. */
function cognitiveChannel(sessions, anchor) {
  const valid = sessions.filter((s) => s.valid);
  return channelFrom([
    // Reciprocal reaction time rises as someone gets faster, so it inverts.
    { key: "speed", weight: 2, channel: channelFromSeries(series(bucket(valid, "date", (r) => r.mean_reciprocal, anchor)), true) },
    { key: "lapses", weight: 1, channel: channelFromSeries(series(bucket(valid, "date", (r) => r.lapses, anchor)), false) },
  ]);
}

/* Channel P is the widest of the three, because self-report is the only one of
   the three that can cover a life rather than a body. Each component is z-scored
   against its own history before they are averaged, so a component that only
   starts existing partway through does not distort the weeks before it. */
function psychologicalChannel(daily, weekly, journal, anchor) {
  const fromDaily = (key, invert) =>
    channelFromSeries(series(bucket(daily, "date", (r) => r[key], anchor)), invert);

  const load = fromDaily("load_0_10", false);
  const recovery = fromDaily("recovery_0_10", true);
  const control = fromDaily("control_0_10", true);   // less say over the week is worse
  const focus = fromDaily("focus_0_10", true);       // the felt counterpart of the vigilance test
  const motivation = fromDaily("motivation_0_10", true);

  /* Reported affect pools the daily grid and any journal entry the person chose
     to rate. Both are the same instrument answered on the same square, so they
     belong in the same bucket rather than in two competing components. What a
     model read from the writing is a different instrument and gets its own part
     below. */
  const affectRows = [
    ...daily.map((r) => ({ date: r.date, valence: r.valence })),
    ...journal.map((j) => ({ date: j.entry_date, valence: j.valence })),
  ];
  const affect = channelFromSeries(series(bucket(affectRows, "date", (r) => r.valence, anchor)), true);

  // Strain is demand weighted by how little say the person had over it, which
  // is why two athletes with identical schedules end up in different states.
  const strainRows = weekly.map((w) => ({
    date: reflectionDate(w.week_start, anchor),
    strain: mean(
      ["training", "academic", "personal"]
        .map((d) => {
          const dem = w["demand_" + d];
          const ctl = w["control_" + d];
          if (dem == null) return null;
          const ctlNorm = ctl == null ? 0.5 : (ctl - 1) / 6;
          return dem * (1 - ctlNorm);
        })
        .filter((v) => v != null)
    ),
  }));
  const strain = channelFromSeries(series(bucket(strainRows, "date", (r) => r.strain, anchor)), false);

  /* The three burnout dimensions summed, with accomplishment flipped so that
     every term points the same way. Kept as one component rather than three so
     a single validated construct does not outvote everything else in the
     channel simply because it is asked as three questions. */
  const burnoutRows = weekly.map((w) => {
    const parts = [
      w.abq_exhaustion,
      w.abq_accomplishment == null ? null : 6 - w.abq_accomplishment,
      w.abq_devaluation,
    ].filter((v) => v != null);
    return { date: reflectionDate(w.week_start, anchor), burnout: parts.length ? mean(parts) : null };
  });
  const burnout = channelFromSeries(series(bucket(burnoutRows, "date", (r) => r.burnout, anchor)), false);

  /* Relatedness, the need that sits beside say (autonomy) and accomplishment
     (competence) in self-determination research, where unmet needs are linked
     with athlete burnout (Li and colleagues, 2013). Feeling alone is the one this
     channel was not reading. Already asked weekly. */
  const connectionRows = weekly
    .filter((w) => w.social_connection != null)
    .map((w) => ({ date: reflectionDate(w.week_start, anchor), connection: w.social_connection }));
  const connection = channelFromSeries(series(bucket(connectionRows, "date", (r) => r.connection, anchor)), true);

  /* How heavy the athlete's own writing reads, when they let a model on their
     machine read it. Weighted at half the parts they answer directly, because
     model readings of daily diaries track the same person's day-to-day changes
     only weakly, around r = .28. It is still worth having: it lets a day they
     wrote about count without asking them anything extra. */
  const writingRows = journal
    .filter((j) => j.reading)
    .map((j) => ({ date: j.entry_date, heaviness: heaviness(j.reading) }));
  const writing = channelFromSeries(series(bucket(writingRows, "date", (r) => r.heaviness, anchor)), false);

  return channelFrom([
    { key: "load", channel: load },
    { key: "control", channel: control },
    { key: "recovery", channel: recovery },
    { key: "focus", channel: focus },
    { key: "motivation", channel: motivation },
    { key: "mood", channel: affect },
    { key: "strain", channel: strain },
    { key: "burnout", channel: burnout },
    { key: "connection", channel: connection },
    { key: "writing", weight: 0.5, channel: writing },
  ]);
}

/* The fourth gap, and the only one that is not between two channels. Measured
   sleep efficiency against how the night was rated the next morning. It sits
   outside the channel model on purpose: both halves describe the same night, so
   the interesting quantity is the disagreement, not either number. */
function sleepPerceptionGap(daily, metrics, anchor) {
  const rated = channelFromSeries(series(bucket(daily, "date", (r) => r.sleep_quality_0_10, anchor)), true);
  const measured = channelFromSeries(series(bucket(metrics, "date", (r) => r.sleep_efficiency, anchor)), true);
  if (rated.z == null || measured.z == null) return null;
  return rated.z - measured.z;
}

/* ---------------- states ---------------- */

/* A channel counts as degraded only when it has held at or above the bar for
   two consecutive weeks. One week over the line is what noise looks like, and
   naming a state off a single reading is how this model would start inventing
   findings. */
function sustained(channel, cfg) {
  const zs = (channel.points || []).map((p) => p.z).filter((z) => z != null);
  if (zs.length < cfg.persistence) return false;
  return zs.slice(-cfg.persistence).every((z) => z >= cfg.notable);
}

function nameState(A, C, P) {

  if (!A && !C && !P) {
    return { key: "aligned", name: "Aligned", detail: "Nothing is out of range this week." };
  }
  if (A && !C && !P) {
    return { key: "physical", name: "Physical Only", detail: "Training adaptation, so a red recovery score can be ignored." };
  }
  if (!A && C && P) {
    return { key: "cogpsy", name: "Cognitive Psychological", detail: "The body is recovered but the head is not." };
  }
  if (!A && C && !P) {
    return { key: "unrecognised", name: "Unrecognised", detail: "Measured impairment without any felt strain." };
  }
  if (!A && !C && P) {
    return { key: "perceived", name: "Perceived Only", detail: "The measures have not caught up with this yet." };
  }
  if (A && C && P) {
    return { key: "convergent", name: "Convergent", detail: "All three are degraded together, which is the pattern that matters." };
  }
  return {
    key: "mixed",
    name: "Mixed Signals",
    detail: "Some channels are elevated and others are not, so read the gaps below.",
  };
}

function describeGap(value, threshold, positive, negative) {
  if (value == null) return null;
  if (Math.abs(value) < threshold) return null;
  return value > 0 ? positive : negative;
}

/* ---------------- plain language ---------------- */

/* The names above are the model's vocabulary, and nobody describes their week as
   "cognitive psychological". These are what a person would actually say, plus a
   few things that tend to help.
 *
 * The guidance is deliberately low-stakes. It never diagnoses, never prescribes,
 * and never tells anyone to stop training. It suggests the kind of step a
 * sensible teammate would, and it points toward a person — a trainer, a sports
 * psychologist, a counsellor — whenever the pattern is the one that matters. */
const PLAIN_STATES = {
  aligned: {
    name: "All Clear",
    tone: "good",
    detail: "Your body, your reaction time, and how you feel all look normal for you.",
    guidance: [
      "Keep your routine steady, since consistency is what lets a real change stand out.",
      "Take the reaction test at your usual hour so the baseline stays sharp.",
    ],
  },
  physical: {
    name: "Body Working Hard",
    tone: "info",
    detail: "Your body is carrying load, but your head and your week feel fine. This is usually training doing its job.",
    guidance: [
      "Recovery basics matter most right now: sleep, food, and fluids.",
      "If your coach allows it, a lighter session is reasonable while this settles.",
      "There is no sign this is reaching your head, which is the good news here.",
    ],
  },
  cogpsy: {
    name: "Head Under Strain",
    tone: "warn",
    detail: "Your body is recovered, but you are slower and you are feeling it. Rest alone may not fix this one.",
    guidance: [
      "Look at what is taking your say away, since low control often sits behind this.",
      "Protect a consistent bedtime, even if your total sleep already looks fine.",
      "Tell one person you trust how the week is actually going.",
    ],
  },
  unrecognised: {
    name: "Slower Than You Feel",
    tone: "warn",
    detail: "Your reaction time has dropped, but you are not reporting strain. This is the pattern people most often miss.",
    guidance: [
      "Treat this as a prompt to check in with yourself, not as a verdict.",
      "Retake the reaction test at your usual hour to see whether it holds.",
      "Avoid late caffeine to push through, since it masks the slowdown this is measuring.",
    ],
  },
  perceived: {
    name: "Feeling It First",
    tone: "info",
    detail: "You are reporting strain that your body and reaction time have not shown yet. Feelings often move first.",
    guidance: [
      "What you report is real data, even before the numbers agree with it.",
      "Tag what is driving it on your check-in, so the pattern has a name.",
      "If it holds for two weeks, talk to someone you trust about it.",
    ],
  },
  convergent: {
    name: "Everything Is Strained",
    tone: "bad",
    detail: "Your body, your reaction time, and how you feel are all worse than your normal at the same time.",
    guidance: [
      "This is the pattern worth acting on rather than waiting out.",
      "Talk to your athletic trainer, a sports psychologist, or campus counselling.",
      "Ask your coach whether a lighter week is possible.",
    ],
  },
  mixed: {
    name: "Mixed Signals",
    tone: "warn",
    detail: "Some channels are off and others are not, so the details below matter more than the headline.",
    guidance: [
      "Read the disagreements below, since they carry more information than this name.",
      "Keep logging as normal, because another week usually resolves a mixed reading.",
    ],
  },
};

function describeState(state, psych, cfg) {
  const plain = PLAIN_STATES[state.key] || {};
  /* Three straight weeks well above normal on the psychological channel earns a
     pointer toward a person, whatever the other channels are doing. */
  const recent = (psych.points || []).map((p) => p.z).filter((z) => z != null).slice(-3);
  const prolonged = recent.length === 3 && recent.every((z) => z >= cfg.marked);
  return {
    key: state.key,
    name: plain.name || state.name,
    technicalName: state.name,
    detail: plain.detail || state.detail,
    tone: plain.tone || "warn",
    guidance: plain.guidance || [],
    support: state.key === "convergent" || prolonged,
  };
}

/* ---------------- entry point ---------------- */

function compute({ metrics = [], sessions = [], daily = [], weekly = [], journal = [], sensitivity, today }) {
  const cfg = SENSITIVITY[sensitivity] || SENSITIVITY[DEFAULT_SENSITIVITY];

  /* The day the seven-day windows count back from: the athlete's own today when
     the caller knows it, otherwise the latest day anything was recorded. */
  const latest = [
    ...metrics.map((r) => r.date), ...sessions.map((r) => r.date), ...daily.map((r) => r.date),
    ...weekly.map((r) => r.week_start), ...journal.map((r) => r.entry_date),
  ].filter(Boolean).map((d) => String(d).slice(0, 10)).sort().pop() || null;
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(today || "") ? today : latest;

  const a = autonomicChannel(metrics, anchor);
  const c = cognitiveChannel(sessions, anchor);
  const p = psychologicalChannel(daily, weekly, journal, anchor);

  const gaps = {
    cognitiveVsAutonomic: c.z != null && a.z != null ? c.z - a.z : null,
    psychologicalVsAutonomic: p.z != null && a.z != null ? p.z - a.z : null,
    cognitiveVsPsychological: c.z != null && p.z != null ? c.z - p.z : null,
    sleepFeltVsMeasured: sleepPerceptionGap(daily, metrics, anchor),
  };

  const readings = [
    describeGap(gaps.cognitiveVsAutonomic, cfg.gap, "Your reaction time is worse than your body suggests.", "Your body is worse than your reaction time suggests."),
    describeGap(gaps.psychologicalVsAutonomic, cfg.gap, "This is landing harder than your body shows.", "Your body is under more load than this feels like."),
    describeGap(gaps.cognitiveVsPsychological, cfg.gap, "You are measurably slower than you are reporting.", "You feel worse than your reaction time shows."),
    describeGap(gaps.sleepFeltVsMeasured, cfg.gap, "Your nights are rating worse than they are measuring.", "Your sleep is measuring worse than it is feeling."),
  ].filter(Boolean);

  const usable = [a, c, p].filter((ch) => ch.z != null).length;
  const depth = Math.max(a.weeks, c.weeks, p.weeks);
  let confidence = "calibrating";
  if (usable >= 2 && depth >= MIN_BASELINE_WEEKS + 1) confidence = "established";
  else if (usable >= 1) confidence = "provisional";

  return {
    channels: {
      autonomic: { z: a.z, weeks: a.weeks, points: a.points, parts: a.parts || {} },
      cognitive: { z: c.z, weeks: c.weeks, points: c.points, parts: c.parts || {} },
      psychological: { z: p.z, weeks: p.weeks, points: p.points, parts: p.parts || {} },
    },
    anchor,
    gaps,
    readings,
    state:
      confidence === "calibrating"
        ? null
        : describeState(nameState(sustained(a, cfg), sustained(c, cfg), sustained(p, cfg)), p, cfg),
    sustained: {
      autonomic: sustained(a, cfg),
      cognitive: sustained(c, cfg),
      psychological: sustained(p, cfg),
    },
    confidence,
    sensitivity: SENSITIVITY[sensitivity] ? sensitivity : DEFAULT_SENSITIVITY,
    thresholds: cfg,
  };
}

module.exports = { compute, weekStart, windowStart, SENSITIVITY, DEFAULT_SENSITIVITY, PLAIN_STATES, MIN_BASELINE_WEEKS };
