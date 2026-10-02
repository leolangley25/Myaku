/* Myaku — the journal.
 *
 * A blank page is the reason most journals die in February, and unstructured
 * venting is the reason some of them make people feel worse. Everything here is
 * an attempt to answer two questions for an athlete on a Tuesday night: what
 * should I write, and did any of it do anything.
 *
 * What the research this is built on actually says:
 *
 *   Expressive writing (Pennebaker): fifteen to twenty minutes on three or four
 *   days, about the hardest thing and how it feels. Real but small on average,
 *   around r = .075 pooled across 146 randomised trials, and people often feel
 *   worse immediately afterwards before improving over two to four weeks.
 *
 *   Rumination is the risk. Brooding predicts worse outcomes; reflective
 *   pondering does not. Prompts that invite global self-evaluation, "why do I
 *   feel this way" and "what is wrong with me" among them, sit on the rumination
 *   scale itself, so none of the prompts below ask them.
 *
 *   Self-distancing (Kross and Ayduk): writing about yourself in the third
 *   person, by name, lowers distress and later rumination compared with writing
 *   from inside the experience.
 *
 *   Three good things (Seligman 2005): a week of it raised happiness and lowered
 *   depressive symptoms six months later. Gratitude habituates when it is daily,
 *   and Emmons and McCullough's weekly version is the one that held up, so this
 *   app suggests it weekly rather than nightly.
 *
 *   Tomorrow's list (Scullin 2018): five minutes writing a specific to-do list
 *   before bed, fell asleep about nine minutes faster than writing about what was
 *   already finished, and the more specific the list the faster they fell asleep.
 *
 *   Reflective practice in sport: what went well, what would change, what was
 *   learned. Structured post-event reflection is associated with better
 *   self-regulation and self-evaluation than free recall.
 *
 * None of this is a treatment, and the page says so.
 */

const { heaviness, numbers } = require("./reader");

const DAY_MS = 24 * 60 * 60 * 1000;

const MODES = [
  {
    id: "free",
    name: "Free Write",
    lead: "Whatever is actually on your mind.",
    prompt: "What is on your mind right now?",
    why: "No structure, for the nights when a prompt would get in the way.",
    minutes: 5,
    evidence: "",
  },
  {
    id: "expressive",
    name: "Get It Out",
    lead: "The hard thing, and how it actually feels.",
    prompt: "Write about the thing weighing on you most, and what it is doing to you. Do not tidy it up.",
    why: "Fifteen minutes, on a few days rather than every day. You may feel worse straight afterwards, which is normal and usually passes within a few weeks.",
    minutes: 15,
    evidence: "Pennebaker's expressive writing, pooled across 146 trials. The average effect is small.",
    caution: true,
  },
  {
    id: "distanced",
    name: "Step Outside It",
    lead: "The same day, from across the room.",
    prompt: "Write about today in the third person, using your own name. What did they face, and what would you tell them?",
    why: "Useful when something keeps going round and will not settle.",
    minutes: 10,
    evidence: "Self-distanced reflection lowers distress and later rumination compared with writing from inside it.",
  },
  {
    id: "good",
    name: "Three Good Things",
    lead: "Three that went well, and your part in them.",
    prompt: "Name three things that went well recently. For each one, write why it happened and what you did to make it possible.",
    why: "Best about once a week. Done nightly it goes flat, which is a real effect rather than a lack of discipline.",
    minutes: 5,
    evidence: "Seligman 2005 found a week of this raised wellbeing six months later.",
    weekly: true,
  },
  {
    id: "performance",
    name: "After The Session",
    lead: "What worked, what you would change.",
    prompt: "What went well today, what would you do differently, and what did you learn that you can use next time?",
    why: "Best written within a few hours of a game or a hard session, while it is still specific.",
    minutes: 8,
    evidence: "Structured post-event reflection is standard practice in sport psychology.",
  },
  {
    id: "tomorrow",
    name: "Tomorrow's List",
    lead: "Everything you are carrying into bed.",
    prompt: "List what you have to do tomorrow, as specifically as you can. Times, places, the first step of each.",
    why: "Five minutes, right before bed. The more specific the list, the better it works.",
    minutes: 5,
    evidence: "Scullin 2018: to-do writers fell asleep about nine minutes faster than those writing about finished tasks.",
    bedtime: true,
  },
];

const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));

const shift = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
const round = (n, places = 1) => (n == null ? null : Math.round(n * 10 ** places) / 10 ** places);
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

