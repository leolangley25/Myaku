/* Myaku — HTTP server.
 *
 * Routes are grouped by what they touch: accounts, the three channels, wearable
 * integrations, reminders, and the account's own data. Every write is validated,
 * every state-changing request must come from this origin, and nothing outside
 * an explicit list of public files is ever served.
 */

const path = require("path");
try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  /* running without a .env file is normal */
}

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const { promisify } = require("util");

const db = require("./db");
const { dataDir } = require("./paths");
const { compute, weekStart, SENSITIVITY, PLAIN_STATES, MIN_BASELINE_WEEKS } = require("./divergence");
const analytics = require("./analytics");
const { fetchICS, parseICS } = require("./ics");
const { sendError, asyncHandler } = require("./errors");
const v = require("./validate");
const { SqliteSessionStore } = require("./session-store");
const security = require("./security");
const reminders = require("./reminders");
const { parseAppleHealth } = require("./integrations/apple-health");
const { plausible, cleanStamps } = require("./integrations/oauth");

const PROVIDERS = {
  whoop: require("./integrations/whoop"),
  google: require("./integrations/google-health"),
};

const schedule = require("./schedule");
const assistant = require("./assistant");
const journalModel = require("./journal");
const reader = require("./reader");

/* Myaku was built around college athletes, and they still get the most from it.
   A high school runner, a club swimmer and someone training on their own have the
   same three channels with a different calendar around them, so the audience
   decides wording and which parts of setup are asked, never the model. */
const AUDIENCES = ["college", "highschool", "club", "recreational", "masters"];
const SEASON_PHASES = ["preseason", "inseason", "postseason", "offseason"];
const EVENT_KINDS = ["game", "practice", "lift", "travel", "exam", "deadline", "class", "other"];

const scrypt = promisify(crypto.scrypt);
const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLIC_ROOT = path.join(__dirname, "..");

/* ---------------- secrets and shared services ---------------- */

const secret = security.loadSecret(dataDir);
const sealer = security.tokenSealer(secret);
const store = new SqliteSessionStore(db);
const vapid = reminders.loadVapid(dataDir);
const push = reminders.createPusher(vapid, process.env.VAPID_SUBJECT || "mailto:support@myaku.app");

/* ---------------- app ---------------- */

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);

app.use(security.securityHeaders);
app.use(security.sameOrigin);
app.use(
  "/api/",
  security.rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    key: security.clientIp,
    message: "Too many requests, so slow down and try again shortly",
  })
);
app.use(express.json({ limit: "512kb" }));
app.use(
  session({
    store,
    secret,
    name: "myaku.sid",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // Secure whenever the request itself arrived over HTTPS.
      secure: "auto",
      maxAge: 30 * DAY_MS,
    },
  })
);

