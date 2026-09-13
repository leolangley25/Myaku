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
const { plausible } = require("./integrations/oauth");

const PROVIDERS = {
  whoop: require("./integrations/whoop"),
  google: require("./integrations/google-health"),
};

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
  userById: db.prepare("SELECT id, name, email, created_at, sensitivity, onboarded_at FROM users WHERE id = ?"),
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
      median_rt, mean_reciprocal, sd_rt, sem_rt, lapses, false_starts, caffeine_minutes_prior, valid)
    VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`),
  allPvt: db.prepare("SELECT * FROM pvt_sessions WHERE user_id = ? ORDER BY date"),
  recentPvt: db.prepare("SELECT * FROM pvt_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 20"),
  pvtOn: db.prepare("SELECT COUNT(*) AS n FROM pvt_sessions WHERE user_id = ? AND date = ?"),
  pvtBetween: db.prepare("SELECT COUNT(*) AS n FROM pvt_sessions WHERE user_id = ? AND date BETWEEN ? AND ?"),
  dailyBetween: db.prepare("SELECT COUNT(*) AS n FROM daily_checkins WHERE user_id = ? AND date BETWEEN ? AND ?"),

  allMetrics: db.prepare("SELECT * FROM daily_metrics WHERE user_id = ? ORDER BY date"),
  /* Merging rather than replacing, so a sync that is missing one field for a day
     does not erase the value another source already supplied. */
  mergeMetric: db.prepare(`
    INSERT INTO daily_metrics (user_id, date, hrv_ms, rhr_bpm, sleep_minutes, sleep_efficiency, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      hrv_ms = COALESCE(excluded.hrv_ms, daily_metrics.hrv_ms),
      rhr_bpm = COALESCE(excluded.rhr_bpm, daily_metrics.rhr_bpm),
      sleep_minutes = COALESCE(excluded.sleep_minutes, daily_metrics.sleep_minutes),
      sleep_efficiency = COALESCE(excluded.sleep_efficiency, daily_metrics.sleep_efficiency),
      source = excluded.source`),
  deleteMetricsBySource: db.prepare("DELETE FROM daily_metrics WHERE user_id = ? AND source = ?"),

  upsertJournal: db.prepare(`
    INSERT INTO journal_entries (user_id, entry_date, content, valence, arousal, domains, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, entry_date) DO UPDATE SET content=excluded.content,
      valence=excluded.valence, arousal=excluded.arousal, domains=excluded.domains,
      updated_at=datetime('now')`),
  journalOn: db.prepare("SELECT * FROM journal_entries WHERE user_id = ? AND entry_date = ?"),
  journalAll: db.prepare("SELECT * FROM journal_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT 60"),
  journalEvery: db.prepare("SELECT * FROM journal_entries WHERE user_id = ? ORDER BY entry_date"),

  caffeineAll: db.prepare("SELECT * FROM caffeine_logs WHERE user_id = ? ORDER BY date"),
  insertCaffeine: db.prepare("INSERT INTO caffeine_logs (user_id, date, label, mg, logged_at) VALUES (?, ?, ?, ?, ?)"),
  caffeineOn: db.prepare("SELECT * FROM caffeine_logs WHERE user_id = ? AND date = ? ORDER BY logged_at DESC"),
  deleteCaffeine: db.prepare("DELETE FROM caffeine_logs WHERE id = ? AND user_id = ?"),

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

const counters = {
  metrics: q.count("daily_metrics", "date"),
  daily: q.count("daily_checkins", "date"),
  pvt: q.count("pvt_sessions", "date"),
  weekly: q.count("weekly_checkins", "week_start"),
  journal: q.count("journal_entries", "entry_date"),
};

function snapshot(uid) {
  const user = q.userById.get(uid);
  return {
    metrics: q.allMetrics.all(uid),
    sessions: q.allPvt.all(uid),
    daily: q.allDaily.all(uid),
    weekly: q.allWeekly.all(uid),
    journal: q.journalEvery.all(uid),
    sensitivity: user ? user.sensitivity : undefined,
  };
}

function upsertMetricRows(uid, rows, source) {
  let stored = 0;
  db.exec("BEGIN");
  try {
    rows.forEach((r) => {
      if (!r || !v.isDate(r.date) || !plausible(r)) return;
      q.mergeMetric.run(uid, r.date, r.hrv ?? null, r.rhr ?? null, r.sleepMinutes ?? null, r.sleepEfficiency ?? null, source);
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
  const ws = weekStart(today);
  const sessions = q.recentPvt.all(uid);
  res.json({
    sessions,
    todayCount: q.pvtOn.get(uid, today).n,
    thisWeek: q.pvtBetween.get(uid, ws, shiftDate(ws, 6)).n,
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
    minutesPrior
  );
  const ws = weekStart(today);
  res.json({ ok: true, caffeineMinutesPrior: minutesPrior, thisWeek: q.pvtBetween.get(uid, ws, shiftDate(ws, 6)).n });
});

/* ---------------- channel A ---------------- */

app.get("/api/metrics", requireAuth, (req, res) => res.json({ days: q.allMetrics.all(req.session.userId) }));

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
  const d = compute(snap);
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
      pvt: q.pvtBetween.get(uid, ws, weekEnd).n,
      pvtTarget: 3,
      checkins: q.dailyBetween.get(uid, ws, weekEnd).n,
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

app.get("/api/divergence", requireAuth, (req, res) => res.json(compute(snapshot(req.session.userId))));

app.get("/api/method", requireAuth, (req, res) => {
  const user = q.userById.get(req.session.userId);
  res.json({
    sensitivity: user.sensitivity,
    levels: SENSITIVITY,
    minBaselineWeeks: MIN_BASELINE_WEEKS,
    states: Object.fromEntries(Object.entries(PLAIN_STATES).map(([k, s]) => [k, { name: s.name, detail: s.detail }])),
  });
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

app.get("/api/journal", requireAuth, (req, res) => {
  if (req.query.date) {
    return res.json({ entry: q.journalOn.get(req.session.userId, v.date(req.query.date, localDate(req))) || null });
  }
  res.json({ entries: q.journalAll.all(req.session.userId) });
});

app.post("/api/journal", requireAuth, (req, res) => {
  const b = req.body || {};
  const date = recentDate(b.date, req, { pastDays: 400 });
  if (!date) return sendError(res, 400, "A valid date is required");
  /* The rating is optional and is the only part of an entry that ever reaches the
     psychological channel. The text is stored and left alone. */
  q.upsertJournal.run(
    req.session.userId, date, String(b.content || "").slice(0, 20000),
    v.numIn(b.valence, -1, 1), v.numIn(b.arousal, -1, 1),
    v.tags(b.domains)
  );
  res.json({ ok: true });
});

/* ---------------- caffeine ---------------- */

app.get("/api/caffeine", requireAuth, (req, res) => {
  res.json({ entries: q.caffeineOn.all(req.session.userId, v.date(req.query.date, localDate(req))) });
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

app.post("/api/calendar/import", requireAuth, asyncHandler(async (req, res) => {
  const url = req.body && req.body.url;
  if (!url) return sendError(res, 400, "A calendar URL is required");
  try {
    const events = parseICS(await fetchICS(String(url).trim().slice(0, 2000)));
    q.upsertIntegration.run(req.session.userId, "calendar");
    res.json({ ok: true, count: events.length });
  } catch (err) {
    sendError(res, 400, err.message || "That calendar could not be imported");
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