function wordCount(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/* Which prompt to offer next. Time of day, what a heavy day looked like, and
   what they have already used this week all point at different ones. */
function suggest({ entries = [], today, hour = 20, lastCheckin = null, hadEvent = false } = {}) {
  const recent = entries.filter((e) => e.entry_date > shift(today, -8));
  const used = new Set(recent.map((e) => e.mode).filter(Boolean));

  if (hadEvent) return { mode: "performance", because: "You had a session today, and this is the window where the detail is still there." };
  if (hour >= 21) return { mode: "tomorrow", because: "It is close to bed, and a specific list beats carrying it upstairs." };
  if (lastCheckin && lastCheckin.control != null && lastCheckin.load != null && lastCheckin.load >= 6 && lastCheckin.control <= 4) {
    return { mode: "distanced", because: "Today was high demand with little say, which is when writing from inside it tends to loop." };
  }
  if (!used.has("good") && recent.length >= 1) return { mode: "good", because: "You have not done this one in the last week, and it works best about weekly." };
  if (lastCheckin && lastCheckin.valence != null && lastCheckin.valence <= -0.3) {
    return { mode: "expressive", because: "Today rated low, and this is what that kind of day is for." };
  }
  return { mode: "free", because: "No particular reason tonight. Write whatever is there." };
}

/* Repeated hard writing on low days, which is the shape that predicts brooding
   rather than reflection. Not a diagnosis, and it never blocks anything. */
function ruminationWatch(entries, today) {
  const window = entries
    .filter((e) => e.entry_date > shift(today, -6))
    .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
  const heavy = window.filter((e) => e.mode === "expressive" || e.mode === "free");
  const low = heavy.filter((e) => e.valence != null && e.valence <= -0.2);
  if (heavy.length >= 3 && low.length >= 3) {
    return {
      raised: true,
      days: low.length,
      suggestion: "distanced",
    };
  }
  return { raised: false, days: low.length, suggestion: null };
}

/* ---------------- looking back ---------------- */

function streak(entries, today) {
  const days = new Set(entries.map((e) => e.entry_date));
  let count = 0;
  let cursor = days.has(today) ? today : shift(today, -1);
  while (days.has(cursor)) {
    count += 1;
    cursor = shift(cursor, -1);
  }
  return count;
}

/* Every entry against the athlete's own usual: how they rated the day, how much
   they wrote, and what the night that followed looked like. */
function entryInsight(entry, { entries = [], metrics = [] } = {}) {
  if (!entry) return null;
  const others = entries.filter((e) => e.entry_date !== entry.entry_date);
  const usualValence = mean(others.map((e) => e.valence).filter((v) => v != null));
  const usualWords = mean(others.map((e) => e.word_count).filter((w) => w != null && w > 0));
  const night = metrics.find((m) => String(m.date).slice(0, 10) === shift(entry.entry_date, 1)) || null;
  const otherNights = metrics.filter((m) => {
    const wroteBefore = entries.some((e) => shift(e.entry_date, 1) === String(m.date).slice(0, 10));
    return !wroteBefore && m.sleep_minutes != null;
  });

  return {
    date: entry.entry_date,
    mode: entry.mode || "free",
    words: entry.word_count ?? null,
    usualWords: usualWords == null ? null : Math.round(usualWords),
    valence: entry.valence ?? null,
    usualValence: round(usualValence, 2),
    nightAfter: night && night.sleep_minutes != null ? Math.round(night.sleep_minutes) : null,
    usualNight: otherNights.length >= 5 ? Math.round(mean(otherNights.map((m) => m.sleep_minutes))) : null,
  };
}

/* What writing has looked like over a season, and what tends to follow it. Every
   line here is a description: writing on hard days and sleeping badly on those
   same days share a cause as often as one leads to the other. */
function insights({ entries = [], metrics = [], daily = [], today } = {}) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
  const sorted = [...entries].sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
  const recent = sorted.filter((e) => e.entry_date > shift(day, -56));

  const byMode = {};
  for (const e of sorted) {
    const id = e.mode || "free";
    byMode[id] = byMode[id] || { mode: id, entries: 0, words: 0, valence: [] };
    byMode[id].entries += 1;
    byMode[id].words += e.word_count || 0;
    if (e.valence != null) byMode[id].valence.push(e.valence);
  }

  const modes = Object.values(byMode)
    .map((m) => ({
      mode: m.mode,
      name: (MODE_BY_ID[m.mode] || {}).name || "Free Write",
      entries: m.entries,
      averageWords: m.entries ? Math.round(m.words / m.entries) : 0,
      averageMood: round(mean(m.valence), 2),
    }))
    .sort((a, b) => b.entries - a.entries);

  /* Nights after a day that was written about, against the nights that were not. */
  const wroteDays = new Set(sorted.map((e) => e.entry_date));
  const after = [];
  const without = [];
  for (const m of metrics) {
    if (m.sleep_minutes == null) continue;
    const dayBefore = shift(String(m.date).slice(0, 10), -1);
    (wroteDays.has(dayBefore) ? after : without).push(Number(m.sleep_minutes));
  }
  const nights =
    after.length >= 4 && without.length >= 4
      ? {
          after: Math.round(mean(after)),
          without: Math.round(mean(without)),
          difference: Math.round(mean(after) - mean(without)),
          nights: after.length,
        }
      : null;

  /* How a written day was rated on the check-in, against days with no entry. */
  const checkinWritten = [];
  const checkinNot = [];
  for (const c of daily) {
    if (c.valence == null) continue;
    (wroteDays.has(String(c.date).slice(0, 10)) ? checkinWritten : checkinNot).push(Number(c.valence));
  }
  const mood =
    checkinWritten.length >= 4 && checkinNot.length >= 4
      ? {
          written: round(mean(checkinWritten), 2),
          notWritten: round(mean(checkinNot), 2),
          days: checkinWritten.length,
        }
      : null;

  const weeks = {};
  for (const e of recent) {
    const key = shift(e.entry_date, -(new Date(e.entry_date + "T00:00:00Z").getUTCDay()));
    weeks[key] = (weeks[key] || 0) + 1;
  }

  return {
    today: day,
    total: sorted.length,
    streak: streak(sorted, day),
    last: sorted.length ? sorted[sorted.length - 1].entry_date : null,
    averageWords: Math.round(mean(sorted.map((e) => e.word_count || 0)) || 0),
    modes,
    nights,
    mood,
    weekly: Object.entries(weeks)
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => (a.week < b.week ? -1 : 1))
      .slice(-8),
    watch: ruminationWatch(sorted, day),
  };
}

