/* Myaku — data sources.
 *
 * Every route into the Body channel in one place: the two wearable providers,
 * the Apple Health export, a spreadsheet, and entry by hand. A provider that is
 * not configured on this server says so plainly rather than offering a button
 * that pretends to connect.
 */

(function () {
  M.boot("more");

  const params = new URLSearchParams(location.search);

  const LABELS = {
    whoop: "Whoop",
    google: "Google Health",
    apple_health: "Apple Health Export",
    csv: "Spreadsheet",
    manual: "Entered By Hand",
    demo: "Demo Season",
  };

  const BANNERS = {
    connected: (p) => ({ tone: "ok", text: `${LABELS[p] || "Provider"} connected. Your past months are importing now, which can take a minute.` }),
    denied: () => ({ tone: "error", text: "The connection was cancelled, so nothing was shared." }),
    state: () => ({ tone: "error", text: "That connection attempt expired, so please try again." }),
    exchange: () => ({ tone: "error", text: "The provider did not finish the connection, so please try again." }),
    "not-configured": () => ({ tone: "error", text: "That provider needs developer credentials on the server before anyone can connect it." }),
    unknown: () => ({ tone: "error", text: "That provider is not supported." }),
  };

  function renderBanner() {
    const key = params.get("connected") ? "connected" : params.get("error");
    if (!key || !BANNERS[key]) return;
    const { tone, text } = BANNERS[key](params.get("connected") || params.get("provider"));
    document.getElementById("banner").innerHTML = `<div class="banner ${tone}" role="status">${M.esc(text)}</div>`;
    if (params.get("from") === "welcome") return;
    history.replaceState(null, "", location.pathname);
  }

  /* ---------------- wearables ---------------- */

  const WEARABLE_SUB = {
    whoop: "Recovery, sleep, and heart rate variability, over the Whoop v2 API.",
    google: "For Fitbit Air, Fitbit, and Pixel Watch, over the Google Health API.",
  };

  function wearableCard(p) {
    const status = !p.available
      ? "Not set up on this server. It needs developer credentials, which the setup guide in the project explains."
      : p.connected
        ? p.last_error
          ? `Last sync failed: ${p.last_error}`
          : `Connected. Last synced ${M.ago(p.last_synced_at)}${p.rows_imported != null ? `, ${p.rows_imported} nights updated` : ""}.`
        : WEARABLE_SUB[p.id];

    const actions = !p.available
      ? ""
      : p.connected
        ? `<div class="grid-2" style="margin-top:14px;">
             <button class="btn btn-tinted" data-sync="${p.id}">Sync Now</button>
             <button class="btn btn-gray" data-disconnect="${p.id}">Disconnect</button>
           </div>`
        : `<a class="btn btn-filled btn-block" style="margin-top:14px;" href="/api/integrations/${p.id}/start">Connect ${M.esc(p.label)}</a>`;

    return `<div class="card">
      <div class="spread">
        <p class="title-3">${M.esc(p.label)}</p>
        ${M.pill(!p.available ? "Setup Needed" : p.connected ? (p.last_error ? "Needs Attention" : "Connected") : "Not Connected",
          !p.available ? "" : p.connected ? (p.last_error ? "warn" : "good") : "info")}
      </div>
      <p class="status-line${p.last_error ? " error" : ""}">${M.esc(status)}</p>
      ${actions}
    </div>`;
  }

  function renderStored(providers, metricDays) {
    const rows = providers.filter((p) => p.connected || p.last_synced_at);
    document.getElementById("summary").textContent = metricDays
      ? `${metricDays} nights of body data stored so far.`
      : "No body data stored yet. Any source below gives your Body channel a start.";

    document.getElementById("stored").innerHTML = rows.length
      ? rows.map((p) => `<div class="row" style="align-items:flex-start;">
          <span class="row-main">
            <span class="row-title">${M.esc(LABELS[p.id] || p.id)}</span>
            <span class="row-sub">${p.last_synced_at ? `Updated ${M.ago(p.last_synced_at)}.` : "Connected, waiting for its first sync."}</span>
          </span>
          <button type="button" class="btn btn-danger btn-sm" data-remove="${p.id}">Remove</button>
        </div>`).join("")
      : `<div class="row"><span class="row-main"><span class="row-title secondary">Nothing stored yet.</span></span></div>`;
  }

  async function load() {
    let data;
    try {
      data = await M.api("/api/integrations");
    } catch {
      return;
    }
    const oauth = data.providers.filter((p) => p.kind === "oauth");
    document.getElementById("wearables").innerHTML = oauth.map(wearableCard).join("");
    renderStored(data.providers, data.metricDays);
    bindActions();
  }

  function bindActions() {
    document.querySelectorAll("[data-sync]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        b.textContent = "Syncing";
        try {
          const r = await M.api(`/api/integrations/${b.dataset.sync}/sync`, { method: "POST" });
          showBanner("ok", `Synced. ${r.stored} nights updated.`);
        } catch (err) {
          showBanner("error", err.message);
        }
        load();
      })
    );

    document.querySelectorAll("[data-disconnect]").forEach((b) =>
      b.addEventListener("click", async () => {
        const label = LABELS[b.dataset.disconnect];
        if (!confirm(`Disconnect ${label}? Your past nights stay, and nothing new will arrive.`)) return;
        await M.api(`/api/integrations/${b.dataset.disconnect}`, { method: "DELETE" }).catch(() => {});
        load();
      })
    );

    document.querySelectorAll("[data-remove]").forEach((b) =>
      b.addEventListener("click", async () => {
        const label = LABELS[b.dataset.remove];
        if (!confirm(`Remove ${label} and delete every night it provided? This cannot be undone.`)) return;
        try {
          const r = await M.api(`/api/integrations/${b.dataset.remove}?deleteData=1`, { method: "DELETE" });
          showBanner("ok", `Removed ${label}, along with ${r.removed} nights of its data.`);
        } catch (err) {
          showBanner("error", err.message);
        }
        load();
      })
    );
  }

  function showBanner(tone, text) {
    document.getElementById("banner").innerHTML = `<div class="banner ${tone}" role="status">${M.esc(text)}</div>`;
  }

  /* ---------------- apple health ---------------- */

  const appleStatus = document.getElementById("apple-status");
  const appleMeter = document.getElementById("apple-meter");

  function setStatus(el, tone, text) {
    el.className = `status-line${tone ? " " + tone : ""}`;
    el.textContent = text;
  }

  /* A plain XMLHttpRequest rather than fetch, because fetch cannot report upload
     progress, and an export of several hundred megabytes with no progress looks
     exactly like a frozen page. */
  function uploadAppleHealth(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/import/apple-health");
      xhr.setRequestHeader("Content-Type", file.type || "application/xml");
      xhr.setRequestHeader("X-Local-Date", M.todayKey());
      xhr.setRequestHeader("X-Timezone", M.timezone());
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        appleMeter.firstElementChild.style.width = pct + "%";
        appleMeter.setAttribute("aria-valuenow", String(pct));
        if (pct >= 100) setStatus(appleStatus, "", "Uploaded. Reading the records now.");
      };
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* an empty or non-JSON body falls through to the generic message */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || "The import did not finish, so please try again."));
      };
      xhr.onerror = () => reject(new Error("The upload was interrupted, so please try again."));
      xhr.send(file);
    });
  }

  async function importApple(file) {
    if (!file) return;
    if (/\.zip$/i.test(file.name)) {
      return setStatus(appleStatus, "error", "That is the zipped archive. Unzip it first, then choose export.xml from inside.");
    }
    if (!/\.xml$/i.test(file.name)) {
      return setStatus(appleStatus, "error", "Choose the export.xml file from the unzipped Apple Health export.");
    }
    appleMeter.hidden = false;
    setStatus(appleStatus, "", `Uploading ${(file.size / 1048576).toFixed(1)} megabytes.`);
    try {
      const r = await uploadAppleHealth(file);
      setStatus(appleStatus, "ok", `Imported ${r.days} nights from ${r.records.toLocaleString()} records.`);
      load();
    } catch (err) {
      setStatus(appleStatus, "error", err.message);
    }
  }

  document.getElementById("apple-file").addEventListener("change", (e) => importApple(e.target.files[0]));

  const drop = document.getElementById("apple-drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    importApple(e.dataTransfer.files[0]);
  });

  /* ---------------- spreadsheet ---------------- */

  const csvStatus = document.getElementById("csv-status");
  const csvImport = document.getElementById("csv-import");
  let csvRows = [];

  const ALIASES = {
    date: ["date", "day", "night"],
    hrv: ["hrv", "hrv_ms", "heart_rate_variability", "rmssd"],
    rhr: ["rhr", "rhr_bpm", "resting_heart_rate", "resting_hr"],
    sleepMinutes: ["sleep_minutes", "minutes_asleep", "sleep_min", "asleep_minutes"],
    sleepHours: ["sleep_hours", "hours_asleep", "sleep"],
    sleepEfficiency: ["sleep_efficiency", "efficiency", "sleep_quality"],
  };

  /* Enough CSV for the files people actually export: quoted fields, commas inside
     quotes, and either line ending. */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((f) => f.trim() !== ""));
  }

  function toMetricRows(table) {
    const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const col = (key) => header.findIndex((h) => ALIASES[key].includes(h));
    const idx = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, col(k)]));
    if (idx.date === -1) throw new Error("The file needs a column named date.");

    const num = (r, k) => {
      if (idx[k] === -1) return null;
      const v = Number(String(r[idx[k]] || "").trim());
      return String(r[idx[k]] || "").trim() === "" || !Number.isFinite(v) ? null : v;
    };

    return table.slice(1).map((r) => {
      const raw = String(r[idx.date] || "").trim();
      const parsed = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : (() => {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })();
      const hours = num(r, "sleepHours");
      return {
        date: parsed,
        hrv: num(r, "hrv"),
        rhr: num(r, "rhr"),
        sleepMinutes: num(r, "sleepMinutes") ?? (hours != null ? hours * 60 : null),
        sleepEfficiency: num(r, "sleepEfficiency"),
      };
    }).filter((r) => r.date);
  }

  document.getElementById("csv-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    csvImport.hidden = true;
    if (!file) return;
    try {
      const table = parseCsv(await file.text());
      if (table.length < 2) throw new Error("That file has no rows under its header.");
      csvRows = toMetricRows(table);
      if (!csvRows.length) throw new Error("No rows had a date that could be read.");
      setStatus(csvStatus, "", `${csvRows.length} rows found, from ${csvRows[0].date} to ${csvRows[csvRows.length - 1].date}.`);
      csvImport.hidden = false;
    } catch (err) {
      setStatus(csvStatus, "error", err.message);
    }
  });

  csvImport.addEventListener("click", async () => {
    csvImport.disabled = true;
    try {
      const r = await M.api("/api/metrics", { method: "POST", body: { source: "csv", days: csvRows } });
      setStatus(csvStatus, "ok", `Imported ${r.stored} nights.${r.skipped ? ` ${r.skipped} rows were skipped because their values were implausible.` : ""}`);
      csvImport.hidden = true;
      load();
    } catch (err) {
      setStatus(csvStatus, "error", err.message);
    }
    csvImport.disabled = false;
  });

  /* ---------------- manual ---------------- */

  const mDate = document.getElementById("m-date");
  mDate.value = M.todayKey();
  mDate.max = M.todayKey();

  document.getElementById("m-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const status = document.getElementById("m-status");
    const val = (id) => {
      const s = document.getElementById(id).value.trim();
      return s === "" ? null : Number(s);
    };
    const hours = val("m-hours");
    const row = {
      date: mDate.value,
      sleepMinutes: hours != null ? hours * 60 : null,
      sleepEfficiency: val("m-eff"),
      hrv: val("m-hrv"),
      rhr: val("m-rhr"),
    };
    if (!row.date) return setStatus(status, "error", "Choose the date this night ended on.");
    if ([row.sleepMinutes, row.sleepEfficiency, row.hrv, row.rhr].every((v) => v == null)) {
      return setStatus(status, "error", "Fill in at least one of the four values.");
    }
    btn.disabled = true;
    try {
      const r = await M.api("/api/metrics", { method: "POST", body: { source: "manual", days: [row] } });
      if (!r.stored) throw new Error("Those values look implausible, so check them and try again.");
      setStatus(status, "ok", `Saved the night ending ${M.prettyDate(row.date)}.`);
      ["m-hours", "m-eff", "m-hrv", "m-rhr"].forEach((id) => (document.getElementById(id).value = ""));
      load();
    } catch (err) {
      setStatus(status, "error", err.message);
    }
    btn.disabled = false;
  });

  renderBanner();
  load();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();
