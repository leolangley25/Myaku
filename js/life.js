/* Myaku — Life.
 *
 * The Life channel, opened up. It has ten parts, more than either of the other
 * two, because self-report is the only channel that covers a whole life rather
 * than a body or a reaction. This page keeps them apart and says each one in the
 * athlete's own terms, and it ends where Life meets Body, on felt against measured
 * sleep. Support is always one scroll away on this page.
 */

(function () {
  M.boot("today");

  const $ = (id) => document.getElementById(id);
  const { node, caption, frame, shortDate } = Channel;

  let data = null;
  let divergence = null;

  const NUMBERS = [
    { key: "load", label: "Load", higherIsWorse: true },
    { key: "control", label: "Your Call", higherIsWorse: false },
    { key: "recovery", label: "Felt Recovery", higherIsWorse: false },
    { key: "focus", label: "Felt Focus", higherIsWorse: false },
    { key: "motivation", label: "Motivation", higherIsWorse: false },
    { key: "sleepQuality", label: "How Nights Felt", higherIsWorse: false },
  ];

  // Laid out the way the check-in square is: wired at the top, pleasant on the right.
  const QUADS = [
    { key: "roughWired", label: "Rough And Wired", rough: true },
    { key: "goodWired", label: "Good And Wired" },
    { key: "roughCalm", label: "Rough And Calm", rough: true },
    { key: "goodCalm", label: "Good And Calm" },
  ];

  const DOMAIN_LABELS = { training: "Training", academic: "Academics", personal: "Personal Life" };

  const BURNOUT = [
    { key: "exhaustion", color: "var(--red)", flip: false },
    { key: "accomplishment", color: "var(--orange)", flip: true },
    { key: "devaluation", color: "var(--purple)", flip: false },
  ];

  const pct = (v) => `${Math.round(v * 100)}%`;

  const tile = (t) => `<div class="tile">
    <div class="tile-key">${t.key}</div>
    <div class="tile-val${t.words ? " words" : ""}">${t.val}</div>
    <div class="tile-sub">${t.sub}</div>
  </div>`;

  function setFinding(id, text, tone) {
    const el = $(id);
    el.classList.remove("finding-good", "finding-warn", "finding-bad");
    if (tone) el.classList.add("finding-" + tone);
    el.textContent = text;
  }

  /* ---------------- the week in numbers ---------------- */

  function renderNumbers() {
    $("coverage-tiles").innerHTML = [
      { key: "Check-Ins", val: `${data.checkins.days}<span class="stat-unit"> of ${data.checkins.target}</span>`, sub: "Last Seven Days" },
      { key: "Weekly Reflection", val: data.weeklyDone ? "Done" : "Not Yet", sub: "This Week", words: true },
    ].map(tile).join("");

    $("numbers-rows").innerHTML = NUMBERS.map((n) => {
      const m = data.measures[n.key];
      if (m.now == null) return "";
      const diff = m.usual == null ? null : m.now - m.usual;
      const moved = diff != null && Math.abs(diff) >= 0.5;
      const worse = moved && (n.higherIsWorse ? diff > 0 : diff < 0);
      const delta = diff == null ? "" : `<small>${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(diff).toFixed(1)}</small>`;
      return `<div class="row">
        <span class="row-main">
          <span class="row-title">${n.label}</span>
          <span class="row-sub">${m.usual == null ? "No Usual Yet" : `Usually ${m.usual.toFixed(1)}`}</span>
        </span>
        <span class="row-value num-delta${moved ? (worse ? " worse" : " better") : ""}">${m.now.toFixed(1)}${delta}</span>
      </div>`;
    }).join("");
  }

  /* ---------------- demand and say ---------------- */

  function renderStrain(animate) {
    const s = data.strain;
    let text;
    let tone = "";
    if (!s.of) {
      text = "None of your check-ins in the last seven days included the first square.";
    } else {
      text = `${s.days} of your ${s.of} check-ins this week landed in the strain corner, a heavy day that was not your call.`;
      if (s.usualShare != null) {
        text += ` Usually about ${pct(s.usualShare)} do.`;
        if (s.days / s.of - s.usualShare >= 0.25) tone = "warn";
      }
    }
    setFinding("strain-finding", text, tone);
    strainChart(animate);
    trendChart(animate);

    const rated = data.domains.filter((d) => d.demand != null && d.control != null);
    $("domain-rows").innerHTML = rated.map((d) => `<div class="row">
      <span class="row-main">
        <span class="row-title">${DOMAIN_LABELS[d.key]}</span>
        <span class="row-sub">Demand ${d.demand} of 7, say ${d.control} of 7.</span>
      </span>
      ${M.pill(d.strained ? "Strain Corner" : "Workable", d.strained ? "warn" : "good")}
    </div>`).join("");
    $("domain-note").textContent = rated.length
      ? `From your weekly reflection for the week of ${M.prettyDate(data.latestWeekStart)}.`
      : "Do a weekly reflection to see demand and say for training, academics, and personal life separately.";
  }

  function strainChart(animate) {
    const host = $("strain-chart");
    const pts = data.strain.points;
    if (!pts.length) {
      host.innerHTML = "";
      return;
    }
    const size = Math.min(340, Math.max(240, Math.round(host.clientWidth || 300)));
    host.innerHTML = "";
    const svg = node("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, "aria-hidden": "true" }, host);
    const padL = 36, top = 10;
    const plot = size - padL - 30;
    const x = (v) => padL + (v / 10) * plot;
    const y = (v) => top + (1 - v / 10) * plot;

    node("rect", { x: padL, y: top, width: plot, height: plot, rx: 10, fill: "var(--on-surface)", opacity: 0.04 }, svg);
    node("rect", { x: x(6), y: y(4), width: x(10) - x(6), height: y(0) - y(4), rx: 8, fill: "var(--red)", opacity: 0.14 }, svg);
    caption(svg, x(8), y(0) - 8, "Strain Corner", { size: 10, weight: 700, fill: "var(--error)" });

    [0, 5, 10].forEach((v) => {
      caption(svg, x(v), top + plot + 14, String(v), { size: 10, weight: 400 });
      caption(svg, padL - 8, y(v) + 4, String(v), { anchor: "end", size: 10, weight: 400 });
    });
    caption(svg, padL + plot / 2, size - 2, "Load", { size: 10, weight: 600 });
    const yLabel = caption(svg, 10, top + plot / 2, "Your Call", { size: 10, weight: 600 });
    yLabel.setAttribute("transform", `rotate(-90 10 ${top + plot / 2})`);

    const groups = {};
    pts.forEach((p) => {
      const k = `${p.load},${p.control}`;
      const g = (groups[k] = groups[k] || { load: p.load, control: p.control, n: 0, recent: false });
      g.n++;
      if (p.recent) g.recent = true;
    });
    Object.values(groups)
      .sort((a, b) => Number(a.recent) - Number(b.recent))
      .forEach((g, i) => {
        const dot = node("circle", {
          cx: x(g.load), cy: y(g.control), r: 4 + 2.5 * Math.sqrt(g.n - 1),
          fill: "var(--ch-psy)", opacity: g.recent ? 0.95 : 0.3,
          stroke: g.recent ? "var(--surface-container-low)" : "none", "stroke-width": 1.5,
        }, svg);
        if (animate) Motion.fadeIn(dot, { delay: Math.min(i * 20, 500), duration: 360 });
      });
  }

  function trendChart(animate) {
    const host = $("trend-chart");
    const days = data.trend;
    if (days.filter((d) => d.load != null).length < 2) {
      host.innerHTML = "";
      return;
    }
    const H = 170, padL = 26, padR = 12, padT = 12, padB = 24;
    const { svg, W } = frame(host, H);
    const x = (i) => padL + (i / (days.length - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - v / 10) * (H - padT - padB);

    [0, 5, 10].forEach((v) => {
      node("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: "var(--outline-variant)", "stroke-width": 1, opacity: 0.6 }, svg);
      caption(svg, padL - 6, y(v) + 4, String(v), { anchor: "end", size: 10, weight: 400 });
    });

    [["load", "var(--orange)"], ["control", "var(--teal)"]].forEach(([key, color], k) => {
      let d = "";
      let pen = false;
      days.forEach((row, i) => {
        if (row[key] == null) { pen = false; return; }
        d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(row[key]).toFixed(1)}`;
        pen = true;
      });
      if (!d) return;
      const path = node("path", { d, fill: "none", stroke: color, "stroke-width": 2.75, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      if (animate) Motion.drawPath(path, { duration: 1000, delay: k * 120 });
    });

    [0, 21, days.length - 1].forEach((i, k) => caption(svg, x(i), H - 6, shortDate(days[i].date), {
      size: 10, weight: 400, anchor: k === 0 ? "start" : k === 2 ? "end" : "middle",
    }));
  }

  /* ---------------- mood ---------------- */

  function renderMood() {
    const r = data.mood.recent;
    const b = data.mood.before;
    const total = Object.values(r).reduce((s, v) => s + v, 0);
    const beforeTotal = Object.values(b).reduce((s, v) => s + v, 0);
    $("mood-section").hidden = !total;
    if (!total) return;

    const top = [...QUADS].sort((p, q) => r[q.key] - r[p.key])[0];
    const rough = (r.roughWired + r.roughCalm) / total;
    let text = `Over the last two weeks your days were most often ${top.label.toLowerCase()}, on ${r[top.key]} of ${total}.`;
    let tone = "";
    if (beforeTotal >= 7) {
      const roughBefore = (b.roughWired + b.roughCalm) / beforeTotal;
      if (rough - roughBefore >= 0.15) { text += ` Rough days rose from ${pct(roughBefore)} to ${pct(rough)}.`; tone = "warn"; }
      else if (roughBefore - rough >= 0.15) { text += ` Rough days fell from ${pct(roughBefore)} to ${pct(rough)}.`; tone = "good"; }
    }
    setFinding("mood-finding", text, tone);

    $("mood-grid").innerHTML = QUADS.map((q) => `<div class="quad${q.rough ? " rough" : ""}">
      <div class="quad-label">${q.label}</div>
      <div class="quad-val">${r[q.key]}<span class="stat-unit"> of ${total}</span></div>
      <div class="quad-sub">${beforeTotal ? `${pct(b[q.key] / beforeTotal)} Before` : "No Earlier Weeks"}</div>
    </div>`).join("");
  }

  /* ---------------- burnout signs ---------------- */

  function renderBurnout(animate) {
    const weeks = data.burnout.weeks;
    $("burnout-section").hidden = weeks.length < 2;
    if (weeks.length < 2) return;

    const moves = data.burnout.moves;
    let text = "Your burnout signs have not been tracked long enough to show a direction yet.";
    let tone = "";
    if (moves) {
      // Fragments of a sentence, capitalised when they land at its start.
      const named = [
        { v: moves.exhaustion, phrase: "exhaustion has climbed" },
        { v: moves.accomplishment, phrase: "your sense of accomplishment has fallen" },
        { v: moves.devaluation, phrase: "caring less about your sport has climbed" },
      ].filter((m) => m.v != null).sort((a, b) => b.v - a.v);
      if (named.length && named[0].v >= 0.5) {
        const phrase = named[0].phrase;
        text = `${phrase[0].toUpperCase()}${phrase.slice(1)} the most, by about ${named[0].v.toFixed(1)} of five points over your recent weeks.`;
        tone = "warn";
      } else {
        text = "None of the three signs has moved much over your recent weeks.";
      }
    }
    setFinding("burnout-finding", text, tone);

    const host = $("burnout-chart");
    const H = 180, padL = 26, padR = 12, padT = 12, padB = 24;
    const { svg, W } = frame(host, H);
    const x = (i) => padL + (i / (weeks.length - 1)) * (W - padL - padR);
    const y = (v) => padT + ((5 - v) / 4) * (H - padT - padB);

    [1, 3, 5].forEach((v) => {
      node("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: "var(--outline-variant)", "stroke-width": 1, opacity: 0.6 }, svg);
      caption(svg, padL - 6, y(v) + 4, String(v), { anchor: "end", size: 10, weight: 400 });
    });

    BURNOUT.forEach((sign, k) => {
      const pts = weeks
        .map((w, i) => (w[sign.key] == null ? null : [x(i), y(sign.flip ? 6 - w[sign.key] : w[sign.key])]))
        .filter(Boolean);
      if (pts.length < 2) return;
      const path = node("path", {
        d: pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(""),
        fill: "none", stroke: sign.color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round",
      }, svg);
      pts.forEach((p) => node("circle", { cx: p[0], cy: p[1], r: 3, fill: sign.color }, svg));
      if (animate) Motion.drawPath(path, { duration: 1000, delay: k * 120 });
    });

    caption(svg, x(0), H - 6, shortDate(weeks[0].week), { size: 10, weight: 400, anchor: "start" });
    caption(svg, x(weeks.length - 1), H - 6, shortDate(weeks[weeks.length - 1].week), { size: 10, weight: 400, anchor: "end" });
  }

  /* ---------------- the writing ---------------- */

  /* What a model on this machine read from the entries the athlete allowed, the
     last two weeks against the six before. Shares rather than counts, so a week
     of writing more does not look like a week of everything getting worse. */
  function themeBars(list, map, tone, limit) {
    return list.slice(0, limit).map((t) => {
      const now = t.recentShare || 0;
      const was = t.beforeShare;
      return `<div class="theme-row${tone ? " " + tone : ""}">
        <span class="theme-name">${M.esc(map[t.key] || t.key)}</span>
        <span class="theme-count">${t.recent} of ${data.writing.recent}${was == null ? "" : ` · ${pct(was)} Before`}</span>
        <span class="theme-track"><i style="width:${Math.max(2, Math.round(now * 100))}%"></i>${was == null ? "" : `<b style="left:calc(${Math.round(was * 100)}% - 1px)"></b>`}</span>
      </div>`;
    }).join("");
  }

  function renderWriting(animate) {
    const w = data.writing;
    const reading = data.journalLevel === "words";
    $("writing-section").hidden = false;
    $("writing-card").hidden = !w || !w.recent;
    $("writing-invite").hidden = reading;
    if (!w || !w.recent) {
      if (reading) {
        $("writing-invite").hidden = false;
        $("writing-invite").querySelector(".body").textContent = w && w.read
          ? "Nothing you wrote in the last two weeks has been read yet. New entries are read as you save them."
          : "Reading is on. Once a few entries have been read, what they keep coming back to shows up here.";
      }
      return;
    }

    const labels = data.labels || { about: {}, signs: {}, lifts: {} };
    /* One or two entries make every share look dramatic, so nothing is called a
       rise until there are at least three to compare. */
    const enough = w.recent >= 3;
    const rising = w.about
      .filter((t) => enough && t.recent >= 2 && t.beforeShare != null && t.recentShare - t.beforeShare >= 0.25)
      .sort((a, b) => (b.recentShare - b.beforeShare) - (a.recentShare - a.beforeShare));
    const sign = w.signs.find((t) => t.recent >= 2);
    let text;
    let tone = "";
    if (!enough && !sign) {
      text = `${w.recent} entr${w.recent === 1 ? "y" : "ies"} read in the last two weeks. A few more and this starts to show what you keep coming back to.`;
    } else if (sign) {
      text = `${labels.signs[sign.key]} came up in ${sign.recent} of your ${w.recent} entries over the last two weeks.`;
      tone = "warn";
    } else if (rising.length) {
      const t = rising[0];
      text = `${labels.about[t.key]} came up in ${t.recent} of your ${w.recent} entries over the last two weeks, up from ${pct(t.beforeShare)} of them before.`;
      tone = "warn";
    } else if (w.about.length) {
      const t = w.about[0];
      text = `${labels.about[t.key]} is what you wrote about most over the last two weeks, in ${t.recent} of ${w.recent} entries.`;
    } else {
      text = `${w.recent} entr${w.recent === 1 ? "y" : "ies"} read over the last two weeks.`;
    }
    setFinding("writing-finding", text, tone);

    $("writing-about").innerHTML = w.about.length ? themeBars(w.about, labels.about, "", 6) : `<p class="footnote secondary">Nothing specific yet.</p>`;
    $("writing-signs-wrap").hidden = !w.signs.some((t) => t.recent || t.before);
    $("writing-signs").innerHTML = themeBars(w.signs, labels.signs, "warn", 5);
    $("writing-lifts-wrap").hidden = !w.lifts.some((t) => t.recent || t.before);
    $("writing-lifts").innerHTML = themeBars(w.lifts, labels.lifts, "good", 6);

    const a = w.agreement;
    let agree = "";
    if (a) {
      const gap = a.read - a.rated;
      agree = Math.abs(gap) < 0.25
        ? `On the ${a.days} days you both wrote and set the grid, your writing and your rating told the same story.`
        : `On the ${a.days} days you both wrote and set the grid, your writing read ${gap < 0 ? "heavier" : "lighter"} than you rated the day. Neither one is the right one, but a gap that keeps showing up is worth noticing.`;
    }
    $("writing-agree").textContent = agree;
    $("writing-agree").hidden = !agree;

    writingChart(animate);
  }

  function writingChart(animate) {
    const host = $("writing-chart");
    const weeks = (data.writing && data.writing.weekly) || [];
    if (weeks.length < 2) {
      host.innerHTML = "";
      return;
    }
    const H = 120, padL = 44, padR = 12, padT = 12, padB = 24;
    const { svg, W } = frame(host, H);
    const x = (i) => padL + (i / (weeks.length - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - v) * (H - padT - padB);

    [[0, "Light"], [1, "Heavy"]].forEach(([v, label]) => {
      node("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: "var(--outline-variant)", "stroke-width": 1, opacity: 0.6 }, svg);
      caption(svg, padL - 6, y(v) + 4, label, { anchor: "end", size: 10, weight: 500 });
    });
    const path = node("path", {
      d: weeks.map((wk, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(wk.heaviness).toFixed(1)}`).join(""),
      fill: "none", stroke: "var(--ch-psy)", "stroke-width": 2.75, "stroke-linejoin": "round", "stroke-linecap": "round",
    }, svg);
    weeks.forEach((wk, i) => node("circle", { cx: x(i), cy: y(wk.heaviness), r: 2.5 + Math.min(3, wk.entries * 0.5), fill: "var(--ch-psy)" }, svg));
    if (animate) Motion.drawPath(path, { duration: 1000 });
    caption(svg, x(0), H - 6, shortDate(weeks[0].week), { size: 10, weight: 400, anchor: "start" });
    caption(svg, x(weeks.length - 1), H - 6, shortDate(weeks[weeks.length - 1].week), { size: 10, weight: 400, anchor: "end" });
  }

  function renderConnection() {
    const c = data.connection;
    $("connection-section").hidden = !c;
    if (!c) return;
    const words = ["", "on your own", "mostly on your own", "a little cut off", "somewhere in between", "fairly connected", "connected", "well supported"];
    let text = `The week of ${M.prettyDate(c.week)} you felt ${words[c.now] || "somewhere in between"}, ${c.now} of 7.`;
    let tone = "";
    if (c.usual != null) {
      const diff = c.now - c.usual;
      if (diff <= -1.5) { text += ` That is below your usual ${c.usual.toFixed(1)}.`; tone = "warn"; }
      else if (diff >= 1.5) { text += ` That is above your usual ${c.usual.toFixed(1)}.`; tone = "good"; }
      else text += ` About your usual.`;
    }
    setFinding("connection-finding", text, tone);
  }

  /* ---------------- heavy days and felt sleep ---------------- */

  function renderDrivers() {
    const tags = (data.drivers.tags || []).filter((t) => t.tag !== "Nothing Specific").slice(0, 5);
    $("drivers-section").hidden = !tags.length;
    if (!tags.length) return;

    const top = tags[0];
    setFinding("drivers-finding", top.heavy - top.light >= 0.2
      ? `${top.tag} shows up on ${pct(top.heavy)} of your heaviest days and ${pct(top.light)} of your lightest.`
      : "No single tag stands out on your heaviest days compared with your lightest.", "");

    $("drivers-bars").innerHTML = tags.map((t) => `<div>
      <div class="tag-bar-head"><span>${M.esc(t.tag)}</span><span>${pct(t.heavy)} Heavy · ${pct(t.light)} Light</span></div>
      <div class="tag-track heavy"><span style="width:${Math.round(t.heavy * 100)}%"></span></div>
      <div class="tag-track light" style="margin-top:4px;"><span style="width:${Math.round(t.light * 100)}%"></span></div>
    </div>`).join("");
  }

  function renderFelt() {
    const f = data.sleepFelt;
    $("felt-section").hidden = !f;
    if (!f) return;
    setFinding(
      "felt-finding",
      `On ${f.worse} of ${f.n} nights your sleep felt worse than your wearable measured it, and on ${f.better} it felt better.`,
      f.worse >= 5 && f.worse > f.better * 1.5 ? "warn" : ""
    );
  }

  /* ---------------- flow ---------------- */

  function renderAll(animate) {
    ["numbers-section", "strain-section"].forEach((id) => ($(id).hidden = false));
    renderNumbers();
    renderStrain(animate);
    renderMood();
    renderWriting(animate);
    renderConnection();
    renderBurnout(animate);
    renderDrivers();
    renderFelt();
  }

  async function init() {
    try {
      [data, divergence] = await Promise.all([M.api("/api/life"), M.api("/api/divergence")]);
    } catch {
      $("channel-state").textContent = "Your check-ins could not be loaded just now, so try again shortly.";
      return;
    }
    Channel.render({ key: "psychological", divergence, color: "var(--ch-psy)", animate: true, ids: Channel.IDS });
    $("support-top").hidden = !(divergence.state && divergence.state.support);
    if (!data.hasData) {
      $("empty-section").hidden = false;
      return;
    }
    renderAll(true);

    let lastWidth = $("channel-chart").clientWidth;
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => {
        const w = $("channel-chart").clientWidth;
        if (Math.abs(w - lastWidth) < 2) return;
        lastWidth = w;
        Channel.render({ key: "psychological", divergence, color: "var(--ch-psy)", animate: false, ids: Channel.IDS });
        strainChart(false);
        trendChart(false);
        writingChart(false);
        renderBurnout(false);
      }).observe($("channel-chart"));
    }
  }

  init();
})();