/* ---------------- helpers ---------------- */

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(pw, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

async function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const check = await scrypt(pw, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === check.length && crypto.timingSafeEqual(expected, check);
}

/* Checked against when the email is unknown, so a failed login takes the same
   time whether or not the account exists and cannot be used to discover which
   emails are registered. */
let DUMMY_HASH = null;
hashPassword(crypto.randomBytes(16).toString("hex")).then((h) => (DUMMY_HASH = h));

function requireAuth(req, res, next) {
  if (!req.session.userId) return sendError(res, 401, "Not signed in");
  if (!q.userById.get(req.session.userId)) {
    return req.session.destroy(() => sendError(res, 401, "Not signed in"));
  }
  next();
}

/* The athlete's own calendar date. The server's clock is the wrong one: at nine
   in the evening in Los Angeles it is already tomorrow in UTC, and a check-in
   filed under tomorrow is a missing day today. The client sends its local date,
   which is accepted when it is within a day and a half of the server's. */
function localDate(req) {
  const header = req.get("x-local-date");
  if (v.isDate(header) && Math.abs(Date.parse(header + "T12:00:00Z") - Date.now()) < 40 * 60 * 60 * 1000) {
    return header;
  }
  return new Date().toISOString().slice(0, 10);
}

function localMinutes(req) {
  const t = v.time(req.get("x-local-time"), null);
  if (!t) {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const shiftDate = (dateStr, days) => {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/* Entries may be backfilled for a missed day, but not invented for the future
   and not rewritten months later, which would silently shift a baseline that
   has already been reported on. */
function recentDate(value, req, { pastDays = 14 } = {}) {
  const today = localDate(req);
  const d = v.date(value, today);
  if (d > shiftDate(today, 1) || d < shiftDate(today, -pastDays)) return null;
  return d;
}

const originOf = (req) => process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get("host")}`;

/* ---------------- statements ---------------- */

const q = {
  insertUser: db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"),
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  userById: db.prepare("SELECT id, name, email, created_at, sensitivity, onboarded_at, assistant_opt_in FROM users WHERE id = ?"),
  passwordHash: db.prepare("SELECT password_hash FROM users WHERE id = ?"),
  setSensitivity: db.prepare("UPDATE users SET sensitivity = ? WHERE id = ?"),
  setOnboarded: db.prepare("UPDATE users SET onboarded_at = datetime('now') WHERE id = ? AND onboarded_at IS NULL"),

  upsertCalibration: db.prepare(`
    INSERT INTO calibration (user_id, sport, training_days, typical_bedtime,
      baseline_training, baseline_academic, baseline_personal, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET sport=excluded.sport, training_days=excluded.training_days,
      typical_bedtime=excluded.typical_bedtime, baseline_training=excluded.baseline_training,
      baseline_academic=excluded.baseline_academic, baseline_personal=excluded.baseline_personal,
      updated_at=datetime('now')`),
  calibration: db.prepare("SELECT * FROM calibration WHERE user_id = ?"),
  setBedtime: db.prepare(`
    INSERT INTO calibration (user_id, typical_bedtime, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET typical_bedtime=excluded.typical_bedtime, updated_at=datetime('now')`),
  setSleepGoal: db.prepare(`
    INSERT INTO calibration (user_id, sleep_goal_minutes, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET sleep_goal_minutes=excluded.sleep_goal_minutes, updated_at=datetime('now')`),

  upsertDaily: db.prepare(`
    INSERT INTO daily_checkins (user_id, date, load_0_10, recovery_0_10, control_0_10,
      focus_0_10, motivation_0_10, sleep_quality_0_10, valence, arousal, attribution, responded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, date) DO UPDATE SET load_0_10=excluded.load_0_10,
      recovery_0_10=excluded.recovery_0_10, control_0_10=excluded.control_0_10,
      focus_0_10=excluded.focus_0_10, motivation_0_10=excluded.motivation_0_10,
      sleep_quality_0_10=excluded.sleep_quality_0_10,
      valence=excluded.valence, arousal=excluded.arousal,
      attribution=excluded.attribution, responded_at=datetime('now')`),
  dailyOn: db.prepare("SELECT * FROM daily_checkins WHERE user_id = ? AND date = ?"),
  allDaily: db.prepare("SELECT * FROM daily_checkins WHERE user_id = ? ORDER BY date"),

  upsertWeekly: db.prepare(`
    INSERT INTO weekly_checkins (user_id, week_start,
      demand_training, control_training, feeling_training,
      demand_academic, control_academic, feeling_academic,
      demand_personal, control_personal, feeling_personal,
      sleep_satisfaction, social_connection, emotions,
      abq_exhaustion, abq_accomplishment, abq_devaluation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, week_start) DO UPDATE SET
      demand_training=excluded.demand_training, control_training=excluded.control_training, feeling_training=excluded.feeling_training,
      demand_academic=excluded.demand_academic, control_academic=excluded.control_academic, feeling_academic=excluded.feeling_academic,
      demand_personal=excluded.demand_personal, control_personal=excluded.control_personal, feeling_personal=excluded.feeling_personal,
      sleep_satisfaction=excluded.sleep_satisfaction, social_connection=excluded.social_connection, emotions=excluded.emotions,
      abq_exhaustion=excluded.abq_exhaustion, abq_accomplishment=excluded.abq_accomplishment,
      abq_devaluation=excluded.abq_devaluation`),
  weeklyOn: db.prepare("SELECT * FROM weekly_checkins WHERE user_id = ? AND week_start = ?"),
  allWeekly: db.prepare("SELECT * FROM weekly_checkins WHERE user_id = ? ORDER BY week_start"),

  insertPvt: db.prepare(`
    INSERT INTO pvt_sessions (user_id, date, started_at, duration_ms, n_trials, mean_rt,
      median_rt, mean_reciprocal, sd_rt, sem_rt, lapses, false_starts, caffeine_minutes_prior, device, local_time, valid)
    VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`),
  allPvt: db.prepare("SELECT * FROM pvt_sessions WHERE user_id = ? ORDER BY date"),
  recentPvt: db.prepare("SELECT * FROM pvt_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 20"),
  pvtOn: db.prepare("SELECT COUNT(*) AS n FROM pvt_sessions WHERE user_id = ? AND date = ?"),
  pvtBetween: db.prepare("SELECT COUNT(*) AS n FROM pvt_sessions WHERE user_id = ? AND date BETWEEN ? AND ?"),
  dailyBetween: db.prepare("SELECT COUNT(*) AS n FROM daily_checkins WHERE user_id = ? AND date BETWEEN ? AND ?"),

  allMetrics: db.prepare("SELECT * FROM daily_metrics WHERE user_id = ? ORDER BY date"),
  /* Merging rather than replacing, so a sync that is missing one field for a day
     does not erase the value another source already supplied. */
  mergeMetric: db.prepare(`
    INSERT INTO daily_metrics (user_id, date, hrv_ms, rhr_bpm, sleep_minutes, sleep_efficiency, sleep_start, sleep_end, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      hrv_ms = COALESCE(excluded.hrv_ms, daily_metrics.hrv_ms),
      rhr_bpm = COALESCE(excluded.rhr_bpm, daily_metrics.rhr_bpm),
      sleep_minutes = COALESCE(excluded.sleep_minutes, daily_metrics.sleep_minutes),
      sleep_efficiency = COALESCE(excluded.sleep_efficiency, daily_metrics.sleep_efficiency),
      sleep_start = COALESCE(excluded.sleep_start, daily_metrics.sleep_start),
      sleep_end = COALESCE(excluded.sleep_end, daily_metrics.sleep_end),
      source = excluded.source`),
  deleteMetricsBySource: db.prepare("DELETE FROM daily_metrics WHERE user_id = ? AND source = ?"),

  upsertJournal: db.prepare(`
    INSERT INTO journal_entries (user_id, entry_date, content, valence, arousal, domains, mode, word_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, entry_date) DO UPDATE SET
      read_json = CASE WHEN journal_entries.content = excluded.content THEN journal_entries.read_json ELSE NULL END,
      read_edited = CASE WHEN journal_entries.content = excluded.content THEN journal_entries.read_edited ELSE NULL END,
      content=excluded.content,
      valence=excluded.valence, arousal=excluded.arousal, domains=excluded.domains,
      mode=excluded.mode, word_count=excluded.word_count,
      updated_at=datetime('now')`),
  setJournalInLife: db.prepare(`
    INSERT INTO calibration (user_id, journal_in_life, journal_read, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET journal_in_life=excluded.journal_in_life,
      journal_read=excluded.journal_read, updated_at=datetime('now')`),
  saveReading: db.prepare(`UPDATE journal_entries SET read_json = ?, read_model = ?, read_at = datetime('now'), read_edited = ?
    WHERE user_id = ? AND entry_date = ?`),
  excludeReading: db.prepare("UPDATE journal_entries SET read_excluded = ? WHERE user_id = ? AND entry_date = ?"),
  unreadEntries: db.prepare(`SELECT entry_date, content FROM journal_entries
    WHERE user_id = ? AND read_json IS NULL AND COALESCE(word_count, 0) >= ? AND entry_date >= ?
    ORDER BY entry_date DESC LIMIT ?`),
  unreadCount: db.prepare(`SELECT COUNT(*) AS n FROM journal_entries
    WHERE user_id = ? AND read_json IS NULL AND COALESCE(word_count, 0) >= ? AND entry_date >= ?`),
  journalOn: db.prepare("SELECT * FROM journal_entries WHERE user_id = ? AND entry_date = ?"),
  journalAll: db.prepare("SELECT * FROM journal_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT 60"),
  journalEvery: db.prepare("SELECT * FROM journal_entries WHERE user_id = ? ORDER BY entry_date"),

  caffeineAll: db.prepare("SELECT * FROM caffeine_logs WHERE user_id = ? ORDER BY date"),
  insertCaffeine: db.prepare("INSERT INTO caffeine_logs (user_id, date, label, mg, logged_at) VALUES (?, ?, ?, ?, ?)"),
  caffeineOn: db.prepare("SELECT * FROM caffeine_logs WHERE user_id = ? AND date = ? ORDER BY logged_at DESC"),
  deleteCaffeine: db.prepare("DELETE FROM caffeine_logs WHERE id = ? AND user_id = ?"),

  /* Who the app is being used by, and the clock either side of a night. Saved on
     its own so the setup portal can write it without clearing the usual levels. */
  setProfile: db.prepare(`
    INSERT INTO calibration (user_id, audience, sport, training_days, season_phase, wake_time, setup_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 2, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      audience=excluded.audience, sport=excluded.sport, training_days=excluded.training_days,
      season_phase=excluded.season_phase, wake_time=excluded.wake_time, setup_version=2,
      updated_at=datetime('now')`),
  setAssistant: db.prepare("UPDATE users SET assistant_opt_in = ? WHERE id = ?"),

  /* The calendar. A row per entry, replaced rather than doubled when a feed is
     imported again, which is what the unique index on the UID is for. */
  insertEvent: db.prepare(`
    INSERT INTO events (user_id, date, end_date, start_time, kind, title, source, uid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, uid) WHERE uid IS NOT NULL DO UPDATE SET
      date=excluded.date, end_date=excluded.end_date, start_time=excluded.start_time,
      kind=excluded.kind, title=excluded.title`),
  eventsBetween: db.prepare("SELECT * FROM events WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date, start_time"),
  allEvents: db.prepare("SELECT * FROM events WHERE user_id = ? ORDER BY date"),
  deleteEvent: db.prepare("DELETE FROM events WHERE id = ? AND user_id = ?"),
  deleteEventsBySource: db.prepare("DELETE FROM events WHERE user_id = ? AND source = ?"),

  insertPhase: db.prepare("INSERT INTO phases (user_id, label, start_date, end_date) VALUES (?, ?, ?, ?)"),
  allPhases: db.prepare("SELECT * FROM phases WHERE user_id = ? ORDER BY start_date DESC"),
  deletePhase: db.prepare("DELETE FROM phases WHERE id = ? AND user_id = ?"),

  integrations: db.prepare("SELECT provider, connected_at, last_synced_at, last_error, rows_imported FROM integrations WHERE user_id = ?"),
  integrationOne: db.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider = ?"),
  upsertIntegration: db.prepare(`
    INSERT INTO integrations (user_id, provider) VALUES (?, ?)
    ON CONFLICT(user_id, provider) DO NOTHING`),
  setSynced: db.prepare(`UPDATE integrations SET last_synced_at = datetime('now'), last_error = NULL,
    rows_imported = ? WHERE user_id = ? AND provider = ?`),
  setSyncError: db.prepare("UPDATE integrations SET last_error = ? WHERE user_id = ? AND provider = ?"),
  deleteIntegration: db.prepare("DELETE FROM integrations WHERE user_id = ? AND provider = ?"),

  tokenFor: db.prepare("SELECT * FROM oauth_tokens WHERE user_id = ? AND provider = ?"),
  allTokens: db.prepare("SELECT user_id, provider FROM oauth_tokens"),
  saveToken: db.prepare(`
    INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scope, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, provider) DO UPDATE SET access_token=excluded.access_token,
      refresh_token=COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
      expires_at=excluded.expires_at, scope=excluded.scope, updated_at=datetime('now')`),
  deleteToken: db.prepare("DELETE FROM oauth_tokens WHERE user_id = ? AND provider = ?"),

  insertShare: db.prepare("INSERT INTO share_links (user_id, token, label) VALUES (?, ?, ?)"),
  listShare: db.prepare("SELECT * FROM share_links WHERE user_id = ? ORDER BY created_at DESC"),
  activeShares: db.prepare("SELECT COUNT(*) AS n FROM share_links WHERE user_id = ? AND revoked = 0"),
  revokeShare: db.prepare("UPDATE share_links SET revoked = 1 WHERE id = ? AND user_id = ?"),
  shareByToken: db.prepare("SELECT * FROM share_links WHERE token = ? AND revoked = 0"),
  touchShare: db.prepare("UPDATE share_links SET last_viewed_at = datetime('now') WHERE id = ?"),

  prefs: db.prepare("SELECT * FROM reminder_prefs WHERE user_id = ?"),
  ensurePrefs: db.prepare("INSERT OR IGNORE INTO reminder_prefs (user_id, timezone) VALUES (?, ?)"),
  savePrefs: db.prepare(`
    INSERT INTO reminder_prefs (user_id, enabled, timezone, pvt_time, pvt_days, checkin_time, weekly_day, weekly_time, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled, timezone=excluded.timezone,
      pvt_time=excluded.pvt_time, pvt_days=excluded.pvt_days, checkin_time=excluded.checkin_time,
      weekly_day=excluded.weekly_day, weekly_time=excluded.weekly_time, updated_at=datetime('now')`),
  enabledPrefs: db.prepare("SELECT * FROM reminder_prefs WHERE enabled = 1"),
  subsFor: db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ?"),
  saveSub: db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth`),
  deleteSub: db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?"),
  deleteSubById: db.prepare("DELETE FROM push_subscriptions WHERE id = ?"),
  wasSent: db.prepare("SELECT 1 FROM reminder_log WHERE user_id = ? AND kind = ? AND local_date = ?"),
  markSent: db.prepare("INSERT OR IGNORE INTO reminder_log (user_id, kind, local_date) VALUES (?, ?, ?)"),

  count: (table, dateColumn = null) =>
    db.prepare(`SELECT COUNT(*) AS n${dateColumn ? `, MIN(${dateColumn}) AS first` : ""} FROM ${table} WHERE user_id = ?`),
};

/* Entries saved before word counts were stored, or imported without one, are
   counted once here, so the reader can tell a sentence from a page. */
{
  const uncounted = db.prepare("SELECT rowid AS rid, content FROM journal_entries WHERE word_count IS NULL").all();
  const setCount = db.prepare("UPDATE journal_entries SET word_count = ? WHERE rowid = ?");
  uncounted.forEach((e) => setCount.run(journalModel.wordCount(e.content), e.rid));
}

const counters = {
  metrics: q.count("daily_metrics", "date"),
  daily: q.count("daily_checkins", "date"),
  pvt: q.count("pvt_sessions", "date"),
  weekly: q.count("weekly_checkins", "week_start"),
  journal: q.count("journal_entries", "entry_date"),
};

/* How far the journal reaches into the Life channel. "off" keeps it out
   entirely, "rating" lets the grid under each entry count, and "words" also lets
   a model on this machine read the entry. Null until the athlete has answered. */
function journalLevel(cal) {
  if (!cal || cal.journal_in_life == null) return null;
  if (cal.journal_in_life !== 1) return "off";
  return cal.journal_read === 1 ? "words" : "rating";
}

/* Journal entries as the channel is allowed to see them. The text itself is
   never handed on, only the rating, and the reading when the athlete allowed one
   and has not left that entry out. */
function journalForChannel(uid) {
  const level = journalLevel(q.calibration.get(uid));
  if (level !== "rating" && level !== "words") return [];
  return q.journalEvery.all(uid).map((e) => ({
    entry_date: e.entry_date,
    valence: e.valence,
    arousal: e.arousal,
    domains: e.domains,
    mode: e.mode,
    word_count: e.word_count,
    reading: level === "words" && !e.read_excluded ? reader.parse(e.read_json) : null,
  }));
}

function snapshot(uid) {
  const user = q.userById.get(uid);
  return {
    metrics: q.allMetrics.all(uid),
    sessions: q.allPvt.all(uid),
    daily: q.allDaily.all(uid),
    weekly: q.allWeekly.all(uid),
    journal: journalForChannel(uid),
    sensitivity: user ? user.sensitivity : undefined,
  };
}

function upsertMetricRows(uid, rows, source) {
  let stored = 0;
  db.exec("BEGIN");
  try {
    rows.forEach((r) => {
      if (!r || !v.isDate(r.date) || !plausible(r)) return;
      const { sleepStart, sleepEnd } = cleanStamps(r);
      q.mergeMetric.run(uid, r.date, r.hrv ?? null, r.rhr ?? null, r.sleepMinutes ?? null, r.sleepEfficiency ?? null, sleepStart, sleepEnd, source);
      stored++;
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return stored;
}

/* ---------------- accounts ---------------- */

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/;

const signupLimit = security.rateLimit({
  // Configurable so an automated test suite, which creates many accounts from
  // one address by design, is not mistaken for an abuser.
  windowMs: 60 * 60 * 1000, max: Number(process.env.SIGNUP_RATE_LIMIT) || 10, key: security.clientIp,
  message: "Too many accounts created from here, so try again later",
});
const loginLimit = security.rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  key: (req) => `${security.clientIp(req)}|${String((req.body && req.body.email) || "").toLowerCase()}`,
  message: "Too many sign-in attempts, so wait fifteen minutes and try again",
});

/* A fresh session identifier on every sign-in, so an identifier planted before
   authentication cannot be carried across it. */
function signIn(req, res, userId, body) {
  req.session.regenerate((err) => {
    if (err) return sendError(res, 500, "Could not start a session");
    req.session.userId = userId;
    req.session.save(() => res.json(body));
  });
}

app.post("/api/signup", signupLimit, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = v.text(b.name, 80);
  const email = String(b.email || "").toLowerCase().trim();
  if (!name || !email || !b.password) return sendError(res, 400, "Name, email, and password are all required");
  if (!EMAIL_RE.test(email)) return sendError(res, 400, "That email address does not look right");
  const problem = security.passwordProblem(b.password);
  if (problem) return sendError(res, 400, problem);
  if (q.userByEmail.get(email)) return sendError(res, 409, "An account with that email already exists");

  const r = q.insertUser.run(name, email, await hashPassword(String(b.password)));
  const uid = Number(r.lastInsertRowid);
  q.ensurePrefs.run(uid, v.timezone(req.get("x-timezone")));
  signIn(req, res, uid, { ok: true, next: "welcome.html" });
}));

app.post("/api/login", loginLimit, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const user = b.email ? q.userByEmail.get(String(b.email).toLowerCase().trim()) : null;
  const ok = await verifyPassword(String(b.password || ""), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return sendError(res, 401, "Your email or password was incorrect");
  signIn(req, res, user.id, { ok: true, next: user.onboarded_at ? "index.html" : "welcome.html" });
}));

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/me", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const user = q.userById.get(uid);
  const prefs = q.prefs.get(uid);
  res.json({
    user: { ...user, onboarded: !!user.onboarded_at },
    calibration: q.calibration.get(uid) || null,
    integrations: q.integrations.all(uid),
    reminders: { enabled: !!(prefs && prefs.enabled), subscribed: q.subsFor.all(uid).length > 0 },
  });
});

app.post("/api/onboarding/complete", requireAuth, (req, res) => {
  q.setOnboarded.run(req.session.userId);
  res.json({ ok: true });
});

app.post("/api/settings/sensitivity", requireAuth, (req, res) => {
  const level = String((req.body || {}).sensitivity || "");
  if (!SENSITIVITY[level]) return sendError(res, 400, "That sensitivity level is not recognised");
  q.setSensitivity.run(level, req.session.userId);
  res.json({ ok: true, sensitivity: level, thresholds: SENSITIVITY[level] });
});

app.post("/api/calibration", requireAuth, (req, res) => {
  const b = req.body || {};
  q.upsertCalibration.run(
    req.session.userId,
    v.text(b.sport, 60),
    v.intIn(b.trainingDays, 0, 7),
    v.time(b.typicalBedtime, null),
    v.intIn(b.baselineTraining, 1, 7),
    v.intIn(b.baselineAcademic, 1, 7),
    v.intIn(b.baselinePersonal, 1, 7)
  );
  res.json({ ok: true });
});

/* The setup portal writes everything it can in one call, so an athlete who
   finishes it has a starting point instead of an empty app. */
app.post("/api/setup", requireAuth, (req, res) => {
  const b = req.body || {};
  const uid = req.session.userId;
  const audience = AUDIENCES.includes(String(b.audience)) ? String(b.audience) : null;
  const phase = SEASON_PHASES.includes(String(b.seasonPhase)) ? String(b.seasonPhase) : null;

  q.setProfile.run(uid, audience, v.text(b.sport, 60), v.intIn(b.trainingDays, 0, 14), phase, v.time(b.wakeTime, null));

  if (v.time(b.typicalBedtime, null)) q.setBedtime.run(uid, v.time(b.typicalBedtime, null));
  if (v.intIn(b.sleepGoalMinutes, 360, 660) != null) q.setSleepGoal.run(uid, v.intIn(b.sleepGoalMinutes, 360, 660));

  const levels = [b.baselineTraining, b.baselineAcademic, b.baselinePersonal].map((n) => v.intIn(n, 1, 7));
  if (levels.some((n) => n != null)) {
    const existing = q.calibration.get(uid) || {};
    q.upsertCalibration.run(
      uid,
      v.text(b.sport, 60) || existing.sport || null,
      v.intIn(b.trainingDays, 0, 14) ?? existing.training_days ?? null,
      v.time(b.typicalBedtime, null) || existing.typical_bedtime || null,
      levels[0] ?? existing.baseline_training ?? null,
      levels[1] ?? existing.baseline_academic ?? null,
      levels[2] ?? existing.baseline_personal ?? null
    );
    /* The upsert above does not carry the newer columns, so they are written again. */
    q.setProfile.run(uid, audience, v.text(b.sport, 60), v.intIn(b.trainingDays, 0, 14), phase, v.time(b.wakeTime, null));
  }

  res.json({ ok: true, calibration: q.calibration.get(uid) || null });
});

/* Bedtime alone, from the caffeine page, without touching the rest of the
   calibration the way the full form would. */
app.post("/api/calibration/bedtime", requireAuth, (req, res) => {
  const bedtime = v.time((req.body || {}).bedtime, null);
  if (!bedtime) return sendError(res, 400, "A bedtime like 23:00 is required");
  q.setBedtime.run(req.session.userId, bedtime);
  res.json({ ok: true, bedtime });
});

app.post("/api/calibration/sleep-goal", requireAuth, (req, res) => {
  const minutes = v.intIn((req.body || {}).minutes, 360, 660);
  if (minutes == null) return sendError(res, 400, "A sleep goal in minutes is required");
  q.setSleepGoal.run(req.session.userId, minutes);
  res.json({ ok: true, minutes });
});

/* ---------------- channel P ---------------- */

app.get("/api/checkin/daily", requireAuth, (req, res) => {
  const date = recentDate(req.query.date, req, { pastDays: 400 }) || localDate(req);
  res.json({ date, entry: q.dailyOn.get(req.session.userId, date) || null });
});

app.post("/api/checkin/daily", requireAuth, (req, res) => {
  const b = req.body || {};
  const date = recentDate(b.date, req);
  if (!date) return sendError(res, 400, "Check-ins can only be logged for the last two weeks");
  const scale = (x) => v.intIn(x, 0, 10);
  q.upsertDaily.run(
    req.session.userId, date,
    scale(b.load), scale(b.recovery), scale(b.control), scale(b.focus),
    scale(b.motivation), scale(b.sleepQuality),
    v.numIn(b.valence, -1, 1), v.numIn(b.arousal, -1, 1),
    v.tags(b.attribution)
  );
  res.json({ ok: true, date });
});

app.get("/api/checkin/weekly", requireAuth, (req, res) => {
  const wk = weekStart(v.date(req.query.week, localDate(req)));
  res.json({ weekStart: wk, entry: q.weeklyOn.get(req.session.userId, wk) || null });
});

app.post("/api/checkin/weekly", requireAuth, (req, res) => {
  const b = req.body || {};
  const wk = weekStart(v.date(b.weekStart, localDate(req)));
  const seven = (x) => v.intIn(x, 1, 7);
  const five = (x) => v.intIn(x, 1, 5);
  q.upsertWeekly.run(
    req.session.userId, wk,
    seven(b.demandTraining), seven(b.controlTraining), seven(b.feelingTraining),
    seven(b.demandAcademic), seven(b.controlAcademic), seven(b.feelingAcademic),
    seven(b.demandPersonal), seven(b.controlPersonal), seven(b.feelingPersonal),
    seven(b.sleepSatisfaction), seven(b.socialConnection),
    v.tags(b.emotions),
    five(b.abqExhaustion), five(b.abqAccomplishment), five(b.abqDevaluation)
  );
  res.json({ ok: true, weekStart: wk });
});

/* ---------------- channel C ---------------- */

app.get("/api/pvt", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const today = localDate(req);
  const sessions = q.recentPvt.all(uid);
  /* Counted over the last seven days, the same window the model reads. A calendar
     week said "0 of 3" every Monday while the Brain page said "3 of 3". */
  res.json({
    sessions,
    todayCount: q.pvtOn.get(uid, today).n,
    thisWeek: q.pvtBetween.get(uid, shiftDate(today, -6), today).n,
    target: 3,
  });
});

app.post("/api/pvt", requireAuth, (req, res) => {
  const b = req.body || {};
  const nTrials = v.intIn(b.nTrials, 0, 1000);
  if (!nTrials || nTrials < 5) return sendError(res, 400, "That session had too few trials to record");
  const meanRt = v.numIn(b.meanRt, 100, 5000);
  if (meanRt == null) return sendError(res, 400, "That session did not include a usable reaction time");

  const uid = req.session.userId;
  const today = localDate(req);

  /* Caffeine improves reaction time, so a dose taken shortly before the test masks
     the impairment this channel exists to detect. The gap is computed on the
     athlete's own clock, which is where the caffeine log times were written. */
  const nowMinutes = localMinutes(req);
  const gaps = q.caffeineOn.all(uid, today)
    .map((l) => {
      const t = v.time(l.logged_at, null);
      if (!t) return null;
      const [h, m] = t.split(":").map(Number);
      const mins = nowMinutes - (h * 60 + m);
      return mins >= 0 ? mins : null;
    })
    .filter((g) => g != null);
  const minutesPrior = gaps.length ? Math.min(...gaps) : null;

  q.insertPvt.run(
    uid, today,
    v.intIn(b.durationMs, 0, 600000), nTrials, meanRt,
    v.numIn(b.medianRt, 100, 5000), v.numIn(b.meanReciprocal, 0, 10),
    v.numIn(b.sdRt, 0, 5000), v.numIn(b.semRt, 0, 1000),
    v.intIn(b.lapses, 0, 1000) || 0, v.intIn(b.falseStarts, 0, 1000) || 0,
    minutesPrior,
    v.text(b.device, 60),
    v.time(req.get("x-local-time"), null)
  );
  res.json({ ok: true, caffeineMinutesPrior: minutesPrior, thisWeek: q.pvtBetween.get(uid, shiftDate(today, -6), today).n });
});

/* ---------------- channel A ---------------- */

app.get("/api/metrics", requireAuth, (req, res) => res.json({ days: q.allMetrics.all(req.session.userId) }));

/* The Body channel opened up: sleep against a goal and a schedule, heart measures
   as seven-day averages against a normal range, and the nights after hard days. */
const bodyModel = require("./body");
app.get("/api/body", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const cal = q.calibration.get(uid) || {};
  res.json(bodyModel.compute({
    metrics: q.allMetrics.all(uid),
    daily: q.allDaily.all(uid),
    goalMinutes: cal.sleep_goal_minutes,
  }));
});

/* The Brain channel opened up: the tests behind the weekly number, whether they
   were taken consistently, and how they move with sleep and felt sharpness. */
const brainModel = require("./brain");
app.get("/api/brain", requireAuth, (req, res) => {
  const uid = req.session.userId;
  res.json(brainModel.compute({
    sessions: q.allPvt.all(uid),
    metrics: q.allMetrics.all(uid),
    daily: q.allDaily.all(uid),
    today: localDate(req),
  }));
});

/* The Life channel opened up: the week in the athlete's own numbers, demand
   against say, mood, burnout signs, and what shows up on heavy days. */
const lifeModel = require("./life");
app.get("/api/life", requireAuth, (req, res) => {
  const uid = req.session.userId;
  res.json({
    ...lifeModel.compute({
      daily: q.allDaily.all(uid),
      weekly: q.allWeekly.all(uid),
      journal: journalForChannel(uid),
      metrics: q.allMetrics.all(uid),
      today: localDate(req),
    }),
    journalLevel: journalLevel(q.calibration.get(uid)),
    labels: { about: reader.SOURCES, signs: reader.SIGNS, lifts: reader.LIFTS },
  });
});

/* Manual entry and spreadsheet import. */
app.post("/api/metrics", requireAuth, (req, res) => {
  const b = req.body || {};
  const rows = Array.isArray(b.days) ? b.days.slice(0, 3000) : [];
  const source = ["manual", "csv"].includes(b.source) ? b.source : "manual";
  const clean = rows.map((d) => ({
    date: v.date(d && d.date),
    hrv: v.numIn(d && d.hrv, 0, 1000),
    rhr: v.numIn(d && d.rhr, 0, 300),
    sleepMinutes: v.numIn(d && d.sleepMinutes, 0, 1440),
    sleepEfficiency: v.numIn(d && d.sleepEfficiency, 0, 100),
    sleepStart: d && d.sleepStart,
    sleepEnd: d && d.sleepEnd,
  }));
  const stored = upsertMetricRows(req.session.userId, clean, source);
  if (stored) {
    q.upsertIntegration.run(req.session.userId, source);
    q.setSynced.run(stored, req.session.userId, source);
  }
  res.json({ ok: true, stored, skipped: rows.length - stored });
});

/* The Apple Health export, streamed straight from the request into the parser. */
app.post("/api/import/apple-health", requireAuth, asyncHandler(async (req, res) => {
  const type = String(req.get("content-type") || "");
  if (/zip/.test(type)) {
    return sendError(res, 415, "Unzip the export first, then choose the export.xml file inside it");
  }
  const { records, rows } = await parseAppleHealth(req);
  if (!records) {
    return sendError(res, 422, "That file had no heart rate or sleep records, so check it is export.xml");
  }
  const uid = req.session.userId;
  const stored = upsertMetricRows(uid, rows, "apple_health");
  q.upsertIntegration.run(uid, "apple_health");
  q.setSynced.run(stored, uid, "apple_health");
  res.json({ ok: true, records, days: stored });
}));

/* ---------------- wearable integrations ---------------- */

async function withFreshToken(uid, providerId, fn) {
  const provider = PROVIDERS[providerId];
  const cfg = provider.config(process.env.PUBLIC_ORIGIN || "");
  if (!cfg) throw Object.assign(new Error("This provider is not configured on the server"), { status: 503 });

  const row = q.tokenFor.get(uid, providerId);
  if (!row) throw Object.assign(new Error("Not connected"), { status: 409 });

  let access = sealer.open(row.access_token);
  const refreshToken = sealer.open(row.refresh_token);

  const renew = async () => {
    if (!refreshToken) throw Object.assign(new Error("The connection has expired, so reconnect it"), { status: 401 });
    const t = await provider.refresh(cfg, refreshToken);
    storeToken(uid, providerId, t);
    access = t.accessToken;
  };

  if (row.expires_at && row.expires_at < Date.now() + 60 * 1000) await renew();
  try {
    return await fn(access);
  } catch (err) {
    if (err.status !== 401) throw err;
    await renew();
    return fn(access);
  }
}

function storeToken(uid, providerId, t) {
  q.saveToken.run(uid, providerId, sealer.seal(t.accessToken), t.refreshToken ? sealer.seal(t.refreshToken) : null, t.expiresAt, t.scope);
}

async function syncProvider(uid, providerId) {
  const integ = q.integrationOne.get(uid, providerId);
  /* A first sync reaches back four months, enough for a baseline on day one. Later
     syncs overlap the previous one by three days, because providers revise recent
     nights after the fact. */
  const since = integ && integ.last_synced_at
    ? shiftDate(String(integ.last_synced_at).slice(0, 10), -3)
    : shiftDate(new Date().toISOString().slice(0, 10), -120);
  try {
    const rows = await withFreshToken(uid, providerId, (token) => PROVIDERS[providerId].sync(token, since + "T00:00:00.000Z"));
    const stored = upsertMetricRows(uid, rows, providerId);
    q.setSynced.run(stored, uid, providerId);
    return stored;
  } catch (err) {
    q.setSyncError.run(String(err.message || "Sync failed").slice(0, 200), uid, providerId);
    throw err;
  }
}

app.get("/api/integrations", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const rows = Object.fromEntries(q.integrations.all(uid).map((r) => [r.provider, r]));
  const origin = originOf(req);
  const oauth = Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    kind: "oauth",
    available: !!p.config(origin),
    connected: !!q.tokenFor.get(uid, p.id),
    ...(rows[p.id] || {}),
  }));
  const imports = ["apple_health", "csv", "manual", "demo"]
    .filter((id) => id !== "demo" || rows.demo)
    .map((id) => ({ id, kind: id === "demo" ? "demo" : "import", connected: !!rows[id], ...(rows[id] || {}) }));
  res.json({ providers: [...oauth, ...imports], metricDays: counters.metrics.get(uid).n });
});

