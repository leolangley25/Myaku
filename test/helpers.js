/* Test helpers: a real server on a random port, pointed at a throwaway data
   directory, and a small client that keeps a cookie and sends an Origin header
   the way a browser would. */

const fs = require("fs");
const os = require("os");
const path = require("path");

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "myaku-test-"));
  process.env.MYAKU_DATA_DIR = dir;
  // The suite creates an account per test from one address; the sign-in limiter
  // stays at its real value so that behaviour is still tested.
  process.env.SIGNUP_RATE_LIMIT = "1000";
  const { app } = require("../server/index.js");
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, dir };
}

function client(base) {
  let cookie = "";

  async function request(method, urlPath, { body, raw, headers = {}, origin = true } = {}) {
    const h = { ...headers };
    if (origin) h.Origin = base;
    if (cookie) h.Cookie = cookie;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      h["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + urlPath, { method, headers: h, body: payload, redirect: "manual" });
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
      const pair = c.split(";")[0];
      if (pair.startsWith("myaku.sid=")) cookie = pair;
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, text };
  }

  return {
    request,
    cookie: () => cookie,
    get: (p, o) => request("GET", p, o),
    post: (p, body, o = {}) => request("POST", p, { ...o, body }),
    del: (p, o) => request("DELETE", p, o),
  };
}

module.exports = { startServer, client };
