/* Myaku — manage high-load periods (season phases, exam weeks, etc). */

(function () {
  function formatDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function phaseCardHTML(phase) {
    return `
      <div class="card log-item" data-id="${phase.id}">
        <div>
          <span class="log-item-label">${phase.label}</span>
          <span class="log-item-time">${formatDate(phase.start_date)} – ${formatDate(phase.end_date)}</span>
        </div>
        <button class="log-delete phase-delete" data-id="${phase.id}" aria-label="Remove period">&times;</button>
      </div>
    `;
  }

  function load() {
    fetch("/api/phases")
      .then((r) => r.json())
      .then((data) => {
        const el = document.getElementById("phase-list");
        const phases = data.phases || [];
        if (!phases.length) {
          el.innerHTML = `<p class="empty-note">You haven't marked any high-load periods yet.</p>`;
          return;
        }
        el.innerHTML = phases.map(phaseCardHTML).join("");
        el.querySelectorAll(".phase-delete").forEach((btn) => {
          btn.addEventListener("click", async () => {
            await fetch(`/api/phases/${btn.getAttribute("data-id")}`, { method: "DELETE" });
            load();
          });
        });
      });
  }

  document.getElementById("phase-add").addEventListener("click", async () => {
    const label = document.getElementById("phase-label").value.trim();
    const startDate = document.getElementById("phase-start").value;
    const endDate = document.getElementById("phase-end").value;
    const errorEl = document.getElementById("phase-error");
    errorEl.style.display = "none";

    if (!label || !startDate || !endDate) {
      errorEl.textContent = "A label, start date, and end date are all required.";
      errorEl.style.display = "block";
      return;
    }

    await fetch("/api/phases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, startDate, endDate }),
    });

    document.getElementById("phase-label").value = "";
    document.getElementById("phase-start").value = "";
    document.getElementById("phase-end").value = "";
    load();
  });

  load();
})();
