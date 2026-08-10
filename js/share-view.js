/* Myaku — public read-only view for a share link. Redacted summary only:
   no journal content, no raw domain numbers, no habit logs. */

(function () {
  const token = new URLSearchParams(window.location.search).get("token");
  const card = document.getElementById("share-view-card");

  function badgeHTML(level, label) {
    const cls = { low: "badge-low", moderate: "badge-moderate", elevated: "badge-elevated" }[level] || "badge-neutral";
    return `<span class="badge ${cls}"><span class="badge-dot"></span>${label}</span>`;
  }

  function render(data) {
    const levelLabel = { low: "Low", moderate: "Moderate", elevated: "Elevated" }[data.level] || "No Data Yet";
    card.innerHTML = `
      <div class="auth-brand">Myaku</div>
      <h1>${data.name}</h1>
      <p class="page-intro" style="margin-bottom: 18px;">A redacted summary shared with you.</p>

      <div class="card">
        <div class="card-label">Current Status</div>
        ${data.hasCheckin ? badgeHTML(data.level, levelLabel) : `<span class="badge badge-neutral"><span class="badge-dot"></span>No Data Yet</span>`}
        <div class="metric-row" style="margin-top: 14px;">
          <span class="metric-name">Most Recent Check-In</span>
          <span class="metric-value">${data.hasCheckin ? `${data.daysAgo} Day${data.daysAgo === 1 ? "" : "s"} Ago` : "None Yet"}</span>
        </div>
        <div class="metric-row">
          <span class="metric-name">Total Check-Ins</span>
          <span class="metric-value">${data.totalCheckins}</span>
        </div>
        <div class="metric-row">
          <span class="metric-name">Connected Data Sources</span>
          <span class="metric-value">${data.connectedCount}</span>
        </div>
      </div>

      <p class="empty-note" style="margin-top: 18px;">This is a limited summary. Full journal and daily logs stay private.</p>
    `;
  }

  function renderError(message) {
    card.innerHTML = `
      <div class="auth-brand">Myaku</div>
      <h1>Link Not Available</h1>
      <p class="page-intro">${message}</p>
    `;
  }

  if (!token) {
    renderError("This share link is invalid or has been removed.");
  } else {
    fetch(`/api/share/public/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then(render)
      .catch(() => renderError("This share link is invalid or has been removed."));
  }
})();
