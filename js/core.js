/* Myaku — shared front-end layer: fetch wrapper, escaping, small render
   helpers, accessible controls, push notifications, and the navigation bar.
   Loaded on every page, after motion.js and explain.js. */

const M = (() => {
  /* ---------------- escaping ---------------- */

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ---------------- dates ---------------- */

  const pad2 = (n) => String(n).padStart(2, "0");

  const keyOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  const todayKey = () => keyOf(new Date());

  function shiftKey(key, days) {
    const d = new Date(key + "T00:00:00");
    d.setDate(d.getDate() + days);
    return keyOf(d);
  }

  function weekStartKey(key) {
    const d = new Date((key || todayKey()) + "T00:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return keyOf(d);
  }

  function prettyDate(key) {
    return new Date(key + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric",
    });
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return "Good Night";
    if (h < 12) return "Good Morning";
    if (h < 17) return "Good Afternoon";
    if (h < 21) return "Good Evening";
    return "Good Night";
  }

  function timezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }

  /* Server timestamps are SQLite UTC strings with a space instead of a T. */
  const parseStamp = (s) => (s ? Date.parse(String(s).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z")) : NaN);

  function ago(stamp) {
    const t = parseStamp(stamp);
    if (Number.isNaN(t)) return "never";
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins} minutes ago`;
    const hours = Math.round(mins / 60);
    if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  /* ---------------- api ---------------- */

  /* Pages reachable without an account. A 401 on one of these is an answer to
     show, not a reason to bounce to the sign-in page. */
  const PUBLIC_PAGES = /\/(login|signup|caffeine|share-view|404|500)\.html$/;

  /* Every request carries the athlete's own date, time, and zone, because the
     server's clock is in the wrong place: nine in the evening in Los Angeles is
     already tomorrow in UTC. */
  function localHeaders() {
    const now = new Date();
    return {
      "X-Local-Date": keyOf(now),
      "X-Local-Time": `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
      "X-Timezone": timezone(),
    };
  }

  async function api(path, options = {}) {
    const headers = { ...localHeaders(), ...(options.headers || {}) };
    let body = options.body;
    if (body !== undefined && !(body instanceof Blob) && typeof body !== "string") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(path, { ...options, headers, body, credentials: "same-origin" });
    } catch {
      throw new Error("You appear to be offline, so try again when you are connected.");
    }

    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      if (!PUBLIC_PAGES.test(location.pathname)) {
        location.href = "login.html";
        throw new Error("unauthenticated");
      }
      // On a public page the server's own message is the useful one, such as
      // telling somebody their password was wrong.
      throw Object.assign(new Error(data.error || "unauthenticated"), { status: 401 });
    }
    if (!res.ok) {
      throw Object.assign(new Error(data.error || "Something went wrong, so please try again."), { status: res.status });
    }
    return data;
  }

  /* ---------------- render helpers ---------------- */

  function row({ title, sub, value, href, icon, tint, onClick }) {
    const tag = href ? "a" : onClick ? "button" : "div";
    const attrs = href ? ` href="${esc(href)}"` : tag === "button" ? ' type="button" style="width:100%;text-align:left;border:none;font:inherit;"' : "";
    return `<${tag} class="row"${attrs}>
      ${icon ? `<span class="row-icon" aria-hidden="true" style="color:${esc(tint || "var(--on-surface-variant)")}">${icon}</span>` : ""}
      <span class="row-main">
        <span class="row-title">${esc(title)}</span>
        ${sub ? `<span class="row-sub">${esc(sub)}</span>` : ""}
      </span>
      ${value != null ? `<span class="row-value">${esc(value)}</span>` : ""}
      ${href ? `<span class="chevron" aria-hidden="true"></span>` : ""}
    </${tag}>`;
  }

  function group(rowsHtml) {
    return `<div class="group">${rowsHtml}</div>`;
  }

  function pill(text, tone) {
    const cls = { good: "pill-green", warn: "pill-orange", bad: "pill-red", info: "pill-blue" }[tone] || "";
    return `<span class="pill ${cls}"><span class="pill-dot" aria-hidden="true"></span>${esc(text)}</span>`;
  }

  function confidenceLabel(confidence) {
    return {
      calibrating: "Still Learning You",
      provisional: "Early Reading",
      established: "Solid Baseline",
    }[confidence] || "Reading";
  }

  const humanize = (name) =>
    String(name).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  /* ---------------- rating scales ---------------- */

  /* A radio group rather than a row of toggle buttons: one answer at a time, one
     tab stop for the whole row, and arrow keys to move between options, which is
     how a screen reader expects a single-choice rating to behave. */
  function scale({ name, min = 1, max = 7, value, lowLabel, highLabel, compact, label }) {
    let opts = "";
    for (let i = min; i <= max; i++) {
      const on = value === i;
      const focusable = on || (value == null && i === min);
      const spoken = `${i}${i === min && lowLabel ? `, ${lowLabel}` : ""}${i === max && highLabel ? `, ${highLabel}` : ""}`;
      opts += `<button type="button" class="scale-opt" role="radio" data-scale="${esc(name)}" data-value="${i}"
        aria-checked="${on}" aria-label="${esc(spoken)}" tabindex="${focusable ? 0 : -1}">${i}</button>`;
    }
    const cls = "scale" + (compact || max - min >= 8 ? " compact" : "");
    return `<div class="${cls}" role="radiogroup" aria-label="${esc(label || humanize(name))}">${opts}</div>
      ${lowLabel ? `<div class="scale-ends" aria-hidden="true"><span>${esc(lowLabel)}</span><span>${esc(highLabel)}</span></div>` : ""}`;
  }

  /* A scale whose options are words rather than numbers. Used where a bare
     number would be guessed at rather than answered. */
  function wordScale({ name, options, label }) {
    return `<div class="scale worded" role="radiogroup" aria-label="${esc(label || humanize(name))}">${options
      .map((text, i) => `<button type="button" class="scale-opt" role="radio" data-scale="${esc(name)}" data-value="${i + 1}"
        aria-checked="false" tabindex="${i === 0 ? 0 : -1}">${esc(text)}</button>`)
      .join("")}</div>`;
  }

  /* Wire every scale in a container to a value object, with arrow-key movement. */
  function bindScales(container, store, onChange) {
    const siblingsOf = (btn) => [...container.querySelectorAll(`[data-scale="${CSS.escape(btn.dataset.scale)}"]`)];

    function select(btn) {
      const value = Number(btn.dataset.value);
      store[btn.dataset.scale] = value;
      siblingsOf(btn).forEach((b) => {
        const on = Number(b.dataset.value) === value;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      if (onChange) onChange(btn.dataset.scale, value);
    }

    container.querySelectorAll("[data-scale]").forEach((btn) => {
      btn.addEventListener("click", () => select(btn));
      btn.addEventListener("keydown", (e) => {
        const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        const siblings = siblingsOf(btn);
        let i = siblings.indexOf(btn);
        if (e.key in moves) i = Math.max(0, Math.min(siblings.length - 1, i + moves[e.key]));
        else if (e.key === "Home") i = 0;
        else if (e.key === "End") i = siblings.length - 1;
        else return;
        e.preventDefault();
        select(siblings[i]);
        siblings[i].focus();
      });
    });
  }

  function resetScales(container, store) {
    const seen = new Set();
    container.querySelectorAll("[data-scale]").forEach((b) => {
      const first = !seen.has(b.dataset.scale);
      seen.add(b.dataset.scale);
      b.setAttribute("aria-checked", "false");
      b.tabIndex = first ? 0 : -1;
      store[b.dataset.scale] = null;
    });
  }

  function bindChips(container, store, key, onChange) {
    store[key] = store[key] || [];
    container.querySelectorAll("[data-chip]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-chip");
        const i = store[key].indexOf(v);
        if (i === -1) store[key].push(v);
        else store[key].splice(i, 1);
        btn.setAttribute("aria-pressed", String(i === -1));
        if (onChange) onChange(key, store[key]);
      });
    });
  }

  function setChips(container, store, key, values) {
    store[key] = [...values];
    container.querySelectorAll("[data-chip]").forEach((b) => {
      b.setAttribute("aria-pressed", String(values.includes(b.getAttribute("data-chip"))));
    });
  }

  /* ---------------- two-axis pad ---------------- */

  /* Renders a square where one gesture sets two values, with two sliders beneath
     it. The square is the fast way; the sliders are the accessible way, for
     anyone who cannot drag or who navigates by keyboard or screen reader. Both
     drive the same value. */
  function padMarkup({ id, tint, top, bottom, left, right, corners = {}, label }) {
    const corner = (pos, textValue) =>
      textValue ? `<span class="pad-corner ${pos}" aria-hidden="true">${esc(textValue)}</span>` : "";
    const xName = `${left} To ${right}`;
    const yName = `${bottom} To ${top}`;
    return `<div class="pad" id="${esc(id)}" tabindex="0" role="group"
        aria-label="${esc(label || `${xName}, and ${yName}`)}. Use the arrow keys to move."
        data-x-name="${esc(xName)}" data-y-name="${esc(yName)}">
      ${tint ? `<span class="pad-tint ${esc(tint)}" aria-hidden="true"></span>` : ""}
      <span class="pad-axis h" aria-hidden="true"></span>
      <span class="pad-axis v" aria-hidden="true"></span>
      <span class="pad-label top" aria-hidden="true">${esc(top)}</span>
      <span class="pad-label bottom" aria-hidden="true">${esc(bottom)}</span>
      <span class="pad-label left" aria-hidden="true">${esc(left)}</span>
      <span class="pad-label right" aria-hidden="true">${esc(right)}</span>
      ${corner("tl", corners.tl)}${corner("tr", corners.tr)}
      ${corner("bl", corners.bl)}${corner("br", corners.br)}
      <span class="pad-dot-layer" id="${esc(id)}-layer" aria-hidden="true"><span class="pad-dot" id="${esc(id)}-dot"></span></span>
      <span class="sr-only" aria-live="polite" id="${esc(id)}-live"></span>
    </div>
    <details class="pad-sliders">
      <summary>Use Sliders Instead</summary>
      <label class="pad-slider"><span>${esc(xName)}</span><input type="range" id="${esc(id)}-x" /></label>
      <label class="pad-slider"><span>${esc(yName)}</span><input type="range" id="${esc(id)}-y" /></label>
    </details>`;
  }

  /* `step` of 1 snaps to integers, which is what a zero-to-ten axis wants;
     leaving it null keeps the continuous resolution the affect grid uses. */
  function bindPad(id, { xMin = -1, xMax = 1, yMin = -1, yMax = 1, step = null, onChange }) {
    const pad = document.getElementById(id);
    const layer = document.getElementById(id + "-layer");
    const dot = document.getElementById(id + "-dot");
    const live = document.getElementById(id + "-live");
    const sliderX = document.getElementById(id + "-x");
    const sliderY = document.getElementById(id + "-y");
    let x = null;
    let y = null;

    const round = (v) => (step ? Math.round(v / step) * step : +v.toFixed(2));
    const clampX = (v) => Math.max(xMin, Math.min(xMax, v));
    const clampY = (v) => Math.max(yMin, Math.min(yMax, v));

    [[sliderX, xMin, xMax], [sliderY, yMin, yMax]].forEach(([el, lo, hi]) => {
      if (!el) return;
      el.min = lo;
      el.max = hi;
      el.step = step || (hi - lo) / 40;
      el.value = (lo + hi) / 2;
    });

    function setValue(nx, ny, notify) {
      const first = x == null;
      x = round(clampX(nx));
      y = round(clampY(ny));
      const px = (x - xMin) / (xMax - xMin);
      const py = 1 - (y - yMin) / (yMax - yMin);
      dot.style.display = "block";
      layer.style.transform = `translate(${(px * 100).toFixed(3)}%, ${(py * 100).toFixed(3)}%)`;
      if (sliderX) sliderX.value = x;
      if (sliderY) sliderY.value = y;
      if (live) live.textContent = `${pad.dataset.xName} ${x}, ${pad.dataset.yName} ${y}.`;
      if (onChange) dot.style.background = onChange(x, y, notify) || "var(--primary)";
      /* The first placement is the one worth marking; after that the dot is
         already on screen and a bounce per pixel of drag would be noise. */
      if (first && !Motion.reduced()) {
        dot.animate(
          [
            { transform: "translate(-50%, -50%) scale(0)" },
            { transform: "translate(-50%, -50%) scale(1.4)" },
            { transform: "translate(-50%, -50%) scale(1)" },
          ],
          { duration: 560, easing: "cubic-bezier(0.2, 0, 0, 1)" }
        );
      }
    }

    function fromEvent(e) {
      const r = pad.getBoundingClientRect();
      const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      setValue(xMin + fx * (xMax - xMin), yMin + (1 - fy) * (yMax - yMin), true);
    }

    /* While a finger is down the dot must sit exactly under it, so the spring
       that makes a restored answer glide into place is switched off for the
       duration of the drag. */
    pad.addEventListener("pointerdown", (e) => {
      pad.setPointerCapture(e.pointerId);
      pad.classList.add("dragging");
      fromEvent(e);
    });
    pad.addEventListener("pointermove", (e) => { if (e.buttons) fromEvent(e); });
    pad.addEventListener("pointerup", () => pad.classList.remove("dragging"));
    pad.addEventListener("pointercancel", () => pad.classList.remove("dragging"));

    pad.addEventListener("keydown", (e) => {
      const stepX = (step || (xMax - xMin) / 20) * (e.shiftKey ? 3 : 1);
      const stepY = (step || (yMax - yMin) / 20) * (e.shiftKey ? 3 : 1);
      let nx = x == null ? (xMin + xMax) / 2 : x;
      let ny = y == null ? (yMin + yMax) / 2 : y;
      switch (e.key) {
        case "ArrowRight": nx += stepX; break;
        case "ArrowLeft": nx -= stepX; break;
        case "ArrowUp": ny += stepY; break;
        case "ArrowDown": ny -= stepY; break;
        case "Home": nx = xMin; break;
        case "End": nx = xMax; break;
        case "PageUp": ny = yMax; break;
        case "PageDown": ny = yMin; break;
        default: return;
      }
      e.preventDefault();
      pad.classList.add("dragging");
      setValue(nx, ny, true);
      requestAnimationFrame(() => pad.classList.remove("dragging"));
    });

    const fromSliders = () => setValue(Number(sliderX.value), Number(sliderY.value), true);
    if (sliderX) sliderX.addEventListener("input", fromSliders);
    if (sliderY) sliderY.addEventListener("input", fromSliders);

    return {
      get: () => ({ x, y }),
      /* Set without a pointer, for restoring a saved answer. */
      set(nx, ny) {
        setValue(nx, ny, false);
      },
      clear() {
        x = null;
        y = null;
        dot.style.display = "none";
        if (live) live.textContent = "";
        [[sliderX, xMin, xMax], [sliderY, yMin, yMax]].forEach(([el, lo, hi]) => el && (el.value = (lo + hi) / 2));
      },
    };
  }

  /* ---------------- channels ---------------- */

  const CHANNELS = {
    autonomic: { label: "Body", color: "var(--ch-auto)" },
    cognitive: { label: "Brain", color: "var(--ch-cog)" },
    psychological: { label: "Life", color: "var(--ch-psy)" },
  };

  /* A channel z of 0 sits at the top of the ring; worse fills it clockwise. */
  function ring(z, color, size = 78) {
    const r = (size - 9) / 2;
    const circ = 2 * Math.PI * r;
    const filled = z == null ? 0 : Math.max(0, Math.min(1, (z + 1) / 3));
    const offset = circ * (1 - filled);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--outline-variant)" stroke-width="7"/>
      <circle class="ring-arc" data-circ="${circ}" data-offset="${offset}"
        cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="7"
        stroke-linecap="round" stroke-dasharray="${circ}"
        stroke-dashoffset="${offset}"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
  }

  /* Sweeps each arc up from empty once it is in the document. Kept separate
     from ring() so the markup can still be rendered as a string. */
  function animateRings(container, { stagger = 130 } = {}) {
    container.querySelectorAll(".ring-arc").forEach((arc, i) => {
      const circ = Number(arc.dataset.circ);
      const offset = Number(arc.dataset.offset);
      if (!Number.isFinite(circ) || Motion.reduced()) return;
      arc.animate(
        [{ strokeDashoffset: circ }, { strokeDashoffset: offset }],
        { duration: 1100, delay: i * stagger, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" }
      );
    });
  }

  function zLabel(z) {
    if (z == null) return "—";
    return (z > 0 ? "+" : "") + z.toFixed(1);
  }

  /* The four corners of a valence-by-arousal square, named the same way
     everywhere they appear so a quadrant in the check-in and a quadrant in
     Trends are recognisably the same thing. */
  function quadrant(valence, arousal) {
    if (valence >= 0) return arousal >= 0 ? "Activated And Positive" : "Settled And Positive";
    return arousal >= 0 ? "Activated And Negative" : "Depleted And Negative";
  }

  /* The same square said in the words a person would use about their own day.
     The axis names are borrowed from the research this grid comes from, and
     nobody describes their Tuesday as having a valence. */
  function affectPhrase(valence, arousal) {
    const pleasant = valence >= 0.25 ? "Good" : valence <= -0.25 ? "Rough" : "Mixed";
    const energy = arousal >= 0.25 ? "and wired" : arousal <= -0.25 ? "and flat" : "and steady";
    return `${pleasant} ${energy}`;
  }

  /* ---------------- push notifications ---------------- */

  function keyBytes(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  const push = {
    supported: () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    ios: () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    installed: () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,

    /* iOS only offers web push to an app launched from the home screen, so the
       most useful thing to say there is how to install it, not that push failed. */
    blocker() {
      if (push.ios() && !push.installed()) return "On iPhone, add Myaku to your Home Screen first, then open it from there.";
      if (!window.isSecureContext) return "Notifications need a secure connection, so open Myaku over HTTPS.";
      if (!push.supported()) return "This browser cannot show notifications, so use the calendar option instead.";
      if (Notification.permission === "denied") return "Notifications are blocked for Myaku, so allow them in your settings.";
      return null;
    },

    async current() {
      if (!push.supported()) return null;
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? reg.pushManager.getSubscription() : null;
    },

    async subscribe() {
      const blocked = push.blocker();
      if (blocked) throw new Error(blocked);
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications were not allowed, so check your settings.");
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api("/api/push/key");
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      await api("/api/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
      return sub;
    },

    async unsubscribe() {
      const sub = await push.current();
      if (!sub) return;
      await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    },
  };

  /* ---------------- navigation bar ---------------- */

  /* Each destination carries two drawings of the same icon. Material fills the
     icon for the current destination and outlines the rest, so the active item
     is marked by the indicator pill, the label weight, and the icon's own
     shape. Three cues, none of which is colour on its own. */
  const TABS = [
    {
      id: "today", href: "index.html", label: "Today",
      outline: '<path d="M4.6 10.1 12 4.3l7.4 5.8V19a1 1 0 0 1-1 1h-3.9v-6.2h-5V20H5.6a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
      fill: '<path d="M4.6 10.1 12 4.3l7.4 5.8V19a1 1 0 0 1-1 1h-3.9v-6.2h-5V20H5.6a1 1 0 0 1-1-1z"/>',
    },
    {
      id: "log", href: "log.html", label: "Log",
      outline: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8.1v7.8M8.1 12h7.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
      fill: '<path fill-rule="evenodd" d="M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6zM13 11h3.4v2H13v3.4h-2V13H7.6v-2H11V7.6h2z"/>',
    },
    {
      id: "trends", href: "trends.html", label: "Trends",
      outline: '<path d="M4 4.6v14.8h15.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7.4 15.6 11 11.2l3 2.5 4.4-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
      fill: '<path d="M4 4.6v14.8h15.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7.4 15.6 11 11.2l3 2.5 4.4-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="11" cy="11.2" r="1.5"/><circle cx="18.4" cy="7.7" r="1.5"/>',
    },
    {
      id: "more", href: "more.html", label: "More",
      outline: '<circle cx="5.4" cy="12" r="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="18.6" cy="12" r="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/>',
      fill: '<circle cx="5.4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18.6" cy="12" r="2"/>',
    },
  ];

  function mountTabs(active) {
    const el = document.createElement("nav");
    el.className = "nav-bar";
    el.setAttribute("aria-label", "Primary");
    el.innerHTML = TABS.map((t) => {
      const on = t.id === active;
      return `<a class="nav-item${on ? " active" : ""}" href="${t.href}"${on ? ' aria-current="page"' : ""}>
        <span class="nav-indicator">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${on ? t.fill : t.outline}</svg>
        </span>
        <span class="nav-label">${t.label}</span>
      </a>`;
    }).join("");
    document.body.appendChild(el);

    /* The indicator springs out from nothing and the icon overshoots with it,
       so arriving on a destination is an event rather than a repaint. */
    if (Motion.reduced()) return;
    const current = el.querySelector(".nav-item.active");
    if (!current) return;
    current.querySelector(".nav-indicator").animate(
      [
        { transform: "scaleX(0.2)", opacity: 0 },
        { transform: "scaleX(1)", opacity: 1 },
      ],
      { duration: 520, easing: "cubic-bezier(0.2, 0, 0, 1)" }
    );
    current.querySelector(".nav-icon").animate(
      [{ transform: "scale(0.5)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }],
      { duration: 620, easing: "cubic-bezier(0.2, 0, 0, 1)" }
    );
  }

  /* ---------------- page setup ---------------- */

  /* Runs on every page: a skip link and a main landmark for keyboard and screen
     reader users, and the service worker that makes reminders possible. */
  function preparePage() {
    const main = document.querySelector(".screen");
    if (main && !main.id) {
      main.id = "main";
      main.setAttribute("role", "main");
      main.tabIndex = -1;
    }
    if (main && !document.querySelector(".skip-link")) {
      const skip = document.createElement("a");
      skip.className = "skip-link";
      skip.href = "#main";
      skip.textContent = "Skip To Content";
      document.body.prepend(skip);
    }
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }

  function boot(activeTab) {
    if (activeTab) mountTabs(activeTab);
  }

  preparePage();

  return {
    esc, api, todayKey, shiftKey, weekStartKey, prettyDate, greeting, timezone, ago, parseStamp,
    row, group, pill, confidenceLabel,
    scale, wordScale, bindScales, resetScales, bindChips, setChips,
    padMarkup, bindPad, quadrant, affectPhrase,
    CHANNELS, ring, animateRings, zLabel,
    push, boot,
  };
})();
