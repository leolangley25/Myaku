/* Reading journal entries on this machine: what a reading may contain, how it
   reaches the Life channel, and that nothing reaches it without the athlete's
   say. A stand-in for Ollama answers in place of a real model, so these tests
   decide exactly what the model "read". */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const reader = require("../server/reader");
const journal = require("../server/journal");
const { compute } = require("../server/divergence");

const PASSWORD = "correct horse battery staple 42";

/* ---------------- the reading itself ---------------- */

test("a reading keeps only the allowed words and drops everything else", () => {
  const r = reader.normalize({
    mood: "Low", energy: "drained", pressure: "heavy", say: "none",
    about: ["school", "training", "school", "aliens"],
    signs: ["exhausted", "depressed"],
    lifts: ["support"],
    summary: "  A long   week of exams and doubles. ",
    unsafe: "yes",
  });
  assert.equal(r.mood, "low");
  assert.deepEqual(r.about, ["school", "training"]);
  assert.deepEqual(r.signs, ["exhausted"]);
  assert.equal(r.summary, "A long week of exams and doubles.");
  assert.equal(r.unsafe, false, "only a real true counts as unsafe");

  assert.equal(reader.normalize({ about: ["school"] }), null, "nothing to read a day from");
  assert.equal(reader.parse("not json"), null);
});

test("a heavy entry reads heavier than a light one, and help takes a little back", () => {
  const heavy = reader.normalize({ mood: "very low", pressure: "overwhelming", say: "none", signs: ["exhausted", "caring_less"], about: [], lifts: [] });
  const light = reader.normalize({ mood: "good", pressure: "light", say: "most of it", signs: [], about: [], lifts: [] });
  const helped = reader.normalize({ mood: "very low", pressure: "overwhelming", say: "none", signs: ["exhausted", "caring_less"], about: [], lifts: ["support", "rest"] });
  assert.ok(reader.heaviness(heavy) > 0.9, `heavy ${reader.heaviness(heavy)}`);
  assert.ok(reader.heaviness(light) < 0.25, `light ${reader.heaviness(light)}`);
  assert.ok(reader.heaviness(helped) < reader.heaviness(heavy));

  const n = reader.numbers(light);
  assert.equal(n.valence, 0.5);
  assert.equal(n.control, 1);
  assert.equal(reader.numbers(reader.normalize({ mood: "mixed", say: "not mentioned" })).control, null);
});

test("a correction only changes what was touched and stays inside the allowed words", () => {
  const base = reader.normalize({ mood: "low", energy: "tired", pressure: "heavy", say: "none", about: ["school"], signs: ["exhausted"], lifts: [], summary: "Exams.", unsafe: false });
  const next = reader.amend(base, { mood: "good", pressure: "furious", signs: [], about: ["school", "family", "made up"] });
  assert.equal(next.mood, "good");
  assert.equal(next.pressure, "heavy", "an unknown word keeps what was there");
  assert.deepEqual(next.signs, []);
  assert.deepEqual(next.about, ["school", "family"]);
  assert.equal(next.energy, "tired");
});

/* ---------------- what the writing keeps returning to ---------------- */

const day = (offset) => new Date(Date.parse("2026-09-30T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
const entry = (offset, reading, valence = null) => ({ entry_date: day(offset), valence, reading: reader.normalize(reading) });

test("themes compare the last two weeks with the six before, as shares", () => {
  const entries = [
    entry(-30, { mood: "good", pressure: "light", about: ["training"], signs: [], lifts: ["enjoyment"] }),
    entry(-25, { mood: "good", pressure: "light", about: ["training"], signs: [], lifts: [] }),
    entry(-5, { mood: "low", pressure: "heavy", about: ["school"], signs: ["exhausted"], lifts: [] }),
    entry(-3, { mood: "low", pressure: "heavy", about: ["school", "training"], signs: ["exhausted"], lifts: [] }),
    entry(-1, { mood: "very low", pressure: "overwhelming", about: ["school"], signs: [], lifts: [] }),
  ];
  const t = journal.themes(entries, day(0));
  assert.equal(t.recent, 3);
  assert.equal(t.before, 2);
  const school = t.about.find((x) => x.key === "school");
  assert.equal(school.recent, 3);
  assert.equal(school.recentShare, 1);
  assert.equal(school.beforeShare, 0);
  assert.equal(t.signs.find((x) => x.key === "exhausted").recent, 2);
  assert.ok(t.weekly.length >= 2);
  assert.equal(t.agreement, null, "too few rated days to compare");
});

/* ---------------- the channel ---------------- */

test("writing joins the Life channel as its own part, and only when read", () => {
  const journalRows = [];
  for (let w = 10; w >= 1; w--) {
    const heavy = w <= 2;
    journalRows.push(entry(-7 * w, {
      mood: heavy ? "very low" : "good",
      pressure: heavy ? "overwhelming" : "light",
      say: heavy ? "none" : "some",
      signs: heavy ? ["exhausted", "not_achieving"] : [],
      about: [], lifts: [],
    }));
  }
  const withReading = compute({ journal: journalRows, today: day(0) });
  const z = withReading.channels.psychological.parts.writing;
  assert.ok(z != null && z > 1, `writing z ${z}`);

  const unread = compute({ journal: journalRows.map((e) => ({ ...e, reading: null })), today: day(0) });
  assert.equal(unread.channels.psychological.parts.writing, null);
});

/* ---------------- the API, against a stand-in model ---------------- */

const ctx = {};
let calls = 0;

test.before(async () => {
  ctx.fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "stand-in:1b" }] }));
      calls += 1;
      const sent = JSON.parse(body || "{}");
      const text = String(sent.messages[sent.messages.length - 1].content);
      const heavy = /brutal|exam/i.test(text);
      res.end(JSON.stringify({
        message: {
          role: "assistant",
          content: JSON.stringify({
            mood: heavy ? "low" : "good", energy: "tired", pressure: heavy ? "heavy" : "light", say: "none",
            about: heavy ? ["training", "school"] : ["friends"], signs: heavy ? ["exhausted"] : [], lifts: [],
            summary: heavy ? "A brutal practice and an exam." : "A quiet day with friends.", unsafe: false,
          }),
        },
      }));
    });
  });
  await new Promise((r) => ctx.fake.listen(0, "127.0.0.1", r));
  const { startServer, client } = require("./helpers");
  ctx.client = client;
  Object.assign(ctx, await startServer({ localUrl: `http://127.0.0.1:${ctx.fake.address().port}` }));
});

