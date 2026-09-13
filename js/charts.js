/* Myaku — chart primitives. Plain SVG, theme-aware through CSS variables,
   no dependencies. Every one of these degrades to an honest empty state
   rather than drawing something meaningless from three points. */

const Charts = (() => {
  const NS = "http://www.w3.org/2000/svg";

  function n(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function frame(container, w, h) {
    container.innerHTML = "";
    const svg = n("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: "100%", preserveAspectRatio: "none" });
    svg.style.display = "block";
    svg.style.overflow = "visible";
    container.appendChild(svg);
    return svg;
  }

  function empty(container, message) {
    container.innerHTML = `<p class="empty">${message}</p>`;
  }

  function text(svg, x, y, str, opts = {}) {
    const t = n("text", {
      x, y,
      "font-size": opts.size || 10,
      fill: opts.fill || "var(--label-2)",
      "text-anchor": opts.anchor || "middle",
      "font-weight": opts.weight || 400,
    });
    t.textContent = str;
    svg.appendChild(t);
    return t;
  }

  /* ---------------- multi-series line ---------------- */

  function lines(container, { labels, series, min, max, height = 200, zeroLine = false, band, bandLabel, bandColor }) {
    const W = 640, H = height, padL = 30, padR = 12, padT = 12, padB = 22;
    if (!labels || labels.length < 2) return empty(container, "Not enough weeks to draw a line yet.");
    const svg = frame(container, W, H);

    const x = (i) => padL + (i * (W - padL - padR)) / (labels.length - 1);
    const y = (v) => H - padB - ((v - min) / (max - min)) * (H - padT - padB);

    if (band) {
      const top = y(band[1]);
      const h = Math.max(1, y(band[0]) - top);
      svg.appendChild(n("rect", {
        x: padL, y: top, width: W - padL - padR, height: h,
        rx: 4, fill: bandColor || "var(--green)", opacity: 0.14,
      }));
      /* Named in place, so the shaded region needs no legend entry. Anchored
         left because the series run out to the right edge and a label there
         lands on top of them. */
      if (bandLabel) {
        /* Tucked under the band's top edge rather than centred in it: the band
           is symmetric about zero, so its centre is exactly where the baseline
           is drawn and the two would sit on top of each other. */
        text(svg, padL + 8, top + 13, bandLabel, { anchor: "start", size: 11, weight: 600, fill: "var(--label-2)" });
      }
    }

    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = min + ((max - min) * i) / steps;
      svg.appendChild(n("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: "var(--separator)", "stroke-width": 1 }));
      text(svg, padL - 6, y(v) + 3, (Math.round(v * 10) / 10).toString(), { anchor: "end" });
    }
    if (zeroLine && min < 0 && max > 0) {
      svg.appendChild(n("line", { x1: padL, x2: W - padR, y1: y(0), y2: y(0), stroke: "var(--label-3)", "stroke-width": 1.5 }));
    }

    /* Each series is drawn on in turn, and its end marker lands as the line
       arrives there, so the chart reads left to right the way the season did. */
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      if (pts.length < 2) return;
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
      const path = n("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width || 3, "stroke-linejoin": "round", "stroke-linecap": "round" });
      svg.appendChild(path);
      Motion.drawPath(path, { duration: 1000, delay: si * 110 });

      const last = pts[pts.length - 1];
      const cap = n("circle", { cx: last[0], cy: last[1], r: 4.5, fill: s.color, stroke: "var(--surface-container-low)", "stroke-width": 2.5 });
      svg.appendChild(cap);
      Motion.popIn(cap, { delay: si * 110 + 900 });
    });

    labels.forEach((l, i) => {
      if (!l) return;
      text(svg, x(i), H - 5, l, { anchor: i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle" });
    });
  }

  /* ---------------- bars ---------------- */

  function bars(container, { items, height = 180, color, formatValue, highlight }) {
    const usable = items.filter((i) => i.value != null);
    if (usable.length < 2) return empty(container, "Not enough data to compare yet.");

    const W = 640, H = height, padT = 18, padB = 24, padL = 8, padR = 8;
    const svg = frame(container, W, H);
    const max = Math.max(...usable.map((i) => i.value));
    const min = Math.min(0, ...usable.map((i) => i.value));
    const bw = (W - padL - padR) / items.length;

    items.forEach((item, i) => {
      const cx = padL + bw * i + bw / 2;
      if (item.value == null) {
        text(svg, cx, H - 6, item.label, { size: 10 });
        return;
      }
      const h = ((item.value - min) / (max - min || 1)) * (H - padT - padB);
      const isHot = highlight && highlight === item.label;
      const rect = n("rect", {
        x: cx - bw * 0.32, y: H - padB - h, width: bw * 0.64, height: Math.max(2, h),
        rx: 8, fill: color, opacity: isHot ? 1 : 0.45,
      });
      svg.appendChild(rect);
      Motion.growRect(rect, { delay: i * 45 });

      const value = text(svg, cx, H - padB - h - 7, formatValue ? formatValue(item.value) : item.value.toFixed(1), { size: 10, weight: 700, fill: "var(--label)" });
      Motion.fadeIn(value, { delay: i * 45 + 380 });
      text(svg, cx, H - 6, item.label, { size: 10 });
    });
  }

  /* Bars measured from a centre line rather than from zero.
     Reaction time never approaches zero, so a zero baseline turns a real
     twenty-millisecond spread into seven indistinguishable full-height bars.
     Rebasing on the mean keeps the differences readable without the usual
     dishonesty of a truncated axis, because the axis is now explicitly a
     difference and is labelled as one. */
  function divergingBars(container, { items, height = 190, positive, negative, colorFor, formatValue, centreLabel }) {
    const usable = items.filter((i) => i.value != null);
    if (usable.length < 2) return empty(container, "Not enough data to compare yet.");

    const W = 640, H = height, padT = 16, padB = 26, padL = 8, padR = 8;
    const svg = frame(container, W, H);
    const span = Math.max(...usable.map((i) => Math.abs(i.value))) * 1.25 || 1;
    const mid = padT + (H - padT - padB) / 2;
    const half = (H - padT - padB) / 2;
    const bw = (W - padL - padR) / items.length;

    svg.appendChild(n("line", { x1: padL, x2: W - padR, y1: mid, y2: mid, stroke: "var(--label-3)", "stroke-width": 1.5 }));

    items.forEach((item, i) => {
      const cx = padL + bw * i + bw / 2;
      if (item.value == null) {
        text(svg, cx, H - 8, item.label, { size: 10, fill: "var(--label-3)" });
        return;
      }
      const h = (Math.abs(item.value) / span) * half;
      const up = item.value > 0;
      const rect = n("rect", {
        x: cx - bw * 0.3, y: up ? mid - h : mid, width: bw * 0.6, height: Math.max(2, h),
        rx: 8, fill: colorFor ? colorFor(item) : up ? positive : negative,
      });
      svg.appendChild(rect);
      // Both directions grow away from the centre line they are measured from.
      Motion.growRect(rect, { delay: i * 55, from: up ? "bottom" : "top" });

      const value = text(svg, cx, up ? mid - h - 6 : mid + h + 14,
        formatValue ? formatValue(item.value) : item.value.toFixed(1),
        { size: 10, weight: 700, fill: "var(--label)" });
      Motion.fadeIn(value, { delay: i * 55 + 380 });
      text(svg, cx, H - 8, item.label, { size: 10 });
    });

    if (centreLabel) text(svg, W - padR, mid - 5, centreLabel, { anchor: "end", size: 9, fill: "var(--label-3)" });
  }

  /* Paired bars, for inside-versus-outside comparisons. */
  function pairedBars(container, { groups, height = 170, colorA, colorB, labelA, labelB, formatValue }) {
    const usable = groups.filter((g) => g.a != null && g.b != null);
    if (!usable.length) return empty(container, "Not enough data inside and outside this period.");

    const W = 640, H = height, padT = 20, padB = 26, padL = 10, padR = 10;
    const svg = frame(container, W, H);
    const all = usable.flatMap((g) => [g.a, g.b]);
    const max = Math.max(...all) * 1.12;
    const gw = (W - padL - padR) / usable.length;

    usable.forEach((g, i) => {
      const cx = padL + gw * i + gw / 2;
      [[g.a, colorA, -1], [g.b, colorB, 1]].forEach(([v, c, side], k) => {
        const h = (v / max) * (H - padT - padB);
        const rect = n("rect", {
          x: cx + side * 2 + (side < 0 ? -gw * 0.3 : 0), y: H - padB - h,
          width: gw * 0.3, height: Math.max(2, h), rx: 6, fill: c,
        });
        svg.appendChild(rect);
        Motion.growRect(rect, { delay: i * 70 + k * 35 });
      });
      text(svg, cx, H - 8, g.label, { size: 10 });
    });

    text(svg, padL, 11, labelA, { anchor: "start", size: 10, fill: colorA, weight: 600 });
    text(svg, W - padR, 11, labelB, { anchor: "end", size: 10, fill: colorB, weight: 600 });
  }

  /* ---------------- lag correlogram ---------------- */

  function correlogram(container, { series, height = 170, color }) {
    const usable = series.filter((s) => s.r != null);
    if (usable.length < 5) return empty(container, "Not enough overlapping days to scan for a lead yet.");

    const W = 640, H = height, padT = 14, padB = 28, padL = 26, padR = 10;
    const svg = frame(container, W, H);
    const mid = (H - padT - padB) / 2 + padT;
    const bw = (W - padL - padR) / series.length;

    svg.appendChild(n("line", { x1: padL, x2: W - padR, y1: mid, y2: mid, stroke: "var(--separator)", "stroke-width": 1 }));
    text(svg, padL - 6, mid + 3, "0", { anchor: "end" });

    const best = usable.reduce((m, s) => (Math.abs(s.r) > Math.abs(m.r) ? s : m));

    series.forEach((s, i) => {
      const cx = padL + bw * i + bw / 2;
      if (s.r == null) return;
      const h = Math.abs(s.r) * (mid - padT);
      const up = s.r > 0;
      const rect = n("rect", {
        x: cx - bw * 0.34, y: up ? mid - h : mid, width: bw * 0.68, height: Math.max(1.5, h),
        rx: 4, fill: color, opacity: s.lag === best.lag ? 1 : 0.4,
      });
      svg.appendChild(rect);
      Motion.growRect(rect, { delay: i * 26, duration: 520, from: up ? "bottom" : "top" });
      if (s.lag % 7 === 0 || s.lag === best.lag) text(svg, cx, H - 10, String(s.lag), { size: 9 });
    });

    text(svg, W / 2, H - 1, "Days Of Lag", { size: 9, fill: "var(--label-3)" });
  }

  /* ---------------- scatter ---------------- */

  function scatter(container, { points, height = 190, color, xLabel, yLabel }) {
    if (!points || points.length < 6) return empty(container, "Not enough paired days to plot this yet.");

    /* The top padding leaves a clear band for the axis name, which otherwise
       lands on the same baseline as the topmost gridline value. */
    const W = 640, H = height, padL = 34, padR = 12, padT = 22, padB = 28;
    const svg = frame(container, W, H);
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs) || 1;
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const px = (v) => padL + ((v - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
    const py = (v) => H - padB - ((v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);

    [0, 0.5, 1].forEach((f) => {
      const v = yMin + (yMax - yMin) * f;
      svg.appendChild(n("line", { x1: padL, x2: W - padR, y1: py(v), y2: py(v), stroke: "var(--separator)", "stroke-width": 1 }));
      text(svg, padL - 6, py(v) + 3, Math.round(v).toString(), { anchor: "end" });
    });

    /* Points land in the order they were recorded, which turns a static cloud
       into the season accumulating. Capped so a long history does not spend
       several seconds arriving. */
    points.forEach((p, i) => {
      const dot = n("circle", { cx: px(p.x), cy: py(p.y), r: 4, fill: color, opacity: 0.72 });
      svg.appendChild(dot);
      Motion.popIn(dot, { delay: Math.min(i * 18, 900), duration: 420 });
    });

    text(svg, W / 2, H - 6, xLabel, { size: 10 });
    text(svg, 0, 9, yLabel, { anchor: "start", size: 9, fill: "var(--label-3)" });
  }

  /* ---------------- sparkline ---------------- */

  /* Two weeks of a single measure with no axes, no labels, and a marker on the
     most recent point. It answers one question — is this going up or down —
     and deliberately cannot answer any other. */
  function sparkline(container, { values, color, height = 26 }) {
    const pts = (values || []).filter((v) => v != null);
    if (pts.length < 3) { container.innerHTML = ""; return; }

    const W = 120, H = height, pad = 3;
    const svg = frame(container, W, H);
    svg.setAttribute("preserveAspectRatio", "none");
    const min = Math.min(...pts), max = Math.max(...pts);
    const x = (i) => (i * (W - pad * 2)) / (pts.length - 1) + pad;
    const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);

    const d = pts.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
    const path = n("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: 0.85 });
    svg.appendChild(path);
    Motion.drawPath(path, { duration: 700 });

    const last = n("circle", { cx: x(pts.length - 1), cy: y(pts[pts.length - 1]), r: 3, fill: color });
    svg.appendChild(last);
    Motion.popIn(last, { delay: 600, duration: 360 });
  }

  /* ---------------- quadrant ---------------- */

  function quadrant(container, { points, trail, height = 260, labels, colorFor }) {
    if (!points || !points.length) return empty(container, "Nothing plotted here yet.");

    const S = 260, H = height;
    const svg = frame(container, S, H);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const pad = 26;
    const px = (v) => pad + ((v + 1) / 2) * (S - pad * 2);
    const py = (v) => H - pad - ((v + 1) / 2) * (H - pad * 2);

    svg.appendChild(n("rect", { x: pad, y: pad, width: S - pad * 2, height: H - pad * 2, rx: 10, fill: "var(--fill-2)" }));
    svg.appendChild(n("line", { x1: pad, x2: S - pad, y1: py(0), y2: py(0), stroke: "var(--separator)", "stroke-width": 1 }));
    svg.appendChild(n("line", { x1: px(0), x2: px(0), y1: pad, y2: H - pad, stroke: "var(--separator)", "stroke-width": 1 }));

    points.forEach((p, i) => {
      const isLast = i === points.length - 1;
      const dot = n("circle", {
        cx: px(p.x), cy: py(p.y), r: isLast ? 8 : p.r || 4,
        fill: colorFor ? colorFor(p) : "var(--blue)",
        opacity: isLast ? 1 : p.opacity || 0.45,
        stroke: isLast ? "var(--surface-container-low)" : "none", "stroke-width": isLast ? 3 : 0,
      });
      svg.appendChild(dot);
      Motion.popIn(dot, { delay: Math.min(i * 20, 820), duration: 440 });
    });

    /* The trail is drawn last and on top, then written on over the top of the
       settled cloud, so the path of the season is the final thing you see. */
    if (trail && trail.length > 1) {
      const d = trail.map((p, i) => (i ? "L" : "M") + px(p.x).toFixed(1) + "," + py(p.y).toFixed(1)).join(" ");
      const path = n("path", { d, fill: "none", stroke: "var(--label-3)", "stroke-width": 2, "stroke-dasharray": "3 4", "stroke-linecap": "round" });
      svg.appendChild(path);
      Motion.fadeIn(path, { delay: 420, duration: 700 });
    }

    /* Drawn after the points, because a point sitting at the extreme of an axis
       lands exactly where that axis is named and would otherwise cover it. */
    if (labels) {
      /* Sized from the label itself, since a fixed plate leaves a visible
         blank slab beside the shorter of the two. */
      const plate = (x, y, label, atStart) => {
        const w = label.length * 5.6 + 5;
        svg.appendChild(n("rect", {
          x: atStart ? x - 3 : x - w + 3, y: y - 10, width: w, height: 13, rx: 3,
          fill: "var(--surface-container-low)", opacity: 0.82,
        }));
      };
      plate(pad, H / 2 - 6, labels.left, true);
      plate(S - pad, H / 2 - 6, labels.right, false);
      text(svg, S / 2, pad - 8, labels.top, { size: 10 });
      text(svg, S / 2, H - pad + 16, labels.bottom, { size: 10 });
      text(svg, pad, H / 2 - 6, labels.left, { size: 10, anchor: "start" });
      text(svg, S - pad, H / 2 - 6, labels.right, { size: 10, anchor: "end" });
    }
  }

  return { lines, bars, divergingBars, pairedBars, correlogram, scatter, quadrant, sparkline, empty };
})();
