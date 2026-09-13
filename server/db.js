const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const { dataDir } = require("./paths");

const db = new DatabaseSync(path.join(dataDir, "myaku.db"));

/* Write-ahead logging lets the reminder scheduler read while a request writes.
   Foreign keys are enforced so a child row can never outlive its user. */
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /* Baseline context captured once at signup so the psychological channel has
     a reference point on day one instead of waiting a month for one. */
  CREATE TABLE IF NOT EXISTS calibration (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    sport TEXT,
    training_days INTEGER,
    typical_bedtime TEXT,
    baseline_training INTEGER,
    baseline_academic INTEGER,
    baseline_personal INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /* Channel A. One row per day, sourced from a wearable. */
  CREATE TABLE IF NOT EXISTS daily_metrics (
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    hrv_ms REAL,
    rhr_bpm REAL,
    sleep_minutes REAL,
    sleep_efficiency REAL,
    source TEXT,
    PRIMARY KEY (user_id, date)
  );

  /* Channel C. One row per completed vigilance session. */
  CREATE TABLE IF NOT EXISTS pvt_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    duration_ms INTEGER,
    n_trials INTEGER,
    mean_rt REAL,
    median_rt REAL,
    mean_reciprocal REAL,
    sd_rt REAL,
    sem_rt REAL,
    lapses INTEGER,
    false_starts INTEGER,
    caffeine_minutes_prior INTEGER,
    valid INTEGER NOT NULL DEFAULT 1
  );

  /* Channel P, daily tier. Load and recovery are separate axes, and the affect
     grid stores valence and arousal as the circumplex coordinates. */
  CREATE TABLE IF NOT EXISTS daily_checkins (
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    load_0_10 INTEGER,
    recovery_0_10 INTEGER,
    valence REAL,
    arousal REAL,
    attribution TEXT,
    prompted_at TEXT,
    responded_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, date)
  );

  /* Channel P, weekly tier. Demand, control, and feeling per domain. */
  CREATE TABLE IF NOT EXISTS weekly_checkins (
    user_id INTEGER NOT NULL REFERENCES users(id),
    week_start TEXT NOT NULL,
    demand_training INTEGER, control_training INTEGER, feeling_training INTEGER,
    demand_academic INTEGER, control_academic INTEGER, feeling_academic INTEGER,
    demand_personal INTEGER, control_personal INTEGER, feeling_personal INTEGER,
    sleep_satisfaction INTEGER,
    social_connection INTEGER,
    emotions TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, week_start)
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    user_id INTEGER NOT NULL REFERENCES users(id),
    entry_date TEXT NOT NULL,
    content TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, entry_date)
  );

  /* Caffeine is not a channel input. It is a utility, and a covariate that
     explains away a vigilance session the athlete dosed before taking. */
  CREATE TABLE IF NOT EXISTS caffeine_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    label TEXT,
    mg REAL,
    logged_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS phases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    label TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS integrations (
    user_id INTEGER NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_synced_at TEXT,
    PRIMARY KEY (user_id, provider)
  );

  CREATE TABLE IF NOT EXISTS share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE,
    label TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_viewed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_pvt_user_date ON pvt_sessions(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_caffeine_user_date ON caffeine_logs(user_id, date);
`);

/* Columns added after the first schema shipped. SQLite has no IF NOT EXISTS for
   a column, so each one is attempted and the duplicate error is swallowed. */
function addColumn(table, definition) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch {
    /* already added on a previous run */
  }
}

/* How eagerly the model should speak up. Some people want a nudge the moment
   something drifts; others only want to hear about a large, sustained problem. */
addColumn("users", "sensitivity TEXT NOT NULL DEFAULT 'medium'");

/* The daily tier grew from two sliders into three two-axis pads. Control and
   focus come from those pads at no extra cost in taps, and both earn their
   place: control is the half of demand that decides whether load is stressful,
   and focus is the felt version of what the vigilance test measures, which is
   what makes the brain-against-life gap mean something specific. */
addColumn("daily_checkins", "control_0_10 INTEGER");
addColumn("daily_checkins", "focus_0_10 INTEGER");
addColumn("daily_checkins", "motivation_0_10 INTEGER");

/* Deliberately kept out of the psychological channel. Subjective sleep quality
   exists to be compared against what the wearable recorded, and a number cannot
   be one side of a comparison and an input to the other side at once. */
addColumn("daily_checkins", "sleep_quality_0_10 INTEGER");

/* Athlete Burnout Questionnaire dimensions, one item each, asked weekly.
   Exhaustion, reduced sense of accomplishment, and devaluation of the sport are
   separable: an athlete can be exhausted and still love the game, and the
   reverse is the one nobody notices in time. */
addColumn("weekly_checkins", "abq_exhaustion INTEGER");
addColumn("weekly_checkins", "abq_accomplishment INTEGER");
addColumn("weekly_checkins", "abq_devaluation INTEGER");

/* How a journal entry reaches the psychological channel. The rating is typed by
   the person, on the same grid the daily check-in uses. Nothing reads the text,
   because inferring mood from someone's private writing is not a claim this app
   is in a position to make. */
addColumn("journal_entries", "valence REAL");
addColumn("journal_entries", "arousal REAL");
addColumn("journal_entries", "domains TEXT");

/* Onboarding, so a new account lands on the welcome flow and the demo does not. */
addColumn("users", "onboarded_at TEXT");
addColumn("integrations", "last_error TEXT");
addColumn("integrations", "rows_imported INTEGER");

db.exec(`
  /* Sessions survive a restart instead of signing everybody out. */
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);

  /* OAuth tokens, encrypted at rest. The columns hold ciphertext, never tokens. */
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    user_id INTEGER NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at INTEGER,
    scope TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, provider)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reminder_prefs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    enabled INTEGER NOT NULL DEFAULT 0,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    pvt_time TEXT NOT NULL DEFAULT '07:30',
    pvt_days TEXT NOT NULL DEFAULT '1,3,5',
    checkin_time TEXT NOT NULL DEFAULT '21:00',
    weekly_day INTEGER NOT NULL DEFAULT 0,
    weekly_time TEXT NOT NULL DEFAULT '19:00',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /* One row per reminder actually sent, so a reminder fires once a day at most. */
  CREATE TABLE IF NOT EXISTS reminder_log (
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,
    local_date TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, kind, local_date)
  );
`);

/* Every table holding a user's data, in an order that satisfies the foreign keys
   when deleting. Kept here, next to the schema, so a new table cannot be added
   without somebody noticing that account deletion has to know about it. */
db.USER_TABLES = [
  "calibration", "daily_metrics", "pvt_sessions", "daily_checkins", "weekly_checkins",
  "journal_entries", "caffeine_logs", "phases", "integrations", "share_links",
  "oauth_tokens", "push_subscriptions", "reminder_prefs", "reminder_log",
];

module.exports = db;
