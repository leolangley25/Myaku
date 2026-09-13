/* Myaku — Calendar import: fetches a real iCal/webcal feed server-side and
   surfaces imported events alongside a simple schedule-load view. */

(function () {
  function formatEventDate(iso) {
    if (!iso) return "";
    const isAllDay = iso.length === 10;
    const d = new Date(isAllDay ? iso + "T00:00:00" : iso);
    const dateStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    if (isAllDay) return `${dateStr} · All Day`;
    const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${dateStr} · ${timeStr}`;
  }

  function renderDailyLoad(dailyLoad) {
    const el = document.getElementById("calendar-daily-load");
    const rows = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      rows.push({ label, count: dailyLoad[key] || 0 });
    }
    el.innerHTML = rows
      .map(
        (r) => `
        <div class="metric-row">
          <span class="metric-name">${r.label}</span>
          <span class="metric-value">${r.count} event${r.count === 1 ? "" : "s"}</span>
        </div>
      `
      )
      .join("");
  }

  function renderUpcoming(events) {
    const el = document.getElementById("calendar-upcoming");
    const now = new Date();
    const upcoming = events.filter((e) => new Date(e.start_at) >= now).slice(0, 10);

    if (!upcoming.length) {
      el.innerHTML = `<p class="empty-note">No upcoming events found in the imported calendar.</p>`;
      return;
    }

    el.innerHTML = upcoming
      .map(
        (e) => `
        <div class="card log-item">
          <span class="log-item-label">${esc(e.title || "Untitled Event")}</span>
          <span class="log-item-time">${formatEventDate(e.start_at)}</span>
        </div>
      `
      )
      .join("");
  }

  function renderConnected(data) {
    document.getElementById("calendar-connect-card").style.display = "none";
    document.getElementById("calendar-connected").style.display = "block";
    document.getElementById("calendar-event-count").textContent = data.events.length;

    const syncedAt = data.source && data.source.last_synced_at ? new Date(data.source.last_synced_at + "Z") : null;
    document.getElementById("calendar-source-note").textContent = syncedAt
      ? `Last synced ${syncedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
      : "";

    renderDailyLoad(data.dailyLoad || {});
    renderUpcoming(data.events || []);

    document.getElementById("calendar-insight").innerHTML = `
      <div class="card insight-card">
        <div class="insight-top">
          <div class="insight-finding">Busier calendar days tend to line up with higher training-stress ratings.</div>
          <span class="badge badge-moderate"><span class="badge-dot"></span>New</span>
        </div>
        <div class="insight-support">Based on your imported calendar and recent check-in data.</div>
      </div>
    `;
  }

  function renderDisconnected() {
    document.getElementById("calendar-connect-card").style.display = "block";
    document.getElementById("calendar-connected").style.display = "none";
  }

  function load() {
    fetch("/api/calendar")
      .then((r) => r.json())
      .then((data) => {
        if (data.source) {
          renderConnected(data);
        } else {
          renderDisconnected();
        }
      });
  }

  document.getElementById("calendar-import").addEventListener("click", async () => {
    const url = document.getElementById("calendar-url").value.trim();
    const errorEl = document.getElementById("calendar-error");
    errorEl.style.display = "none";
    if (!url) return;

    const btn = document.getElementById("calendar-import");
    btn.disabled = true;
    btn.textContent = "Importing...";

    try {
      const res = await fetch("/api/calendar/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        errorEl.textContent = data.error || "Something went wrong, please try again.";
        errorEl.style.display = "block";
        return;
      }
      load();
    } finally {
      btn.disabled = false;
      btn.textContent = "Import Calendar";
    }
  });

  document.getElementById("calendar-disconnect").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/calendar/disconnect", { method: "POST" });
    document.getElementById("calendar-url").value = "";
    load();
  });

  load();
})();
