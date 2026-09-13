const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");
const db = require("./db");
const { fetchICS, parseICS } = require("./ics");
const { computeCorrelations } = require("./insights");
const { sendError, asyncHandler } = require("./errors");

const app = express();
app.use(express.json());
app.use(
  session({
    secret: crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return sendError(res, 401, "Not Signed In");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return sendError(res, 401, "Not Signed In");
  const user = findUserById.get(req.session.userId);
  if (!user || user.role !== "admin") return sendError(res, 403, "Admins Only");
  next();
}

const VALID_ROLES = ["student_athlete", "individual", "admin"];

const insertUser = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)");
const findUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const findUserById = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?");
const insertConnection = db.prepare("INSERT OR IGNORE INTO connected_accounts (user_id, provider) VALUES (?, ?)");
const deleteConnection = db.prepare("DELETE FROM connected_accounts WHERE user_id = ? AND provider = ?");
const listConnections = db.prepare("SELECT provider FROM connected_accounts WHERE user_id = ?");

const upsertCalibration = db.prepare(`
  INSERT INTO calibration (
    user_id, sport, training_days_per_week, typical_bedtime, course_load,
    baseline_training_stress, baseline_academic_stress, baseline_personal_stress, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    sport = excluded.sport,
    training_days_per_week = excluded.training_days_per_week,
    typical_bedtime = excluded.typical_bedtime,
    course_load = excluded.course_load,
    baseline_training_stress = excluded.baseline_training_stress,
    baseline_academic_stress = excluded.baseline_academic_stress,
    baseline_personal_stress = excluded.baseline_personal_stress,
    updated_at = datetime('now')
`);
const findCalibration = db.prepare("SELECT * FROM calibration WHERE user_id = ?");

const insertLog = db.prepare(`
  INSERT INTO logs (user_id, type, label, amount, logged_at, note)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const listLogs = db.prepare("SELECT * FROM logs WHERE user_id = ? AND type = ? ORDER BY logged_at DESC LIMIT 50");
const deleteLog = db.prepare("DELETE FROM logs WHERE id = ? AND user_id = ?");

const upsertCalendarSource = db.prepare(`
  INSERT INTO calendar_sources (user_id, url, last_synced_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET url = excluded.url, last_synced_at = datetime('now')
`);
const findCalendarSource = db.prepare("SELECT * FROM calendar_sources WHERE user_id = ?");
const deleteCalendarSource = db.prepare("DELETE FROM calendar_sources WHERE user_id = ?");
const deleteCalendarEvents = db.prepare("DELETE FROM calendar_events WHERE user_id = ?");
const insertCalendarEvent = db.prepare(`
  INSERT INTO calendar_events (user_id, title, start_at, end_at) VALUES (?, ?, ?, ?)
`);
const listCalendarEvents = db.prepare(`
  SELECT * FROM calendar_events WHERE user_id = ? ORDER BY start_at ASC
`);

const upsertJournal = db.prepare(`
  INSERT INTO journal_entries (user_id, entry_date, content, updated_at) VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, entry_date) DO UPDATE SET content = excluded.content, updated_at = datetime('now')
`);
const findJournalEntry = db.prepare("SELECT * FROM journal_entries WHERE user_id = ? AND entry_date = ?");
const listJournalEntries = db.prepare(`
  SELECT * FROM journal_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT 30
`);

const insertCheckin = db.prepare(`
  INSERT INTO checkins (user_id, training_stress, academic_stress, personal_stress) VALUES (?, ?, ?, ?)
`);
const listCheckins = db.prepare("SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at ASC");
const latestCheckin = db.prepare("SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1");

const insertShareLink = db.prepare("INSERT INTO share_links (user_id, token, label) VALUES (?, ?, ?)");
const listShareLinks = db.prepare("SELECT * FROM share_links WHERE user_id = ? ORDER BY created_at DESC");
const revokeShareLink = db.prepare("UPDATE share_links SET revoked = 1 WHERE id = ? AND user_id = ?");
const findShareLinkByToken = db.prepare("SELECT * FROM share_links WHERE token = ? AND revoked = 0");
const touchShareLink = db.prepare("UPDATE share_links SET last_viewed_at = datetime('now') WHERE id = ?");
const countConnections = db.prepare("SELECT COUNT(*) AS count FROM connected_accounts WHERE user_id = ?");

const insertPhase = db.prepare("INSERT INTO phases (user_id, label, start_date, end_date) VALUES (?, ?, ?, ?)");
const listPhases = db.prepare("SELECT * FROM phases WHERE user_id = ? ORDER BY start_date ASC");
const deletePhase = db.prepare("DELETE FROM phases WHERE id = ? AND user_id = ?");

const insertToken = db.prepare("INSERT INTO api_tokens (user_id, token, label) VALUES (?, ?, ?)");
const listTokens = db.prepare(
  "SELECT id, label, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC"
);
const revokeToken = db.prepare("UPDATE api_tokens SET revoked = 1 WHERE id = ? AND user_id = ?");
const findTokenRow = db.prepare("SELECT * FROM api_tokens WHERE token = ? AND revoked = 0");
const touchToken = db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?");

const VALID_PROVIDERS = ["whoop", "fitbit", "apple_health"];
const VALID_LOG_TYPES = ["caffeine", "hydration", "screen_time"];

app.post("/api/signup", (req, res) => {
  const { name, email, password, role, adminCode } = req.body || {};
  if (!name || !email || !password) {
    return sendError(res, 400, "Name, email, and password are all required.");
  }
  if (password.length < 8) {
    return sendError(res, 400, "Password must be at least 8 characters.");
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = findUserByEmail.get(normalizedEmail);
  if (existing) {
    return sendError(res, 409, "An account with that email already exists.");
  }

  const finalRole = VALID_ROLES.includes(role) ? role : "student_athlete";

  /* Admin accounts read aggregate data across every user, so the role can never
     be self-assigned from the signup form. It requires a code held by the
     operator; with no code configured, admin signup is closed entirely. */
  if (finalRole === "admin") {
    const expected = process.env.MYAKU_ADMIN_CODE;
    if (!expected) {
      return sendError(res, 403, "Admin signup is not enabled on this server.");
    }
    const supplied = Buffer.from(String(adminCode || ""));
    const target = Buffer.from(expected);
    const matches = supplied.length === target.length && crypto.timingSafeEqual(supplied, target);
    if (!matches) {
      return sendError(res, 403, "That admin code is not valid.");
    }
  }

  const result = insertUser.run(String(name).trim(), normalizedEmail, hashPassword(password), finalRole);
  req.session.userId = Number(result.lastInsertRowid);
  res.json({ ok: true, role: finalRole });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = email ? findUserByEmail.get(String(email).toLowerCase().trim()) : null;
  if (!user || !verifyPassword(password || "", user.password_hash)) {
    return sendError(res, 401, "Your email or password was incorrect.");
  }
  req.session.userId = user.id;
  res.json({ ok: true, role: user.role });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = findUserById.get(req.session.userId);
  const connectedProviders = listConnections.all(req.session.userId).map((r) => r.provider);
  const calibration = findCalibration.get(req.session.userId) || null;
  res.json({ user, connectedProviders, calibration });
});

app.get("/api/tokens", requireAuth, (req, res) => {
  res.json({ tokens: listTokens.all(req.session.userId) });
});

app.post("/api/tokens", requireAuth, (req, res) => {
  const { label } = req.body || {};
  const token = `myaku_${crypto.randomBytes(24).toString("hex")}`;
  const result = insertToken.run(req.session.userId, token, label ? String(label).trim() : null);
  res.json({ ok: true, id: Number(result.lastInsertRowid), token });
});

app.post("/api/tokens/:id/revoke", requireAuth, (req, res) => {
  revokeToken.run(Number(req.params.id), req.session.userId);
  res.json({ ok: true });
});

function requireApiToken(req, res, next) {
  const header = req.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return sendError(res, 401, "Not Signed In");
  const row = findTokenRow.get(token);
  if (!row) return sendError(res, 401, "Not Signed In");
  touchToken.run(row.id);
  req.tokenUserId = row.user_id;
  next();
}

app.get("/api/export", requireApiToken, (req, res) => {
  const userId = req.tokenUserId;
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceStr = since.toISOString().slice(0, 10);

  const checkins = db
    .prepare("SELECT * FROM checkins WHERE user_id = ? AND created_at >= ? ORDER BY created_at ASC")
    .all(userId, sinceStr);
  const logs = db
    .prepare("SELECT * FROM logs WHERE user_id = ? AND logged_at >= ? ORDER BY logged_at ASC")
    .all(userId, sinceStr);

  const byDay = {};
  function dayBucket(dateStr) {
    const day = String(dateStr).slice(0, 10);
    if (!byDay[day]) byDay[day] = { date: day, stressSamples: [], hydrationOz: 0, caffeineMg: 0, screenTimeMin: 0 };
    return byDay[day];
  }

  checkins.forEach((c) => {
    const values = [c.training_stress, c.academic_stress, c.personal_stress].filter((v) => v != null);
    if (values.length === 0) return;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    dayBucket(c.created_at).stressSamples.push(avg);
  });

  logs.forEach((l) => {
    const bucket = dayBucket(l.logged_at);
    const amount = l.amount || 0;
    if (l.type === "hydration") bucket.hydrationOz += amount;
    if (l.type === "caffeine") bucket.caffeineMg += amount;
    if (l.type === "screen_time") bucket.screenTimeMin += amount;
  });

  const days = Object.values(byDay)
    .map((d) => ({
      date: d.date,
      stress: d.stressSamples.length ? d.stressSamples.reduce((a, b) => a + b, 0) / d.stressSamples.length : null,
      hydrationOz: d.hydrationOz || null,
      caffeineMg: d.caffeineMg || null,
      screenTimeMin: d.screenTimeMin || null,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  res.json({ days });
});

app.post("/api/calibration", requireAuth, (req, res) => {
  const {
    sport,
    trainingDaysPerWeek,
    typicalBedtime,
    courseLoad,
    baselineTrainingStress,
    baselineAcademicStress,
    baselinePersonalStress,
  } = req.body || {};

  upsertCalibration.run(
    req.session.userId,
    sport ? String(sport).trim() : null,
    trainingDaysPerWeek != null ? Number(trainingDaysPerWeek) : null,
    typicalBedtime || null,
    courseLoad || null,
    baselineTrainingStress != null ? Number(baselineTrainingStress) : null,
    baselineAcademicStress != null ? Number(baselineAcademicStress) : null,
    baselinePersonalStress != null ? Number(baselinePersonalStress) : null
  );

  res.json({ ok: true });
});

app.post("/api/connect", requireAuth, (req, res) => {
  const { provider } = req.body || {};
  if (!VALID_PROVIDERS.includes(provider)) {
    return sendError(res, 400, "Unknown Provider");
  }
  insertConnection.run(req.session.userId, provider);
  const connectedProviders = listConnections.all(req.session.userId).map((r) => r.provider);
  res.json({ ok: true, connectedProviders });
});

app.post("/api/disconnect", requireAuth, (req, res) => {
  const { provider } = req.body || {};
  deleteConnection.run(req.session.userId, provider);
  const connectedProviders = listConnections.all(req.session.userId).map((r) => r.provider);
  res.json({ ok: true, connectedProviders });
});

app.get("/api/logs", requireAuth, (req, res) => {
  const { type } = req.query;
  if (!VALID_LOG_TYPES.includes(type)) {
    return sendError(res, 400, "Unknown Log Type");
  }
  const entries = listLogs.all(req.session.userId, type);
  res.json({ entries });
});

app.post("/api/logs", requireAuth, (req, res) => {
  const { type, label, amount, loggedAt, note } = req.body || {};
  if (!VALID_LOG_TYPES.includes(type)) {
    return sendError(res, 400, "Unknown Log Type");
  }
  if (!loggedAt) {
    return sendError(res, 400, "A Time Is Required");
  }
  const result = insertLog.run(
    req.session.userId,
    type,
    label ? String(label).trim() : null,
    amount != null && amount !== "" ? Number(amount) : null,
    String(loggedAt),
    note ? String(note).trim() : null
  );
  const entries = listLogs.all(req.session.userId, type);
  res.json({ ok: true, id: Number(result.lastInsertRowid), entries });
});

app.delete("/api/logs/:id", requireAuth, (req, res) => {
  deleteLog.run(Number(req.params.id), req.session.userId);
  res.json({ ok: true });
});

app.get("/api/calendar", requireAuth, (req, res) => {
  const source = findCalendarSource.get(req.session.userId) || null;
  const events = listCalendarEvents.all(req.session.userId);

  const dailyLoad = {};
  events.forEach((e) => {
    const day = e.start_at.slice(0, 10);
    dailyLoad[day] = (dailyLoad[day] || 0) + 1;
  });

  res.json({ source, events, dailyLoad });
});

app.post(
  "/api/calendar/connect",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { url } = req.body || {};
    if (!url) {
      return sendError(res, 400, "A calendar URL is required.");
    }

    let text;
    try {
      text = await fetchICS(String(url).trim());
    } catch (err) {
      return sendError(res, 400, err.message || "Could not import that calendar.");
    }

    const events = parseICS(text);

    deleteCalendarEvents.run(req.session.userId);
    events.forEach((e) => {
      insertCalendarEvent.run(req.session.userId, e.title || null, e.start, e.end || null);
    });
    upsertCalendarSource.run(req.session.userId, String(url).trim());

    res.json({ ok: true, count: events.length });
  })
);

app.post("/api/calendar/disconnect", requireAuth, (req, res) => {
  deleteCalendarSource.run(req.session.userId);
  deleteCalendarEvents.run(req.session.userId);
  res.json({ ok: true });
});

app.get("/api/journal", requireAuth, (req, res) => {
  const { date } = req.query;
  if (date) {
    const entry = findJournalEntry.get(req.session.userId, String(date)) || null;
    return res.json({ entry });
  }
  const entries = listJournalEntries.all(req.session.userId);
  res.json({ entries });
});

app.post("/api/journal", requireAuth, (req, res) => {
  const { date, content } = req.body || {};
  if (!date) {
    return sendError(res, 400, "A Date Is Required");
  }
  upsertJournal.run(req.session.userId, String(date), content ? String(content) : "");
  res.json({ ok: true });
});

app.get("/api/checkins", requireAuth, (req, res) => {
  res.json({ entries: listCheckins.all(req.session.userId) });
});

app.post("/api/checkins", requireAuth, (req, res) => {
  const { trainingStress, academicStress, personalStress } = req.body || {};
  if (trainingStress == null || academicStress == null || personalStress == null) {
    return sendError(res, 400, "All three domains are required.");
  }
  insertCheckin.run(req.session.userId, Number(trainingStress), Number(academicStress), Number(personalStress));
  res.json({ ok: true });
});

app.get("/api/insights/computed", requireAuth, (req, res) => {
  const checkins = listCheckins.all(req.session.userId);
  const logs = db.prepare("SELECT * FROM logs WHERE user_id = ?").all(req.session.userId);
  const results = computeCorrelations(checkins, logs);
  res.json({ results, checkinCount: checkins.length });
});

app.get("/api/share", requireAuth, (req, res) => {
  res.json({ links: listShareLinks.all(req.session.userId) });
});

app.post("/api/share", requireAuth, (req, res) => {
  const { label } = req.body || {};
  const token = crypto.randomBytes(12).toString("hex");
  insertShareLink.run(req.session.userId, token, label ? String(label).trim() : null);
  res.json({ ok: true, token });
});

app.post("/api/share/:id/revoke", requireAuth, (req, res) => {
  revokeShareLink.run(Number(req.params.id), req.session.userId);
  res.json({ ok: true });
});

app.get("/api/share/public/:token", (req, res) => {
  const link = findShareLinkByToken.get(req.params.token);
  if (!link) return sendError(res, 404, "This share link is invalid or has been removed.");

  touchShareLink.run(link.id);

  const user = findUserById.get(link.user_id);
  const recent = latestCheckin.get(link.user_id);
  const totalCheckins = listCheckins.all(link.user_id).length;
  const connected = countConnections.get(link.user_id).count;

  let level = null;
  let daysAgo = null;
  if (recent) {
    const values = [recent.training_stress, recent.academic_stress, recent.personal_stress].filter((v) => v != null);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    level = avg <= 2.3 ? "low" : avg <= 3.6 ? "moderate" : "elevated";
    daysAgo = Math.floor((Date.now() - new Date(recent.created_at + "Z").getTime()) / (1000 * 60 * 60 * 24));
  }

  res.json({
    name: user ? user.name.split(" ")[0] : "This athlete",
    hasCheckin: !!recent,
    level,
    daysAgo,
    totalCheckins,
    connectedCount: connected,
    label: link.label,
  });
});

app.get("/api/phases", requireAuth, (req, res) => {
  res.json({ phases: listPhases.all(req.session.userId) });
});

app.post("/api/phases", requireAuth, (req, res) => {
  const { label, startDate, endDate } = req.body || {};
  if (!label || !startDate || !endDate) {
    return sendError(res, 400, "A label, start date, and end date are all required.");
  }
  insertPhase.run(req.session.userId, String(label).trim(), String(startDate), String(endDate));
  res.json({ ok: true });
});

app.delete("/api/phases/:id", requireAuth, (req, res) => {
  deletePhase.run(Number(req.params.id), req.session.userId);
  res.json({ ok: true });
});

app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const usersByRole = db.prepare("SELECT role, COUNT(*) AS count FROM users GROUP BY role").all();
  const totalCheckins = db.prepare("SELECT COUNT(*) AS count FROM checkins").get().count;
  const avgStress = db
    .prepare("SELECT AVG(training_stress) AS training, AVG(academic_stress) AS academic, AVG(personal_stress) AS personal FROM checkins")
    .get();
  const logsByType = db.prepare("SELECT type, COUNT(*) AS count FROM logs GROUP BY type").all();
  const totalJournalEntries = db.prepare("SELECT COUNT(*) AS count FROM journal_entries").get().count;
  const activeShareLinks = db.prepare("SELECT COUNT(*) AS count FROM share_links WHERE revoked = 0").get().count;

  res.json({ usersByRole, totalCheckins, avgStress, logsByType, totalJournalEntries, activeShareLinks });
});

app.use(express.static(path.join(__dirname, "..")));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return sendError(res, 404, "That Endpoint Doesn't Exist");
  }
  res.status(404).sendFile(path.join(__dirname, "..", "404.html"));
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  const rawStatus = err.status || err.statusCode;
  const status = rawStatus >= 400 && rawStatus < 500 ? rawStatus : 500;
  if (req.path.startsWith("/api/")) {
    return sendError(res, status, err.message || "Something went wrong. Please try again.");
  }
  res.status(status).sendFile(path.join(__dirname, "..", status === 500 ? "500.html" : "404.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Myaku running at http://localhost:${PORT}`);
});
