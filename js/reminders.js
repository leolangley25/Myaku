/* Myaku — reminder settings.
 *
 * Two separate switches, because they answer two separate questions. One is
 * whether this particular phone may show notifications; the other is whether
 * Myaku should send reminders at all. A person with a phone and a laptop needs
 * to be able to say yes to the first and no to the second.
 */

(function () {
  M.boot("more");

  const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const FULL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const deviceSwitch = document.getElementById("device-switch");
  const deviceSub = document.getElementById("device-sub");
  const deviceStatus = document.getElementById("device-status");
  const enabled = document.getElementById("enabled");
  const saveStatus = document.getElementById("save-status");
  let pvtDays = [1, 3, 5];

  function setStatus(el, tone, text) {
    el.className = `status-line${tone ? " " + tone : ""}`;
    el.textContent = text;
  }

  /* ---------------- this device ---------------- */

  async function renderDevice() {
    const blocked = M.push.blocker();
    const sub = await M.push.current().catch(() => null);
    deviceSwitch.checked = !!sub;
    deviceSwitch.disabled = !!blocked && !sub;
    deviceSub.textContent = sub ? "On for this device." : blocked ? "Not available here." : "Off for this device.";
    setStatus(deviceStatus, "", blocked && !sub ? blocked : "");
  }

  deviceSwitch.addEventListener("change", async () => {
    deviceSwitch.disabled = true;
    try {
      if (deviceSwitch.checked) {
        await M.push.subscribe();
        // Turning notifications on is a clear enough request to switch the
        // schedule on too, rather than making somebody find a second switch.
        if (!enabled.checked) {
          enabled.checked = true;
          await save({ quiet: true });
        }
        setStatus(deviceStatus, "ok", "Notifications are on for this device.");
      } else {
        await M.push.unsubscribe();
        setStatus(deviceStatus, "", "Notifications are off for this device.");
      }
    } catch (err) {
      deviceSwitch.checked = false;
      setStatus(deviceStatus, "error", err.message);
    }
    deviceSwitch.disabled = false;
    renderDevice();
  });

  /* ---------------- schedule ---------------- */

  function renderDays() {
    const box = document.getElementById("pvt-days");
    box.innerHTML = SHORT_DAYS.map(
      (d, i) => `<button type="button" class="day-opt" data-day="${i}" aria-pressed="${pvtDays.includes(i)}" aria-label="${FULL_DAYS[i]}">${d}</button>`
    ).join("");
    box.querySelectorAll("[data-day]").forEach((b) =>
      b.addEventListener("click", () => {
        const day = Number(b.dataset.day);
        pvtDays = pvtDays.includes(day) ? pvtDays.filter((d) => d !== day) : [...pvtDays, day].sort();
        b.setAttribute("aria-pressed", String(pvtDays.includes(day)));
      })
    );
  }

  document.getElementById("weekly-day").innerHTML = FULL_DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join("");

  async function load() {
    try {
      const { prefs } = await M.api("/api/reminders");
      enabled.checked = prefs.enabled;
      document.getElementById("pvt-time").value = prefs.pvtTime;
      document.getElementById("checkin-time").value = prefs.checkinTime;
      document.getElementById("weekly-day").value = String(prefs.weeklyDay);
      document.getElementById("weekly-time").value = prefs.weeklyTime;
      pvtDays = prefs.pvtDays;
      renderDays();
      const local = M.timezone();
      document.getElementById("tz-line").textContent =
        prefs.timezone === local
          ? `Times are in your time zone, ${local.replace(/_/g, " ")}.`
          : `Saved for ${prefs.timezone.replace(/_/g, " ")}. Saving again switches to ${local.replace(/_/g, " ")}, where this device is now.`;
    } catch {
      /* handled by the api layer */
    }
  }

  async function save({ quiet = false } = {}) {
    if (!pvtDays.length) {
      setStatus(saveStatus, "error", "Choose at least one day for the reaction test.");
      return false;
    }
    try {
      await M.api("/api/reminders", {
        method: "POST",
        body: {
          enabled: enabled.checked,
          timezone: M.timezone(),
          pvtTime: document.getElementById("pvt-time").value,
          pvtDays,
          checkinTime: document.getElementById("checkin-time").value,
          weeklyDay: Number(document.getElementById("weekly-day").value),
          weeklyTime: document.getElementById("weekly-time").value,
        },
      });
      if (!quiet) setStatus(saveStatus, "ok", enabled.checked ? "Saved. Reminders will follow this schedule." : "Saved. Reminders are paused.");
      return true;
    } catch (err) {
      setStatus(saveStatus, "error", err.message);
      return false;
    }
  }

  document.getElementById("save").addEventListener("click", () => save());
  enabled.addEventListener("change", () => save());

  document.getElementById("test").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await M.api("/api/push/test", { method: "POST" });
      setStatus(deviceStatus, r.delivered ? "ok" : "error",
        r.delivered ? "Sent. It should appear within a few seconds." : "Nothing was delivered, so turn notifications off and on again.");
    } catch (err) {
      setStatus(deviceStatus, "error", err.message);
    }
    btn.disabled = false;
  });

  renderDays();
  load();
  renderDevice();
})();
