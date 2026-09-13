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
