/* Sessions kept in SQLite rather than in process memory.
 *
 * The default memory store loses every session on restart, which signs every
 * user out whenever the server is redeployed, and it grows without bound because
 * nothing ever expires. This one survives restarts and prunes itself.
 */

const session = require("express-session");

const DAY_MS = 24 * 60 * 60 * 1000;

class SqliteSessionStore extends session.Store {
  constructor(db, { ttlMs = 30 * DAY_MS, pruneEveryMs = 60 * 60 * 1000 } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.q = {
      get: db.prepare("SELECT sess FROM sessions WHERE sid = ? AND expires > ?"),
      set: db.prepare(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`),
      destroy: db.prepare("DELETE FROM sessions WHERE sid = ?"),
      touch: db.prepare("UPDATE sessions SET expires = ? WHERE sid = ?"),
      prune: db.prepare("DELETE FROM sessions WHERE expires <= ?"),
      destroyForUser: db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?"),
    };
    this.pruner = setInterval(() => this.prune(), pruneEveryMs);
    this.pruner.unref();
  }

  expiry(sess) {
    const cookieExpiry = sess && sess.cookie && sess.cookie.expires;
    return cookieExpiry ? new Date(cookieExpiry).getTime() : Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    try {
      const row = this.q.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.q.set.run(sid, JSON.stringify(sess), this.expiry(sess));
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.q.touch.run(this.expiry(sess), sid);
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.q.destroy.run(sid);
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }

  /* Signs a user out everywhere, which account deletion needs. */
  destroyUser(userId) {
    this.q.destroyForUser.run(userId);
  }

  prune() {
    try {
      this.q.prune.run(Date.now());
    } catch {
      /* a failed prune is retried on the next interval */
    }
  }
}

module.exports = { SqliteSessionStore };