app.get("/api/integrations/:provider/start", requireAuth, (req, res) => {
  const provider = PROVIDERS[req.params.provider];
  if (!provider) return res.redirect("/sources.html?error=unknown");
  const cfg = provider.config(originOf(req));
  if (!cfg) return res.redirect(`/sources.html?error=not-configured&provider=${provider.id}`);

  const state = crypto.randomBytes(24).toString("base64url");
  const { verifier, challenge } = require("./integrations/oauth").pkce();
  req.session.oauth = { provider: provider.id, state, verifier, at: Date.now(), returnTo: v.text(req.query.return, 40) };
  req.session.save(() => res.redirect(provider.authorizeUrl(cfg, state, challenge)));
});

app.get("/api/integrations/:provider/callback", requireAuth, asyncHandler(async (req, res) => {
  const provider = PROVIDERS[req.params.provider];
  const pending = req.session.oauth;
  delete req.session.oauth;
  const back = (params) => {
    const page = pending && pending.returnTo === "welcome" ? "/welcome.html" : "/sources.html";
    res.redirect(`${page}?${new URLSearchParams(params)}`);
  };

  if (!provider || !pending || pending.provider !== provider.id) return back({ error: "state" });
  if (req.query.error) return back({ error: "denied", provider: provider.id });

  const given = Buffer.from(String(req.query.state || ""));
  const expected = Buffer.from(pending.state);
  // Constant-time comparison, and the state expires, so a replayed callback fails.
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected) || Date.now() - pending.at > 10 * 60 * 1000) {
    return back({ error: "state" });
  }

  const cfg = provider.config(originOf(req));
  if (!cfg) return back({ error: "not-configured", provider: provider.id });

  try {
    const token = await provider.exchange(cfg, String(req.query.code || ""), pending.verifier);
    const uid = req.session.userId;
    storeToken(uid, provider.id, token);
    q.upsertIntegration.run(uid, provider.id);
    // The first sync can take several seconds, so it runs after the redirect.
    syncProvider(uid, provider.id).catch((err) => console.error(`${provider.id} first sync failed`, err.message));
    back({ connected: provider.id });
  } catch (err) {
    console.error(`${provider.id} token exchange failed`, err.message);
    back({ error: "exchange", provider: provider.id });
  }
}));

