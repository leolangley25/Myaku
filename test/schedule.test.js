const test = require("node:test");
const assert = require("node:assert/strict");

const schedule = require("../server/schedule");
const assistant = require("../server/assistant");

const day = (offset, base = "2026-09-21") =>
  new Date(Date.parse(base + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);

const event = (offset, kind, extra = {}) => ({ date: day(offset), kind, title: kind, ...extra });

test("a calendar entry is typed from what it is called", () => {
  assert.equal(schedule.classify("Away @ Tampa"), "travel");
  assert.equal(schedule.classify("Men's Soccer vs Drury"), "game");
  assert.equal(schedule.classify("BIO 204 Midterm"), "exam");
  assert.equal(schedule.classify("Essay due"), "deadline");
  assert.equal(schedule.classify("Team practice"), "practice");
  assert.equal(schedule.classify("Lift"), "lift");
  assert.equal(schedule.classify("CHEM 101 Lecture"), "class");
  assert.equal(schedule.classify("Haircut"), "other");
  /* An exam beats a class, because the title says both. */
  assert.equal(schedule.classify("Lecture then midterm"), "exam");
});

test("importing keeps one row per entry and drops what is out of season", () => {
  const now = new Date("2026-09-21T12:00:00Z");
  const events = schedule.importEvents(
    [
      { start: "2026-09-25", title: "Game vs State", uid: "a" },
      { start: "2026-09-25", title: "Game vs State", uid: "a" },
      { start: "2019-01-01", title: "Old practice", uid: "b" },
      { start: "not a date", title: "Broken", uid: "c" },
      { start: "2026-10-02T19:30:00", end: "2026-10-02T21:30:00", title: "Away @ Rival", uid: "d" },
    ],
    { now }
  );

  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "game");
  assert.equal(events[1].kind, "travel");
  assert.equal(events[1].startTime, "19:30");
  assert.equal(events[1].endDate, null);
});

test("a week's load counts what lands in it, weighted by what it costs", () => {
  const events = [event(2, "game"), event(3, "exam"), event(4, "practice"), event(30, "game")];
  const load = schedule.weekLoad(events, day(1), day(7));
  assert.equal(load.counts.game, 1);
  assert.equal(load.counts.exam, 1);
  assert.ok(load.score > 6 && load.score < 7.5);
  assert.equal(load.hardDays, 2);
});

test("a multi-day trip lands on every day it covers", () => {
  const trip = { date: day(2), endDate: day(4), kind: "travel", title: "Road trip" };
  assert.equal(schedule.weekLoad([trip], day(1), day(7)).counts.travel, 3);
});

test("a squeeze is both heavy and heavier than this athlete's usual week", () => {
  const events = [];
  /* Eight ordinary weeks behind: one game and two practices each. */
  for (let w = 1; w <= 8; w++) {
    events.push(event(-7 * w, "game"), event(-7 * w + 1, "practice"), event(-7 * w + 2, "practice"));
  }
  /* The third week ahead stacks games, travel and exams. */
  events.push(event(3, "practice"), event(16, "game"), event(17, "travel"), event(18, "exam"), event(19, "exam"));

  const season = schedule.season({ events, metrics: [], today: day(0) });
  assert.equal(season.weeks.length, 4);
  assert.ok(season.typical.score > 0);
  assert.equal(season.weeks[0].squeeze, false);
  assert.equal(season.weeks[2].squeeze, true);
  assert.equal(season.next.start, day(15));
});

test("nights on game days are compared with every other night", () => {
  const events = [event(-2, "game"), event(-9, "game"), event(-16, "game")];
  const metrics = [];
  for (let i = 1; i <= 30; i++) {
    const d = day(-i);
    const isGame = [2, 9, 16].includes(i);
    metrics.push({ date: d, sleep_minutes: isGame ? 380 : 450 });
  }
  const response = schedule.responseTo("game", events, metrics);
  assert.equal(response.nights, 3);
  assert.equal(response.deltaMinutes, -70);
});

test("the fact sheet carries readings and never carries journal text", () => {
  const divergence = {
    channels: {
      autonomic: { z: 0.4, weeks: 5, parts: { sleep_minutes: 0.5 } },
      cognitive: { z: 1.9, weeks: 5, parts: { speed: 1.4, lapses: 2.5 } },
      psychological: { z: null, weeks: 1, parts: {} },
    },
    thresholds: { notable: 1, marked: 1.8, gap: 1.5, persistence: 2 },
    readings: [{ text: "This is landing harder than your body shows." }],
    state: { key: "unrecognised", name: "Slower Than You Feel", detail: "Measured slowdown without felt strain." },
    confidence: "established",
    sensitivity: "medium",
  };

  const facts = assistant.factSheet({
    today: "2026-09-21",
    user: { name: "Jordan" },
    divergence,
    life: { hasData: true, checkins: { days: 4, target: 7 }, measures: { load: { now: 6.2, usual: 4.8 } } },
    schedule: { next: { start: "2026-10-05", end: "2026-10-11", counts: { game: 2, exam: 1 } }, responses: [] },
  });

  assert.match(facts, /Brain: 1.9 spreads worse than your normal, which reads as much worse than usual/);
  assert.match(facts, /Life: no reading yet/);
  assert.match(facts, /Slower Than You Feel/);
  assert.match(facts, /Check-ins in the last seven days: 4 of 7/);
  assert.match(facts, /Next heavy week: 2026-10-05/);
  assert.doesNotMatch(facts, /journal/i);
  /* Column names never reach the model, because it repeats them back verbatim. */
  assert.match(facts, /response speed 1.4 spreads worse/);
  assert.doesNotMatch(facts, /\bspeed 1.4\b(?! spreads)/);
});

