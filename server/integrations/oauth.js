/* Shared plumbing for wearable providers: token requests, authenticated reads,
   PKCE, and merging partial readings from separate endpoints into one row a day. */

const crypto = require("crypto");

async function postForm(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
  });
  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* some providers answer errors in plain text */
  }
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `The provider rejected the token request with status ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getJson(url, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const err = new Error(
      res.status === 401 ? "The connection has expired" :
      res.status === 429 ? "The provider is rate limiting requests, so try again later" :
      `The provider returned status ${res.status}`
    );
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* Proof Key for Code Exchange, so an intercepted authorization code is useless
   without the verifier held in this server's session. */
function pkce() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const FIELDS = ["hrv", "rhr", "sleepMinutes", "sleepEfficiency"];

/* Providers report sleep and heart data from different endpoints, often with a
   field missing on a given day. Later partials fill gaps; they never overwrite a
   value with nothing. */
function mergeByDate(...partials) {
  const out = {};
  partials.flat().forEach((p) => {
    if (!p || !p.date) return;
    const row = (out[p.date] = out[p.date] || { date: p.date });
    FIELDS.forEach((k) => {
      if (p[k] != null && Number.isFinite(Number(p[k]))) row[k] = Number(p[k]);
    });
  });
  return Object.values(out).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/* Readings a sensor could plausibly produce. Anything outside is a sync artefact
   and would poison a robust baseline far longer than it takes to notice. */
function plausible(row) {
  const ok = (v, lo, hi) => v == null || (v >= lo && v <= hi);
  return (
    ok(row.hrv, 3, 300) &&
    ok(row.rhr, 25, 130) &&
    ok(row.sleepMinutes, 30, 960) &&
    ok(row.sleepEfficiency, 20, 100)
  );
}

module.exports = { postForm, getJson, pkce, mergeByDate, plausible, FIELDS };
