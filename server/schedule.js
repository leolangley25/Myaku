/* Myaku — the schedule, and the weeks where it collides.
 *
 * Everything an athlete's week is made of arrives as calendar entries with
 * nothing but a title and a time. This file turns those into typed events, then
 * reads the weeks ahead for the collisions that cost the most: a game the night
 * before an exam, travel stacked on a heavy training block.
 *
 * Why it matters, from the literature this app already cites elsewhere:
 *   Student athletes report insufficient sleep on about four nights a week, and
 *   competition travel disrupts both sleep duration and circadian timing
 *   (Heller and colleagues, Journal of Biological Rhythms, 2023).
 *   The highest stress and illness rates in a season fall in examination weeks
 *   (Mann and colleagues, review of collegiate athlete stress, 2016).
 *
 * The weights below are reasoned, not measured. They are stated in one place so
 * they can be argued with, and the page that shows them says so.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/* Kind, in the order a title is tested against. The first match wins, so the
   specific patterns come before the general ones. */
const KINDS = [
  { kind: "exam", test: /\b(exam|final|finals|midterm|quiz|test)\b/i },
  { kind: "deadline", test: /\b(due|deadline|paper|essay|project|submission|thesis)\b/i },
  { kind: "travel", test: /\b(travel|flight|fly|bus|depart|departure|road trip|away|@)\b/i },
  { kind: "game", test: /\b(game|match|meet|race|tournament|championship|vs\.?|versus|fixture|regatta)\b/i },
  { kind: "lift", test: /\b(lift|weights|strength|gym|conditioning)\b/i },
  { kind: "practice", test: /\b(practice|training|session|drill|skills|scrimmage|shootaround|rehearsal)\b/i },
  { kind: "class", test: /\b(class|lecture|lab|seminar|tutorial|office hours)\b/i },
];

const KIND_LABEL = {
  game: "Game",
  practice: "Practice",
  lift: "Lift",
  travel: "Travel",
  exam: "Exam",
  deadline: "Deadline",
  class: "Class",
  other: "Other",
};

/* What each kind costs a week, before anything about this athlete is known.
   Games and exams are the two that reliably move a night's sleep. */
const WEIGHT = { game: 3, exam: 3, travel: 2.5, deadline: 1.5, lift: 0.75, practice: 0.75, class: 0.2, other: 0.25 };

/* A week counts as a squeeze when it is both heavy in itself and heavier than
   this athlete's own ordinary week. */
const SQUEEZE_SCORE = 6;
const SQUEEZE_RATIO = 1.4;