/* What the writing keeps returning to, from the readings a model on this machine
   made and the athlete left in. The last two weeks against the six before them,
   as shares of entries read in each, so writing more often does not look like
   everything getting worse. */
function themes(entries = [], today) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
  const read = entries.filter((e) => e.reading).sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1));
  const recent = read.filter((e) => e.entry_date > shift(day, -14));
  const before = read.filter((e) => e.entry_date <= shift(day, -14) && e.entry_date > shift(day, -56));

  const tally = (list, field) => {
    const out = {};
    list.forEach((e) => (e.reading[field] || []).forEach((k) => (out[k] = (out[k] || 0) + 1)));
    return out;
  };
  const compare = (field) => {
    const now = tally(recent, field);
    const then = tally(before, field);
    return [...new Set([...Object.keys(now), ...Object.keys(then)])]
      .map((key) => ({
        key,
        recent: now[key] || 0,
        before: then[key] || 0,
        recentShare: recent.length ? round((now[key] || 0) / recent.length, 2) : null,
        beforeShare: before.length ? round((then[key] || 0) / before.length, 2) : null,
      }))
      .sort((a, b) => b.recent - a.recent || b.before - a.before);
  };

  /* Weekly average of how heavy the writing read, oldest first. */
  const weeks = {};
  read.filter((e) => e.entry_date > shift(day, -56)).forEach((e) => {
    const key = shift(e.entry_date, -((new Date(e.entry_date + "T00:00:00Z").getUTCDay() + 6) % 7));
    const h = heaviness(e.reading);
    if (h != null) (weeks[key] = weeks[key] || []).push(h);
  });

  /* Days that have both a rating the athlete typed and a reading of the words.
     When the two keep disagreeing, that is worth seeing, the same way felt sleep
     against measured sleep is. Neither side is the right one. */
  const paired = read
    .filter((e) => e.valence != null)
    .map((e) => ({ rated: e.valence, read: (numbers(e.reading) || {}).valence }))
    .filter((p) => p.read != null);
  const agreement =
    paired.length >= 5
      ? { days: paired.length, rated: round(mean(paired.map((p) => p.rated)), 2), read: round(mean(paired.map((p) => p.read)), 2) }
      : null;

  return {
    read: read.length,
    recent: recent.length,
    before: before.length,
    about: compare("about"),
    signs: compare("signs"),
    lifts: compare("lifts"),
    weekly: Object.entries(weeks)
      .map(([week, list]) => ({ week, heaviness: round(mean(list), 2), entries: list.length }))
      .sort((a, b) => (a.week < b.week ? -1 : 1)),
    agreement,
  };
}

module.exports = { MODES, MODE_BY_ID, wordCount, suggest, insights, entryInsight, streak, ruminationWatch, themes };
