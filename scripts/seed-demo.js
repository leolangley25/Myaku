/* Myaku — demo account.
 *
 * Eight weeks of a plausible season for one athlete. The body holds up the
 * whole way through; from about week five, coursework climbs, control over it
 * falls, reaction time slows, and self-report follows. That is the pattern the
 * product exists to name, and it is invisible to anything measuring only the
 * autonomic side.
 *
 * Deterministic, so the demo looks the same every time it is rebuilt.
 */

const crypto = require("crypto");
const db = require("../server/db");

const EMAIL = "demo@myaku.app";
const PASSWORD = "seasondemo2026";
const NAME = "Jordan Reyes";
const WEEKS = 8;

/* ---------------- deterministic noise ---------------- */

let seed = 20260911;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function gauss(mean, sd) {
  let z = 0;
  for (let i = 0; i < 6; i++) z += rnd();
  return mean + ((z - 3) / Math.sqrt(0.5)) * sd;
}
const round = (v, d = 0) => Number(v.toFixed(d));

/* ---------------- timeline ---------------- */

const DAYS = WEEKS * 7;
const start = new Date();
start.setHours(0, 0, 0, 0);
start.setDate(start.getDate() - (DAYS - 1));

const dayKey = (i) => {
  const d = new Date(start);
  d.setDate(d.getDate() + i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const mondayOf = (key) => {
  const d = new Date(key + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* Pressure ramps in from day 28 and keeps climbing to the end. */
const pressure = (i) => Math.max(0, Math.min(1, (i - 28) / 24));

/* ---------------- reset ---------------- */

const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(EMAIL);
if (existing) {
  const id = existing.id;
  db.USER_TABLES.forEach((t) => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id));
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = `${salt}:${crypto.scryptSync(PASSWORD, salt, 64).toString("hex")}`;
const userId = Number(
  db.prepare("INSERT INTO users (name, email, password_hash, sensitivity, onboarded_at) VALUES (?, ?, ?, 'medium', datetime('now'))")
    .run(NAME, EMAIL, hash).lastInsertRowid
);

db.prepare(`INSERT INTO calibration (user_id, sport, training_days, typical_bedtime,
  baseline_training, baseline_academic, baseline_personal)
  VALUES (?, 'Soccer', 5, '23:00', 4, 3, 3)`).run(userId);

// Labelled as demo data rather than as a Whoop connection, so nothing in the
// app implies a real wearable is attached to this account.
db.prepare("INSERT INTO integrations (user_id, provider, last_synced_at, rows_imported) VALUES (?, 'demo', datetime('now'), ?)")
  .run(userId, DAYS);
db.prepare("INSERT INTO reminder_prefs (user_id, timezone) VALUES (?, ?)")
  .run(userId, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

/* ---------------- channel A: steady body ---------------- */

const insertMetric = db.prepare(`INSERT INTO daily_metrics
  (user_id, date, hrv_ms, rhr_bpm, sleep_minutes, sleep_efficiency, source)
  VALUES (?, ?, ?, ?, ?, ?, 'demo')`);

for (let i = 0; i < DAYS; i++) {
  const p = pressure(i);
  // Sleep shortens a little under pressure, but nothing a recovery score
  // would call alarming. The body is deliberately the boring channel.
  insertMetric.run(
    userId, dayKey(i),
    round(gauss(68 - p * 3, 5.5), 1),
    round(gauss(52 + p * 1.5, 2.2), 1),
    round(gauss(452 - p * 28, 32)),
    round(gauss(92 - p * 1.2, 2.4), 1)
  );
}

/* ---------------- channel C: reaction time slows ---------------- */

const insertPvt = db.prepare(`INSERT INTO pvt_sessions
  (user_id, date, started_at, duration_ms, n_trials, mean_rt, median_rt,
   mean_reciprocal, sd_rt, sem_rt, lapses, false_starts, caffeine_minutes_prior, valid)
  VALUES (?, ?, ?, 180000, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);

for (let i = 0; i < DAYS; i++) {
  // Monday, Wednesday, Friday, before training.
  const dow = new Date(dayKey(i) + "T00:00:00").getDay();
  if (![1, 3, 5].includes(dow)) continue;

  const p = pressure(i);
  const n = Math.round(gauss(44, 3));
  const mean = gauss(268 + p * 34, 11);
  const sd = gauss(62 + p * 18, 7);
  const lapses = Math.max(0, Math.round(gauss(1.2 + p * 5.5, 1.1)));

  insertPvt.run(
    userId, dayKey(i), `${dayKey(i)} 07:20:00`, n,
    round(mean, 1), round(mean - gauss(8, 3), 1),
    round(1000 / mean, 3), round(sd, 1), round(sd / Math.sqrt(n), 2),
    lapses, Math.round(rnd() * 1.4),
    rnd() < 0.35 ? Math.round(gauss(50, 20)) : null
  );
}

/* ---------------- channel P: load climbs, control falls ---------------- */

const insertDaily = db.prepare(`INSERT INTO daily_checkins
  (user_id, date, load_0_10, recovery_0_10, control_0_10, focus_0_10,
   motivation_0_10, sleep_quality_0_10, valence, arousal, attribution, responded_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const clamp10 = (v) => Math.max(0, Math.min(10, Math.round(v)));

for (let i = 0; i < DAYS; i++) {
  if (rnd() < 0.12) continue; // a few missed nights, which is realistic

  const p = pressure(i);
  const key = dayKey(i);
  const dow = new Date(key + "T00:00:00").getDay();
  const matchDay = dow === 6;

  const load = clamp10(gauss(4.2 + p * 3.6 + (matchDay ? 1.2 : 0), 1.1));
  const recovery = clamp10(gauss(7 - p * 3.1, 1.2));

  // Control is the half that collapses. The schedule did not get much heavier;
  // the say over it disappeared, which is the difference that makes a season
  // feel survivable or not.
  const control = clamp10(gauss(7.2 - p * 4.4, 1.0));

  // Subjective sharpness tracks the measured slowdown but arrives later and
  // shallower, which is what opens the brain-against-life gap.
  const focus = clamp10(gauss(7.4 - p * 2.4, 1.1));

  // Motivation holds, then goes last. Devaluation is the dimension nobody
  // catches in time precisely because it lags everything else.
  const motivation = clamp10(gauss(8.1 - Math.max(0, p - 0.45) * 6.5, 0.9));

  // Rated worse than the wearable records it, which is the fourth gap and the
  // single most common complaint about devices in this category.
  const sleepQuality = clamp10(gauss(7.3 - p * 3.4, 1.2));

  // Valence drops as pressure builds; arousal stays high because the weeks
  // are busy rather than empty. That is the tense quadrant, not the flat one.
  const valence = Math.max(-1, Math.min(1, gauss(0.45 - p * 1.0, 0.22)));
  const arousal = Math.max(-1, Math.min(1, gauss(0.1 + p * 0.4, 0.25)));

  const tags = [];
  if (matchDay || rnd() < 0.5) tags.push("Training");
  if (p > 0.25 || rnd() < 0.3) tags.push("School");
  if (rnd() < 0.22) tags.push("Personal");
  if (rnd() < 0.15) tags.push("Social");
  if (p > 0.4 && rnd() < 0.25) tags.push("Money");
  if (!tags.length) tags.push("Nothing Specific");

  insertDaily.run(
    userId, key, load, recovery, control, focus, motivation, sleepQuality,
    round(valence, 2), round(arousal, 2),
    tags.join(","), `${key} 21:${String(Math.round(rnd() * 50)).padStart(2, "0")}:00`
  );
}

const insertWeekly = db.prepare(`INSERT INTO weekly_checkins
  (user_id, week_start, demand_training, control_training, feeling_training,
   demand_academic, control_academic, feeling_academic,
   demand_personal, control_personal, feeling_personal,
   sleep_satisfaction, social_connection, emotions,
   abq_exhaustion, abq_accomplishment, abq_devaluation, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const clamp7 = (v) => Math.max(1, Math.min(7, Math.round(v)));
const clamp5 = (v) => Math.max(1, Math.min(5, Math.round(v)));

const EMO = {
  calm: ["Motivated", "Confident", "Settled", "Content"],
  strained: ["Overwhelmed", "Anxious", "Tense", "Drained", "Frustrated"],
};

for (let w = 0; w < WEEKS; w++) {
  const i = w * 7;
  const p = pressure(i + 3);
  const wk = mondayOf(dayKey(i));

  const emotions = (p > 0.35 ? EMO.strained : EMO.calm).filter(() => rnd() < 0.65);
  if (!emotions.length) emotions.push(p > 0.35 ? "Tense" : "Content");

  insertWeekly.run(
    userId, wk,
    clamp7(gauss(5 + p * 0.8, 0.5)), clamp7(gauss(5.4, 0.5)), clamp7(gauss(6 - p * 0.8, 0.5)),
    // Coursework is where it bites: demand climbs while say over it collapses.
    clamp7(gauss(3 + p * 3.4, 0.5)), clamp7(gauss(5 - p * 3, 0.5)), clamp7(gauss(5 - p * 2.6, 0.5)),
    clamp7(gauss(3 + p * 1.2, 0.6)), clamp7(gauss(5 - p * 1, 0.5)), clamp7(gauss(5 - p * 1.4, 0.6)),
    clamp7(gauss(5 - p * 2, 0.6)), clamp7(gauss(5 - p * 1.8, 0.6)),
    emotions.join(","),
    // Exhaustion rises first, accomplishment erodes with it, and devaluation
    // only starts moving late. That order is the whole argument for asking
    // these three apart instead of summing them into one burnout number.
    clamp5(gauss(1.6 + p * 2.6, 0.4)),
    clamp5(gauss(4.4 - p * 2.2, 0.4)),
    clamp5(gauss(1.3 + Math.max(0, p - 0.5) * 4.4, 0.35)),
    `${dayKey(i + 6)} 20:00:00`
  );
}

/* ---------------- caffeine ---------------- */

const insertCaffeine = db.prepare(
  "INSERT INTO caffeine_logs (user_id, date, label, mg, logged_at) VALUES (?, ?, ?, ?, ?)"
);
const DRINKS = [["Celsius", 200], ["Coffee", 95], ["Cold Brew", 205], ["Red Bull", 80], ["Espresso", 64]];

for (let i = 0; i < DAYS; i++) {
  const p = pressure(i);
  const count = rnd() < 0.35 + p * 0.4 ? 2 : 1;
  for (let k = 0; k < count; k++) {
    const [label, mg] = DRINKS[Math.floor(rnd() * DRINKS.length)];
    // The second one drifts later in the day as the term gets heavier.
    const hour = k === 0 ? 7 + Math.floor(rnd() * 2) : 13 + Math.floor(rnd() * (2 + p * 4));
    insertCaffeine.run(userId, dayKey(i), label, mg,
      `${String(hour).padStart(2, "0")}:${String(Math.round(rnd() * 55)).padStart(2, "0")}`);
  }
}

/* ---------------- journal and context ---------------- */

/* Entries carry the rating the athlete typed, on the same square the daily
   check-in uses. That rating is the only part that reaches the psychological
   channel; the text sits here and is never read by anything. */
const insertJournal = db.prepare(
  `INSERT INTO journal_entries (user_id, entry_date, content, valence, arousal, domains)
   VALUES (?, ?, ?, ?, ?, ?)`
);

const NOTES = [
  [6, "Good week. Legs felt heavy Thursday but the session on Saturday was the best one this month.", 0.55, 0.2, "Training"],
  [17, "Slept badly before the away trip and still felt fine. Body seems to be handling the volume.", 0.3, -0.1, "Training,Health"],
  [30, "Two midterms landed in the same week as a double session. Not sure how I am going to fit the reading in.", -0.45, 0.62, "School,Training"],
  [37, "Reaction test felt slow this morning even though I slept seven and a half hours. Odd.", -0.25, 0.15, "Health"],
  [44, "Coach said I looked a step off in the small-sided games. I felt fine physically, so that surprised me.", -0.5, 0.35, "Training,Competition"],
  [48, "Skipped the film session to finish a problem set. First time I have chosen school over the team.", -0.6, 0.3, "School,Training"],
  [51, "Library until one again. Recovery score still green, which does not match how my head feels at all.", -0.72, 0.48, "School"],
  [54, "Did not want to go in today. Went anyway, but that is new and I do not love it.", -0.68, -0.3, "Training,Personal"],
];
NOTES.forEach(([i, text, valence, arousal, domains]) =>
  insertJournal.run(userId, dayKey(i), text, valence, arousal, domains)
);

db.prepare("INSERT INTO phases (user_id, label, start_date, end_date) VALUES (?, ?, ?, ?)")
  .run(userId, "Midterms", dayKey(29), dayKey(40));
db.prepare("INSERT INTO phases (user_id, label, start_date, end_date) VALUES (?, ?, ?, ?)")
  .run(userId, "Conference Play", dayKey(42), dayKey(DAYS - 1));

db.prepare("INSERT INTO share_links (user_id, token, label) VALUES (?, ?, ?)")
  .run(userId, "demoshare0001coach", "Coach Rivera");

/* ---------------- report ---------------- */

const { compute } = require("../server/divergence");
const analytics = require("../server/analytics");

const snap = {
  metrics: db.prepare("SELECT * FROM daily_metrics WHERE user_id = ? ORDER BY date").all(userId),
  sessions: db.prepare("SELECT * FROM pvt_sessions WHERE user_id = ? ORDER BY date").all(userId),
  daily: db.prepare("SELECT * FROM daily_checkins WHERE user_id = ? ORDER BY date").all(userId),
  weekly: db.prepare("SELECT * FROM weekly_checkins WHERE user_id = ? ORDER BY week_start").all(userId),
  journal: db.prepare("SELECT * FROM journal_entries WHERE user_id = ? ORDER BY entry_date").all(userId),
  caffeine: db.prepare("SELECT * FROM caffeine_logs WHERE user_id = ? ORDER BY date").all(userId),
  phases: db.prepare("SELECT * FROM phases WHERE user_id = ? ORDER BY start_date").all(userId),
};

console.log(`Seeded ${NAME} <${EMAIL}> over ${WEEKS} weeks.`);
console.log(`  ${snap.metrics.length} days of wearable data`);
console.log(`  ${snap.sessions.length} vigilance sessions`);
console.log(`  ${snap.daily.length} daily check-ins`);
console.log(`  ${snap.weekly.length} weekly reflections`);
console.log(`  ${snap.journal.length} journal entries, ${snap.journal.filter((j) => j.valence != null).length} rated`);
console.log("");

["light", "medium", "heavy"].forEach((s) => {
  const d = compute({ ...snap, sensitivity: s });
  const f = (z) => (z == null ? "  null" : ((z > 0 ? "+" : "") + z.toFixed(2)).padStart(6));
  console.log(
    `  ${s.padEnd(7)} body${f(d.channels.autonomic.z)}  brain${f(d.channels.cognitive.z)}  life${f(d.channels.psychological.z)}` +
    `  ->  ${d.state ? d.state.name : "calibrating"} (${d.readings.length} reading${d.readings.length === 1 ? "" : "s"})`
  );
});

const a = analytics.compute(snap);
const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");
console.log("");
console.log("  trends");
console.log(`    heaviest day        ${a.dayOfWeek.heaviest ? a.dayOfWeek.heaviest.day : "—"}`);
console.log(`    strain days         ${a.controlMap.strainDays} of ${a.controlMap.n}`);
console.log(`    load ratio points   ${a.loadRatio.series.length}`);
console.log(`    caffeine test       n=${a.caffeineSleep.n} rho=${a.caffeineSleep.rho == null ? "—" : a.caffeineSleep.rho.toFixed(2)} p=${a.caffeineSleep.p == null ? "—" : a.caffeineSleep.p.toFixed(3)}`);
console.log(`    sleep perception    ${a.sleepPerception.worseThanMeasured} felt worse, ${a.sleepPerception.betterThanMeasured} felt better, ${a.sleepPerception.agreed} agreed`);
console.log(`    burnout weeks       ${a.burnout.length}`);
console.log(`    top heavy-day tag   ${a.attribution.tags.length ? `${a.attribution.tags[0].tag} (${pct(a.attribution.tags[0].heavy)} heavy vs ${pct(a.attribution.tags[0].light)} light)` : "—"}`);