test("a question narrows the fact sheet to what it is about", () => {
  const divergence = {
    channels: {
      autonomic: { z: 0.4, weeks: 5, parts: {} },
      cognitive: { z: 1.9, weeks: 5, parts: {} },
      psychological: { z: 0.2, weeks: 5, parts: {} },
    },
    thresholds: { notable: 1, marked: 1.8, gap: 1.5, persistence: 2 },
    readings: [],
    state: { key: "unrecognised", name: "Slower Than You Feel", detail: "Measured slowdown." },
    confidence: "established",
    sensitivity: "medium",
  };
  const parts = {
    today: "2026-09-21",
    divergence,
    body: { hasData: true, goal: 480, sleep: { week: { average: 400, nights: 7, atGoal: 2 } } },
    life: { hasData: true, checkins: { days: 4, target: 7 } },
  };

  const sleepQuestion = assistant.factSheet({ ...parts, question: "Why is my sleep bad?" });
  assert.match(sleepQuestion, /BODY detail/);
  assert.doesNotMatch(sleepQuestion, /LIFE detail/);

  const moodQuestion = assistant.factSheet({ ...parts, question: "Why does my mood feel off?" });
  assert.match(moodQuestion, /LIFE detail/);
  assert.doesNotMatch(moodQuestion, /BODY detail/);

  /* The three channels and the pattern are in every answer, whatever was asked. */
  for (const sheet of [sleepQuestion, moodQuestion]) {
    assert.match(sheet, /CHANNELS/);
    assert.match(sheet, /Slower Than You Feel/);
  }

  /* A question that matches nothing still gets the whole sheet. */
  const vague = assistant.factSheet({ ...parts, question: "Hello?" });
  assert.match(vague, /BODY detail/);
  assert.match(vague, /LIFE detail/);
});

test("the assistant refuses to answer an empty question", async () => {
  await assert.rejects(() => assistant.ask({ question: "   ", facts: "x", apiKey: "k" }), /Ask a question/);
});

/* The local path is tested against a stand-in for Ollama, so the test says
   nothing about which models happen to be on the machine running it. */
test("a model on this machine answers, and the fact sheet reaches it whole", async () => {
  const http = require("node:http");
  let seen = null;

  const fake = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ models: [{ name: "gemma3:4b" }] }));
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = JSON.parse(body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: { role: "assistant", content: "Your Brain channel moved more than your Body did." } }));
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));

  const url = `http://127.0.0.1:${fake.address().port}`;
  process.env.MYAKU_LOCAL_URL = url;
  delete require.cache[require.resolve("../server/assistant")];
  const local = require("../server/assistant");

  try {
    const engine = await local.status({ apiKey: "" });
    assert.equal(engine.provider, "local");
    assert.equal(engine.onDevice, true);

    const result = await local.ask({ question: "What changed?", facts: "FACT SHEET LINE", apiKey: "" });
    assert.equal(result.provider, "local");
    assert.equal(result.onDevice, true);
    assert.match(result.answer, /Brain channel moved/);

    assert.equal(seen.model, "gemma3:4b");
    assert.equal(seen.stream, false);
    assert.equal(seen.messages[0].role, "system");
    assert.match(seen.messages.at(-1).content, /FACT SHEET LINE/);
    assert.match(seen.messages.at(-1).content, /at most one number from the fact sheet/);
    assert.match(seen.messages.at(-1).content, /never the person/);
  } finally {
    fake.close();
    delete process.env.MYAKU_LOCAL_URL;
    delete require.cache[require.resolve("../server/assistant")];
  }
});

test("with no model anywhere, the reading is shown instead of an answer", async () => {
  process.env.MYAKU_LOCAL_URL = "http://127.0.0.1:1";
  delete require.cache[require.resolve("../server/assistant")];
  const offline = require("../server/assistant");
  try {
    const result = await offline.ask({ question: "What changed?", facts: "FACTS", apiKey: "" });
    assert.equal(result.provider, "none");
    assert.equal(result.model, null);
    assert.match(result.answer, /not switched on/);
  } finally {
    delete process.env.MYAKU_LOCAL_URL;
    delete require.cache[require.resolve("../server/assistant")];
  }
});
