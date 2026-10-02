/* Myaku — the assistant.
 *
 * An athlete can ask what a reading means, what moved, or what to do about it.
 * Two rules shape every line of this file.
 *
 * It answers from computed facts only. The model is handed a fact sheet built
 * from the same functions the pages draw from, and is told to say so when the
 * answer is not in it. Nothing is inferred from raw data it has not been given,
 * and journal text is never included at all, only how heavy entries read when
 * the athlete let a model on their own machine read them.
 *
 * It is off until the athlete turns it on. Answering means sending that fact
 * sheet to Anthropic, which is a different promise from the rest of the app, so
 * it is opt-in, it says exactly what leaves the device, and it can be turned
 * back off.
 */

const { PLAIN_STATES } = require("./divergence");

const MODEL = "claude-opus-5";
const MAX_QUESTION = 500;
const MAX_TURNS = 8;

/* A model running on the athlete's own machine, through Ollama. When one is
   there it is preferred over anything hosted, because then the fact sheet never
   leaves the device at all, which is the promise the rest of the app makes. */
const LOCAL_URL = (process.env.MYAKU_LOCAL_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const LOCAL_MODEL = process.env.MYAKU_LOCAL_MODEL || "";
const LOCAL_TIMEOUT_MS = Number(process.env.MYAKU_LOCAL_TIMEOUT_MS || 90000);
const PROBE_TTL_MS = 60000;

/* ---------------- the fact sheet ---------------- */

const BANDS = [
  { at: 2, word: "much worse than usual" },
  { at: 1, word: "worse than usual" },
  { at: -1, word: "typical for you" },
  { at: -Infinity, word: "better than usual" },
];

function band(z, cfg) {
  if (z == null) return "still learning";
  if (z >= cfg.marked) return BANDS[0].word;
  if (z >= cfg.notable) return BANDS[1].word;
  if (z <= -cfg.notable) return BANDS[3].word;
  return BANDS[2].word;
}

const round = (n, places = 2) => (n == null ? null : Math.round(n * 10 ** places) / 10 ** places);

/* The model repeats these words back to the athlete, so they are the words the
   app itself uses on its pages, never the column names underneath. */
const MEASURE_NAME = {
  hrv_ms: "heart rate variability",
  rhr_bpm: "resting heart rate",
  sleep_minutes: "sleep",
  sleep_efficiency: "sleep efficiency",
  speed: "response speed",
  lapses: "lapses",
  load: "demand",
  control: "say over your week",
  recovery: "felt recovery",
  focus: "felt focus",
  motivation: "motivation",
  mood: "mood",
  strain: "days of high demand with little say",
  burnout: "burnout signs",
  connection: "feeling connected to people",
  writing: "how heavy your journal entries read",
};

/* A spread is meaningless without its direction, and a model handed a bare
   number will guess at which way is bad. */
function spread(z) {
  const n = round(z, 1);
  if (n === 0) return "exactly at your normal";
  return `${Math.abs(n)} spreads ${n > 0 ? "worse" : "better"} than your normal`;
}

function channelLines(divergence) {
  const names = { autonomic: "Body", cognitive: "Brain", psychological: "Life" };
  return Object.entries(divergence.channels).map(([key, ch]) => {
    const parts = Object.entries(ch.parts || {})
      .filter(([, z]) => z != null)
      .map(([name, z]) => `${MEASURE_NAME[name] || name} ${spread(z)}`)
      .join("; ");
    const move = ch.z == null ? "no reading yet" : `${spread(ch.z)}, which reads as ${band(ch.z, divergence.thresholds)}`;
    return `${names[key]}: ${move}; ${ch.weeks} weeks of history${parts ? `. Behind it: ${parts}` : ""}`;
  });
}

/* Which parts of the sheet a question is actually about. A small model handed
   everything answers with a summary of everything, which is what made the first
   version of this feel like a report rather than a reply. */
const TOPICS = [
  { key: "body", test: /sleep|slept|bed|nap|hrv|heart|rest|recover|tired|night|sick|ill/i },
  { key: "brain", test: /brain|reaction|react|test|slow|lapse|sharp|focus|concentrat|alert/i },
  { key: "life", test: /life|mood|stress|feel|check-?in|burn|motivat|demand|control|say|drain/i },
  { key: "season", test: /week|change|changed|trend|season|history|pattern|before|lately|month/i },
  { key: "schedule", test: /game|practice|exam|travel|schedule|ahead|busy|next|plan|upcoming/i },
  { key: "logging", test: /log|track|how often|consistent|missing|data|enough/i },
];

function topicsFor(question) {
  const text = String(question || "");
  if (!text) return null;
  const hit = TOPICS.filter((t) => t.test.test(text)).map((t) => t.key);
  return hit.length ? new Set(hit) : null;
}

/* Everything the model is allowed to know, in the order an athlete would ask
   about it. Plain lines rather than JSON, because the answers quote them back.
   With a question, only the sections that question is about are included. */
function factSheet({ today, user, divergence, progress, body, brain, life, trends, schedule, caffeine, question }) {
  const wanted = topicsFor(question);
  const wants = (key) => !wanted || wanted.has(key);
  const lines = [];
  const push = (label, value) => value && lines.push(`${label}: ${value}`);

  push("Today", today);
  push("Name", user && user.name);
  push("Sensitivity", divergence.sensitivity);
  push(
    "Confidence",
    `${divergence.confidence}${divergence.confidence !== "established" ? " (a channel needs four weeks of history before a pattern is named)" : ""}`
  );

  if (divergence.state) {
    const plain = PLAIN_STATES[divergence.state.key] || {};
    push("Current pattern", `${divergence.state.name} — ${divergence.state.detail}`);
    if (plain.guidance && plain.guidance.length) push("Guidance already shown", plain.guidance.join(" "));
  } else {
    push("Current pattern", "none named yet, because there is not enough history");
  }

  lines.push("", "CHANNELS, measured against this athlete's own history:");
  channelLines(divergence).forEach((line) => lines.push(`- ${line}`));

  if (divergence.readings && divergence.readings.length) {
    lines.push("", "DISAGREEMENTS between channels:");
    divergence.readings.forEach((r) => lines.push(`- ${r.text || r}`));
  }

  if (wants("season") && trends && trends.hasData) {
    lines.push("", "SEASON:");
    lines.push(`- Weeks read: ${(trends.weeks || []).length}`);
    if (trends.current) lines.push(`- Current pattern held: ${trends.heldWeeks} weeks`);
    if (trends.previous) lines.push(`- Pattern before it: ${trends.previous.name || trends.previous.key}`);
  }

  if (wants("body") && body && body.hasData) {
    lines.push("", "BODY detail:");
    const s = body.sleep || {};
    if (s.week) {
      lines.push(`- Sleep over seven nights: ${s.week.average} minutes on average across ${s.week.nights} nights, ${s.week.atGoal} of them at the ${body.goal} minute goal`);
      if (s.usualAverage != null) lines.push(`- Usual average before this week: ${s.usualAverage} minutes`);
      if (s.efficiency != null) lines.push(`- Sleep efficiency: ${s.efficiency}%`);
    }
    heartLine(lines, "Heart rate variability", body.hrv, "ms", true);
    heartLine(lines, "Resting heart rate", body.rhr, "bpm", false);
    if (body.sources && body.sources.latest) lines.push(`- Data source: ${body.sources.latest}${body.sources.sdnn ? " (Apple reports a different variability measure from the others)" : ""}`);
  }

  if (wants("brain") && brain && brain.hasData && brain.week) {
    lines.push("", "BRAIN detail:");
    lines.push(`- Last seven days: ${brain.week.sessions} tests${brain.week.meanRt != null ? `, average response ${Math.round(brain.week.meanRt)} ms` : ""}${brain.week.lapses != null ? `, ${brain.week.lapses} lapses` : ""}`);
    if (brain.usual && brain.usual.low != null) lines.push(`- Usual range from earlier tests: ${Math.round(brain.usual.low)} to ${Math.round(brain.usual.high)} ms`);
    if (brain.target) lines.push(`- Target: ${brain.target} tests a week`);
    if (brain.devices && brain.devices.length > 1) lines.push(`- Tests came from more than one device, which changes how fast a tap registers`);
  }

  if (wants("life") && life && life.hasData) {
    lines.push("", "LIFE detail:");
    if (life.checkins) lines.push(`- Check-ins in the last seven days: ${life.checkins.days} of ${life.checkins.target}`);
    const measures = life.measures && typeof life.measures === "object" ? Object.entries(life.measures) : [];
    measures.slice(0, 8).forEach(([name, m]) => {
      if (!m) return;
      const label = MEASURE_NAME[name] || name;
      if (m.now != null) lines.push(`- ${label}: ${round(m.now, 1)} out of 7 this week${m.usual != null ? `, against ${round(m.usual, 1)} usually` : ""}`);
      else if (m.usual != null) lines.push(`- ${label}: nothing logged this week, usually ${round(m.usual, 1)} out of 7`);
    });
    if (life.strain && life.strain.days != null) lines.push(`- Days with high demand and low say: ${life.strain.days}`);
    if (life.burnout && life.burnout.moves) {
      Object.entries(life.burnout.moves).forEach(
        ([sign, move]) => move != null && lines.push(`- Burnout question, ${sign}: ${Math.abs(round(move, 1))} points ${move > 0 ? "worse" : "better"} than the weeks before`)
      );
    }
  }

  if (wants("schedule") && schedule && schedule.next) {
    lines.push("", "SCHEDULE AHEAD:");
    lines.push(`- Next heavy week: ${schedule.next.start} to ${schedule.next.end}, ${describeCounts(schedule.next.counts)}`);
    (schedule.responses || []).forEach((r) =>
      lines.push(`- On ${r.kind} days this athlete sleeps ${Math.abs(r.deltaMinutes)} minutes ${r.deltaMinutes < 0 ? "less" : "more"} than usual, over ${r.nights} nights`)
    );
  }

  if (caffeine && caffeine.bedtimeMg != null) {
    push("Caffeine left at bedtime, recent average", `${Math.round(caffeine.bedtimeMg)} mg`);
  }

  if (wants("logging") && progress) {
    lines.push("", "LOGGING over the last seven days:");
    lines.push(`- Reaction tests ${progress.thisWeek.pvt} of ${progress.thisWeek.pvtTarget}, check-ins ${progress.thisWeek.checkins} of 7, weekly reflection ${progress.thisWeek.weekly ? "done" : "not done"}`);
  }

  return lines.filter((l) => l !== undefined).join("\n");
}

/* Higher variability is better and a higher resting rate is worse, so each line
   says which way this one has gone in words rather than leaving it to be guessed. */
function heartLine(lines, label, measure, unit, higherIsBetter) {
  if (!measure || measure.current == null) return;
  const normal = measure.normal && measure.normal.low != null ? `, usual range ${round(measure.normal.low, 1)} to ${round(measure.normal.high, 1)}` : "";
  let verdict = "";
  if (measure.status === "above") verdict = higherIsBetter ? ", above it, which is the good direction" : ", above it, which is the direction that matters";
  if (measure.status === "below") verdict = higherIsBetter ? ", below it, which is the direction that matters" : ", below it, which is the good direction";
  if (measure.status === "normal") verdict = ", inside it";
  lines.push(`- ${label}: ${round(measure.current, 1)} ${unit}${normal}${verdict}`);
}

function describeCounts(counts) {
  const parts = Object.entries(counts || {})
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "nothing scheduled";
}

/* ---------------- the model ---------------- */

const SYSTEM = `You are the assistant inside Myaku, an app that compares an athlete's wearable data (Body), a three-minute reaction test (Brain), and their own check-ins (Life) against their own history, and reports where the three disagree. You are talking to that athlete about their own numbers.

TALK LIKE A GOOD COACH OR COUNSELLOR, NOT LIKE A DASHBOARD. You have their numbers so that you can understand them, not so that you can read them out. Most answers should contain at most one number, and many should contain none at all. If you catch yourself listing measures, stop and say the human thing instead.

ANSWER THE QUESTION THEY ASKED, in their words, in the first sentence. Never open with a summary of what the app knows.

BE DIRECT AND TAKE A POSITION. When they ask what to do, say what you would do, with a real time or amount, and say it as one clear thing rather than three options. When they ask how they are or what something means, answer that instead: name what you see happening to them, and check whether it lands, ending with one short question. Never pad with caveats or reminders that you are not a doctor. The app prints that under every answer you give.

Still true, no matter how direct you are:
- Use only numbers that appear in the fact sheet. If the answer is not in it, say so in one sentence, name the page or habit that would collect it, then answer as far as the data lets you.
- Never tell them what they are. "You are burning out", "you are overtrained", "you are depressed" are all out, however clear the data looks, because this app reads patterns and not people. Say what the data is doing and what to do about it: "this is the pattern worth acting on" is fine, "you are burning out" is not. Never name a diagnosis and never discuss medication or supplements as treatment.
- Numbers in the fact sheet are written the way you should say them. Never write a raw field name like hrv_ms or rhr_bpm, and never quote a spread without saying it is a spread from their normal.
- If a question touches self-harm, disordered eating, or a medical emergency, drop everything else: say plainly that this is past what an app should answer, and point them to 988, the Suicide and Crisis Lifeline, which is on the More page.
- A move of one means one typical spread away from their own normal. Say it that way, never as statistics.
- If a reading rests on thin history, say so in a clause and keep going. Do not spend the whole answer on uncertainty.

Style: warm, plain, second person. Two or three sentences, never more. No lists unless they asked for steps, and then three at most. Contractions are fine. Sound like someone who knows them and is on their side, not like a report with a friendly opening line.`;

function fallbackAnswer(facts) {
  return {
    answer:
      "The assistant is not switched on for this server, so here is the reading itself instead. " +
      "Everything below comes from your own pages.",
    facts,
    model: null,
    provider: "none",
  };
}

/* ---------------- a model on this machine ---------------- */

let probed = { at: 0, models: [] };

async function localModels() {
  if (Date.now() - probed.at < PROBE_TTL_MS) return probed.models;
  try {
    const res = await fetch(`${LOCAL_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const body = res.ok ? await res.json() : { models: [] };
    probed = { at: Date.now(), models: (body.models || []).map((m) => m.name).filter(Boolean) };
  } catch {
    probed = { at: Date.now(), models: [] };
  }
  return probed.models;
}

/* Which engine will answer, and what it means for the athlete's data. Asked by
   the Ask page before it shows anyone a consent screen, because the promise is
   different in each case. */
async function status({ apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  const models = await localModels();
  const chosen = LOCAL_MODEL && models.includes(LOCAL_MODEL) ? LOCAL_MODEL : models[0] || null;
  if (chosen) return { provider: "local", model: chosen, onDevice: true, available: true, models };
  if (apiKey) return { provider: "anthropic", model: MODEL, onDevice: false, available: true, models: [] };
  return { provider: "none", model: null, onDevice: false, available: false, models: [] };
}

/* Small models drift into essays and invented detail, so the rules they most
   often break are repeated right before the question. */
const LOCAL_REMINDER =
  "Answer this exact question in two or three sentences, the way a coach who knows them would. " +
  "Use at most one number from the fact sheet, and none at all if the answer does not need one. Never list measures. " +
  "Be direct about what to do, or reflect back what is happening to them and end with one short question. " +
  "Describe the pattern, never the person: do not tell them they are burning out, overtrained, depressed or ill, however clear it looks. " +
  "No disclaimers and no hedging: the app prints its own note under your answer.";

async function askLocal({ text, facts, history, model }) {
  const messages = [
    { role: "system", content: SYSTEM },
    ...history.slice(-MAX_TURNS).map((turn) => ({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: String(turn.content || "").slice(0, 2000),
    })),
    { role: "user", content: `Fact sheet for this athlete:\n\n${facts}\n\n${LOCAL_REMINDER}\n\nTheir question: ${text}` },
  ];

  const res = await fetch(`${LOCAL_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      /* The fact sheet and the rules together run past a default context window,
         and an overflowing window drops the oldest tokens, which are the rules. */
      options: { temperature: 0.2, num_predict: 400, num_ctx: 8192 },
    }),
    signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`The model on this machine answered with status ${res.status}.`);
  const body = await res.json();
  const answer = String((body.message && body.message.content) || "").trim();
  if (!answer) throw new Error("The model on this machine returned nothing.");
  return { answer, model, provider: "local", onDevice: true };
}

/* One question, answered against one fact sheet. History is the last few turns,
   so a follow-up like "why?" still makes sense. */
async function ask({ question, facts, history = [], apiKey = process.env.ANTHROPIC_API_KEY }) {
  const text = String(question || "").trim().slice(0, MAX_QUESTION);
  if (!text) throw Object.assign(new Error("Ask a question first"), { status: 400 });

  /* A model on this machine wins, because then nothing leaves it. */
  const engine = await status({ apiKey });
  if (engine.provider === "local") {
    try {
      return await askLocal({ text, facts, history, model: engine.model });
    } catch (err) {
      if (!apiKey) throw Object.assign(new Error(err.message || "The model on this machine did not answer"), { status: 503 });
    }
  }
  if (!apiKey) return fallbackAnswer(facts);

  let Anthropic;
  try {
    Anthropic = require("@anthropic-ai/sdk");
  } catch {
    return fallbackAnswer(facts);
  }

  const client = new Anthropic({ apiKey });
  const messages = [
    ...history.slice(-MAX_TURNS).map((turn) => ({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: String(turn.content || "").slice(0, 2000),
    })),
    { role: "user", content: `Here is the fact sheet for this athlete:\n\n${facts}\n\nTheir question: ${text}` },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    messages,
  });

  if (response.stop_reason === "refusal") {
    return { answer: "I could not answer that one. Try asking about a reading on one of your pages.", model: MODEL, provider: "anthropic" };
  }

  const answer = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return {
    answer: answer || "I could not put that into words. Try asking it a different way.",
    model: MODEL,
    provider: "anthropic",
    onDevice: false,
  };
}

module.exports = { factSheet, ask, status, SYSTEM, MODEL };
