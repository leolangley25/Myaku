/* Myaku — caffeine.
 *
 * Deliberately not a channel. It is here because energy drinks are the thing
 * people actually reach for, and because caffeine improves reaction time,
 * which means a dose taken before a vigilance session masks the impairment
 * that session exists to detect. The server records the gap as a covariate.
 *
 * Works signed out. Requiring an account before the useful part is what kills
 * a page like this, so entries fall back to local storage.
 */

(function () {
  M.boot("log");

  const HALF_LIFE_H = 5;
  const BED_THRESHOLD_MG = 50;

  const PRESETS = [
    { label: "Celsius", mg: 200 },
    { label: "Red Bull", mg: 80 },
    { label: "Monster", mg: 160 },
    { label: "Alani Nu", mg: 200 },
    { label: "Coffee", mg: 95 },
    { label: "Espresso", mg: 64 },
    { label: "Cold Brew", mg: 205 },
    { label: "Green Tea", mg: 28 },
  ];

  let signedIn = true;
  let entries = [];

  const LOCAL_KEY = "myaku.caffeine." + M.todayKey();

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch { return []; }
  }
  function saveLocal(list) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  }

  const nowTime = () => new Date().toTimeString().slice(0, 5);
  const toHours = (hhmm) => {
    const [h, m] = String(hhmm).split(":").map(Number);
    return h + (m || 0) / 60;
  };

  /* Exponential decay: what is left of each dose at a given hour. */
  function remainingAt(hour) {
    return entries.reduce((sum, e) => {
      const elapsed = hour - toHours(e.logged_at);
      if (elapsed < 0) return sum;
      return sum + e.mg * Math.pow(0.5, elapsed / HALF_LIFE_H);
    }, 0);
  }

  function drawDecay() {
    const el = document.getElementById("decay");
    if (!entries.length) {
      el.innerHTML = `<p class="empty">Log a drink to see the curve for today.</p>`;
      document.getElementById("bed-note").textContent = "";
      return;
    }

    const NS = "http://www.w3.org/2000/svg";
    const W = 600, H = 150, padL = 8, padR = 8, padT = 10, padB = 22;
    const startH = Math.max(0, Math.min(...entries.map((e) => toHours(e.logged_at))) - 0.5);
    const endH = 26; // run past midnight so bedtime is visible
    const points = [];
    for (let h = startH; h <= endH; h += 0.25) points.push([h, remainingAt(h)]);
    const peak = Math.max(BED_THRESHOLD_MG * 1.6, ...points.map((p) => p[1]));

    const x = (h) => padL + ((h - startH) / (endH - startH)) * (W - padL - padR);
    const y = (v) => H - padB - (v / peak) * (H - padT - padB);
    const n = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

    const svg = n("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: "100%", preserveAspectRatio: "none" });
    svg.style.display = "block";

    svg.appendChild(n("line", {
      x1: padL, x2: W - padR, y1: y(BED_THRESHOLD_MG), y2: y(BED_THRESHOLD_MG),
      stroke: "var(--label-3)", "stroke-width": 1, "stroke-dasharray": "4 4",
    }));

    const d = points.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1)).join(" ");
    svg.appendChild(n("path", {
      d: d + ` L${x(endH)},${H - padB} L${x(startH)},${H - padB} Z`,
      fill: "var(--orange)", opacity: 0.14,
    }));
    svg.appendChild(n("path", { d, fill: "none", stroke: "var(--orange)", "stroke-width": 2.5, "stroke-linejoin": "round" }));

    [6, 12, 18, 24].forEach((h) => {
      if (h < startH || h > endH) return;
      const t = n("text", { x: x(h), y: H - 5, "font-size": 10, fill: "var(--label-2)", "text-anchor": "middle" });
      t.textContent = h === 24 ? "12am" : h > 12 ? `${h - 12}pm` : `${h}am`;
      svg.appendChild(t);
    });

    el.innerHTML = "";
    el.appendChild(svg);

    // When does it drop under the level that starts to matter for sleep?
    let clears = null;
    for (let h = toHours(nowTime()); h <= endH; h += 0.25) {
      if (remainingAt(h) < BED_THRESHOLD_MG) { clears = h; break; }
    }
    const note = document.getElementById("bed-note");
    if (clears == null) {
      note.textContent = `This stays above ${BED_THRESHOLD_MG} mg past midnight, which is the range that starts to affect sleep.`;
    } else {
      const hh = Math.floor(clears % 24);
      const mm = Math.round((clears % 1) * 60);
      const label = `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")} ${hh >= 12 && hh < 24 ? "pm" : "am"}`;
      note.textContent = `Drops below ${BED_THRESHOLD_MG} mg around ${label}, and the dashed line marks that level.`;
    }
  }

  function render() {
    const total = entries.reduce((s, e) => s + e.mg, 0);
    document.getElementById("total-mg").textContent = Math.round(total);
    document.getElementById("now-mg").textContent = Math.round(remainingAt(toHours(nowTime())));

    const el = document.getElementById("entries");
    el.innerHTML = entries.length
      ? entries
          .map(
            (e) => `<div class="row">
              <span class="row-main">
                <span class="row-title">${M.esc(e.label || "Drink")}</span>
                <span class="row-sub">${M.esc(e.logged_at)}</span>
              </span>
              <span class="row-value mono">${Math.round(e.mg)} mg</span>
              ${e.id ? `<button type="button" class="btn btn-danger btn-sm" data-del="${e.id}">Remove</button>` : ""}
            </div>`
          )
          .join("")
      : `<div class="row"><span class="row-main"><span class="row-title secondary">Nothing logged yet today.</span></span></div>`;

    el.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        await M.api("/api/caffeine/" + b.getAttribute("data-del"), { method: "DELETE" }).catch(() => {});
        refresh();
      })
    );

    drawDecay();
  }

  async function add(label, mg) {
    if (!mg || mg <= 0) return;
    if (signedIn) {
      try {
        const r = await M.api("/api/caffeine", { method: "POST", body: { label, mg, loggedAt: nowTime() } });
        entries = r.entries;
        render();
        return;
      } catch { signedIn = false; }
    }
    entries = [{ label, mg, logged_at: nowTime() }, ...entries];
    saveLocal(entries);
    render();
  }

  async function refresh() {
    try {
      const r = await M.api("/api/caffeine");
      signedIn = true;
      entries = r.entries;
    } catch {
      signedIn = false;
      entries = loadLocal();
      document.getElementById("signin-prompt").hidden = false;
    }
    render();
  }

  document.getElementById("presets").innerHTML = PRESETS.map(
    (p) => `<button type="button" class="chip" data-mg="${p.mg}" data-label="${M.esc(p.label)}">${M.esc(p.label)} · ${p.mg}</button>`
  ).join("");

  document.querySelectorAll("[data-mg]").forEach((b) =>
    b.addEventListener("click", () => add(b.getAttribute("data-label"), Number(b.getAttribute("data-mg"))))
  );

  document.getElementById("custom-add").addEventListener("click", () => {
    const label = document.getElementById("custom-label").value.trim() || "Drink";
    const mg = Number(document.getElementById("custom-mg").value);
    add(label, mg);
    document.getElementById("custom-label").value = "";
    document.getElementById("custom-mg").value = "";
  });

  refresh();
})();