app.post("/api/integrations/:provider/sync", requireAuth, asyncHandler(async (req, res) => {
  const id = req.params.provider;
  if (!PROVIDERS[id]) return sendError(res, 404, "That provider is not supported");
  try {
    const stored = await syncProvider(req.session.userId, id);
    res.json({ ok: true, stored });
  } catch (err) {
    sendError(res, err.status && err.status < 500 ? err.status : 502, err.message || "Sync failed");
  }
}));

app.delete("/api/integrations/:provider", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const id = String(req.params.provider);
  if (![...Object.keys(PROVIDERS), "apple_health", "csv", "manual", "demo"].includes(id)) {
    return sendError(res, 404, "That provider is not supported");
  }
  q.deleteToken.run(uid, id);
  q.deleteIntegration.run(uid, id);
  // Disconnecting keeps history unless the athlete explicitly asks for it gone.
  const removed = req.query.deleteData === "1" ? Number(q.deleteMetricsBySource.run(uid, id).changes) : 0;
  res.json({ ok: true, removed });
});

/* ---------------- progress ---------------- */

/* Everything the home screen needs to show a new athlete how close they are to a
   first reading, and what the current week has covered. */
app.get("/api/progress", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const today = localDate(req);
  const ws = weekStart(today);
  const weekEnd = shiftDate(ws, 6);

  const metrics = counters.metrics.get(uid);
  const daily = counters.daily.get(uid);
  const pvt = counters.pvt.get(uid);
  const weekly = counters.weekly.get(uid);
  const snap = snapshot(uid);
  const d = compute({ ...snap, today });
  const prefs = q.prefs.get(uid);
  const needed = MIN_BASELINE_WEEKS + 1;
  /* Weeks that hold any data at all. The engine's own week count only starts once
     a week can be compared against three before it, which would leave a new
     athlete's progress bar sitting at zero for most of a month. */
  const weeksOf = (dates) => new Set(dates.map((x) => weekStart(String(x).slice(0, 10)))).size;

  res.json({
    confidence: d.confidence,
    weeksNeeded: needed,
    channels: {
      autonomic: { weeks: weeksOf(snap.metrics.map((r) => r.date)), days: metrics.n },
      cognitive: { weeks: weeksOf(snap.sessions.map((r) => r.date)), sessions: pvt.n },
      psychological: {
        weeks: weeksOf([...snap.daily.map((r) => r.date), ...snap.weekly.map((r) => r.week_start)]),
        days: daily.n,
      },
    },
    thisWeek: {
      weekStart: ws,
      // The last seven days, matching the model; the reflection below stays per week.
      pvt: q.pvtBetween.get(uid, shiftDate(today, -6), today).n,
      pvtTarget: 3,
      checkins: q.dailyBetween.get(uid, shiftDate(today, -6), today).n,
      checkinTarget: 7,
      weekly: !!q.weeklyOn.get(uid, ws),
    },
    today: {
      pvt: q.pvtOn.get(uid, today).n > 0,
      checkin: !!q.dailyOn.get(uid, today),
    },
    checklist: {
      bodyData: metrics.n > 0,
      firstTest: pvt.n > 0,
      firstCheckin: daily.n > 0,
      firstReflection: weekly.n > 0,
      reminders: !!(prefs && prefs.enabled) && q.subsFor.all(uid).length > 0,
    },
    firstDay: [metrics.first, daily.first, pvt.first].filter(Boolean).sort()[0] || null,
  });
});

