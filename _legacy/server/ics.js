const http = require("http");
const https = require("https");
const dns = require("dns");
const net = require("net");

const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 8000;

/* A calendar URL is attacker-controlled, so the address it actually resolves to
   has to be checked before we connect. Validating only the hostname would still
   allow a public name that resolves to an internal address. */
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (/^f[cd]/.test(lower) || lower.startsWith("fe80")) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

const BLOCKED_ADDRESS_ERROR = "That calendar URL points to a private network address.";

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const resolved = Array.isArray(address) ? address.map((a) => a.address) : [address];
    if (resolved.some(isPrivateAddress)) {
      return callback(new Error(BLOCKED_ADDRESS_ERROR));
    }
    callback(null, address, family);
  });
}

function fetchICS(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url.replace(/^webcal:\/\//i, "https://"));
    } catch {
      return reject(new Error("That doesn't look like a valid URL."));
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return reject(new Error("Calendar URLs must start with http or https."));
    }

    /* Node skips the custom lookup when the host is already a literal IP, so a
       bare address has to be rejected here; safeLookup covers hostnames. */
    const host = target.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isPrivateAddress(host)) {
      return reject(new Error(BLOCKED_ADDRESS_ERROR));
    }

    const lib = target.protocol === "https:" ? https : http;
    const req = lib.get(target, { timeout: TIMEOUT_MS, lookup: safeLookup }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error("Too Many Redirects"));
        return resolve(fetchICS(new URL(res.headers.location, target).toString(), redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`The calendar responded with status ${res.statusCode}.`));
      }

      let data = "";
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy();
          reject(new Error("That calendar feed is too large to import."));
          return;
        }
        data += chunk;
      });
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timed out reaching that calendar."));
    });
    req.on("error", (err) => {
      reject(new Error(err.message === BLOCKED_ADDRESS_ERROR ? err.message : "Could not reach that calendar URL."));
    });
  });
}

function unfoldLines(text) {
  const rawLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseICSDate(value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hasTime, h = "00", mi = "00", s = "00", z] = m;
  if (!hasTime) return `${y}-${mo}-${d}`;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : ""}`;
}

function unescapeText(value) {
  return value.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseICS(text) {
  const lines = unfoldLines(text);
  const events = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current && current.start) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).split(";")[0].toUpperCase();
    const value = line.slice(idx + 1);

    if (key === "SUMMARY") current.title = unescapeText(value);
    if (key === "DTSTART") current.start = parseICSDate(value);
    if (key === "DTEND") current.end = parseICSDate(value);
    if (key === "UID") current.uid = value;
  }

  return events.slice(0, 500);
}

module.exports = { fetchICS, parseICS };
