/* Small pure modules: validation, token sealing, statistics, and the
   browser-side interpretation layer loaded into a sandbox. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const v = require("../server/validate");
const { tokenSealer, passwordProblem } = require("../server/security");
const analytics = require("../server/analytics");

test("validation clamps, rejects, and cleans", () => {
  assert.equal(v.isDate("2026-02-29"), false);
  assert.equal(v.isDate("2028-02-29"), true);
  assert.equal(v.intIn("11", 0, 10), 10);
  assert.equal(v.intIn("abc", 0, 10), null);
  assert.equal(v.numIn(-3, -1, 1), -1);
  assert.equal(v.time("24:00", "07:30"), "07:30");
  assert.equal(v.tags(["School, Work", "School, Work", ""]), "School  Work");
  assert.equal(v.timezone("Mars/Olympus"), "UTC");
  assert.equal(v.timezone("America/Chicago"), "America/Chicago");
  assert.equal(v.weekdays([6, 1, 1, 9]), "1,6");
});

test("sealed tokens open with the right secret and fail when tampered", () => {
  const sealer = tokenSealer("a secret");
  const sealed = sealer.seal("access-token-value");
  assert.notEqual(sealed, "access-token-value");
  assert.equal(sealer.open(sealed), "access-token-value");
  const [iv, tag, data] = sealed.split(".");
  const tampered = [iv, tag, Buffer.from("x" + Buffer.from(data, "base64url").toString("latin1"), "latin1").toString("base64url")].join(".");
  assert.throws(() => sealer.open(tampered));
  assert.throws(() => tokenSealer("another secret").open(sealed));
});

test("password rules catch short, huge, and common passwords", () => {
  assert.ok(passwordProblem("short"));
  assert.ok(passwordProblem("x".repeat(201)));
  assert.ok(passwordProblem("Password123"));
  assert.equal(passwordProblem("correct horse battery"), null);
});

test("rank correlation and its chance estimate behave at the extremes", () => {
  assert.equal(analytics.spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1);
  assert.equal(analytics.spearman([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]), -1);
  assert.equal(analytics.correlationP(0.5, 4), null);
  assert.ok(analytics.correlationP(0, 30) > 0.99);
  assert.ok(analytics.correlationP(0.9, 30) < 0.001);
});

/* explain.js is written for the browser, so it is evaluated in a sandbox. */
function loadExplain() {
  const code = fs.readFileSync(path.join(__dirname, "..", "js", "explain.js"), "utf8");
  const sandbox = {};
  vm.runInNewContext(`${code}\nthis.Explain = Explain;`, sandbox);
  return sandbox.Explain;
}

test("plain-language bands follow the chosen sensitivity", () => {
  const E = loadExplain();
  const medium = { notable: 1.0, marked: 1.5 };
  assert.equal(E.band(0.2, medium).word, "Typical For You");
  assert.equal(E.band(1.2, medium).word, "Above Usual");
  assert.equal(E.band(1.2, { notable: 1.5, marked: 2.2 }).word, "Typical For You");
  assert.equal(E.band(2, medium).tone, "bad");
});

test("readings are compared in the right direction for each measure", () => {
  const E = loadExplain();
  const history = [52, 53, 52, 54, 53, 52, 53];
  const rhrUp = E.compare(58, history, { higherIsWorse: true, unit: " bpm" });
  assert.equal(rhrUp.tone, "warn");
  assert.match(rhrUp.sentence, /above your usual 53 bpm\./);
  const hrvUp = E.compare(80, [60, 62, 61, 63, 60], { higherIsWorse: false, unit: " ms" });
  assert.equal(hrvUp.tone, "good");
  assert.equal(E.compare(53, history, { higherIsWorse: true }).word, "Typical For You");
});

test("ranks are stated as counts, and correlations never say less quality", () => {
  const E = loadExplain();
  const points = [0.1, 0.4, 0.2, 1.8].map((z) => ({ z }));
  assert.equal(E.rankSentence(points), "This is the highest of your 4 recorded weeks.");
  assert.match(E.correlationSentence(-0.35, 55, { xLabel: "late caffeine", yLabel: "sleep quality" }), /lower sleep quality/);
  assert.match(E.correlationSentence(0.05, 55, { xLabel: "a", yLabel: "b" }), /almost no pattern/);
  assert.equal(E.duration(432), "7h 12m");
});