/* ---------------- divergence and analytics ---------------- */

app.get("/api/divergence", requireAuth, (req, res) =>
  res.json(compute({ ...snapshot(req.session.userId), today: localDate(req) })));

app.get("/api/method", requireAuth, (req, res) => {
  const user = q.userById.get(req.session.userId);
  res.json({
    sensitivity: user.sensitivity,
    levels: SENSITIVITY,
    minBaselineWeeks: MIN_BASELINE_WEEKS,
    states: Object.fromEntries(Object.entries(PLAIN_STATES).map(([k, s]) => [k, { name: s.name, detail: s.detail }])),
  });
});

/* The season as a sequence of weeks: the named pattern, each channel, and each gap,
   recomputed as the model would have read them at the end of every week. */
const trendsModel = require("./trends");
app.get("/api/trends", requireAuth, (req, res) => {
  res.json(trendsModel.season({ ...snapshot(req.session.userId), today: localDate(req) }));
});

app.get("/api/analytics", requireAuth, (req, res) => {
  const uid = req.session.userId;
  res.json(
    analytics.compute({
      daily: q.allDaily.all(uid),
      weekly: q.allWeekly.all(uid),
      sessions: q.allPvt.all(uid),
      metrics: q.allMetrics.all(uid),
      caffeine: q.caffeineAll.all(uid),
      phases: q.allPhases.all(uid),
      journal: q.journalEvery.all(uid),
    })
  );
});

