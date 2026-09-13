/* Reminders: web push, a calendar fallback, and the scheduler that decides when.
 *
 * The whole model depends on consistency — the vigilance test at the same hour,
 * a check-in most nights — and a product that depends on consistency without
 * reminding anybody is relying on memory it does not have.
 *
 * Two deliberate restraints. A reminder is never sent for something already done
 * that day, and there are no streaks anywhere. This is a burnout app; guilt about
 * a broken streak is not a feeling it should be manufacturing.
 */

const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

/* ---------------- keys ---------------- */

function loadVapid(dataDir) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = path.join(dataDir, "vapid.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    const keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    return keys;
  }
}

/* ---------------- time ---------------- */

/* The athlete's own local date, time, and weekday. A reminder at half past seven
   means half past seven where they are, not where the server is. */
function localParts(timeZone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    dow,
  };
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
};

/* Fires inside a window rather than on an exact minute, so a scheduler tick that
   lands a few seconds late cannot silently skip a day. The log makes it fire once. */
const WINDOW_MINUTES = 20;
const within = (now, target) => now >= target && now < target + WINDOW_MINUTES;

/* Pure, so the rules can be tested without a clock, a database, or a network. */
function dueReminders(prefs, parts, status) {
  if (!prefs || !prefs.enabled) return [];
  const due = [];
  const pvtDays = String(prefs.pvt_days || "").split(",").map(Number);

  if (pvtDays.includes(parts.dow) && within(parts.minutes, toMinutes(prefs.pvt_time)) && !status.pvtToday) {
    due.push({
      kind: "pvt",
      title: "Reaction Test",
      body: "Three minutes at your usual hour keeps your baseline honest.",
      url: "/pvt.html",
    });
  }
  if (within(parts.minutes, toMinutes(prefs.checkin_time)) && !status.checkinToday) {
    due.push({
      kind: "checkin",
      title: "Daily Check-In",
      body: "Under a minute. The first square is the only one that matters.",
      url: "/checkin.html",
    });
  }
  if (parts.dow === Number(prefs.weekly_day) && within(parts.minutes, toMinutes(prefs.weekly_time)) && !status.weeklyDone) {
    due.push({
      kind: "weekly",
      title: "Weekly Reflection",
      body: "How the week went, one square per area of your life.",
      url: "/weekly.html",
    });
  }
  return due;
}

/* ---------------- calendar fallback ---------------- */

const ICS_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function nextDate(fromDate, dow) {
  const d = new Date(fromDate + "T00:00:00Z");
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/* Floating local times with no time zone attached, so the event fires at the same
   wall-clock hour wherever the phone is. That is the right behaviour for a test
   whose whole point is being taken at the same hour of the athlete's day. */
function remindersCalendar(prefs, { startDate, origin }) {
  const hhmm = (t) => String(t).replace(":", "") + "00";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const pvtDays = String(prefs.pvt_days || "1,3,5").split(",").map(Number);
  const firstPvt = Math.min(...pvtDays);

  const event = (uid, date, time, rule, summary, description, url) => [
    "BEGIN:VEVENT",
    `UID:${uid}@myaku`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${date}T${hhmm(time)}`,
    `DURATION:PT5M`,
    `RRULE:${rule}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `URL:${origin}${url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${summary}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
  ];

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Myaku//Reminders//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Myaku",
    ...event("pvt", nextDate(startDate, firstPvt), prefs.pvt_time,
      `FREQ=WEEKLY;BYDAY=${pvtDays.map((d) => ICS_DAYS[d]).join(",")}`,
      "Myaku Reaction Test", "Three minutes at your usual hour.", "/pvt.html"),
    ...event("checkin", startDate.replace(/-/g, ""), prefs.checkin_time,
      "FREQ=DAILY", "Myaku Check-In", "Under a minute.", "/checkin.html"),
    ...event("weekly", nextDate(startDate, Number(prefs.weekly_day)), prefs.weekly_time,
      `FREQ=WEEKLY;BYDAY=${ICS_DAYS[Number(prefs.weekly_day)]}`,
      "Myaku Weekly Reflection", "How the week went.", "/weekly.html"),
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

/* ---------------- sending ---------------- */

function createPusher(vapid, subject) {
  webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);

  return async function push(subscriptions, payload, onGone) {
    let delivered = 0;
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 }
        );
        delivered++;
      } catch (err) {
        // 404 and 410 mean the browser discarded the subscription for good.
        if (err && (err.statusCode === 404 || err.statusCode === 410)) onGone(sub);
      }
    }
    return delivered;
  };
}

/* Checks every minute. getUsers and getStatus are injected so this file never
   needs to know how the database is laid out. */
function startScheduler({ getUsers, getStatus, getSubscriptions, alreadySent, markSent, push, removeSubscription }) {
  async function tick() {
    const now = new Date();
    for (const user of getUsers()) {
      const parts = localParts(user.timezone || "UTC", now);
      const due = dueReminders(user, parts, getStatus(user.user_id, parts.date));
      for (const reminder of due) {
        if (alreadySent(user.user_id, reminder.kind, parts.date)) continue;
        const subs = getSubscriptions(user.user_id);
        if (!subs.length) continue;
        markSent(user.user_id, reminder.kind, parts.date);
        await push(subs, reminder, removeSubscription);
      }
    }
  }
  const timer = setInterval(() => tick().catch((err) => console.error("reminder tick failed", err)), 60 * 1000);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = { loadVapid, localParts, dueReminders, remindersCalendar, createPusher, startScheduler };