test.after(() => {
  ctx.server.close();
  ctx.fake.close();
});

async function signedIn() {
  const c = ctx.client(ctx.base);
  const r = await c.post("/api/signup", { name: "Test Athlete", email: `reader${Math.random().toString(36).slice(2)}@example.com`, password: PASSWORD });
  assert.equal(r.status, 200, r.text);
  return c;
}

const today = new Date().toISOString().slice(0, 10);
const headers = { "X-Local-Date": today };
const LONG = "Practice was brutal and coach ran us for an hour after, then I had an exam I barely studied for and I am wiped out.";

test("nothing is read until the athlete chooses reading", async () => {
  const c = await signedIn();
  await c.post("/api/journal", { date: today, content: LONG }, { headers });

  const before = calls;
  assert.equal((await c.post("/api/journal/read", { date: today }, { headers })).status, 403);
  await c.post("/api/journal/consent", { level: "rating" });
  assert.equal((await c.post("/api/journal/read", { date: today }, { headers })).status, 403);
  assert.equal(calls, before, "the model was never asked");

  const insights = await c.get("/api/journal/insights", { headers });
  assert.equal(insights.json.level, "rating");
  assert.equal(insights.json.counted, true);
  assert.equal(insights.json.reader.available, true);
  assert.equal(insights.json.themes, null);
});

test("with reading on, a saved entry is read, shown back, correctable, and can be left out", async () => {
  const c = await signedIn();
  await c.post("/api/journal/consent", { level: "words" });

  const saved = await c.post("/api/journal", { date: today, content: LONG }, { headers });
  assert.equal(saved.json.toRead, true);

  const read = await c.post("/api/journal/read", { date: today }, { headers });
  assert.equal(read.status, 200, read.text);
  assert.equal(read.json.reading.pressure, "heavy");
  assert.deepEqual(read.json.reading.about, ["training", "school"]);

  const got = await c.get("/api/journal?date=" + today, { headers });
  assert.equal(got.json.entry.reading.summary, "A brutal practice and an exam.");
  assert.equal(got.json.entry.read_json, undefined, "the stored form is not sent twice");

  const life = await c.get("/api/life", { headers });
  assert.equal(life.json.journalLevel, "words");
  assert.equal(life.json.writing.recent, 1);
  assert.equal(life.json.writing.about[0].key, "training");

  /* A correction is the athlete's, and survives saving the same text again. */
  const fixed = await c.request("PUT", "/api/journal/reading", { body: { date: today, edits: { pressure: "moderate", signs: [] } }, headers });
  assert.equal(fixed.status, 200, fixed.text);
  assert.equal(fixed.json.entry.reading.pressure, "moderate");
  assert.equal(fixed.json.entry.read_edited, 1);
  const again = await c.post("/api/journal", { date: today, content: LONG }, { headers });
  assert.equal(again.json.toRead, false);
  assert.equal(again.json.reading.pressure, "moderate");

  /* Changing the words clears the old reading, so it is read fresh. */
  const changed = await c.post("/api/journal", { date: today, content: "A quiet day with friends after a long week, and finally some proper rest." }, { headers });
  assert.equal(changed.json.toRead, true);

  /* Left out, it stops counting but stays visible to its author. */
  await c.post("/api/journal/read", { date: today }, { headers });
  const left = await c.request("PUT", "/api/journal/reading", { body: { date: today, excluded: true }, headers });
  assert.equal(left.json.entry.read_excluded, 1);
  assert.ok(!(await c.get("/api/life", { headers })).json.writing);

  /* Turning reading off takes every reading out of the channel at once. */
  await c.request("PUT", "/api/journal/reading", { body: { date: today, excluded: false }, headers });
  assert.equal((await c.get("/api/life", { headers })).json.writing.recent, 1);
  await c.post("/api/journal/consent", { level: "rating" });
  assert.ok(!(await c.get("/api/life", { headers })).json.writing);
});

test("short entries are not read, and earlier entries are read a few at a time", async () => {
  const c = await signedIn();
  await c.post("/api/journal/consent", { level: "words" });

  const short = await c.post("/api/journal", { date: today, content: "Tired." }, { headers });
  assert.equal(short.json.toRead, false);
  assert.equal((await c.post("/api/journal/read", { date: today }, { headers })).json.reason, "short");

  for (let i = 1; i <= 4; i++) {
    const date = new Date(Date.parse(today + "T00:00:00Z") - i * 86400000).toISOString().slice(0, 10);
    await c.post("/api/journal", { date, content: LONG + " Day " + i + "." }, { headers });
  }
  assert.equal((await c.get("/api/journal/insights", { headers })).json.reader.unread, 4);

  const first = await c.post("/api/journal/read-back", {}, { headers });
  assert.equal(first.json.read, 3);
  assert.equal(first.json.remaining, 1);
  const second = await c.post("/api/journal/read-back", {}, { headers });
  assert.equal(second.json.read, 1);
  assert.equal(second.json.remaining, 0);
});
