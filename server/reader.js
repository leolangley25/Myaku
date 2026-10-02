/* Myaku — reading a journal entry on this machine.
 *
 * An athlete who writes most nights should not also have to rate most nights.
 * Longer questionnaires are what raise burden and careless answers in daily
 * tracking (Eisele and colleagues, 2022), so rather than add questions, the entry
 * itself is read, when they allow it, for what the Life channel needs: how the day felt, how much was
 * pressing on them, how much of it was their call, what it was about, and
 * whether any of the three burnout signs came up.
 *
 * Three rules hold everywhere this is used.
 *
 *   It runs on this machine or not at all. The reader only ever talks to a model
 *   served locally through Ollama. There is no hosted fallback, so when no local
 *   model is running an entry simply waits, unread, until one is.
 *
 *   The athlete sees exactly what was taken and can correct it or leave the
 *   entry out. Model readings of brief daily diaries agree with what people
 *   report at about r = .42 across people but only about .28 from day to day
 *   for the same person (Ringwald and colleagues, 2026). That is useful as one
 *   voice among several and wrong often enough that it must never be the last
 *   word on anyone's day.
 *
 *   It describes the writing, never the writer. Every label below is something
 *   the entry says, not something the person is.
 *
 * Answers are asked for as words rather than numbers. Small models place a word
 * like "heavy" far more consistently than they place a 3 on an unlabelled scale,
 * for the same reason people do.
 */

/* Looked up on every read rather than once, so the address the server was started
   with is the one used, whichever module happened to load this file first. */
const localUrl = () => (process.env.MYAKU_LOCAL_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.MYAKU_READ_TIMEOUT_MS || 120000);

/* Below this there is too little to read a day from, and a guess would be noise. */
const MIN_WORDS = 12;
const MAX_CHARS = 6000;

const MOOD = ["very low", "low", "mixed", "good", "very good"];
const ENERGY = ["drained", "tired", "steady", "energised", "wired"];
const PRESSURE = ["none", "light", "moderate", "heavy", "overwhelming"];
const SAY = ["not mentioned", "none", "some", "most of it"];

const SOURCES = {
  training: "Training",
  competition: "Competition",
  coach_team: "Coach Or Team",
  school: "School",
  work: "Work",
  family: "Family",
  friends: "Friends",
  relationship: "Relationship",
  money: "Money",
  health: "Health Or Injury",
  sleep: "Sleep",
  future: "The Future",
};

/* The three athlete burnout signs, plus the two that most often travel with
   them in the writing itself. */
const SIGNS = {
  exhausted: "Worn Out",
  caring_less: "Caring Less",
  not_achieving: "Not Getting Anywhere",
  isolated: "On Your Own",
  hard_on_self: "Hard On Yourself",
};

const LIFTS = {
  progress: "Progress",
  support: "Support",
  enjoyment: "Enjoyment",
  rest: "Rest",
  pride: "Pride",
  gratitude: "Gratitude",
};

const SCHEMA = {
  type: "object",
  properties: {
    mood: { type: "string", enum: MOOD },
    energy: { type: "string", enum: ENERGY },
    pressure: { type: "string", enum: PRESSURE },
    say: { type: "string", enum: SAY },
    about: { type: "array", items: { type: "string", enum: Object.keys(SOURCES) } },
    signs: { type: "array", items: { type: "string", enum: Object.keys(SIGNS) } },
    lifts: { type: "array", items: { type: "string", enum: Object.keys(LIFTS) } },
    summary: { type: "string" },
    unsafe: { type: "boolean" },
  },
  required: ["mood", "energy", "pressure", "say", "about", "signs", "lifts", "summary", "unsafe"],
};

const INSTRUCTIONS = `You read one private journal entry written by an athlete and describe it for their own dashboard. Return JSON only.

mood: how the writer seems to feel overall. "very low", "low", "mixed", "good", or "very good". A bad practice described calmly is "low", not "very low".
energy: "drained", "tired", "steady", "energised", or "wired" (restless, keyed up, can't switch off). Use "steady" when the entry gives no sign either way.
pressure: how much is being demanded of them in what they describe. "none", "light", "moderate", "heavy", or "overwhelming".
say: "not mentioned" unless the entry clearly says whether they chose what was asked of them. "none" only when they say it was forced on them or out of their hands, "some" when partly their call, "most of it" when they were steering it.
about: every area the entry is about. training (practice, sessions, lifting, going in), competition, coach_team (coaches, teammates, the team), school (classes, exams, homework, studying), work (a paid job only), family, friends, relationship, money, health (illness, injury, pain), sleep, future. Empty if none apply.
signs: only those the writer clearly expresses. exhausted (physically or mentally worn out), caring_less (losing interest in their sport, not wanting to go), not_achieving (feeling they are not getting anywhere), isolated (alone, misunderstood, unsupported), hard_on_self (harsh self-criticism). Usually empty.
lifts: only those the writer clearly describes as having happened. progress, support, enjoyment, rest, pride, gratitude. A plan for later is not a lift.
summary: one plain sentence under 18 words, addressed to the writer as "you", saying what the entry was about. Describe the situation, never the person. No advice, no diagnosis.
unsafe: true only if the writer mentions wanting to die, harming themselves, or not being safe. Otherwise false.

If the entry is mainly a list or a plan, read its mood as "mixed" and leave signs and lifts empty unless they are stated.
Read only what is written. Do not guess at things the entry does not say.`;

