/* Myaku — caffeine.
 *
 * Deliberately not a channel. It is here because energy drinks are the thing
 * people actually reach for, and because caffeine improves reaction time,
 * which means a dose taken before a vigilance session masks the impairment
 * that session exists to detect. The server records the gap as a covariate.
 *
 * The page answers two questions: how much is in you at any hour, and how much
 * is still there when you try to sleep. The second is the one that matters, so
 * the chart shades the sleep window by what the dose and timing studies found,
 * and a signed-in athlete with body data sees those zones against their own
 * nights.
 *
 * Works signed out. Requiring an account before the useful part is what kills
 * a page like this, so entries fall back to local storage.
 */

(function () {
  M.boot("log");

  /* Kept identical to the server's model, so the curve and the night-by-night
     history can never disagree about what bedtime looked like. */
  const HALF_LIFE_H = 5;
  const ABSORB_H = 0.75;
  const CLEAR_MG = 30;
  const HIGH_MG = 75;
  const SLEEP_H = 8;
  const DAILY_LIMIT_MG = 400;
  const NS = "http://www.w3.org/2000/svg";

  const ZONES = {
    clear: { name: "Clear", tone: "green", color: "var(--green)", range: "Under 30 mg", words: "under 30 mg" },
    borderline: { name: "Borderline", tone: "orange", color: "var(--orange)", range: "30 To 75 mg", words: "30 to 75 mg" },
    high: { name: "High", tone: "red", color: "var(--red)", range: "Over 75 mg", words: "over 75 mg" },
  };

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

  const LAST_CALL_DEFAULTS = [
    { label: "Espresso", mg: 64 },
    { label: "Coffee", mg: 95 },
    { label: "Energy Drink", mg: 200 },
  ];

  const minutesText = (d) => (d >= 60 ? Explain.duration(d) : `${Math.round(d)} minutes`);
  const signed = (d, text) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${text}`;

  /* What each night measure is called, how it is read back, and how small a
     difference is too small to mention. */
  const MEASURES = {
    sleepMinutes: {
      name: "Sleep", noun: "sleep", subject: "you slept", up: "more", down: "less", higherIsBetter: true, tolerance: 10,
      format: (v) => Explain.duration(v), amount: minutesText, delta: (d) => signed(d, `${Math.abs(Math.round(d))}m`),
      tick: (v) => `${(v / 60).toFixed(1)}h`,
    },
    sleepEfficiency: {
      name: "Sleep Efficiency", noun: "sleep efficiency", subject: "your sleep efficiency was", up: "higher", down: "lower", higherIsBetter: true, tolerance: 1,
      format: (v) => `${Math.round(v)}%`, amount: (d) => `${d.toFixed(1)} points`, delta: (d) => signed(d, Math.abs(d).toFixed(1)),
      tick: (v) => `${Math.round(v)}%`,
    },
    hrv: {
      name: "Heart Rate Variability", noun: "heart rate variability", subject: "your heart rate variability was", up: "higher", down: "lower", higherIsBetter: true, tolerance: 2,
      format: (v) => `${Math.round(v)} ms`, amount: (d) => `${Math.round(d)} ms`, delta: (d) => signed(d, `${Math.abs(Math.round(d))} ms`),
      tick: (v) => `${Math.round(v)}`,
    },
    rhr: {
      name: "Resting Heart Rate", noun: "resting heart rate", subject: "your resting heart rate was", up: "higher", down: "lower", higherIsBetter: false, tolerance: 1,
      format: (v) => `${Math.round(v)} bpm`, amount: (d) => `${Math.round(d)} bpm`, delta: (d) => signed(d, `${Math.abs(Math.round(d))} bpm`),
      tick: (v) => `${Math.round(v)}`,
    },
  };

  let signedIn = false;
  /* The time every add is recorded at. Null means the moment it is added. */
  let addTime = null;
  let whenChoice = "now";
  let entries = [];
  let yesterday = [];
  let insights = null;
  let bedtime = "23:00";
  let measure = "sleepMinutes";
  let scrubHour = null;
  let chart = null;

  const $ = (id) => document.getElementById(id);

  /* ---------------- time ---------------- */

  const pad2 = (n) => String(n).padStart(2, "0");

  function toHours(hhmm) {
    const [h, m] = String(hhmm || "").split(":").map(Number);
    return (h || 0) + (m || 0) / 60;
  }

  function clock(hour) {
    let mins = Math.round((((hour % 24) + 24) % 24) * 60);
    if (mins >= 1440) mins -= 1440;
    const h = Math.floor(mins / 60);
    return `${h % 12 || 12}:${pad2(mins % 60)} ${h < 12 ? "AM" : "PM"}`;
  }

  function hourMark(hour) {
    const h = ((Math.round(hour) % 24) + 24) % 24;
    return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
  }

  function nowHours() {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  const nowTime = () => new Date().toTimeString().slice(0, 5);

  function dayKey(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  /* A bedtime after midnight is still tonight, so it sits past 24 on the axis. */
  function bedHours() {
    const h = toHours(bedtime);
    return h < 12 ? h + 24 : h;
  }

  /* ---------------- model ---------------- */

  function doseLevel(mg, elapsed) {
    if (!(elapsed >= 0)) return 0;
    return mg * Math.min(1, elapsed / ABSORB_H) * Math.pow(0.5, elapsed / HALF_LIFE_H);
  }

  /* Today's drinks, plus what yesterday's are still leaving behind. `extra` is a
     drink that has not been had yet, for working out the last call. */
  function levelAt(hour, extra) {
    let sum = 0;
    entries.forEach((e) => { sum += doseLevel(Number(e.mg), hour - toHours(e.logged_at)); });
    yesterday.forEach((e) => { sum += doseLevel(Number(e.mg), hour + 24 - toHours(e.logged_at)); });
    if (extra) sum += doseLevel(extra.mg, hour - extra.hour);
    return sum;
  }

  /* The level while falling asleep, matching the server: a drink still being
     absorbed at bedtime counts at its peak. */
  function onset(levelFn) {
    const bedH = bedHours();
    return Math.max(...[0, 0.25, 0.5, 0.75].map((k) => levelFn(bedH + k)));
  }

  const bedLevel = (extra) => onset((h) => levelAt(h, extra));
  const zoneFor = (mg) => (mg < CLEAR_MG ? "clear" : mg < HIGH_MG ? "borderline" : "high");

  /* The latest a drink can be had today and still leave bedtime under 30 mg. */
  function lastCall(mg) {
    const bedH = bedHours();
    if (Math.round(bedLevel()) >= CLEAR_MG) return { kind: "over" };
    let latest = null;
    for (let h = Math.ceil(nowHours() * 12) / 12; h <= bedH; h += 1 / 12) {
      if (bedLevel({ mg, hour: h }) < CLEAR_MG) latest = h;
      else break;
    }
    if (latest == null) return { kind: "passed" };
    if (latest >= bedH - 1 / 12) return { kind: "any" };
    return { kind: "until", hour: latest };
  }

  /* ---------------- storage ---------------- */

  const localKey = (offset) => "myaku.caffeine." + dayKey(offset);

  function loadLocal(offset) {
    try {
      const list = JSON.parse(localStorage.getItem(localKey(offset)) || "[]");
      return Array.isArray(list) ? list.map((e, i) => (e.id ? e : { ...e, id: `local-${offset}-${i}` })) : [];
    } catch {
      return [];
    }
  }

  function saveLocal(list) {
    try { localStorage.setItem(localKey(0), JSON.stringify(list)); } catch { /* private mode */ }
  }

  function loadBedtime() {
    try {
      const value = localStorage.getItem("myaku.bedtime") || "";
      return /^\d{2}:\d{2}$/.test(value) ? value : null;
    } catch {
      return null;
    }
  }

  function saveBedtime(value) {
    try { localStorage.setItem("myaku.bedtime", value); } catch { /* private mode */ }
  }

  /* ---------------- svg ---------------- */

  function node(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function caption(parent, x, y, str, opts = {}) {
    const t = node("text", {
      x, y,
      "font-size": opts.size || 11,
      "font-weight": opts.weight || 500,
      fill: opts.fill || "var(--on-surface-variant)",
      "text-anchor": opts.anchor || "middle",
    }, parent);
    t.textContent = str;
    return t;
  }

  const pathOf = (pts, x, y) => pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");

  /* ---------------- the day curve ---------------- */

  function drawCurve(animate) {
    const host = $("curve");
    const W = Math.max(280, Math.round(host.clientWidth || 600));
    const narrow = W < 460;
    const H = narrow ? 230 : 260;
    const padL = 34, padR = 10, padT = 40, padB = 26;

    const now = nowHours();
    const bedH = bedHours();
    const doseHours = entries.map((e) => toHours(e.logged_at));
    const startH = Math.max(0, Math.min(6, Math.floor(now), ...doseHours.map((h) => Math.floor(h - 0.5))));
    const endH = bedH + SLEEP_H;

    const samples = [];
    for (let h = startH; h <= endH + 1e-9; h += 1 / 12) samples.push([h, levelAt(h)]);
    const usual = insights && insights.usual ? insights.usual.filter((p) => p.hour >= startH && p.hour <= endH) : [];

    const peak = Math.max(0, ...samples.map((p) => p[1]), ...usual.map((p) => p.mg));
    const top = Math.max(120, peak * 1.12);
    const tick = top > 300 ? 100 : 50;
    const yMax = Math.ceil(top / tick) * tick;

    const plotW = W - padL - padR, plotH = H - padT - padB;
    const x = (h) => padL + ((h - startH) / (endH - startH)) * plotW;
    const y = (v) => padT + plotH - (v / yMax) * plotH;

    host.innerHTML = "";
    host.dataset.width = String(Math.round(host.clientWidth));
    const svg = node("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" }, host);

    const defs = node("defs", {}, svg);
    const grad = node("linearGradient", { id: "caffeine-fill", x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
    node("stop", { offset: "0%", "stop-color": "var(--orange)", "stop-opacity": 0.34 }, grad);
    node("stop", { offset: "100%", "stop-color": "var(--orange)", "stop-opacity": 0.04 }, grad);

    // The sleep window, banded by what the studies found at each level.
    const bx = x(bedH), ex = x(endH);
    node("rect", { x: bx, y: padT, width: ex - bx, height: plotH, fill: "var(--on-surface)", opacity: 0.04 }, svg);
    [[0, CLEAR_MG, "clear", 0.16], [CLEAR_MG, HIGH_MG, "borderline", 0.16], [HIGH_MG, yMax, "high", 0.11]].forEach(([lo, hi, key, op]) => {
      node("rect", { x: bx, y: y(hi), width: ex - bx, height: y(lo) - y(hi), fill: ZONES[key].color, opacity: op }, svg);
    });

    for (let v = 0; v <= yMax; v += tick) {
      node("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: "var(--outline-variant)", "stroke-width": 1, opacity: v ? 0.6 : 1 }, svg);
      caption(svg, padL - 6, y(v) + 4, String(v), { anchor: "end", size: 10, weight: 400 });
    }

    const every = narrow ? 6 : 3;
    for (let h = Math.ceil(startH / every) * every; h <= endH + 1e-9; h += every) {
      node("line", { x1: x(h), x2: x(h), y1: padT, y2: padT + plotH, stroke: "var(--outline-variant)", "stroke-width": 1, opacity: 0.45 }, svg);
      caption(svg, x(h), H - 7, hourMark(h), { size: 10, weight: 400 });
    }

    [[CLEAR_MG, "borderline"], [HIGH_MG, "high"]].forEach(([v, key]) => {
      node("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: ZONES[key].color, "stroke-width": 1.25, "stroke-dasharray": "5 4", opacity: 0.9 }, svg);
      caption(svg, W - padR - 4, y(v) - 5, `${v} mg`, { anchor: "end", size: 10, weight: 700, fill: ZONES[key].color });
    });

    if (usual.length > 1) {
      node("path", {
        d: pathOf(usual.map((p) => [p.hour, p.mg]), x, y), fill: "none",
        stroke: "var(--on-surface-variant)", "stroke-width": 1.5, "stroke-dasharray": "3 4", opacity: 0.75,
      }, svg);
    }

    const line = pathOf(samples, x, y);
    const area = node("path", { d: `${line}L${x(endH).toFixed(1)},${y(0)}L${x(startH).toFixed(1)},${y(0)}Z`, fill: "url(#caffeine-fill)" }, svg);
    const curve = node("path", { d: line, fill: "none", stroke: "var(--orange)", "stroke-width": 2.75, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);

    if (peak < 1) {
      // Placed above the threshold lines, which cross the middle of an empty chart.
      caption(svg, padL + (bx - padL) / 2, padT + plotH * 0.28, "Log a drink to draw your curve.", { size: 13, fill: "var(--on-surface-variant)" });
    }

    // Each drink, labelled at the top and dropped to the moment it was logged.
    const rowEnds = [-Infinity, -Infinity];
    entries
      .map((e) => ({ e, h: toHours(e.logged_at) }))
      .sort((a, b) => a.h - b.h)
      .forEach(({ e, h }) => {
        if (h < startH || h > endH) return;
        const px = x(h);
        const name = String(e.label || "Drink");
        const text = `${name.length > 14 ? name.slice(0, 13) + "…" : name} · ${Math.round(e.mg)}`;
        const width = text.length * 6.1 + 8;
        const row = px - width / 2 > rowEnds[0] ? 0 : 1;
        const lx = Math.min(W - width / 2, Math.max(width / 2, px));
        rowEnds[row] = lx + width / 2 + 4;
        const ly = row ? 28 : 13;
        node("line", { x1: px, x2: px, y1: ly + 5, y2: y(0), stroke: "var(--orange)", "stroke-width": 1, "stroke-dasharray": "2 3", opacity: 0.6 }, svg);
        node("circle", { cx: px, cy: y(0), r: 4, fill: "var(--orange)" }, svg);
        caption(svg, lx, ly, text, { size: 11, weight: 600, fill: "var(--on-surface)" });
      });

    // Bedtime, with what is left as you fall asleep.
    const bedMg = bedLevel();
    const bedZone = ZONES[zoneFor(Math.round(bedMg))];
    node("line", { x1: bx, x2: bx, y1: padT, y2: padT + plotH, stroke: "var(--on-surface-variant)", "stroke-width": 1.5, "stroke-dasharray": "4 3" }, svg);
    caption(svg, bx + 6, padT + 14, "Bedtime", { anchor: "start", size: 11, weight: 700, fill: "var(--on-surface)" });
    node("circle", { cx: bx, cy: y(levelAt(bedH)), r: 5.5, fill: bedZone.color, stroke: "var(--surface-container-low)", "stroke-width": 2 }, svg);
    caption(svg, bx + 9, Math.max(padT + 30, y(levelAt(bedH)) - 8), `${Math.round(bedMg)} mg`, { anchor: "start", size: 11, weight: 700, fill: bedZone.color });

    if (now >= startH && now <= endH) {
      const nx = x(now);
      const near = Math.abs(nx - bx) < 70;
      node("line", { x1: nx, x2: nx, y1: padT, y2: padT + plotH, stroke: "var(--primary)", "stroke-width": 1.5, opacity: 0.75 }, svg);
      if (near && nx < bx) caption(svg, nx - 6, padT + 14, "Now", { anchor: "end", size: 11, weight: 700, fill: "var(--primary)" });
      else caption(svg, nx + 6, near ? padT + 30 : padT + 14, "Now", { anchor: "start", size: 11, weight: 700, fill: "var(--primary)" });
      node("circle", { cx: nx, cy: y(levelAt(now)), r: 5.5, fill: "var(--primary)", stroke: "var(--surface-container-low)", "stroke-width": 2 }, svg);
    }

    const cursor = node("g", { opacity: 0 }, svg);
    const cLine = node("line", { y1: padT, y2: padT + plotH, stroke: "var(--on-surface)", "stroke-width": 1, opacity: 0.55 }, cursor);
    const cDot = node("circle", { r: 5, fill: "var(--surface-container-low)", stroke: "var(--on-surface)", "stroke-width": 2 }, cursor);

    chart = { startH, endH, x, y, padL, plotW, cursor, cLine, cDot };
    host.setAttribute("aria-valuemin", Math.round(startH * 60));
    host.setAttribute("aria-valuemax", Math.round(endH * 60));

    if (animate) {
      Motion.drawPath(curve, { duration: 1100 });
      Motion.fadeIn(area, { delay: 250, duration: 700 });
    }
    if (scrubHour != null) setScrub(scrubHour);
  }

  function setScrub(hour) {
    if (!chart) return;
    if (hour == null) {
      scrubHour = null;
      chart.cursor.setAttribute("opacity", 0);
      renderReadout();
      return;
    }
    scrubHour = Math.min(chart.endH, Math.max(chart.startH, Math.round(hour * 12) / 12));
    const px = chart.x(scrubHour);
    chart.cLine.setAttribute("x1", px);
    chart.cLine.setAttribute("x2", px);
    chart.cDot.setAttribute("cx", px);
    chart.cDot.setAttribute("cy", chart.y(levelAt(scrubHour)));
    chart.cursor.setAttribute("opacity", 1);
    renderReadout();
  }

  function renderReadout() {
    const now = nowHours();
    const hour = scrubHour == null ? now : scrubHour;
    const mg = Math.round(levelAt(hour));
    const bedH = bedHours();
    let note = "";
    if (scrubHour == null) note = clock(now);
    else if (Math.abs(hour - bedH) < 1 / 24) note = "Bedtime";
    else if (hour > bedH) note = `Asleep · ${ZONES[zoneFor(mg)].name}`;

    $("readout").innerHTML = `<strong>${scrubHour == null ? "Now" : clock(hour)}</strong>
      <span class="readout-mg">${mg} mg</span>${note ? `<span class="readout-note">${note}</span>` : ""}`;

    const host = $("curve");
    host.setAttribute("aria-valuenow", Math.round(hour * 60));
    host.setAttribute("aria-valuetext", `${clock(hour)}, ${mg} milligrams`);
  }

  function bindCurve() {
    const host = $("curve");
    const hourFrom = (ev) => {
      const r = host.getBoundingClientRect();
      return chart.startH + ((ev.clientX - r.left - chart.padL) / chart.plotW) * (chart.endH - chart.startH);
    };
    host.addEventListener("pointerdown", (ev) => chart && setScrub(hourFrom(ev)));
    host.addEventListener("pointermove", (ev) => chart && (ev.pointerType === "mouse" || ev.buttons) && setScrub(hourFrom(ev)));
    host.addEventListener("pointerleave", (ev) => {
      if (ev.pointerType === "mouse" && document.activeElement !== host) setScrub(null);
    });
    host.addEventListener("blur", () => setScrub(null));
    host.addEventListener("keydown", (ev) => {
      if (!chart) return;
      const moves = { ArrowRight: 0.25, ArrowLeft: -0.25, ArrowUp: 1, ArrowDown: -1, PageUp: 3, PageDown: -3 };
      const base = scrubHour == null ? Math.min(chart.endH, Math.max(chart.startH, nowHours())) : scrubHour;
      if (ev.key in moves) setScrub(base + moves[ev.key]);
      else if (ev.key === "Home") setScrub(chart.startH);
      else if (ev.key === "End") setScrub(chart.endH);
      else if (ev.key === "Escape") setScrub(null);
      else return;
      ev.preventDefault();
    });
  }

  /* ---------------- summaries ---------------- */

  function nowNote(now) {
    const rising = entries.some((e) => {
      const d = now - toHours(e.logged_at);
      return d >= 0 && d < ABSORB_H;
    });
    if (rising) {
      let best = now, most = -1;
      for (let h = now; h <= now + ABSORB_H; h += 1 / 60) {
        const v = levelAt(h);
        if (v > most) { most = v; best = h; }
      }
      return `Still rising, peaks near ${clock(best)}.`;
    }
    const carried = yesterday.reduce((s, e) => s + doseLevel(Number(e.mg), now + 24 - toHours(e.logged_at)), 0);
    if (carried >= 5) return `${Math.round(carried)} mg is left from yesterday.`;
    // The figure is modelled, not measured, and it should never pass for a reading.
    return entries.length ? "An estimate, using an average five-hour half-life." : "";
  }

  function renderCheckpoints() {
    const bedH = bedHours();
    const points = [
      { key: "Now", hour: nowHours() },
      { key: "Bedtime", hour: bedH, onset: true },
      { key: "Middle Of Night", hour: bedH + SLEEP_H / 2 },
      { key: "Wake Up", hour: bedH + SLEEP_H },
    ];
    $("checkpoints").innerHTML = points.map((p) => {
      const mg = Math.round(p.onset ? bedLevel() : levelAt(p.hour));
      return `<div class="checkpoint">
        <div class="checkpoint-key"><span class="zone-dot" style="background:${ZONES[zoneFor(mg)].color}" aria-hidden="true"></span>${p.key}</div>
        <div class="checkpoint-val">${mg}<small>mg</small></div>
        <div class="checkpoint-time">${clock(p.hour)}</div>
      </div>`;
    }).join("");
  }

  function span(hours) {
    const minutes = Math.round((hours * 60) / 5) * 5;
    return minutes < 60 ? `${minutes} minutes` : Explain.duration(minutes);
  }

  function renderVerdict(animate) {
    const bedH = bedHours();
    const mg = Math.round(bedLevel());
    const key = zoneFor(mg);
    const zone = ZONES[key];

    if (animate) Motion.countUp($("bed-mg"), mg);
    else $("bed-mg").textContent = mg;
    $("bed-zone").innerHTML = `<span class="pill pill-${zone.tone}">${zone.name}</span>`;

    const sentences = {
      clear: entries.length || yesterday.length
        ? "Under 30 mg at bedtime lines up with the timing that sleep studies recommend."
        : "Nothing is logged today, so nothing is left for bedtime.",
      borderline: "Between 30 and 75 mg is where studies disagree, so it may cost you some deep sleep.",
      high: "Over 75 mg at bedtime is the range where studies measured less deep sleep and more waking.",
    };
    $("bed-sentence").textContent = sentences[key];

    let clears = "";
    if (mg >= CLEAR_MG) {
      for (let h = bedH; h <= bedH + 24; h += 1 / 12) {
        if (levelAt(h) < CLEAR_MG) { clears = `Drops under 30 mg around ${clock(h)}, ${span(h - bedH)} after bedtime.`; break; }
      }
    } else if (entries.length) {
      const peakEnd = Math.max(...entries.map((e) => toHours(e.logged_at))) + ABSORB_H;
      if (levelAt(peakEnd) >= CLEAR_MG) {
        for (let h = peakEnd; h <= bedH; h += 1 / 12) {
          if (levelAt(h) < CLEAR_MG) { clears = `Under 30 mg from about ${clock(h)}, ${span(bedH - h)} before bedtime.`; break; }
        }
      }
    }
    $("bed-clears").textContent = clears;
  }

  function renderLastCall() {
    const mine = insights && insights.topDrinks && insights.topDrinks.length ? insights.topDrinks : null;
    const drinks = mine || LAST_CALL_DEFAULTS;
    let over = false;
    $("last-call").innerHTML = drinks.map((d) => {
      const r = lastCall(Number(d.mg));
      /* Once bedtime is already past the line, a cutoff has nothing left to say,
         so the row says what that drink would add instead. */
      const added = () => {
        over = true;
        return `Adds ${Math.round(bedLevel({ mg: Number(d.mg), hour: nowHours() }) - bedLevel())} mg`;
      };
      const value = {
        until: () => `By ${clock(r.hour)}`,
        any: () => "Any Time Before Bed",
        over: added,
        passed: () => "Too Late Today",
      }[r.kind]();
      const muted = r.kind === "over" || r.kind === "passed";
      return `<div class="row">
        <span class="row-main">
          <span class="row-title">${M.esc(d.label)}</span>
          <span class="row-sub">${Math.round(d.mg)} mg</span>
        </span>
        <span class="row-value${muted ? "" : " last-call-ok"}">${value}</span>
      </div>`;
    }).join("");
    $("last-call-note").textContent = over
      ? "You are already over 30 mg at bedtime, so each row shows what that drink now would add."
      : mine
        ? "The latest time each of your usual drinks still keeps you under 30 mg at bedtime."
        : "The latest time each drink still keeps you under 30 mg at bedtime.";
  }

  function renderEntries() {
    const el = $("entries");
    if (!entries.length) {
      el.innerHTML = `<div class="row"><span class="row-main"><span class="row-title secondary">Nothing logged yet today.</span></span></div>`;
      return;
    }
    el.innerHTML = entries
      .map((e) => ({ e, h: toHours(e.logged_at) }))
      .sort((a, b) => b.h - a.h)
      .map(({ e, h }) => {
        const left = Math.round(onset((t) => doseLevel(Number(e.mg), t - h)));
        return `<div class="row">
          <span class="row-main">
            <span class="row-title">${M.esc(e.label || "Drink")}</span>
            <span class="row-sub">${clock(h)} · ${left} mg Left At Bedtime</span>
          </span>
          <span class="row-value mono">${Math.round(e.mg)} mg</span>
          <button type="button" class="btn btn-danger btn-sm" data-del="${M.esc(String(e.id))}">Remove</button>
        </div>`;
      })
      .join("");
    el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => remove(b.getAttribute("data-del"))));
  }

  function renderHourly() {
    const el = $("hourly");
    const now = nowHours();
    const bedH = bedHours();
    const doseHours = entries.map((e) => toHours(e.logged_at));
    if (!doseHours.length && levelAt(now) < 1) {
      el.innerHTML = `<p>Log a drink to see the amount left at every hour.</p>`;
      return;
    }
    const marks = [];
    for (let h = Math.ceil(Math.min(now, ...doseHours)); h <= Math.floor(bedH + SLEEP_H); h++) {
      if (Math.abs(h - bedH) > 1e-6) marks.push({ hour: h });
    }
    marks.push({ hour: bedH, bed: true });
    marks.sort((a, b) => a.hour - b.hour);

    const rows = marks.map(({ hour, bed }) => {
      const mg = Math.round(bed ? bedLevel() : levelAt(hour));
      const asleep = hour >= bedH;
      const note = bed ? `Bedtime · ${ZONES[zoneFor(mg)].name}` : asleep ? ZONES[zoneFor(mg)].name : "";
      return `<tr class="${asleep ? "asleep" : ""}"><td>${clock(hour)}</td><td class="num">${mg} mg</td><td>${note}</td></tr>`;
    }).join("");

    el.innerHTML = `<div class="table-wrap" style="margin-top:0;">
      <table class="table">
        <thead><tr><th scope="col">Time</th><th scope="col" class="num">Caffeine</th><th scope="col">Sleep Zone</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  /* ---------------- personal ---------------- */

  function renderRecent() {
    const section = $("recent");
    const r = (insights && insights.recent) || {};
    section.hidden = !(signedIn && r.days >= 3);
    if (section.hidden) return;

    const bedZone = r.bedMg == null ? null : ZONES[zoneFor(Math.round(r.bedMg))];
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const tiles = [
      { key: "Daily Average", val: `${r.averageMg}<span class="stat-unit"> mg</span>`, sub: `${plural(r.days, "Logged Day", "Logged Days")}` },
      { key: "At Bedtime", val: r.bedMg == null ? "—" : `${Math.round(r.bedMg)}<span class="stat-unit"> mg</span>`, sub: bedZone ? `Usually ${bedZone.name}` : "No Nights Yet" },
      { key: "Nights Over 30 mg", val: String(r.nightsOver), sub: `Of ${plural(r.nights, "Night", "Nights")}` },
      { key: "Last Drink", val: r.lastHour == null ? "—" : clock(r.lastHour), sub: "Usual Time", words: true },
    ];
    $("recent-tiles").innerHTML = tiles.map((t) => `<div class="tile">
      <div class="tile-key">${t.key}</div>
      <div class="tile-val${t.words ? " words" : ""}">${t.val}</div>
      <div class="tile-sub">${t.sub}</div>
    </div>`).join("");
  }

  function findingFor(zones, key) {
    const m = MEASURES[key];
    const usable = zones.filter((z) => z[key + "N"] >= 3);
    if (usable.length < 2) return { text: `There are not yet enough nights with ${m.noun} in two zones to compare.`, tone: "" };
    const lo = usable[0], hi = usable[usable.length - 1];
    const diff = hi[key] - lo[key];
    const where = `on nights with ${ZONES[hi.key].words} left at bedtime`;
    if (Math.abs(diff) < m.tolerance) {
      return { text: `Your ${m.noun} was about the same ${where} as on nights with ${ZONES[lo.key].words}.`, tone: "" };
    }
    const worse = m.higherIsBetter ? diff < 0 : diff > 0;
    const text = `On nights with ${ZONES[hi.key].words} left at bedtime, ${m.subject} ${m.amount(Math.abs(diff))} ${diff > 0 ? m.up : m.down} than on nights with ${ZONES[lo.key].words}.`;
    return { text, tone: worse ? "warn" : "" };
  }

  function renderPersonal(animate) {
    const section = $("personal");
    const body = $("personal-body");
    section.hidden = !(signedIn && insights);
    if (section.hidden) return;

    if (!insights.hasBodyData) {
      body.innerHTML = `<div class="card">
        <p class="callout">Connect a wearable to see how your own sleep changes with the caffeine left at bedtime.</p>
        <a class="btn btn-tinted btn-block" href="sources.html" style="margin-top:14px;">Connect Body Data</a>
      </div>`;
      return;
    }

    const zones = insights.zones;
    const available = Object.keys(MEASURES).filter((k) => zones.some((z) => z[k + "N"] > 0));
    const comparable = (k) => zones.filter((z) => z[k + "N"] >= 3).length >= 2;

    if (!available.some(comparable)) {
      const paired = insights.pairedNights;
      const note = paired >= 8
        ? "Your nights so far all land in one zone, so there is nothing to compare yet."
        : "Each day you log a drink is paired with the sleep your wearable records that night.";
      body.innerHTML = `<div class="card">
        <div class="card-title">Still Learning You</div>
        <div class="meter-row" style="margin-top:0;">
          <span class="meter-label">Paired Nights</span>
          <span class="meter-count">${Math.min(paired, 8)} of 8</span>
          <div class="meter"><span style="width:${Math.min(100, (paired / 8) * 100)}%"></span></div>
        </div>
        <p class="footnote secondary" style="margin-top:12px;">${note}</p>
      </div>`;
      return;
    }

    if (!available.includes(measure) || !comparable(measure)) measure = available.find(comparable);
    const m = MEASURES[measure];
    const finding = findingFor(zones, measure);
    const usable = zones.filter((z) => z[measure + "N"] >= 3);
    const baseline = usable[0];
    const maxV = Math.max(...usable.map((z) => z[measure]));

    const bars = zones.map((z) => {
      const n = z[measure + "N"];
      const enough = n >= 3;
      const zone = ZONES[z.key];
      const delta = enough && z !== baseline ? `<span class="zone-bar-sub">${m.delta(z[measure] - baseline[measure])}</span>` : "";
      return `<div class="zone-bar">
        <div class="zone-bar-name">
          <span class="zone-dot" style="background:${zone.color}" aria-hidden="true"></span>
          <span><strong>${zone.name}</strong><span class="zone-bar-sub">${zone.range}</span></span>
        </div>
        <div class="zone-bar-track">${enough ? `<span data-width="${((z[measure] / maxV) * 100).toFixed(1)}" style="width:${((z[measure] / maxV) * 100).toFixed(1)}%;background:${zone.color};"></span>` : ""}</div>
        <div class="zone-bar-val">${enough ? m.format(z[measure]) : "—"}${delta}<span class="zone-bar-sub">${n} ${n === 1 ? "Night" : "Nights"}</span></div>
      </div>`;
    }).join("");

    body.innerHTML = `<div class="card">
      <div class="spread">
        <div class="card-title" style="margin:0;">Caffeine And Your Sleep</div>
        <a class="badge badge-describe" href="method.html#labels">Description</a>
      </div>
      <div class="chips" style="margin-top:16px;" role="group" aria-label="Night Measure">
        ${available.filter(comparable).map((k) => `<button type="button" class="chip" data-measure="${k}" aria-pressed="${k === measure}">${MEASURES[k].name}</button>`).join("")}
      </div>
      ${Explain.finding(finding.text, finding.tone)}
      <div class="zone-bars">${bars}</div>
      <div class="night-scatter" id="night-scatter"></div>
      ${Explain.howToRead(`
        <p>The bars show your middle night in each zone, and the dots show every night on its own. How far across a dot sits is the caffeine estimated to be left when you went to bed, and its height is what was measured that night.</p>
        <p>The estimate assumes half of each drink is gone every five hours and uses the bedtime set above. Only days with at least one logged drink are counted.</p>
      `)}
      <p class="caveat">This describes your nights and does not prove caffeine caused the difference. Busy stretches raise late caffeine and disturb sleep on their own.</p>
    </div>`;

    body.querySelectorAll("[data-measure]").forEach((b) =>
      b.addEventListener("click", () => {
        measure = b.getAttribute("data-measure");
        renderPersonal(true);
      })
    );

    if (animate && !Motion.reduced()) {
      body.querySelectorAll(".zone-bar-track > span").forEach((bar, i) => {
        bar.animate([{ width: "0%" }, { width: bar.dataset.width + "%" }], {
          duration: 800, delay: i * 70, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards",
        });
      });
    }
    drawScatter(animate);
  }

  function drawScatter(animate) {
    const host = $("night-scatter");
    if (!host || !insights) return;
    const m = MEASURES[measure];
    const pts = insights.nights.filter((p) => p[measure] != null);
    if (pts.length < 6) { host.innerHTML = ""; return; }

    const W = Math.max(280, Math.round(host.clientWidth || 600));
    const H = 220, padL = 44, padR = 12, padT = 24, padB = 40;
    const xMax = Math.max(100, Math.ceil((Math.max(...pts.map((p) => p.bedMg)) * 1.08) / 25) * 25);
    const ys = pts.map((p) => p[measure]);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const spread = (hi - lo) * 0.12 || 1;
    const yMin = lo - spread, yMax = hi + spread;
    const x = (v) => padL + (v / xMax) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

    host.innerHTML = "";
    const svg = node("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `${m.name} By Caffeine At Bedtime` }, host);

    [[0, CLEAR_MG, "clear", 0.13], [CLEAR_MG, HIGH_MG, "borderline", 0.13], [HIGH_MG, xMax, "high", 0.1]].forEach(([a, b, key, op]) => {
      node("rect", { x: x(a), y: padT, width: x(b) - x(a), height: H - padT - padB, fill: ZONES[key].color, opacity: op }, svg);
    });

    [lo, (lo + hi) / 2, hi].forEach((v) => {
      node("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: "var(--outline-variant)", "stroke-width": 1, opacity: 0.7 }, svg);
      caption(svg, padL - 6, y(v) + 4, m.tick(v), { anchor: "end", size: 10, weight: 400 });
    });
    [0, CLEAR_MG, HIGH_MG, xMax].forEach((v) => caption(svg, x(v), H - padB + 15, String(v), { size: 10, weight: 400 }));
    caption(svg, padL + (W - padL - padR) / 2, H - 4, "Caffeine At Bedtime, mg", { size: 10, weight: 600 });
    caption(svg, 4, 12, m.name, { anchor: "start", size: 10, weight: 600 });

    pts.forEach((p, i) => {
      const dot = node("circle", {
        cx: x(p.bedMg), cy: y(p[measure]), r: 4.5, fill: ZONES[p.zone].color, opacity: 0.85,
        stroke: "var(--surface-container-low)", "stroke-width": 1.5,
      }, svg);
      if (animate) Motion.fadeIn(dot, { delay: Math.min(i * 12, 700), duration: 380 });
    });
  }

  /* ---------------- flow ---------------- */

  function render(animate) {
    const now = nowHours();
    const total = entries.reduce((s, e) => s + Number(e.mg || 0), 0);
    const nowMg = Math.round(levelAt(now));
    if (animate) {
      Motion.countUp($("now-mg"), nowMg);
      Motion.countUp($("total-mg"), Math.round(total));
    } else {
      $("now-mg").textContent = nowMg;
      $("total-mg").textContent = Math.round(total);
    }
    $("now-sub").textContent = nowNote(now);
    $("total-sub").textContent = `${Math.round((total / DAILY_LIMIT_MG) * 100)}% Of 400 mg Limit`;
    $("usual-legend").hidden = !(insights && insights.usual);

    drawCurve(animate);
    renderReadout();
    renderCheckpoints();
    renderVerdict(animate);
    renderLastCall();
    renderEntries();
    renderHourly();
    renderWhen();
  }

  async function loadInsights() {
    try {
      insights = await M.api("/api/caffeine/insights");
      yesterday = insights.yesterday || [];
      bedtime = insights.bedtime || bedtime;
    } catch {
      insights = null;
    }
  }

  async function refresh(animate) {
    try {
      const r = await M.api("/api/caffeine");
      signedIn = true;
      entries = r.entries;
      await loadInsights();
    } catch {
      signedIn = false;
      insights = null;
      entries = loadLocal(0);
      yesterday = loadLocal(-1);
      bedtime = loadBedtime() || bedtime;
      $("signin-prompt").hidden = false;
    }
    $("bedtime").value = bedtime;
    render(animate);
    renderRecent();
    renderPersonal(animate);
  }

  async function add(label, mg, time) {
    if (!(mg > 0)) return;
    const loggedAt = time || nowTime();
    if (signedIn) {
      try {
        const r = await M.api("/api/caffeine", { method: "POST", body: { label, mg, loggedAt } });
        entries = r.entries;
        render(true);
        return;
      } catch {
        signedIn = false;
      }
    }
    entries = [{ id: `local-${Date.now()}`, label, mg, logged_at: loggedAt }, ...entries];
    saveLocal(entries);
    render(true);
  }

  async function remove(id) {
    if (id.startsWith("local-")) {
      entries = entries.filter((e) => String(e.id) !== id);
      saveLocal(entries);
      render(true);
      return;
    }
    await M.api("/api/caffeine/" + encodeURIComponent(id), { method: "DELETE" }).catch(() => {});
    try {
      entries = (await M.api("/api/caffeine")).entries;
    } catch { /* keep what is shown */ }
    render(true);
  }

  $("presets").innerHTML = PRESETS.map(
    (p) => `<button type="button" class="chip" data-mg="${p.mg}" data-label="${M.esc(p.label)}">${M.esc(p.label)} · ${p.mg}</button>`
  ).join("");

  document.querySelectorAll("[data-mg]").forEach((b) =>
    b.addEventListener("click", () => add(b.getAttribute("data-label"), Number(b.getAttribute("data-mg")), addTime))
  );

  /* ---------------- when it was had ---------------- */

  /* One time for every way of logging. A drink you had at eight and log at noon
     was being recorded at noon, which moved the curve and the bedtime estimate. */
  const WHEN_CHOICES = [
    { id: "now", label: "Now", minutes: 0 },
    { id: "30", label: "30 Min Ago", minutes: 30 },
    { id: "60", label: "1 Hour Ago", minutes: 60 },
    { id: "120", label: "2 Hours Ago", minutes: 120 },
  ];

  function timeAgo(minutes) {
    const d = new Date(Date.now() - minutes * 60000);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function renderWhen() {
    $("when-chips").innerHTML = WHEN_CHOICES.map(
      (c) => `<button type="button" class="chip" data-when="${c.id}" aria-pressed="${whenChoice === c.id}">${c.label}</button>`
    ).join("");
    document.querySelectorAll("[data-when]").forEach((b) =>
      b.addEventListener("click", () => {
        whenChoice = b.dataset.when;
        const choice = WHEN_CHOICES.find((c) => c.id === whenChoice);
        addTime = choice.minutes ? timeAgo(choice.minutes) : null;
        $("when-time").value = addTime || "";
        renderWhen();
      })
    );

    const at = addTime || nowTime();
    const isNow = !addTime;
    $("when-note").textContent = isNow
      ? "Anything you add lands at the time you add it."
      : `Anything you add lands at ${clock(toHours(at))}, not now.`;
    $("custom-when").textContent = isNow
      ? "This lands at the time you add it. Change that above."
      : `This lands at ${clock(toHours(at))}, set above.`;
  }

  $("when-time").addEventListener("change", () => {
    const value = $("when-time").value;
    if (!/^\d{2}:\d{2}$/.test(value)) {
      addTime = null;
      whenChoice = "now";
    } else {
      addTime = value;
      whenChoice = "custom";
    }
    renderWhen();
  });

  $("custom-add").addEventListener("click", () => {
    const label = $("custom-label").value.trim() || "Drink";
    const mg = Number($("custom-mg").value);
    add(label, mg, addTime);
    $("custom-label").value = "";
    $("custom-mg").value = "";
  });

  $("bedtime").addEventListener("change", async () => {
    const value = $("bedtime").value;
    if (!/^\d{2}:\d{2}$/.test(value)) return;
    bedtime = value;
    saveBedtime(value);
    render(false);
    if (!signedIn) return;
    try {
      await M.api("/api/calibration/bedtime", { method: "POST", body: { bedtime: value } });
      await loadInsights();
      render(false);
      renderRecent();
      renderPersonal(false);
    } catch { /* the local bedtime still applies */ }
  });

  bindCurve();

  /* Redraw at the new width rather than stretching, so the labels stay legible
     on a phone. The width check skips the observer's first call, which would
     otherwise cancel the entrance animation. */
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      const host = $("curve");
      if (String(Math.round(host.clientWidth)) === host.dataset.width) return;
      drawCurve(false);
      drawScatter(false);
    }).observe($("curve"));
  }

  // Keep "now" honest while the page stays open.
  setInterval(() => {
    if (scrubHour == null && document.visibilityState === "visible") render(false);
  }, 5 * 60 * 1000);

  refresh(true);
})();
