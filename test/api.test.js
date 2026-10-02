/* End-to-end tests against a real server and a real database. These are the
   guarantees that matter most: data cannot leak, requests cannot be forged, and
   bad input cannot reach a baseline. */

const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, client } = require("./helpers");

let ctx;
const PASSWORD = "correct horse battery";

test.before(async () => {
  ctx = await startServer();
});

test.after(() => {
  ctx.server.close();
});

async function signedIn(email = `athlete${Math.random().toString(36).slice(2)}@example.com`) {
  const c = client(ctx.base);
  const r = await c.post("/api/signup", { name: "Test Athlete", email, password: PASSWORD });
  assert.equal(r.status, 200, r.text);
  return { c, email };
}

test("caffeine insights pair a logged day with the next night and keep the bedtime", async () => {
  const { c } = await signedIn();
  const today = new Date().toISOString().slice(0, 10);
  const headers = { "X-Local-Date": today };

  const empty = await c.get("/api/caffeine/insights", { headers });
  assert.equal(empty.status, 200, empty.text);
  assert.equal(empty.json.bedtime, "23:00");
  assert.equal(empty.json.hasBodyData, false);

  assert.equal((await c.post("/api/calibration/bedtime", { bedtime: "late" })).status, 400);
  assert.equal((await c.post("/api/calibration/bedtime", { bedtime: "22:30" })).status, 200);

  await c.post("/api/caffeine", { label: "Coffee", mg: 95, loggedAt: "15:00" }, { headers });
  const tomorrow = new Date(Date.parse(today + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
  const stored = await c.post("/api/metrics", { days: [{ date: tomorrow, sleepMinutes: 430, sleepEfficiency: 90 }] });
  assert.equal(stored.json.stored, 1, stored.text);

  const r = await c.get("/api/caffeine/insights", { headers });
  assert.equal(r.json.bedtime, "22:30");
  assert.equal(r.json.hasBodyData, true);
  assert.equal(r.json.pairedNights, 1);
  // 95 mg seven and a half hours before bed is one and a half half-lives.
  assert.equal(r.json.nights[0].bedMg, 33.6);
  assert.equal(r.json.nights[0].zone, "borderline");
  assert.equal(r.json.nights[0].sleepMinutes, 430);

  const stranger = await client(ctx.base).get("/api/caffeine/insights");
  assert.equal(stranger.status, 401);
});

test("the body reading carries sleep times and a saved sleep goal", async () => {
  const { c } = await signedIn();

  const empty = await c.get("/api/body");
  assert.equal(empty.status, 200, empty.text);
  assert.equal(empty.json.goal, 480);
  assert.equal(empty.json.hasData, false);

  assert.equal((await c.post("/api/calibration/sleep-goal", { minutes: "soon" })).status, 400);
  assert.equal((await c.post("/api/calibration/sleep-goal", { minutes: 540 })).status, 200);

  const stored = await c.post("/api/metrics", {
    days: [
      { date: "2026-09-01", sleepMinutes: 450, sleepEfficiency: 90, sleepStart: "2026-08-31 23:10", sleepEnd: "2026-09-01 07:30" },
      // Times that run backwards are dropped, and the rest of the night is kept.
      { date: "2026-09-02", sleepMinutes: 440, sleepStart: "2026-09-02 07:00", sleepEnd: "2026-09-01 23:00" },
    ],
  });
  assert.equal(stored.json.stored, 2, stored.text);

  const { json } = await c.get("/api/metrics");
  assert.equal(json.days[0].sleep_start, "2026-08-31 23:10");
  assert.equal(json.days[0].sleep_end, "2026-09-01 07:30");
  assert.equal(json.days[1].sleep_start, null);
  assert.equal(json.days[1].sleep_minutes, 440);

  const r = await c.get("/api/body");
  assert.equal(r.json.goal, 540);
  assert.equal(r.json.sleep.week.nights, 2);
});

test("brain and life readings load, and a reaction test keeps its device and local time", async () => {
  const { c } = await signedIn();
  assert.equal((await c.get("/api/brain")).json.hasData, false);
  assert.equal((await c.get("/api/life")).json.hasData, false);

  const saved = await c.post(
    "/api/pvt",
    { durationMs: 180000, nTrials: 40, meanRt: 270, medianRt: 262, meanReciprocal: 3.8, sdRt: 60, semRt: 9.5, lapses: 1, falseStarts: 0, device: "iPhone · Touch · 120 Hz" },
    { headers: { "X-Local-Time": "07:45" } }
  );
  assert.equal(saved.status, 200, saved.text);

  const { json } = await c.get("/api/pvt");
  assert.equal(json.sessions[0].device, "iPhone · Touch · 120 Hz");
  assert.equal(json.sessions[0].local_time, "07:45");

  const brain = await c.get("/api/brain");
  assert.equal(brain.json.hasData, true);
  assert.equal(brain.json.week.sessions, 1);

  const div = await c.get("/api/divergence");
  assert.ok(div.json.anchor);
  assert.deepEqual(Object.keys(div.json.channels.cognitive.parts).sort(), ["lapses", "speed"]);
});

test("the season timeline loads for a new athlete and after a first check-in", async () => {
  const { c } = await signedIn();
  const empty = await c.get("/api/trends");
  assert.equal(empty.status, 200, empty.text);
  assert.equal(empty.json.hasData, false);

  const today = new Date().toISOString().slice(0, 10);
  await c.post("/api/checkin/daily", { date: today, load: 5, control: 6 }, { headers: { "X-Local-Date": today } });
  const r = await c.get("/api/trends", { headers: { "X-Local-Date": today } });
  assert.equal(r.json.hasData, true);
  assert.equal(r.json.weeks.length, 1);
  assert.equal(r.json.weeks[0].state, null);
});

test("health check responds", async () => {
  const r = await client(ctx.base).get("/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test("nothing outside the public allowlist is served", async () => {
  const c = client(ctx.base);
  for (const p of ["/data/myaku.db", "/data/secret.key", "/server/index.js", "/package.json", "/.env", "/node_modules/express/package.json", "/scripts/seed-demo.js", "/test/api.test.js"]) {
    const r = await c.get(p);
    assert.equal(r.status, 404, `${p} should not be served`);
  }
  const page = await c.get("/index.html");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
});

test("state-changing requests without this origin are refused", async () => {
  const c = client(ctx.base);
  const noOrigin = await c.request("POST", "/api/signup", { body: { name: "X", email: "x@example.com", password: PASSWORD }, origin: false });
  assert.equal(noOrigin.status, 403);
  const forged = await c.request("POST", "/api/signup", {
    body: { name: "X", email: "x@example.com", password: PASSWORD },
    origin: false,
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(forged.status, 403);
});

test("signup rejects weak passwords and sends new accounts to onboarding", async () => {
  const c = client(ctx.base);
  const weak = await c.post("/api/signup", { name: "A", email: "weak@example.com", password: "password123" });
  assert.equal(weak.status, 400);

  const { c: fresh } = await signedIn();
  const me = await fresh.get("/api/me");
  assert.equal(me.json.user.onboarded, false);
  await fresh.post("/api/onboarding/complete", {});
  const after = await fresh.get("/api/me");
  assert.equal(after.json.user.onboarded, true);
});

test("a wrong password gets a readable message, and sign-in issues a new session id", async () => {
  const { c, email } = await signedIn();
  const before = c.cookie();
  await c.post("/api/logout", {});

  const wrong = await c.post("/api/login", { email, password: "not the password" });
  assert.equal(wrong.status, 401);
  assert.match(wrong.json.error, /incorrect/);

  const ok = await c.post("/api/login", { email, password: PASSWORD });
  assert.equal(ok.status, 200);
  assert.notEqual(c.cookie(), before);
});

test("daily check-ins clamp out-of-range answers and refuse old dates", async () => {
  const { c } = await signedIn();
  const r = await c.post("/api/checkin/daily", { load: 99, control: -5, valence: 3 });
  assert.equal(r.status, 200);
  const got = await c.get("/api/checkin/daily");
  assert.equal(got.json.entry.load_0_10, 10);
  assert.equal(got.json.entry.control_0_10, 0);
  assert.equal(got.json.entry.valence, 1);

  const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const stale = await c.post("/api/checkin/daily", { date: old, load: 5, control: 5 });
  assert.equal(stale.status, 400);
});

test("the athlete's local date is used instead of the server's", async () => {
  const { c } = await signedIn();
  const yesterday = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const headers = { "X-Local-Date": yesterday };
  await c.request("POST", "/api/pvt", {
    headers,
    body: { nTrials: 40, meanRt: 280, medianRt: 275, meanReciprocal: 3.6, sdRt: 60, semRt: 9, lapses: 1 },
  });
  const pvt = await c.request("GET", "/api/pvt", { headers });
  assert.equal(pvt.json.todayCount, 1);
  assert.equal(pvt.json.sessions[0].date, yesterday);
});

test("implausible body data is skipped rather than stored", async () => {
  const { c } = await signedIn();
  const r = await c.post("/api/metrics", {
    source: "csv",
    days: [
      { date: "2026-09-01", hrv: 64, rhr: 52, sleepMinutes: 440, sleepEfficiency: 91 },
      { date: "2026-09-02", hrv: 5000, rhr: 52 },
      { date: "not-a-date", hrv: 60 },
    ],
  });
  assert.equal(r.json.stored, 1);
  assert.equal(r.json.skipped, 2);
});

test("an Apple Health export streams in, and a zipped one is refused", async () => {
  const { c } = await signedIn();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<HealthData>",
    ' <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Watch" unit="ms" startDate="2026-09-02 06:00:00 -0500" endDate="2026-09-02 06:01:00 -0500" value="48"/>',
    ' <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Watch" unit="count/min" startDate="2026-09-02 00:00:00 -0500" endDate="2026-09-02 23:59:00 -0500" value="53"/>',
    ' <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-09-01 23:30:00 -0500" endDate="2026-09-02 06:30:00 -0500" value="HKCategoryValueSleepAnalysisAsleepCore"/>',
    "</HealthData>",
  ].join("\n");
  const r = await c.request("POST", "/api/import/apple-health", { raw: xml, headers: { "Content-Type": "application/xml" } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.days, 1);

  const zip = await c.request("POST", "/api/import/apple-health", { raw: "PK", headers: { "Content-Type": "application/zip" } });
  assert.equal(zip.status, 415);
});

test("unconfigured providers say so instead of pretending to connect", async () => {
  const { c } = await signedIn();
  const list = await c.get("/api/integrations");
  const whoop = list.json.providers.find((p) => p.id === "whoop");
  assert.equal(whoop.available, false);
  const start = await c.get("/api/integrations/whoop/start");
  assert.equal(start.status, 302);
  assert.match(start.headers.get("location"), /error=not-configured/);
});

test("reminders validate their schedule and export a calendar", async () => {
  const { c } = await signedIn();
  await c.post("/api/reminders", { enabled: true, pvtTime: "25:99", pvtDays: [1, 3, 9], timezone: "Not/AZone" });
  const r = await c.get("/api/reminders");
  assert.equal(r.json.prefs.pvtTime, "07:30");
  assert.deepEqual(r.json.prefs.pvtDays, [1, 3]);
  assert.equal(r.json.prefs.timezone, "UTC");

  const ics = await c.get("/api/reminders/calendar.ics");
  assert.match(ics.headers.get("content-type"), /text\/calendar/);
  assert.match(ics.text, /BEGIN:VCALENDAR/);

  const badSub = await c.post("/api/push/subscribe", { subscription: { endpoint: "http://insecure.example", keys: { p256dh: "a", auth: "b" } } });
  assert.equal(badSub.status, 400);
});

test("the data export holds the athlete's data and never the password hash", async () => {
  const { c } = await signedIn();
  await c.post("/api/checkin/daily", { load: 4, control: 7 });
  const r = await c.get("/api/account/export");
  assert.equal(r.status, 200);
  assert.equal(r.json.daily_checkins.length, 1);
  assert.doesNotMatch(r.text, /password_hash/);
});

test("deleting an account needs the password and removes everything", async () => {
  const { c } = await signedIn();
  await c.post("/api/checkin/daily", { load: 4, control: 7 });
  const wrong = await c.post("/api/account/delete", { password: "nope" });
  assert.equal(wrong.status, 403);
  const ok = await c.post("/api/account/delete", { password: PASSWORD });
  assert.equal(ok.status, 200);
  const me = await c.get("/api/me");
  assert.equal(me.status, 401);
});

test("repeated failed sign-ins are rate limited", async () => {
  const c = client(ctx.base);
  let last;
  for (let i = 0; i < 11; i++) {
    last = await c.post("/api/login", { email: "nobody@example.com", password: "wrong password" });
  }
  assert.equal(last.status, 429);
  assert.ok(last.headers.get("retry-after"));
});

test("setup saves a profile and a baseline in one call", async () => {
  const { c } = await signedIn();
  const saved = await c.post("/api/setup", {
    audience: "highschool",
    seasonPhase: "inseason",
    sport: "Swimming",
    trainingDays: 6,
    typicalBedtime: "22:15",
    wakeTime: "06:15",
    sleepGoalMinutes: 540,
    baselineTraining: 5,
    baselineAcademic: 6,
    baselinePersonal: 3,
  });
  assert.equal(saved.status, 200, saved.text);

  const me = await c.get("/api/me");
  const cal = me.json.calibration;
  assert.equal(cal.audience, "highschool");
  assert.equal(cal.season_phase, "inseason");
  assert.equal(cal.sport, "Swimming");
  assert.equal(cal.training_days, 6);
  assert.equal(cal.typical_bedtime, "22:15");
  assert.equal(cal.wake_time, "06:15");
  assert.equal(cal.sleep_goal_minutes, 540);
  assert.equal(cal.baseline_academic, 6);

  /* An audience outside the list is dropped rather than stored. */
  await c.post("/api/setup", { audience: "astronaut", sport: "Swimming" });
  assert.equal((await c.get("/api/me")).json.calibration.audience, null);
});

test("a pasted calendar becomes typed events, and importing again does not double them", async () => {
  const { c } = await signedIn();
  const soon = (days) => {
    const d = new Date(Date.now() + days * 86400000);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  };
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:game-1",
    `DTSTART:${soon(3)}T190000`,
    "SUMMARY:Soccer vs Rival",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:exam-1",
    `DTSTART;VALUE=DATE:${soon(4)}`,
    "SUMMARY:BIO 204 Midterm",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const first = await c.post("/api/calendar/import", { text: ics });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.count, 2);
  assert.equal(first.json.counts.game, 1);
  assert.equal(first.json.counts.exam, 1);

  const again = await c.post("/api/calendar/import", { text: ics });
  assert.equal(again.json.count, 2);
  assert.equal((await c.get("/api/events")).json.events.length, 2);

  assert.equal((await c.post("/api/calendar/import", {})).status, 400);
  assert.equal((await c.post("/api/calendar/import", { text: "BEGIN:VCALENDAR\r\nEND:VCALENDAR" })).status, 400);
});

test("events can be added and removed by hand, and the schedule reads the weeks ahead", async () => {
  const { c } = await signedIn();
  const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  assert.equal((await c.post("/api/events", { kind: "game" })).status, 400);
  assert.equal((await c.post("/api/events", { date: inDays(2), kind: "game", title: "Home Opener" })).status, 200);
  assert.equal((await c.post("/api/events", { date: inDays(3), kind: "nonsense", title: "Something" })).status, 200);

  const list = await c.get("/api/events");
  assert.equal(list.json.events.length, 2);
  assert.equal(list.json.events.find((e) => e.title === "Something").kind, "other");

  const season = await c.get("/api/schedule");
  assert.equal(season.status, 200, season.text);
  assert.equal(season.json.weeks.length, 4);
  assert.equal(season.json.weeks[0].counts.game, 1);

  await c.del("/api/events/" + list.json.events[0].id);
  assert.equal((await c.get("/api/events")).json.events.length, 1);
});

test("the assistant stays off until it is turned on, and never answers without a key", async () => {
  const { c } = await signedIn();
  const shut = await c.post("/api/assistant", { question: "What is my pattern?" });
  assert.equal(shut.status, 403);

  const before = await c.get("/api/assistant/status");
  assert.equal(before.status, 200, before.text);
  assert.equal(before.json.enabled, false);
  assert.equal(before.json.provider, "none");

  assert.equal((await c.post("/api/assistant/consent", { enabled: true })).status, 200);
  assert.ok((await c.get("/api/me")).json.user.assistant_opt_in);
  assert.equal((await c.get("/api/assistant/status")).json.enabled, true);

  const answered = await c.post("/api/assistant", { question: "What changed this week?" });
  assert.equal(answered.status, 200, answered.text);
  assert.equal(answered.json.model, null);
  assert.match(answered.json.answer, /not switched on/);

  assert.equal((await c.post("/api/assistant", { question: "" })).status, 400);

  await c.post("/api/assistant/consent", { enabled: false });
  assert.equal((await c.post("/api/assistant", { question: "Anything?" })).status, 403);
});

test("the journal asks before its ratings reach the Life channel", async () => {
  const { c } = await signedIn();
  const today = new Date().toISOString().slice(0, 10);
  const headers = { "X-Local-Date": today };

  const first = await c.get("/api/journal/insights", { headers });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.asked, false);
  assert.equal(first.json.counted, false);
  assert.ok(first.json.prompts.length >= 5);

  const saved = await c.post("/api/journal", { date: today, content: "Long day, two sessions and a late bus.", mode: "performance", valence: -0.4 }, { headers });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.insight.mode, "performance");
  assert.equal(saved.json.insight.words, 8);

  /* Until they answer, the rating stays out of the channel. */
  const before = await c.get("/api/life", { headers });
  assert.equal(before.status, 200);

  assert.equal((await c.post("/api/journal/consent", { counted: true })).status, 200);
  const after = await c.get("/api/journal/insights", { headers });
  assert.equal(after.json.counted, true);
  assert.equal(after.json.asked, true);
  assert.equal(after.json.total, 1);
  assert.equal(after.json.streak, 1);

  await c.post("/api/journal/consent", { counted: false });
  assert.equal((await c.get("/api/journal/insights", { headers })).json.counted, false);

  /* An unknown prompt falls back rather than being stored as given. */
  await c.post("/api/journal", { date: today, content: "Again.", mode: "nonsense" }, { headers });
  assert.equal((await c.get("/api/journal", { headers })).json.entries[0].mode, "free");
});
