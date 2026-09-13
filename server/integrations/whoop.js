/* Whoop, over the v2 developer API.
 *
 * v1 was removed after October 1, 2025, so this targets v2 only. Sleep and
 * recovery come from separate collections and are joined through the recovery's
 * sleep identifier, which is how v2 associates them.
 *
 * Whoop reports RMSSD, the same heart rate variability statistic Google Health
 * uses. Apple Watch reports SDNN, a different statistic, which is why the source
 * of every row is kept: the two should never share one baseline.
 */

const { postForm, getJson, mergeByDate } = require("./oauth");

const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API = "https://api.prod.whoop.com/developer/v2";
// "offline" is what returns a refresh token; without it access lapses in an hour.
const SCOPES = ["read:recovery", "read:sleep", "read:cycles", "read:profile", "offline"];

function config(origin) {
  const id = process.env.WHOOP_CLIENT_ID;
  const secret = process.env.WHOOP_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret, redirect: process.env.WHOOP_REDIRECT_URI || `${origin}/api/integrations/whoop/callback` };
}

function authorizeUrl(cfg, state) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.id,
    redirect_uri: cfg.redirect,
    scope: SCOPES.join(" "),
    state,
  }).toString();
  return u.toString();
}

const normalizeToken = (t) => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token || null,
  expiresAt: t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : null,
  scope: t.scope || null,
});

async function exchange(cfg, code) {
  return normalizeToken(await postForm(TOKEN_URL, {
    grant_type: "authorization_code",
    code,
    client_id: cfg.id,
    client_secret: cfg.secret,
    redirect_uri: cfg.redirect,
  }));
}

async function refresh(cfg, refreshToken) {
  return normalizeToken(await postForm(TOKEN_URL, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.id,
    client_secret: cfg.secret,
    scope: "offline",
  }));
}

/* The calendar date of a moment as it was on the athlete's own clock. Whoop
   supplies the offset alongside each record for exactly this purpose. */
function localDate(iso, offset) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return null;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset || "");
  const mins = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(t + mins * 60000).toISOString().slice(0, 10);
}

async function collect(path, token, start) {
  const records = [];
  let next = null;
  let pages = 0;
  do {
    const u = new URL(API + path);
    u.searchParams.set("limit", "25");
    if (start) u.searchParams.set("start", start);
    if (next) u.searchParams.set("nextToken", next);
    const page = await getJson(u, token);
    records.push(...(page.records || []));
    next = page.next_token || null;
    pages++;
  } while (next && pages < 60);
  return records;
}

/* Pure mapping from Whoop records to daily rows, kept separate from the network
   calls so it can be tested against fixtures. */
function mapWhoop(sleeps, recoveries) {
  const sleepDate = {};
  const nights = {};

  (sleeps || []).forEach((s) => {
    // Naps are excluded: they are real sleep, but counting them would make a
    // nap-heavy day look like a long night and distort the sleep baseline.
    if (!s || s.nap || s.score_state !== "SCORED" || !s.score) return;
    const date = localDate(s.end, s.timezone_offset);
    if (!date) return;
    sleepDate[s.id] = date;

    const st = s.score.stage_summary || {};
    const asleepMs =
      (st.total_light_sleep_time_milli || 0) +
      (st.total_slow_wave_sleep_time_milli || 0) +
      (st.total_rem_sleep_time_milli || 0);
    const row = {
      date,
      sleepMinutes: asleepMs ? asleepMs / 60000 : null,
      sleepEfficiency: s.score.sleep_efficiency_percentage ?? null,
    };
    const prev = nights[date];
    if (!prev || (row.sleepMinutes || 0) > (prev.sleepMinutes || 0)) nights[date] = row;
  });

  const recovery = (recoveries || [])
    .filter((r) => r && r.score_state === "SCORED" && r.score)
    .map((r) => ({
      date: sleepDate[r.sleep_id] || localDate(r.created_at, null),
      hrv: r.score.hrv_rmssd_milli ?? null,
      rhr: r.score.resting_heart_rate ?? null,
    }));

  return mergeByDate(Object.values(nights), recovery);
}

async function sync(token, sinceIso) {
  const [sleeps, recoveries] = await Promise.all([
    collect("/activity/sleep", token, sinceIso),
    collect("/recovery", token, sinceIso),
  ]);
  return mapWhoop(sleeps, recoveries);
}

module.exports = {
  id: "whoop",
  label: "Whoop",
  usesPkce: false,
  config, authorizeUrl, exchange, refresh, sync, mapWhoop, localDate,
};
