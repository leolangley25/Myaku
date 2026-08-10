const http = require("http");
const https = require("https");

const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 8000;

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

    const lib = target.protocol === "https:" ? https : http;
    const req = lib.get(target, { timeout: TIMEOUT_MS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error("Too many redirects."));
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
    req.on("error", () => reject(new Error("Could not reach that calendar URL.")));
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
