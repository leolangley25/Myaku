const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");
const db = require("./db");

const app = express();
app.use(express.json());
app.use(
  session({
    secret: crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not signed in." });
  next();
}

const insertUser = db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)");
const findUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const findUserById = db.prepare("SELECT id, name, email FROM users WHERE id = ?");
const insertConnection = db.prepare("INSERT OR IGNORE INTO connected_accounts (user_id, provider) VALUES (?, ?)");
const deleteConnection = db.prepare("DELETE FROM connected_accounts WHERE user_id = ? AND provider = ?");
const listConnections = db.prepare("SELECT provider FROM connected_accounts WHERE user_id = ?");

const VALID_PROVIDERS = ["whoop", "fitbit", "apple_health"];

app.post("/api/signup", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are all required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = findUserByEmail.get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  const result = insertUser.run(String(name).trim(), normalizedEmail, hashPassword(password));
  req.session.userId = Number(result.lastInsertRowid);
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = email ? findUserByEmail.get(String(email).toLowerCase().trim()) : null;
  if (!user || !verifyPassword(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Your email or password was incorrect." });
  }
  req.session.userId = user.id;
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = findUserById.get(req.session.userId);
  const connectedProviders = listConnections.all(req.session.userId).map((r) => r.provider);
  res.json({ user, connectedProviders });
});

app.post("/api/connect", requireAuth, (req, res) => {
  const { provider } = req.body || {};
  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: "Unknown provider." });
  }
  insertConnection.run(req.session.userId, provider);
  const connectedProviders = listConnections.all(req.session.userId).map((r) => r.provider);
  res.json({ ok: true, connectedProviders });
});

app.post("/api/disconnect", requireAuth, (req, res) => {
  const { provider } = req.body || {};
  deleteConnection.run(req.session.userId, provider);
  const connectedProviders = listConnections.all(req.session.userId).map((r) => r.provider);
  res.json({ ok: true, connectedProviders });
});

app.use(express.static(path.join(__dirname, "..")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Myaku running at http://localhost:${PORT}`);
});
