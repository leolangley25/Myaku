/* Myaku — shared logic for the Caffeine / Hydration / Screen Time pages. */

(function () {
  const type = document.body.getAttribute("data-log-type");
  const config = MYAKU_LOG_CONFIGS[type];
  if (!config) return;

  function badgeClass(level) {
    return { low: "badge-low", moderate: "badge-moderate", elevated: "badge-elevated", neutral: "badge-neutral", accent: "badge-accent" }[
      level
    ] || "badge-neutral";
  }

  function nowTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function formatTime(hhmm) {
    const [h, m] = String(hhmm).split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
  }

  document.getElementById("log-form-container").innerHTML = `
    <div class="card">
      <label class="field-label" for="log-label">${config.labelField}</label>
      <input type="text" id="log-label" class="field-input" placeholder="${config.labelPlaceholder}" />

      <label class="field-label" for="log-amount">${config.amountField}</label>
      <input type="number" id="log-amount" class="field-input" placeholder="${config.amountPlaceholder}" min="0" />

      <label class="field-label" for="log-time">Time</label>
      <input type="time" id="log-time" class="field-input" value="${nowTime()}" />

      <label class="field-label" for="log-note">Note</label>
      <textarea id="log-note" class="note-input" placeholder="Add an optional note here."></textarea>

      <button class="btn btn-primary btn-block" id="log-submit" style="margin-top: 16px;">${config.submitLabel}</button>
    </div>
  `;

  document.getElementById("log-insight").innerHTML = `
    <div class="card insight-card">
      <div class="insight-top">
        <div class="insight-finding">${config.insight.finding}</div>
        <span class="badge ${badgeClass(config.insight.tagLevel)}"><span class="badge-dot"></span>${config.insight.tag}</span>
      </div>
      <div class="insight-support">${config.insight.support}</div>
    </div>
  `;

  function renderList(entries) {
    const listEl = document.getElementById("log-list");
    if (!entries.length) {
      listEl.innerHTML = `<p class="empty-note">${config.emptyNote}</p>`;
      return;
    }
    listEl.innerHTML = entries
      .map(
        (e) => `
        <div class="card log-item">
          <div>
            <span class="log-item-label">${e.label || "Entry"}</span>
            <span class="log-item-time">${formatTime(e.logged_at)}</span>
          </div>
          <div class="log-item-right">
            <span class="log-item-amount">${e.amount != null ? e.amount + config.unit : ""}</span>
            <button class="log-delete" data-id="${e.id}" aria-label="Delete entry">&times;</button>
          </div>
        </div>
      `
      )
      .join("");

    listEl.querySelectorAll(".log-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await fetch(`/api/logs/${btn.getAttribute("data-id")}`, { method: "DELETE" });
        load();
      });
    });
  }

  function load() {
    fetch(`/api/logs?type=${type}`)
      .then((r) => r.json())
      .then((data) => {
        renderList(data.entries || []);
        document.dispatchEvent(new CustomEvent("myaku:logs-updated", { detail: { type, entries: data.entries || [] } }));
      });
  }

  document.getElementById("log-submit").addEventListener("click", async () => {
    const label = document.getElementById("log-label").value.trim();
    const amount = document.getElementById("log-amount").value;
    const time = document.getElementById("log-time").value || nowTime();
    const note = document.getElementById("log-note").value.trim();

    await fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, label, amount, loggedAt: time, note }),
    });

    document.getElementById("log-label").value = "";
    document.getElementById("log-amount").value = "";
    document.getElementById("log-note").value = "";
    document.getElementById("log-time").value = nowTime();
    load();
  });

  document.addEventListener("myaku:caffeine-preset-added", load);

  load();
})();