/* ---------------- journal ---------------- */

/* An entry as its own author sees it, with the stored reading turned back into
   words they can check. */
const withReading = (e) => {
  if (!e) return null;
  const { read_json, ...rest } = e;
  return { ...rest, reading: reader.parse(read_json) };
};

app.get("/api/journal", requireAuth, (req, res) => {
  if (req.query.date) {
    return res.json({ entry: withReading(q.journalOn.get(req.session.userId, v.date(req.query.date, localDate(req)))) });
  }
  res.json({ entries: q.journalAll.all(req.session.userId).map(withReading) });
});

app.post("/api/journal", requireAuth, (req, res) => {
  const b = req.body || {};
  const uid = req.session.userId;
  const date = recentDate(b.date, req, { pastDays: 400 });
  if (!date) return sendError(res, 400, "A valid date is required");
  /* The rating is optional and reaches the psychological channel only when the
     athlete has said it may. The text is read only at the "words" level, by a
     model on this machine, in a separate request the page makes after saving,
     so a slow model never holds up the save itself. */
  const content = String(b.content || "").slice(0, 20000);
  const mode = journalModel.MODE_BY_ID[String(b.mode || "")] ? String(b.mode) : "free";
  q.upsertJournal.run(
    uid, date, content,
    v.numIn(b.valence, -1, 1), v.numIn(b.arousal, -1, 1),
    v.tags(b.domains), mode, journalModel.wordCount(content)
  );

  const entries = q.journalEvery.all(uid);
  const saved = q.journalOn.get(uid, date);
  res.json({
    ok: true,
    insight: journalModel.entryInsight(saved, { entries, metrics: q.allMetrics.all(uid) }),
    toRead: journalLevel(q.calibration.get(uid)) === "words" && !saved.read_json && (saved.word_count || 0) >= reader.MIN_WORDS,
    reading: reader.parse(saved.read_json),
  });
});

/* ---------------- reading entries on this machine ---------------- */

/* One read at a time per athlete. A laptop running a four-billion-parameter
   model has room for one entry at a time, and a second tab should wait its turn
   rather than doubling the wait for both. */
const reading = new Set();

/* The model that will read, or null. Only ever a local one: the hosted
   assistant's key is deliberately not passed, so an entry can never be read by
   anything that is not on this machine. */
async function localReader() {
  const engine = await assistant.status({ apiKey: "" });
  return engine.provider === "local" ? engine.model : null;
}

async function readEntry(uid, date) {
  const entry = q.journalOn.get(uid, date);
  if (!entry) return { reading: null, reason: "missing" };
  if (entry.read_json) return { reading: reader.parse(entry.read_json), model: entry.read_model };
  if ((entry.word_count || 0) < reader.MIN_WORDS) return { reading: null, reason: "short" };
  const model = await localReader();
  if (!model) return { reading: null, reason: "offline" };
  const result = await reader.read({ text: entry.content, model });
  q.saveReading.run(JSON.stringify(result), model, 0, uid, date);
  return { reading: result, model };
}

app.post("/api/journal/read", requireAuth, asyncHandler(async (req, res) => {
  const uid = req.session.userId;
  if (journalLevel(q.calibration.get(uid)) !== "words") {
    return sendError(res, 403, "Reading entries is off. Turn it on in the journal first");
  }
  const date = v.date((req.body || {}).date, localDate(req));
  if (reading.has(uid)) return sendError(res, 409, "Another entry is being read. Try again in a moment");
  reading.add(uid);
  try {
    res.json(await readEntry(uid, date));
  } catch (err) {
    sendError(res, err.status || 502, err.message || "The model on this machine could not read that entry");
  } finally {
    reading.delete(uid);
  }
}));

/* Entries written before reading was turned on, a few per request, newest first.
   The page keeps asking while any remain, so the athlete watches it happen
   rather than waiting on one long silent request. */
const READ_BACK_DAYS = 120;
app.post("/api/journal/read-back", requireAuth, asyncHandler(async (req, res) => {
  const uid = req.session.userId;
  if (journalLevel(q.calibration.get(uid)) !== "words") {
    return sendError(res, 403, "Reading entries is off. Turn it on in the journal first");
  }
  const since = shiftDate(localDate(req), -READ_BACK_DAYS);
  if (reading.has(uid)) return sendError(res, 409, "Another entry is being read. Try again in a moment");
  const model = await localReader();
  if (!model) return res.json({ read: 0, remaining: q.unreadCount.get(uid, reader.MIN_WORDS, since).n, offline: true });

  reading.add(uid);
  let read = 0;
  try {
    for (const e of q.unreadEntries.all(uid, reader.MIN_WORDS, since, 3)) {
      const result = await reader.read({ text: e.content, model });
      q.saveReading.run(JSON.stringify(result), model, 0, uid, e.entry_date);
      read += 1;
    }
  } catch (err) {
    if (!read) return sendError(res, err.status || 502, err.message || "The model on this machine could not read those entries");
  } finally {
    reading.delete(uid);
  }
  res.json({ read, remaining: q.unreadCount.get(uid, reader.MIN_WORDS, since).n, offline: false });
}));

/* The athlete's correction, or their choice to leave an entry out. A corrected
   reading is marked as theirs and is never overwritten by the model again. */
app.put("/api/journal/reading", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const b = req.body || {};
  const date = v.date(b.date, localDate(req));
  const entry = q.journalOn.get(uid, date);
  if (!entry) return sendError(res, 404, "No entry on that day");

  if (typeof b.excluded === "boolean") q.excludeReading.run(b.excluded ? 1 : 0, uid, date);
  if (b.edits && typeof b.edits === "object") {
    const next = reader.amend(reader.parse(entry.read_json), b.edits);
    q.saveReading.run(JSON.stringify(next), entry.read_model || "you", 1, uid, date);
  }
  res.json({ entry: withReading(q.journalOn.get(uid, date)) });
});

/* Everything the journal page shows about how the writing itself has gone. */
app.get("/api/journal/insights", requireAuth, asyncHandler(async (req, res) => {
  const uid = req.session.userId;
  const today = localDate(req);
  const entries = q.journalEvery.all(uid);
  const cal = q.calibration.get(uid) || {};
  const level = journalLevel(cal);
  const lastCheckin = q.dailyOn.get(uid, today) || q.dailyOn.get(uid, shiftDate(today, -1)) || null;
  const model = await localReader();

  res.json({
    /* `modes` is how often each kind has been used; `prompts` is the list of
       kinds themselves. They were both called modes, and the list quietly
       replaced the counts. */
    ...journalModel.insights({ entries, metrics: q.allMetrics.all(uid), daily: q.allDaily.all(uid), today }),
    prompts: journalModel.MODES,
    level,
    counted: level === "rating" || level === "words",
    asked: level != null,
    reader: {
      available: !!model,
      model,
      unread: level === "words" ? q.unreadCount.get(uid, reader.MIN_WORDS, shiftDate(today, -READ_BACK_DAYS)).n : 0,
    },
    labels: { about: reader.SOURCES, signs: reader.SIGNS, lifts: reader.LIFTS },
    themes: level === "words" ? journalModel.themes(journalForChannel(uid), today) : null,
    suggestion: journalModel.suggest({
      entries,
      today,
      hour: Math.floor(localMinutes(req) / 60),
      lastCheckin,
      hadEvent: q.eventsBetween.all(uid, today, today).some((e) => e.kind === "game" || e.kind === "practice"),
    }),
  });
}));

/* How far entries may reach into the Life channel. Asked once, before the first
   entry, and changeable from this page whenever the athlete likes. The older
   { counted } form is still understood. */
const JOURNAL_LEVELS = ["off", "rating", "words"];
app.post("/api/journal/consent", requireAuth, (req, res) => {
  const b = req.body || {};
  const level = JOURNAL_LEVELS.includes(b.level) ? b.level : b.counted === true ? "rating" : "off";
  q.setJournalInLife.run(req.session.userId, level === "off" ? 0 : 1, level === "words" ? 1 : 0);
  res.json({ ok: true, level, counted: level !== "off" });
});

