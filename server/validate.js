/* Input validation. Every value that reaches the database passes through one of
 * these, so a malformed request produces a clamped or rejected value rather than
 * a row that quietly breaks the baseline arithmetic for weeks afterwards.
 *
 * Out-of-range numbers are clamped rather than rejected. A client that sends an
 * eleven on a zero-to-ten scale has a bug, but refusing the whole check-in over
 * it would lose the other seven answers.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isDate(value) {
  const s = String(value == null ? "" : value);
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const date = (value, fallback = null) => (isDate(value) ? String(value) : fallback);

function intIn(value, lo, hi) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function numIn(value, lo, hi) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

function text(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

const time = (value, fallback) => (TIME_RE.test(String(value || "")) ? String(value) : fallback);

/* Tags are stored comma-joined, so a comma inside a tag would split it in two. */
function tags(value, { maxLength = 40, maxCount = 24 } = {}) {
  if (!Array.isArray(value)) return null;
  const clean = [...new Set(
    value
      .map((t) => String(t == null ? "" : t).replace(/,/g, " ").trim().slice(0, maxLength))
      .filter(Boolean)
  )].slice(0, maxCount);
  return clean.length ? clean.join(",") : "";
}

function timezone(value) {
  const tz = String(value || "");
  if (!tz || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/* A day-of-week list such as "1,3,5", where Sunday is zero. */
function weekdays(value, fallback = "1,3,5") {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const days = [...new Set(list.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return days.length ? days.join(",") : fallback;
}

module.exports = { isDate, date, intIn, numIn, text, time, tags, timezone, weekdays };
