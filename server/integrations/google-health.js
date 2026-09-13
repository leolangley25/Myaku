/* Google Health API, which is where Fitbit and Pixel Watch data now lives.
 *
 * The legacy Fitbit Web API is decommissioned on September 30, 2026, and tokens do
 * not carry over, so a Fitbit device — including the Fitbit Air — is read through
 * this API rather than through Fitbit's own.
 *
 * The parsing below is defensive on purpose. The documented field names are
 * minutesAsleep, minutesInBed, efficiency, beatsPerMinute, and rmssd, but the exact
 * nesting of each payload is only described in linked reference pages, and it has
 * not yet been checked against a live response. Rather than hard-code a path that
 * might be one level off, each value is looked up by name anywhere inside its data
 * point. Verify against a real account before relying on it.
 */

const { postForm, getJson, mergeByDate } = require("./oauth");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://health.googleapis.com/v4/users/me/dataTypes";
const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
];

function config(origin) {
  const id = process.env.GOOGLE_HEALTH_CLIENT_ID;
  const secret = process.env.GOOGLE_HEALTH_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret, redirect: process.env.GOOGLE_HEALTH_REDIRECT_URI || `${origin}/api/integrations/google/callback` };
}

function authorizeUrl(cfg, state, challenge) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.id,
    redirect_uri: cfg.redirect,
    scope: SCOPES.join(" "),
    state,
    // offline plus consent is what makes Google issue a refresh token on every
    // connection rather than only the first.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

const normalizeToken = (t) => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token || null,
  expiresAt: t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : null,
  scope: t.scope || null,
});

async function exchange(cfg, code, verifier) {
  return normalizeToken(await postForm(TOKEN_URL, {
    grant_type: "authorization_code",
    code,
    client_id: cfg.id,
    client_secret: cfg.secret,
    redirect_uri: cfg.redirect,
    code_verifier: verifier,
  }));
}

async function refresh(cfg, refreshToken) {
  return normalizeToken(await postForm(TOKEN_URL, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.id,
    client_secret: cfg.secret,
  }));
}

/* ---------------- defensive lookups ---------------- */

function civilDate(value) {
  if (!value) return null;
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  if (typeof value === "object" && value.year) {
    return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
  }
  return null;
}

const matches = (key, patterns) => patterns.some((p) => (p instanceof RegExp ? p.test(key) : p === key));

function findNumber(obj, patterns, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (matches(k, patterns) && typeof v === "number" && Number.isFinite(v)) return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = findNumber(v, patterns, depth + 1);
      if (found != null) return found;
    }
  }
  return null;
}

function findDate(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  for (const key of keys) {
    if (key in obj) {
      const d = civilDate(obj[key]);
      if (d) return d;
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = findDate(v, keys, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/* ---------------- mapping ---------------- */

function mapGoogle({ sleep = [], restingHeartRate = [], heartRateVariability = [] }, since) {
  const nights = {};
  sleep.forEach((dp) => {
    const p = (dp && dp.sleep) || dp;
    // The end of the night names it, matching how every other source is keyed.
    const date = findDate(p, ["civilEndTime", "endTime", "civilStartTime", "startTime"]);
    const minutes = findNumber(p, ["minutesAsleep"]);
    if (!date || minutes == null) return;
    const inBed = findNumber(p, ["minutesInBed"]);
    let efficiency = findNumber(p, ["efficiency"]);
    if (efficiency == null && inBed) efficiency = Math.min(100, (minutes / inBed) * 100);
    const prev = nights[date];
    if (!prev || minutes > prev.sleepMinutes) nights[date] = { date, sleepMinutes: minutes, sleepEfficiency: efficiency };
  });

  const rhr = restingHeartRate
    .map((dp) => {
      const p = (dp && dp.dailyRestingHeartRate) || dp;
      return { date: findDate(p, ["date"]), rhr: findNumber(p, ["beatsPerMinute"]) };
    })
    .filter((r) => r.date && r.rhr != null);

  const hrv = heartRateVariability
    .map((dp) => {
      const p = (dp && dp.dailyHeartRateVariability) || dp;
      return { date: findDate(p, ["date"]), hrv: findNumber(p, [/rmssd/i, /heartRateVariabilityMill/i]) };
    })
    .filter((r) => r.date && r.hrv != null);

  return mergeByDate(Object.values(nights), rhr, hrv).filter((r) => !since || r.date >= since);
}

async function listAll(type, token, { pageSize, maxPages }) {
  const out = [];
  let pageToken = null;
  let pages = 0;
  do {
    const u = new URL(`${API}/${type}/dataPoints`);
    u.searchParams.set("pageSize", String(pageSize));
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const page = await getJson(u, token);
    out.push(...(page.dataPoints || []));
    pageToken = page.nextPageToken || null;
    pages++;
  } while (pageToken && pages < maxPages);
  return out;
}

async function sync(token, sinceIso) {
  const since = sinceIso ? sinceIso.slice(0, 10) : null;
  // Sleep sessions are capped at twenty-five a page by the API.
  const [sleep, restingHeartRate, heartRateVariability] = await Promise.all([
    listAll("sleep", token, { pageSize: 25, maxPages: 20 }),
    listAll("daily-resting-heart-rate", token, { pageSize: 400, maxPages: 5 }),
    listAll("daily-heart-rate-variability", token, { pageSize: 400, maxPages: 5 }),
  ]);
  return mapGoogle({ sleep, restingHeartRate, heartRateVariability }, since);
}

module.exports = {
  id: "google",
  label: "Google Health",
  usesPkce: true,
  config, authorizeUrl, exchange, refresh, sync, mapGoogle, civilDate, findNumber,
};
