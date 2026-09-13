/* Myaku — More. Setup, sensitivity, marked periods, sharing, and the account. */

(function () {
  M.boot("more");

  const ICON = {
    body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
    tune: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20"/></svg>',
  };

  let sensitivity = "medium";

  /* Each option is described by what it does, because "light" and "heavy" on
     their own could reasonably be read either direction. */
  const LEVELS = [
    { id: "heavy", label: "Heavy", sub: "Flags smaller shifts, and after a single week." },
    { id: "medium", label: "Medium", sub: "Balanced, and the setting most people should keep." },
    { id: "light", label: "Light", sub: "Stays quiet until a divergence is large and sustained." },
  ];

  const check = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width:20px;height:20px;color:var(--primary)"><path d="M9.55 17.6 4 12.05l1.4-1.4 4.15 4.15 9.05-9.05L20 7.15z"/></svg>';

  function setStatus(el, tone, text) {
    el.className = `status-line${tone ? " " + tone : ""}`;
    el.textContent = text;
  }

  /* ---------------- setup ---------------- */

  function renderSetup(me) {
    const connected = (me.integrations || []).filter((i) => i.provider !== "calendar").length;
    document.getElementById("setup-rows").innerHTML = [
      M.row({
        title: "Data Sources", href: "sources.html", icon: ICON.body, tint: "var(--ch-auto)",
        sub: connected ? `${connected} source${connected === 1 ? "" : "s"} feeding your Body channel.` : "Connect a wearable, import, or enter a night by hand.",
      }),
      M.row({
        title: "Reminders", href: "reminders.html", icon: ICON.bell, tint: "var(--primary)",
        sub: me.reminders.enabled ? (me.reminders.subscribed ? "On, and sent to this account's devices." : "On, but no device is set to receive them.") : "Off. Consistency is easier with a nudge.",
      }),
      M.row({
        title: "Edit Calibration", href: "calibrate.html?from=more", icon: ICON.tune, tint: "var(--ch-psy)",
        sub: me.calibration ? `Set for ${me.calibration.sport || "your sport"}.` : "Tell Myaku your usual levels.",
      }),
      M.row({
        title: "How Myaku Works", href: "method.html", icon: ICON.book, tint: "var(--ch-cog)",
        sub: "The method, the thresholds, and the limits.",
      }),
    ].join("");
  }

  /* ---------------- sensitivity ---------------- */

  function renderSensitivity() {
    document.getElementById("sensitivity").innerHTML = LEVELS.map(
      (l) => `<button type="button" class="row" role="radio" aria-checked="${l.id === sensitivity}" data-level="${l.id}"
          style="width:100%;text-align:left;border:none;font:inherit;">
        <span class="row-main">
          <span class="row-title">${l.label}</span>
          <span class="row-sub">${l.sub}</span>
        </span>
        ${l.id === sensitivity ? check : ""}
      </button>`
    ).join("");

    document.querySelectorAll("[data-level]").forEach((b) =>
      b.addEventListener("click", async () => {
        const level = b.getAttribute("data-level");
        if (level === sensitivity) return;
        try {
          await M.api("/api/settings/sensitivity", { method: "POST", body: { sensitivity: level } });
          sensitivity = level;
          renderSensitivity();
          document.querySelector(`[data-level="${level}"]`).focus();
          document.getElementById("sens-note").textContent =
            "Saved, and your channels will be read against the new bar from now on.";
        } catch (err) {
          document.getElementById("sens-note").textContent = err.message;
        }
      })
    );
  }

  /* ---------------- periods ---------------- */

  function renderPhases(phases) {
    document.getElementById("phases").innerHTML = phases.length
      ? phases.map((p) => `<div class="row">
            <span class="row-main">
              <span class="row-title">${M.esc(p.label)}</span>
              <span class="row-sub">${M.esc(M.prettyDate(p.start_date))} to ${M.esc(M.prettyDate(p.end_date))}</span>
            </span>
            <button type="button" class="btn btn-danger btn-sm" data-phase="${p.id}" aria-label="Remove ${M.esc(p.label)}">Remove</button>
          </div>`).join("")
      : `<div class="row"><span class="row-main"><span class="row-title secondary">No periods marked yet.</span></span></div>`;

    document.querySelectorAll("[data-phase]").forEach((b) =>
      b.addEventListener("click", async () => {
        await M.api("/api/phases/" + b.getAttribute("data-phase"), { method: "DELETE" }).catch(() => {});
        loadPhases();
      })
    );
  }

  const loadPhases = () => M.api("/api/phases").then(({ phases }) => renderPhases(phases)).catch(() => {});

  document.getElementById("phase-add").addEventListener("click", async () => {
    const status = document.getElementById("phase-status");
    const label = document.getElementById("phase-label").value.trim();
    const startDate = document.getElementById("phase-start").value;
    const endDate = document.getElementById("phase-end").value;
    if (!label || !startDate || !endDate) return setStatus(status, "error", "Give the period a name, a start date, and an end date.");
    try {
      await M.api("/api/phases", { method: "POST", body: { label, startDate, endDate } });
      document.getElementById("phase-label").value = "";
      setStatus(status, "ok", "Marked. Trends will compare this stretch against the rest of your season.");
      loadPhases();
    } catch (err) {
      setStatus(status, "error", err.message);
    }
  });

  /* ---------------- sharing ---------------- */

  function renderShares(links) {
    document.getElementById("shares").innerHTML = links.length
      ? links.map((l) => {
          const url = `${location.origin}/share-view.html?token=${encodeURIComponent(l.token)}`;
          return `<div class="row" style="align-items:flex-start;">
            <span class="row-main">
              <span class="row-title">${M.esc(l.label || "Untitled Link")}</span>
              <span class="row-sub" style="word-break:break-all;">${l.revoked ? "Revoked" : M.esc(url)}</span>
            </span>
            ${l.revoked ? "" : `<div style="display:flex;flex-direction:column;gap:6px;">
              <button type="button" class="btn btn-tinted btn-sm" data-copy="${M.esc(url)}">Copy</button>
              <button type="button" class="btn btn-danger btn-sm" data-revoke="${l.id}">Revoke</button>
            </div>`}
          </div>`;
        }).join("")
      : `<div class="row"><span class="row-main"><span class="row-title secondary">No links created yet.</span></span></div>`;

    document.querySelectorAll("[data-copy]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy);
          b.textContent = "Copied";
        } catch {
          b.textContent = "Copy Failed";
        }
        setTimeout(() => (b.textContent = "Copy"), 1600);
      })
    );
    document.querySelectorAll("[data-revoke]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Revoke this link? Anyone holding it will stop seeing your pattern.")) return;
        await M.api(`/api/share/${b.getAttribute("data-revoke")}/revoke`, { method: "POST" }).catch(() => {});
        loadShares();
      })
    );
  }

  const loadShares = () => M.api("/api/share").then(({ links }) => renderShares(links)).catch(() => {});

  document.getElementById("share-add").addEventListener("click", async () => {
    const label = document.getElementById("share-label").value.trim();
    await M.api("/api/share", { method: "POST", body: { label } }).catch(() => {});
    document.getElementById("share-label").value = "";
    loadShares();
  });

  /* ---------------- account ---------------- */

  document.getElementById("delete-account").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const status = document.getElementById("delete-status");
    const password = document.getElementById("delete-password").value;
    if (!password) return setStatus(status, "error", "Enter your password to confirm.");
    if (!confirm("Delete your account and every piece of data in it? This cannot be undone.")) return;
    btn.disabled = true;
    try {
      await M.api("/api/account/delete", { method: "POST", body: { password } });
      location.href = "signup.html";
    } catch (err) {
      setStatus(status, "error", err.message);
      btn.disabled = false;
    }
  });

  document.getElementById("logout").addEventListener("click", async () => {
    await M.api("/api/logout", { method: "POST" }).catch(() => {});
    location.href = "login.html";
  });

  M.api("/api/me")
    .then((me) => {
      document.getElementById("who").textContent = `${me.user.name} · ${me.user.email}`;
      sensitivity = me.user.sensitivity || "medium";
      renderSetup(me);
      renderSensitivity();
      document.getElementById("sens-note").textContent =
        "This changes how far a channel has to move, and for how long, before Myaku names a pattern.";
    })
    .catch(() => {});

  loadPhases();
  loadShares();
})();
