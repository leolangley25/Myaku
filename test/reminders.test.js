const test = require("node:test");
const assert = require("node:assert/strict");
const { dueReminders, localParts, remindersCalendar } = require("../server/reminders");

const prefs = {
  enabled: 1,
  pvt_days: "1,3,5",
  pvt_time: "07:30",
  checkin_time: "21:00",
  weekly_day: 0,
  weekly_time: "19:00",
};
const none = { pvtToday: false, checkinToday: false, weeklyDone: false };
const at = (dow, hh, mm) => ({ date: "2026-09-14", dow, minutes: hh * 60 + mm });
const kinds = (list) => list.map((r) => r.kind);

test("the reaction test reminder fires on test days, inside its window, only when not yet done", () => {
  assert.deepEqual(kinds(dueReminders(prefs, at(1, 7, 35), none)), ["pvt"]);
  assert.deepEqual(kinds(dueReminders(prefs, at(1, 7, 35), { ...none, pvtToday: true })), []);
  assert.deepEqual(kinds(dueReminders(prefs, at(2, 7, 35), none)), []);
  assert.deepEqual(kinds(dueReminders(prefs, at(1, 7, 29), none)), []);
  assert.deepEqual(kinds(dueReminders(prefs, at(1, 7, 55), none)), []);
});

test("check-in and weekly reminders respect their own day, time, and completion", () => {
  assert.deepEqual(kinds(dueReminders(prefs, at(4, 21, 5), none)), ["checkin"]);
  assert.deepEqual(kinds(dueReminders(prefs, at(4, 21, 5), { ...none, checkinToday: true })), []);
  assert.deepEqual(kinds(dueReminders(prefs, at(0, 19, 10), none)), ["weekly"]);
  assert.deepEqual(kinds(dueReminders(prefs, at(0, 19, 10), { ...none, weeklyDone: true })), []);
});

test("nothing fires when reminders are switched off", () => {
  assert.deepEqual(dueReminders({ ...prefs, enabled: 0 }, at(1, 7, 35), none), []);
});

test("local parts are computed in the athlete's own zone", () => {
  const utc = localParts("UTC", new Date("2026-09-14T07:30:00Z"));
  assert.deepEqual(utc, { date: "2026-09-14", minutes: 450, dow: 1 });
  const la = localParts("America/Los_Angeles", new Date("2026-09-14T03:00:00Z"));
  assert.deepEqual(la, { date: "2026-09-13", minutes: 1200, dow: 0 });
});

test("the calendar export repeats on the chosen days with an alarm", () => {
  const ics = remindersCalendar(prefs, { startDate: "2026-09-13", origin: "https://myaku.example" });
  assert.match(ics, /BYDAY=MO,WE,FR/);
  assert.match(ics, /DTSTART:20260914T073000/);
  assert.match(ics, /FREQ=DAILY/);
  assert.match(ics, /BEGIN:VALARM/);
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});