const clean = (list, allowed) =>
  [...new Set((Array.isArray(list) ? list : []).map((v) => String(v).trim().toLowerCase()).filter((v) => v in allowed))];

const indexIn = (list, value) => {
  const i = list.indexOf(String(value || "").trim().toLowerCase());
  return i === -1 ? null : i;
};

/* Whatever came back, turned into the shape the rest of the app stores. Anything
   outside the allowed words is dropped rather than guessed at. */
function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mood = indexIn(MOOD, raw.mood);
  const energy = indexIn(ENERGY, raw.energy);
  const pressure = indexIn(PRESSURE, raw.pressure);
  const say = indexIn(SAY, raw.say);
  if (mood == null && pressure == null) return null;

  const summary = String(raw.summary || "").replace(/\s+/g, " ").trim().slice(0, 160);
  return {
    mood: mood == null ? null : MOOD[mood],
    energy: energy == null ? null : ENERGY[energy],
    pressure: pressure == null ? null : PRESSURE[pressure],
    say: say == null || say === 0 ? "not mentioned" : SAY[say],
    about: clean(raw.about, SOURCES),
    signs: clean(raw.signs, SIGNS),
    lifts: clean(raw.lifts, LIFTS),
    summary,
    unsafe: raw.unsafe === true,
  };
}

/* The same reading on the scales the rest of the Life channel uses. */
function numbers(reading) {
  if (!reading) return null;
  const at = (list, v) => {
    const i = list.indexOf(v);
    return i === -1 ? null : i;
  };
  const mood = at(MOOD, reading.mood);
  const energy = at(ENERGY, reading.energy);
  const pressure = at(PRESSURE, reading.pressure);
  const say = at(SAY, reading.say);
  return {
    valence: mood == null ? null : (mood - 2) / 2,           // -1 to 1, like the mood square
    arousal: energy == null ? null : (energy - 2) / 2,       // -1 to 1
    pressure: pressure == null ? null : pressure / 4,        // 0 to 1
    control: say == null || say === 0 ? null : (say - 1) / 2, // 0 to 1, or unknown
  };
}

/* How heavy an entry reads, from 0 to 1. Low mood, pressure, and burnout signs
   each count for a third, so an entry about a brutal week that ends somewhere
   good does not read as heavy as one that ends nowhere. Lifts take a little back,
   because support and progress are exactly what buffers demand. */
function heaviness(reading) {
  const n = numbers(reading);
  if (!n || (n.valence == null && n.pressure == null)) return null;
  const parts = [];
  if (n.valence != null) parts.push((1 - n.valence) / 2);
  if (n.pressure != null) parts.push(n.control == null ? n.pressure : n.pressure * (1 - 0.4 * n.control));
  parts.push(Math.min(1, (reading.signs || []).length / 2));
  const lift = Math.min(0.15, (reading.lifts || []).length * 0.05);
  const value = parts.reduce((a, b) => a + b, 0) / parts.length - lift;
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function parse(json) {
  if (!json) return null;
  try {
    return normalize(typeof json === "string" ? JSON.parse(json) : json);
  } catch {
    return null;
  }
}

/* One entry, read by the model on this machine. Throws when there is no model to
   ask, and the caller leaves the entry unread. */
async function read({ text, model, url = localUrl() }) {
  const body = String(text || "").trim().slice(0, MAX_CHARS);
  if (!model) throw Object.assign(new Error("No model is running on this machine"), { status: 503 });

  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: SCHEMA,
      options: { temperature: 0, num_predict: 300, num_ctx: 4096 },
      messages: [
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: `Journal entry:\n\n${body}` },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw Object.assign(new Error(`The model on this machine answered with status ${res.status}`), { status: 502 });
  const out = await res.json();
  const reading = parse(String((out.message && out.message.content) || ""));
  if (!reading) throw Object.assign(new Error("The model on this machine returned something unreadable"), { status: 502 });
  return reading;
}

/* An athlete's correction. Only the fields they touched change, and each is held
   to the same allowed words a model reading is. */
function amend(current, edits = {}) {
  const base = current || { mood: null, energy: null, pressure: null, say: "not mentioned", about: [], signs: [], lifts: [], summary: "", unsafe: false };
  const next = { ...base };
  if ("mood" in edits) next.mood = MOOD.includes(edits.mood) ? edits.mood : base.mood;
  if ("energy" in edits) next.energy = ENERGY.includes(edits.energy) ? edits.energy : base.energy;
  if ("pressure" in edits) next.pressure = PRESSURE.includes(edits.pressure) ? edits.pressure : base.pressure;
  if ("say" in edits) next.say = SAY.includes(edits.say) ? edits.say : base.say;
  if ("about" in edits) next.about = clean(edits.about, SOURCES);
  if ("signs" in edits) next.signs = clean(edits.signs, SIGNS);
  if ("lifts" in edits) next.lifts = clean(edits.lifts, LIFTS);
  return next;
}

module.exports = {
  MIN_WORDS, MOOD, ENERGY, PRESSURE, SAY, SOURCES, SIGNS, LIFTS, SCHEMA, INSTRUCTIONS,
  normalize, numbers, heaviness, parse, read, amend,
};