function classify(title) {
  const text = String(title || "");
  for (const { kind, test } of KINDS) if (test.test(text)) return kind;
  return "other";
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

function dateOf(value) {
  const s = String(value || "");
  return isDate(s.slice(0, 10)) ? s.slice(0, 10) : null;
}

function timeOf(value) {
  const m = String(value || "").match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/* A calendar entry, reduced to what Myaku reads: when it lands, what kind of
   thing it is, and nothing else. Entries without a usable date are dropped. */
function normalize(raw, { now = new Date(), monthsBack = 2, monthsAhead = 6 } = {}) {
  const date = dateOf(raw.start);
  if (!date) return null;
  const from = new Date(now.getTime() - monthsBack * 30 * DAY_MS).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + monthsAhead * 30 * DAY_MS).toISOString().slice(0, 10);
  if (date < from || date > to) return null;

  const end = dateOf(raw.end);
  return {
    date,
    endDate: end && end > date ? end : null,
    startTime: timeOf(raw.start),
    kind: raw.kind && KIND_LABEL[raw.kind] ? raw.kind : classify(raw.title),
    title: String(raw.title || "Untitled").slice(0, 120),
    uid: raw.uid ? String(raw.uid).slice(0, 200) : null,
  };
}

function importEvents(parsed, options) {
  const seen = new Set();
  const out = [];
  for (const raw of parsed) {
    const event = normalize(raw, options);
    if (!event) continue;
    const key = event.uid || `${event.date}|${event.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

/* ---------------- weeks ---------------- */

const shift = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);

/* Weeks run from the day after today, seven days at a time, because "next week"
   to an athlete means the next seven days, not a row on a wall calendar. */
function weekBuckets(today, count = 4) {
  return Array.from({ length: count }, (_, i) => ({
    start: shift(today, 1 + i * 7),
    end: shift(today, 7 + i * 7),
  }));
}

/* A multi-day event lands on every day it covers, capped so a month-long entry
   cannot swamp a week. */
function daysCovered(event) {
  const days = [event.date];
  if (!event.endDate) return days;
  let d = event.date;
  for (let i = 0; i < 13 && d < event.endDate; i++) {
    d = shift(d, 1);
    days.push(d);
  }
  return days;
}

function weekLoad(events, start, end) {
  const counts = {};
  let score = 0;
  const nights = new Set();
  for (const e of events) {
    for (const day of daysCovered(e)) {
      if (day < start || day > end) continue;
      counts[e.kind] = (counts[e.kind] || 0) + 1;
      score += WEIGHT[e.kind] ?? WEIGHT.other;
      if (e.kind === "game" || e.kind === "travel" || e.kind === "exam") nights.add(day);
    }
  }
  return { score: Math.round(score * 10) / 10, counts, hardDays: nights.size };
}

/* What this athlete's ordinary week looks like, from the weeks already in the
   calendar. Without enough history the typical week is the weights' own idea of
   a normal week rather than a guess about this person. */
function typicalWeek(events, today) {
  const scores = [];
  for (let i = 1; i <= 8; i++) {
    const start = shift(today, -7 * i);
    const end = shift(start, 6);
    const { score } = weekLoad(events, start, end);
    if (score > 0) scores.push(score);
  }
  if (scores.length < 3) return { score: null, weeks: scores.length };
  const sorted = scores.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { score: Math.round(median * 10) / 10, weeks: scores.length };
}

/* How the athlete's own nights have gone on days of a given kind, against every
   other day. Description only: a hard day and a short night share a cause as
   often as one causes the other. */
function responseTo(kind, events, metrics) {
  const onDays = new Set();
  for (const e of events) if (e.kind === kind) daysCovered(e).forEach((d) => onDays.add(d));

  const on = [];
  const off = [];
  for (const m of metrics) {
    if (m.sleep_minutes == null) continue;
    (onDays.has(m.date) ? on : off).push(Number(m.sleep_minutes));
  }
  if (on.length < 3 || off.length < 5) return null;
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  return {
    kind,
    nights: on.length,
    onMinutes: Math.round(mean(on)),
    offMinutes: Math.round(mean(off)),
    deltaMinutes: Math.round(mean(on) - mean(off)),
  };
}

/* ---------------- the squeeze ---------------- */

function season({ events = [], metrics = [], today, weeks = 4 }) {
  const day = isDate(today) ? today : new Date().toISOString().slice(0, 10);
  const typical = typicalWeek(events, day);

  const ahead = weekBuckets(day, weeks).map((bucket) => {
    const load = weekLoad(events, bucket.start, bucket.end);
    const ratio = typical.score ? Math.round((load.score / typical.score) * 100) / 100 : null;
    const squeeze = load.score >= SQUEEZE_SCORE && (ratio == null || ratio >= SQUEEZE_RATIO);
    return { ...bucket, ...load, ratio, squeeze };
  });

  const responses = ["travel", "game", "exam"]
    .map((kind) => responseTo(kind, events, metrics))
    .filter(Boolean)
    .filter((r) => Math.abs(r.deltaMinutes) >= 10);

  const next = ahead.find((w) => w.squeeze) || null;
  return {
    today: day,
    typical,
    weeks: ahead,
    responses,
    next,
    counted: events.length,
    thresholds: { score: SQUEEZE_SCORE, ratio: SQUEEZE_RATIO },
  };
}

module.exports = { classify, normalize, importEvents, weekLoad, typicalWeek, responseTo, season, KIND_LABEL, WEIGHT };