/* ---------------- caffeine ---------------- */

app.get("/api/caffeine", requireAuth, (req, res) => {
  res.json({ entries: q.caffeineOn.all(req.session.userId, v.date(req.query.date, localDate(req))) });
});

/* Everything the caffeine page knows about this athlete in one request: the
   night-by-night pairing, the usual day, and yesterday's drinks, which are
   still partly in the system this morning. */
app.get("/api/caffeine/insights", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const today = localDate(req);
  const cal = q.calibration.get(uid);
  const bedtime = (cal && cal.typical_bedtime) || null;
  res.json({
    bedtime: bedtime || "23:00",
    bedtimeSaved: !!bedtime,
    today,
    yesterday: q.caffeineOn.all(uid, shiftDate(today, -1)),
    ...analytics.caffeineNights(q.caffeineAll.all(uid), q.allMetrics.all(uid), { bedtime, today }),
  });
});

app.post("/api/caffeine", requireAuth, (req, res) => {
  const b = req.body || {};
  const mg = v.numIn(b.mg, 1, 1500);
  if (mg == null) return sendError(res, 400, "An amount in milligrams is required");
  const today = localDate(req);
  const now = localMinutes(req);
  const fallbackTime = `${String(Math.floor(now / 60)).padStart(2, "0")}:${String(now % 60).padStart(2, "0")}`;
  q.insertCaffeine.run(req.session.userId, today, v.text(b.label, 60), mg, v.time(b.loggedAt, fallbackTime));
  res.json({ ok: true, entries: q.caffeineOn.all(req.session.userId, today) });
});

app.delete("/api/caffeine/:id", requireAuth, (req, res) => {
  q.deleteCaffeine.run(Number(req.params.id), req.session.userId);
  res.json({ ok: true });
});

/* ---------------- periods ---------------- */

app.get("/api/phases", requireAuth, (req, res) => res.json({ phases: q.allPhases.all(req.session.userId) }));

app.post("/api/phases", requireAuth, (req, res) => {
  const b = req.body || {};
  const label = v.text(b.label, 60);
  const start = v.date(b.startDate);
  const end = v.date(b.endDate);
  if (!label || !start || !end) return sendError(res, 400, "A label, start date, and end date are all required");
  if (end < start) return sendError(res, 400, "The end date must come after the start date");
  q.insertPhase.run(req.session.userId, label, start, end);
  res.json({ ok: true });
});

app.delete("/api/phases/:id", requireAuth, (req, res) => {
  q.deletePhase.run(Number(req.params.id), req.session.userId);
  res.json({ ok: true });
});

/* ---------------- sharing ---------------- */

app.get("/api/share", requireAuth, (req, res) => res.json({ links: q.listShare.all(req.session.userId) }));

app.post("/api/share", requireAuth, (req, res) => {
  if (q.activeShares.get(req.session.userId).n >= 20) {
    return sendError(res, 400, "Revoke an existing link before creating another");
  }
  const token = crypto.randomBytes(18).toString("base64url");
  q.insertShare.run(req.session.userId, token, v.text(req.body && req.body.label, 60));
  res.json({ ok: true, token });
});

app.post("/api/share/:id/revoke", requireAuth, (req, res) => {
  q.revokeShare.run(Number(req.params.id), req.session.userId);
  res.json({ ok: true });
});

/* Public and deliberately thin: a named state, never a raw channel. */
/* The athlete's own wording is second person, which reads as if it were about the
   coach holding the link. A name on its own is easy to over-read, so the share
   view carries one neutral sentence about the person it describes. */
const SHARE_MEANING = {
  aligned: "Nothing in their own data is outside its usual range this week.",
  physical: "Their body is carrying load, while their reaction time and their week look normal.",
  cogpsy: "Their body looks recovered, while their reaction time and their week do not.",
  unrecognised: "Their reaction time has slowed without them reporting any strain.",
  perceived: "They are reporting strain that their measures have not shown yet.",
  convergent: "All three channels are worse than their own normal at the same time.",
  mixed: "Some channels are outside their usual range and others are not.",
};

app.get(
  "/api/share/public/:token",
  security.rateLimit({ windowMs: 60 * 1000, max: 30, key: security.clientIp, message: "Too many requests" }),
  (req, res) => {
    const link = q.shareByToken.get(String(req.params.token));
    if (!link) return sendError(res, 404, "This link is invalid or has been removed");
    q.touchShare.run(link.id);

    const user = q.userById.get(link.user_id);
    const d = compute(snapshot(link.user_id));
    res.json({
      name: user ? String(user.name).split(" ")[0] : "This athlete",
      state: d.state ? d.state.name : null,
      stateKey: d.state ? d.state.key : null,
      tone: d.state ? d.state.tone : null,
      meaning: d.state ? SHARE_MEANING[d.state.key] || null : null,
      confidence: d.confidence,
      label: link.label,
    });
  }
);

/* ---------------- reminders ---------------- */

function prefsFor(uid, req) {
  q.ensurePrefs.run(uid, v.timezone(req.get("x-timezone")));
  return q.prefs.get(uid);
}

app.get("/api/push/key", requireAuth, (req, res) => res.json({ publicKey: vapid.publicKey }));

app.post("/api/push/subscribe", requireAuth, (req, res) => {
  const sub = (req.body || {}).subscription || {};
  const endpoint = String(sub.endpoint || "");
  const keys = sub.keys || {};
  let valid = false;
  try {
    valid = new URL(endpoint).protocol === "https:" && endpoint.length < 1200;
  } catch {
    valid = false;
  }
  if (!valid || !keys.p256dh || !keys.auth) return sendError(res, 400, "That push subscription is not valid");
  q.saveSub.run(req.session.userId, endpoint, String(keys.p256dh).slice(0, 200), String(keys.auth).slice(0, 100));
  res.json({ ok: true });
});

app.post("/api/push/unsubscribe", requireAuth, (req, res) => {
  q.deleteSub.run(String((req.body || {}).endpoint || ""), req.session.userId);
  res.json({ ok: true });
});

app.post("/api/push/test", requireAuth, asyncHandler(async (req, res) => {
  const subs = q.subsFor.all(req.session.userId);
  if (!subs.length) return sendError(res, 409, "Turn on notifications on this device first");
  const delivered = await push(
    subs,
    { kind: "test", title: "Reminders Are On", body: "This is how Myaku will remind you.", url: "/reminders.html" },
    (s) => q.deleteSubById.run(s.id)
  );
  res.json({ ok: true, delivered });
}));

app.get("/api/reminders", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const prefs = prefsFor(uid, req);
  res.json({
    prefs: {
      enabled: !!prefs.enabled,
      timezone: prefs.timezone,
      pvtTime: prefs.pvt_time,
      pvtDays: prefs.pvt_days.split(",").map(Number),
      checkinTime: prefs.checkin_time,
      weeklyDay: prefs.weekly_day,
      weeklyTime: prefs.weekly_time,
    },
    devices: q.subsFor.all(uid).length,
  });
});

app.post("/api/reminders", requireAuth, (req, res) => {
  const b = req.body || {};
  const uid = req.session.userId;
  const current = prefsFor(uid, req);
  q.savePrefs.run(
    uid,
    b.enabled == null ? current.enabled : b.enabled ? 1 : 0,
    v.timezone(b.timezone || current.timezone),
    v.time(b.pvtTime, current.pvt_time),
    v.weekdays(b.pvtDays, current.pvt_days),
    v.time(b.checkinTime, current.checkin_time),
    v.intIn(b.weeklyDay, 0, 6) ?? current.weekly_day,
    v.time(b.weeklyTime, current.weekly_time)
  );
  res.json({ ok: true });
});

app.get("/api/reminders/calendar.ics", requireAuth, (req, res) => {
  const prefs = prefsFor(req.session.userId, req);
  res.set({
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'attachment; filename="myaku-reminders.ics"',
  });
  res.send(reminders.remindersCalendar(prefs, { startDate: localDate(req), origin: originOf(req) }));
});

/* ---------------- account ---------------- */

/* Everything held about the athlete, in one file they can keep. OAuth tokens and
   the password hash are left out: the first is useless outside this server and
   the second should never leave it. */
