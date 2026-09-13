/* Security middleware and secrets.
 *
 * Myaku holds journal entries, mood ratings, and OAuth tokens to a person's
 * wearable. That is sensitive enough that the defaults an Express prototype ships
 * with — a random session secret, no headers, no request-origin check, no rate
 * limit, tokens in plain text — are not acceptable even before launch.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { sendError } = require("./errors");

/* ---------------- secrets ---------------- */

/* A session secret generated fresh on every boot signs every user out on every
   restart. This one is created once, stored with owner-only permissions, and
   reused, unless the environment supplies one. */
function loadSecret(dataDir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, "secret.key");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    const secret = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

/* Authenticated encryption for OAuth tokens at rest. A copied database file is
   useless without the secret, and a tampered ciphertext fails to open rather than
   decrypting to garbage. */
function tokenSealer(secret) {
  const key = crypto.createHash("sha256").update("myaku-oauth-tokens:" + secret).digest();
  return {
    seal(plain) {
      if (plain == null) return null;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
    },
    open(sealed) {
      if (!sealed) return null;
      const [iv, tag, data] = String(sealed).split(".").map((s) => Buffer.from(s, "base64url"));
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    },
  };
}

/* ---------------- headers ---------------- */

/* No inline scripts anywhere in the app, so scripts are restricted to this origin.
   Inline style attributes are used throughout, which is why style-src keeps
   'unsafe-inline'; style injection cannot execute code the way script injection
   can. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Personal data must never be written to a shared cache.
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  next();
}

/* ---------------- request origin ---------------- */

/* Cross-site request forgery defence. Every state-changing API call must come
   from a page on this origin. Browsers attach Origin to every cross-site POST and
   cannot be made to forge it, which makes this check sufficient alongside the
   SameSite session cookie without needing a token in every form. */
function sameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.path.startsWith("/api/")) return next();

  let origin = req.get("origin");
  if (!origin && req.get("referer")) {
    try {
      origin = new URL(req.get("referer")).origin;
    } catch {
      origin = null;
    }
  }

  const expected = `${req.protocol}://${req.get("host")}`;
  const allowed = [expected, ...String(process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)];

  if (!origin || !allowed.includes(origin)) {
    return sendError(res, 403, "This request did not come from Myaku");
  }
  next();
}

/* ---------------- rate limiting ---------------- */

/* A fixed-window counter held in memory. That is correct for one server process,
   which is what this is; a second instance behind a load balancer would need the
   counts moved into shared storage. */
function rateLimit({ windowMs, max, key, message }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs);
  sweep.unref();

  return function limiter(req, res, next) {
    const k = key(req);
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(k, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.start + windowMs - now) / 1000)));
      return sendError(res, 429, message);
    }
    next();
  };
}

const clientIp = (req) => req.ip || (req.socket && req.socket.remoteAddress) || "unknown";

/* Common enough that an attacker tries them first. Not a substitute for length. */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyuiop", "iloveyou", "football", "baseball", "basketball", "soccer123",
  "letmein1", "welcome1", "abc12345", "11111111", "00000000", "passw0rd",
]);

function passwordProblem(pw) {
  const s = String(pw || "");
  if (s.length < 8) return "Password must be at least 8 characters";
  // scrypt cost scales with input length, so an unbounded password is a cheap
  // way to tie up the server.
  if (s.length > 200) return "Password must be under 200 characters";
  if (COMMON_PASSWORDS.has(s.toLowerCase())) return "That password is too common, so please choose another";
  return null;
}

module.exports = { loadSecret, tokenSealer, securityHeaders, sameOrigin, rateLimit, clientIp, passwordProblem };
