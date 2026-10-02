/* Myaku — the shared channel card.
 *
 * Body, Brain, and Life each open with the same card: the channel exactly as the
 * divergence engine scores it, the parts moving it, and its weeks as a line. It
 * lives here once so the three pages cannot drift apart in how they describe the
 * model they share, and Today uses the same part names when it summarises them.
 */

const Channel = (function () {
  const NS = "http://www.w3.org/2000/svg";

  /* Each part of each channel, where on its page it is explained, and the
     sentence used when it is the part pulling the channel the wrong way. */
  const PARTS = {
    autonomic: [
      { key: "sleep_minutes", label: "Sleep", href: "#sleep-section", worse: "Sleep is shorter than usual." },
      { key: "sleep_efficiency", label: "Sleep Efficiency", href: "#sleep-section", worse: "Sleep efficiency is lower than usual." },
      { key: "hrv_ms", label: "Heart Rate Variability", href: "#hrv-section", worse: "Heart rate variability is lower than usual." },
      { key: "rhr_bpm", label: "Resting Heart Rate", href: "#rhr-section", worse: "Resting heart rate is higher than usual." },
    ],
    cognitive: [
      { key: "speed", label: "Response Speed", href: "#sessions-section", worse: "Your responses are slower than usual." },
      { key: "lapses", label: "Lapses", href: "#sessions-section", worse: "Lapses are more frequent than usual." },
    ],
    psychological: [
      { key: "load", label: "Load", href: "#numbers-section", worse: "Your days feel heavier than usual." },
      { key: "control", label: "Your Call", href: "#strain-section", worse: "Less of your days feel like your call than usual." },
      { key: "recovery", label: "Felt Recovery", href: "#numbers-section", worse: "You feel less recovered than usual." },
      { key: "focus", label: "Felt Focus", href: "#numbers-section", worse: "You feel less sharp than usual." },
      { key: "motivation", label: "Motivation", href: "#numbers-section", worse: "Your motivation is lower than usual." },
      { key: "mood", label: "Mood", href: "#mood-section", worse: "Your mood is lower than usual." },
      { key: "strain", label: "Weekly Demand", href: "#strain-section", worse: "Your weekly demands outweigh your say more than usual." },
      { key: "burnout", label: "Burnout Signs", href: "#burnout-section", worse: "Your burnout signs are higher than usual." },
      { key: "connection", label: "Connection", href: "#connection-section", worse: "You feel less connected to people than usual." },
      { key: "writing", label: "Your Writing", href: "#writing-section", worse: "Your journal entries read heavier than usual." },
    ],
  };

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

  /* Drawn at the container's real width rather than stretched, so labels stay the
     size they were set at on a phone. */
  function frame(host, H) {
    const W = Math.max(280, Math.round(host.clientWidth || 600));
    host.innerHTML = "";
    return { svg: node("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" }, host), W };
  }

  const shortDate = (d) =>
    new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  /* The part pulling a channel furthest the wrong way, or null when none has moved
     far enough to name. */
  function topPart(key, parts, thresholds) {
    const ranked = (PARTS[key] || [])
      .map((s) => ({ ...s, z: parts ? parts[s.key] : null }))
      .filter((s) => s.z != null)
      .sort((a, b) => b.z - a.z);
    return ranked.length && ranked[0].z >= thresholds.notable ? ranked[0] : null;
  }

  function weeklyChart(host, points, thresholds, color, animate) {
    const pts = (points || []).filter((p) => p.z != null).slice(-12);
    if (pts.length < 2) {
      host.innerHTML = `<p class="empty">The weekly line appears once two weeks have been compared.</p>`;
      return;
    }
    const H = 180, padL = 12, padR = 14, padT = 16, padB = 24;
    const { svg, W } = frame(host, H);
    const zs = pts.map((p) => p.z);
    const yMin = Math.max(-3, Math.min(-2, Math.min(...zs) - 0.4));
    const yMax = Math.min(3, Math.max(2, Math.max(...zs) + 0.4));
    const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
    const y = (v) => padT + ((yMax - v) / (yMax - yMin)) * (H - padT - padB);
    const n = thresholds.notable;

    node("rect", { x: padL, y: y(n), width: W - padL - padR, height: y(-n) - y(n), rx: 8, fill: "var(--green)", opacity: 0.13 }, svg);
    node("line", { x1: padL, x2: W - padR, y1: y(0), y2: y(0), stroke: "var(--outline-variant)", "stroke-width": 1 }, svg);
    caption(svg, padL + 8, y(n) + 15, "Typical For You", { anchor: "start", size: 10, weight: 600 });
    caption(svg, padL + 2, padT + 2, "Worse", { anchor: "start", size: 10, weight: 400 });
    caption(svg, padL + 2, H - padB - 2, "Better", { anchor: "start", size: 10, weight: 400 });

    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.z).toFixed(1)}`).join("");
    const path = node("path", { d, fill: "none", stroke: color, "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    pts.forEach((p, i) => node("circle", {
      cx: x(i), cy: y(p.z), r: i === pts.length - 1 ? 5.5 : 3.5,
      fill: color, stroke: "var(--surface-container-low)", "stroke-width": 2,
    }, svg));

    const ticks = [...new Set([0, Math.floor((pts.length - 1) / 2), pts.length - 1])];
    ticks.forEach((i, k) => caption(svg, x(i), H - 6, shortDate(pts[i].week), {
      size: 10, weight: 400, anchor: k === 0 ? "start" : i === pts.length - 1 ? "end" : "middle",
    }));
    if (animate) Motion.drawPath(path, { duration: 1000 });
  }

  /* A radial tick dial in the manner of an instrument gauge. The arc runs from
     better than usual on the left, through typical at the top, to worse than usual
     on the right. The ticks inside the typical band are brighter, and each marker
     is one channel's position, so several markers apart on one dial is the
     divergence itself. */
  function dial(host, { markers, thresholds, size = 220, value = "", label = "", compact = false, word = false, animate = true }) {
    const c = size / 2;
    const outer = c - 4;
    const major = size * (compact ? 0.09 : 0.07);
    const minor = size * (compact ? 0.055 : 0.042);
    const sweep = 270;
    const start = -135;
    const count = compact ? 37 : 61;
    const notable = thresholds ? thresholds.notable : 1;
    const angleOf = (z) => start + ((Math.max(-3, Math.min(3, z)) + 3) / 6) * sweep;
    const point = (deg, r) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return [c + Math.cos(rad) * r, c + Math.sin(rad) * r];
    };

    const wrap = document.createElement("div");
    wrap.className = "dial" + (compact ? " compact" : "");
    wrap.style.width = `${size}px`;
    wrap.style.height = `${size}px`;
    const svg = node("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, "aria-hidden": "true" }, wrap);

    for (let i = 0; i < count; i++) {
      const a = start + (i / (count - 1)) * sweep;
      const z = -3 + (i / (count - 1)) * 6;
      const isMajor = i % 5 === 0;
      const [x1, y1] = point(a, outer);
      const [x2, y2] = point(a, outer - (isMajor ? major : minor));
      node("line", {
        x1, y1, x2, y2,
        stroke: "var(--on-surface)",
        "stroke-opacity": Math.abs(z) < notable ? 0.5 : 0.15,
        "stroke-width": isMajor ? 1.6 : 1.1,
        "stroke-linecap": "round",
      }, svg);
    }

    // The typical band as a faint inner arc, so "normal for you" has a shape.
    const bandR = outer - major - (compact ? 5 : 9);
    const [bx1, by1] = point(angleOf(-notable), bandR);
    const [bx2, by2] = point(angleOf(notable), bandR);
    node("path", {
      d: `M${bx1.toFixed(2)},${by1.toFixed(2)} A${bandR},${bandR} 0 0 1 ${bx2.toFixed(2)},${by2.toFixed(2)}`,
      fill: "none", stroke: "var(--green)", "stroke-opacity": 0.5, "stroke-width": compact ? 2 : 2.5, "stroke-linecap": "round",
    }, svg);

    if (!compact) {
      const [lx, ly] = point(start, outer - major - 14);
      const [rx, ry] = point(start + sweep, outer - major - 14);
      caption(svg, lx + 6, ly + 18, "Better", { size: 9.5, weight: 500, anchor: "middle" });
      caption(svg, rx - 6, ry + 18, "Worse", { size: 9.5, weight: 500, anchor: "middle" });
    }

    (markers || []).filter((m) => m.z != null).forEach((m, i) => {
      const g = node("g", {}, svg);
      const [tx, ty] = point(0, outer + 3);
      const [ix, iy] = point(0, outer - major - (compact ? 2 : 5));
      node("line", { x1: tx, y1: ty, x2: ix, y2: iy, stroke: m.color, "stroke-width": compact ? 3 : 3.5, "stroke-linecap": "round" }, g);
      node("circle", { cx: tx, cy: ty, r: compact ? 3 : 4, fill: m.color }, g);
      g.style.transformOrigin = `${c}px ${c}px`;
      g.style.transform = `rotate(${angleOf(m.z)}deg)`;
      g.style.filter = `drop-shadow(0 0 6px ${m.color})`;
      if (animate && !Motion.reduced()) {
        g.animate([{ transform: `rotate(${start + sweep / 2}deg)`, opacity: 0 }, { transform: `rotate(${angleOf(m.z)}deg)`, opacity: 1 }], {
          duration: 1100, delay: 150 + i * 140, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards",
        });
      }
    });

    const center = document.createElement("div");
    center.className = "dial-center";
    center.innerHTML = `<div class="dial-value${word ? " word" : ""}">${M.esc(value)}</div>${label ? `<div class="dial-label">${M.esc(label)}</div>` : ""}`;
    wrap.appendChild(center);

    host.innerHTML = "";
    host.appendChild(wrap);
  }

  /* The opening card of a channel page. `ids` names the elements to fill: state,
     axis, drivers, chart, and note. */
  function render({ key, divergence, color, animate, ids }) {
    const $ = (id) => document.getElementById(id);
    const d = divergence;
    const ch = d.channels[key];
    const b = Explain.band(ch.z, d.thresholds);
    const held = d.sustained && d.sustained[key];
    const weeksHeld = d.thresholds.persistence;

    $(ids.state).innerHTML = `
      <div class="state-row">
        <div>
          <p class="title-1">${M.esc(b.word)}</p>
          <p class="body secondary" style="margin-top:8px;">${M.esc(Explain.channelSentence(key, ch.z, d.thresholds))}</p>
          <div style="margin-top:14px;">${held
            ? M.pill(`Held For ${weeksHeld} ${weeksHeld === 1 ? "Week" : "Weeks"}`, "warn")
            : M.pill(M.confidenceLabel(d.confidence), b.tone)}</div>
        </div>
        <div class="state-dial"></div>
      </div>`;
    dial($(ids.state).querySelector(".state-dial"), {
      markers: [{ z: ch.z, color }], thresholds: d.thresholds, size: 124, compact: true, animate,
      // A word rather than a signed number, which carried no unit anyone could read.
      value: b.short, label: "Last Seven Days", word: true,
    });

    /* Positive is always the worse direction here, whichever way the raw number
       for that part runs. */
    const parts = ch.parts || {};
    const notable = d.thresholds.notable;
    $(ids.axis).hidden = !Object.values(parts).some((z) => z != null);
    $(ids.drivers).innerHTML = PARTS[key].map((p) => {
      const z = parts[p.key];
      const word = z == null ? "No Reading" : z >= notable ? "Worse Than Usual" : z <= -notable ? "Better Than Usual" : "Typical";
      const tone = z == null ? "" : z >= notable ? "bad" : z <= -notable ? "good" : "";
      const width = z == null ? 0 : Math.min(50, (Math.abs(z) / 3) * 50);
      const bar = z == null || width < 0.5
        ? ""
        : `<span class="driver-bar ${z > 0 ? "worse" : "better"}" style="width:${width.toFixed(1)}%;${z > 0 ? "left" : "right"}:50%;"></span>`;
      return `<a class="driver" href="${p.href}">
        <span class="driver-name">${p.label}</span>
        <span class="driver-word ${tone}">${word}</span>
        <span class="driver-track" aria-hidden="true"><span class="driver-mid"></span>${bar}</span>
      </a>`;
    }).join("");

    weeklyChart($(ids.chart), ch.points, d.thresholds, color, animate);
    const weeks = ch.weeks || 0;
    $(ids.note).textContent = weeks
      ? `Each point is one week, counted back from today and compared with the weeks before it. ${weeks} ${weeks === 1 ? "week has" : "weeks have"} been compared so far.`
      : "The weekly reading starts once there are three earlier weeks to compare against.";
  }

  /* A small comparison table whose first column names each row. */
  function table(headers, rows) {
    return `<div class="table-wrap">
      <table class="table">
        <thead><tr>${headers.map((h, i) => `<th scope="col"${i ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr><th scope="row">${r[0]}</th>${r.slice(1).map((c) => `<td class="num">${c}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`;
  }

  const IDS = { state: "channel-state", axis: "driver-axis", drivers: "drivers", chart: "channel-chart", note: "channel-note" };

  return { PARTS, IDS, node, caption, frame, shortDate, topPart, weeklyChart, dial, render, table };
})();
