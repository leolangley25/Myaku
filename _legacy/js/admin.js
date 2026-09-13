/* Myaku — admin aggregate dashboard. Every number here is aggregated across
   all users; nothing here is traceable back to an individual account. */

(function () {
  const ROLE_LABELS = { student_athlete: "Student Athlete", individual: "Individual", admin: "Admin" };
  const LOG_TYPE_LABELS = { caffeine: "Caffeine", hydration: "Hydration", screen_time: "Screen Time" };

  function metricRow(name, value) {
    return `<div class="metric-row"><span class="metric-name">${esc(name)}</span><span class="metric-value">${esc(value)}</span></div>`;
  }

  fetch("/api/admin/stats")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      const totalUsers = data.usersByRole.reduce((sum, r) => sum + r.count, 0);
      document.getElementById("admin-total-users").textContent = totalUsers;
      document.getElementById("admin-users-by-role").innerHTML = data.usersByRole
        .map((r) => metricRow(ROLE_LABELS[r.role] || r.role, r.count))
        .join("");

      document.getElementById("admin-total-checkins").textContent = data.totalCheckins;

      const avg = data.avgStress || {};
      document.getElementById("admin-avg-stress").innerHTML = [
        metricRow("Training Or Activity", avg.training != null ? `${Number(avg.training).toFixed(1)} / 5` : "No Data Yet"),
        metricRow("Academic Or Work", avg.academic != null ? `${Number(avg.academic).toFixed(1)} / 5` : "No Data Yet"),
        metricRow("Personal Life", avg.personal != null ? `${Number(avg.personal).toFixed(1)} / 5` : "No Data Yet"),
      ].join("");

      document.getElementById("admin-logs-by-type").innerHTML = data.logsByType.length
        ? data.logsByType.map((l) => metricRow(LOG_TYPE_LABELS[l.type] || l.type, l.count)).join("")
        : `<p class="empty-note">No logs recorded yet.</p>`;

      document.getElementById("admin-other").innerHTML = [
        metricRow("Journal Entries", data.totalJournalEntries),
        metricRow("Active Share Links", data.activeShareLinks),
      ].join("");
    });
})();