app.get("/api/account/export", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const exported = { exportedAt: new Date().toISOString(), user: q.userById.get(uid) };
  db.USER_TABLES.filter((t) => t !== "oauth_tokens").forEach((table) => {
    exported[table] = db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(uid);
  });
  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="myaku-export-${localDate(req)}.json"`,
  });
  res.send(JSON.stringify(exported, null, 2));
});

app.post("/api/account/delete", requireAuth, loginLimit, asyncHandler(async (req, res) => {
  const uid = req.session.userId;
  const row = q.passwordHash.get(uid);
  if (!(await verifyPassword(String((req.body || {}).password || ""), row.password_hash))) {
    return sendError(res, 403, "That password was incorrect");
  }
  db.exec("BEGIN");
  try {
    db.USER_TABLES.forEach((table) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(uid));
    db.prepare("DELETE FROM users WHERE id = ?").run(uid);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  store.destroyUser(uid);
  req.session.destroy(() => res.json({ ok: true }));
}));

/* ---------------- calendar ---------------- */

/* A calendar arrives either as a feed the athlete subscribes to or as a file they
   export. Both end up as typed events, and both replace what the same source put
   there last time instead of stacking a second copy of the season. */
app.post("/api/calendar/import", requireAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const uid = req.session.userId;
  const hasText = typeof b.text === "string" && b.text.trim().length > 0;
  if (!b.url && !hasText) return sendError(res, 400, "A calendar URL or file is required");

  try {
    const raw = hasText ? String(b.text).slice(0, 5_000_000) : await fetchICS(String(b.url).trim().slice(0, 2000));
    const parsed = parseICS(raw);
    if (!parsed.length) return sendError(res, 400, "No events were found in that calendar");

    const events = schedule.importEvents(parsed);
    if (!events.length) return sendError(res, 400, "That calendar has nothing inside the season window");

    db.exec("BEGIN");
    try {
      if (b.replace !== false) q.deleteEventsBySource.run(uid, "ics");
      events.forEach((e) => q.insertEvent.run(uid, e.date, e.endDate, e.startTime, e.kind, e.title, "ics", e.uid));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    q.upsertIntegration.run(uid, "calendar");
    const counts = {};
    events.forEach((e) => (counts[e.kind] = (counts[e.kind] || 0) + 1));
    res.json({ ok: true, count: events.length, counts });
  } catch (err) {
    sendError(res, 400, err.message || "That calendar could not be imported");
  }
}));

app.get("/api/events", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const today = localDate(req);
  res.json({
    today,
    events: q.eventsBetween.all(uid, shiftDate(today, -28), shiftDate(today, 120)),
    kinds: EVENT_KINDS,
  });
});

app.post("/api/events", requireAuth, (req, res) => {
  const b = req.body || {};
  const date = v.isDate(b.date) ? b.date : null;
  if (!date) return sendError(res, 400, "A date like 2026-10-14 is required");
  const kind = EVENT_KINDS.includes(String(b.kind)) ? String(b.kind) : "other";
  const endDate = v.isDate(b.endDate) && b.endDate > date ? b.endDate : null;
  q.insertEvent.run(req.session.userId, date, endDate, v.time(b.startTime, null), kind, v.text(b.title, 120) || schedule.KIND_LABEL[kind], "manual", null);
  res.json({ ok: true });
});

app.delete("/api/events/:id", requireAuth, (req, res) => {
  q.deleteEvent.run(Number(req.params.id) || 0, req.session.userId);
  res.json({ ok: true });
});

/* The weeks ahead, and which of them collide. */
app.get("/api/schedule", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const today = localDate(req);
  res.json(
    schedule.season({
      events: q.allEvents.all(uid),
      metrics: q.allMetrics.all(uid),
      today,
    })
  );
});

/* ---------------- assistant ---------------- */

/* A model on this machine answers without anything leaving the device, which is
   the same promise the rest of the app already makes, so it is on unless the
   athlete has turned it off. A hosted model is a different promise, and stays
   off until they say yes. */
function assistantAllowed(user, engine) {
  const choice = user.assistant_opt_in;
  if (choice === "off") return false;
  if (choice) return true;
  return engine.provider === "local";
}

app.get("/api/assistant/status", requireAuth, asyncHandler(async (req, res) => {
  const user = q.userById.get(req.session.userId);
  const engine = await assistant.status();
  const choice = user.assistant_opt_in;
  res.json({
    ...engine,
    enabled: assistantAllowed(user, engine),
    choice: choice === "off" ? "off" : choice ? "on" : "unset",
    /* A hosted model needs a yes before it is used; a local one does not. */
    needsConsent: engine.provider !== "local" && !choice,
  });
}));

app.post("/api/assistant/consent", requireAuth, (req, res) => {
  const on = (req.body || {}).enabled === true;
  q.setAssistant.run(on ? new Date().toISOString() : "off", req.session.userId);
  res.json({ ok: true, enabled: on });
});

const assistantLimit = security.rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  key: (req) => `assistant:${req.session.userId}`,
  message: "That is a lot of questions at once. Try again in a minute",
});

app.post("/api/assistant", requireAuth, assistantLimit, asyncHandler(async (req, res) => {
  const uid = req.session.userId;
  const user = q.userById.get(uid);
  if (!assistantAllowed(user, await assistant.status())) {
    return sendError(res, 403, "The assistant is switched off for this account");
  }

  const today = localDate(req);
  const snap = snapshot(uid);
  const divergence = compute({ ...snap, today });
  const cal = q.calibration.get(uid) || {};
  const facts = assistant.factSheet({
    today,
    user,
    question: (req.body || {}).question,
    divergence,
    body: bodyModel.compute({ metrics: snap.metrics, daily: snap.daily, goalMinutes: cal.sleep_goal_minutes }),
    brain: brainModel.compute({ sessions: snap.sessions, metrics: snap.metrics, daily: snap.daily, today }),
    life: lifeModel.compute({ daily: snap.daily, weekly: snap.weekly, journal: snap.journal, metrics: snap.metrics, today }),
    trends: trendsModel.season({ ...snap, today }),
    schedule: schedule.season({ events: q.allEvents.all(uid), metrics: snap.metrics, today }),
  });

  const history = Array.isArray((req.body || {}).history) ? req.body.history : [];
  try {
    const result = await assistant.ask({ question: (req.body || {}).question, facts, history });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status === 400) return sendError(res, 400, err.message);
    if (err.status === 503) return sendError(res, 503, err.message);
    res.json({
      ok: true,
      answer: "The assistant could not be reached just now, so nothing was sent. Your pages still have the numbers.",
      model: null,
    });
  }
}));

/* ---------------- health ---------------- */

app.get("/api/health", (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

/* ---------------- static files ---------------- */

/* An allowlist, not the project directory. Serving the whole folder would hand out
   the database, the session secret, and the server source to anyone who asked for
   them by path. */
const PUBLIC_DIRS = ["/css/", "/js/", "/icons/"];
const PUBLIC_ROOT_FILE = /^\/(?:[a-z0-9-]+\.html|manifest\.webmanifest|sw\.js)$/;

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (req.path === "/" || PUBLIC_DIRS.some((d) => req.path.startsWith(d)) || PUBLIC_ROOT_FILE.test(req.path)) {
    return next();
  }
  res.status(404).sendFile(path.join(PUBLIC_ROOT, "404.html"));
});

app.use(
  express.static(PUBLIC_ROOT, {
    index: "index.html",
    dotfiles: "deny",
    setHeaders(res, file) {
      // The service worker and pages are revalidated every load, so a deploy is
      // picked up immediately instead of hiding behind a stale cache.
      if (/\.(html|webmanifest)$/.test(file) || file.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache");
      if (file.endsWith("sw.js")) res.setHeader("Service-Worker-Allowed", "/");
    },
  })
);

app.use("/api/", (req, res) => sendError(res, 404, "Not found"));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_ROOT, "404.html")));

app.use((err, req, res, _next) => {
  console.error(err);
  if (req.path.startsWith("/api/")) return sendError(res, 500, "Something went wrong on our side");
  res.status(500).sendFile(path.join(PUBLIC_ROOT, "500.html"));
});

/* ---------------- start ---------------- */

function start(port = process.env.PORT || 3000) {
  const server = app.listen(port, process.env.HOST || "0.0.0.0", () => {
    console.log(`Myaku running at http://localhost:${port}`);
  });

  const scheduler = reminders.startScheduler({
    getUsers: () => q.enabledPrefs.all(),
    getStatus: (uid, date) => ({
      pvtToday: q.pvtOn.get(uid, date).n > 0,
      checkinToday: !!q.dailyOn.get(uid, date),
      weeklyDone: !!q.weeklyOn.get(uid, weekStart(date)),
    }),
    getSubscriptions: (uid) => q.subsFor.all(uid),
    alreadySent: (uid, kind, date) => !!q.wasSent.get(uid, kind, date),
    markSent: (uid, kind, date) => q.markSent.run(uid, kind, date),
    push,
    removeSubscription: (sub) => q.deleteSubById.run(sub.id),
  });

  /* Background sync every six hours for every connected wearable. */
  const syncTimer = setInterval(() => {
    q.allTokens.all().forEach(({ user_id, provider }) => {
      if (!PROVIDERS[provider]) return;
      syncProvider(user_id, provider).catch((err) => console.error(`${provider} sync for user ${user_id} failed`, err.message));
    });
  }, 6 * 60 * 60 * 1000);
  syncTimer.unref();

  const shutdown = () => {
    scheduler.stop();
    clearInterval(syncTimer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}

if (require.main === module) start();

module.exports = { app, start, syncProvider };
