/* Myaku — Trends.
 *
 * The channel pages answer "what is each channel doing now". This page answers the
 * question a season raises instead: how did I get here. It opens with the named
 * pattern for every week, recomputed as the model would have read it at the time,
 * then shows the channels and the gaps between them across those weeks, and ends
 * with the analyses that only make sense over a whole season.
 *
 * The labelling rule still governs everything: a description and a test are marked
 * differently and treated differently, and exactly one claim in the app was fixed
 * before any data existed.
 */

(function () {
  M.boot("trends");

  const $ = (id) => document.getElementById(id);
  const { node, caption, frame, shortDate, table } = Channel;
  const esc = M.esc;

  let season = null;   // week-by-week recomputation
  let stats = null;    // season analytics
  let div = null;      // the current reading

  const TONE_COLOR = { good: "var(--success)", info: "var(--tertiary)", warn: "var(--warning)", bad: "var(--error)" };
  const GAPS = [
    { key: "cognitiveVsAutonomic", color: "var(--ch-cog)" },
    { key: "psychologicalVsAutonomic", color: "var(--ch-psy)" },
    { key: "cognitiveVsPsychological", color: "var(--warning)" },
  ];
  const DAY = 24 * 60 * 60 * 1000;

  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const toneClass = (tone) => (tone === "info" ? "" : tone || "");

  /* ---------------- markup ---------------- */

  function section(title, inner, id) {
    return `<section class="section"${id ? ` id="${id}"` : ""}>
      <div class="section-header">${esc(title)}</div>
      ${inner}
    </section>`;
  }

  const card = (inner) => `<div class="card">${inner}</div>`;

  function badge(kind) {
    const [cls, label] = {
      test: ["badge-test", "Pre-Registered Test"],
      explore: ["badge-explore", "Exploratory"],
      describe: ["badge-describe", "Description"],
    }[kind];
    // A link to what the label means, since a badge nobody can decode is decoration.
    return `<a class="badge ${cls}" href="method.html#labels">${label}</a>`;
  }

  const chartBox = (id, label) => `<div class="body-chart" id="${id}" role="img" aria-label="${esc(label)}"></div>`;

  const legend = (items) => `<div class="legend">${items
    .map((i) => `<span class="legend-item"><span class="legend-swatch" style="background:${i.color}"></span>${esc(i.label)}</span>`)
    .join("")}</div>`;

  const tile = (key, val, sub, words) => `<div class="tile">
    <div class="tile-key">${esc(key)}</div>
    <div class="tile-val${words ? " words" : ""}">${esc(val)}</div>
    <div class="tile-sub">${esc(sub)}</div>
  </div>`;

  const caveat = (text) => `<p class="caveat">${esc(text)}</p>`;
  const emptyChart = (host, text) => { host.innerHTML = `<p class="empty">${esc(text)}</p>`; };

  /* ---------------- charts ---------------- */

  /* Every chart is laid out at its container's real width, like the channel pages,
     so labels keep their size on a phone instead of being stretched with the art. */

  function lineChart(host, { labels, series, min, max, band, bandLabel, bandColor = "var(--green)", zero = false, height = 200, format, padL = 36, animate = true }) {
    if (!labels || labels.length < 2) return emptyChart(host, "Two weeks are needed before a line can be drawn.");
    const H = height, padR = 12, padT = 16, padB = 24;
    const { svg, W } = frame(host, H);
    const fmt = format || ((v) => String(Math.round(v * 10) / 10));
    const x = (i) => padL + (i / (labels.length - 1)) * (W - padL - padR);
    const y = (v) => padT + ((max - v) / (max - min)) * (H - padT - padB);

    if (band) {
      node("rect", { x: padL, y: y(band[1]), width: W - padL - padR, height: Math.max(2, y(band[0]) - y(band[1])), rx: 6, fill: bandColor, opacity: 0.13 }, svg);
      if (bandLabel) caption(svg, padL + 8, y(band[1]) + 14, bandLabel, { anchor: "start", size: 10, weight: 600 });
    }
    [min, (min + max) / 2, max].forEach((v) => {
      node("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: "var(--outline-variant)", "stroke-width": 1, opacity: 0.7 }, svg);
      caption(svg, padL - 6, y(v) + 4, fmt(v), { anchor: "end", size: 10, weight: 400 });
    });
    if (zero && min < 0 && max > 0) {
      node("line", { x1: padL, x2: W - padR, y1: y(0), y2: y(0), stroke: "var(--on-surface)", "stroke-width": 1, opacity: 0.3 }, svg);
    }

    series.forEach((s, si) => {
      let d = "";
      let pen = false;
      let last = null;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
        last = [i, v];
      });
      if (!d) return;
      const path = node("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width || 2.75, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      s.values.forEach((v, i) => {
        if (v != null && (!last || i !== last[0])) node("circle", { cx: x(i), cy: y(v), r: 2.5, fill: s.color, opacity: 0.8 }, svg);
      });
      if (last) node("circle", { cx: x(last[0]), cy: y(last[1]), r: 5, fill: s.color, stroke: "var(--surface-container-low)", "stroke-width": 2 }, svg);
      if (animate) Motion.drawPath(path, { duration: 1000, delay: si * 110 });
    });

    const n = labels.length;
    [...new Set([0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1])].forEach((i, k, all) => {
      caption(svg, x(i), H - 6, labels[i], { size: 10, weight: 400, anchor: k === 0 ? "start" : k === all.length - 1 ? "end" : "middle" });
    });
  }

  function barChart(host, { items, color, highlight, format, height = 170, animate = true }) {
    const usable = items.filter((i) => i.value != null);
    if (usable.length < 2) return emptyChart(host, "Not enough days logged to compare yet.");
    const H = height, padL = 6, padR = 6, padT = 22, padB = 24;
    const { svg, W } = frame(host, H);
    const max = Math.max(...usable.map((i) => i.value)) || 1;
    const slot = (W - padL - padR) / items.length;

    items.forEach((it, i) => {
      const cx = padL + slot * i + slot / 2;
      caption(svg, cx, H - 6, it.label, { size: 10, weight: it.label === highlight ? 700 : 400, fill: it.label === highlight ? "var(--on-surface)" : undefined });
      if (it.value == null) return;
      const h = (it.value / max) * (H - padT - padB);
      const rect = node("rect", {
        x: cx - slot * 0.3, y: H - padB - h, width: slot * 0.6, height: Math.max(2, h), rx: 6,
        fill: color, opacity: it.label === highlight ? 1 : 0.4,
      }, svg);
      if (animate) Motion.growRect(rect, { delay: i * 45 });
      caption(svg, cx, H - padB - h - 6, format(it.value), { size: 10, weight: 600, fill: "var(--on-surface)" });
    });
  }

  function divergingChart(host, { items, colorFor, format, centreLabel, height = 180, animate = true }) {
    const usable = items.filter((i) => i.value != null);
    if (usable.length < 2) return emptyChart(host, "Not enough data to compare yet.");
    const H = height, padL = 6, padR = 6, padT = 18, padB = 26;
    const { svg, W } = frame(host, H);
    const span = Math.max(...usable.map((i) => Math.abs(i.value))) * 1.3 || 1;
    const mid = padT + (H - padT - padB) / 2;
    const half = (H - padT - padB) / 2;
    const slot = (W - padL - padR) / items.length;

    node("line", { x1: padL, x2: W - padR, y1: mid, y2: mid, stroke: "var(--on-surface)", "stroke-width": 1, opacity: 0.35 }, svg);
    if (centreLabel) caption(svg, W - padR, mid - 6, centreLabel, { anchor: "end", size: 9.5, weight: 500 });

    items.forEach((it, i) => {
      const cx = padL + slot * i + slot / 2;
      caption(svg, cx, H - 7, it.label, { size: 10, weight: 400 });
      if (it.value == null) return;
      const h = (Math.abs(it.value) / span) * half;
      const up = it.value > 0;
      const rect = node("rect", {
        x: cx - slot * 0.28, y: up ? mid - h : mid, width: slot * 0.56, height: Math.max(2, h), rx: 5,
        fill: colorFor(it),
      }, svg);
      if (animate) Motion.growRect(rect, { delay: i * 50, from: up ? "bottom" : "top" });
      caption(svg, cx, up ? mid - h - 6 : mid + h + 13, format(it.value), { size: 10, weight: 600, fill: "var(--on-surface)" });
    });
  }

  function correlogramChart(host, { series, color, height = 160, animate = true }) {
    const usable = series.filter((s) => s.r != null);
    if (usable.length < 5) return emptyChart(host, "Not enough overlapping days to scan for a lead yet.");
    const H = height, padL = 10, padR = 10, padT = 12, padB = 30;
    const { svg, W } = frame(host, H);
    const mid = padT + (H - padT - padB) / 2;
    const half = (H - padT - padB) / 2;
    const slot = (W - padL - padR) / series.length;
    const best = usable.reduce((m, s) => (Math.abs(s.r) > Math.abs(m.r) ? s : m));

    node("line", { x1: padL, x2: W - padR, y1: mid, y2: mid, stroke: "var(--on-surface)", "stroke-width": 1, opacity: 0.3 }, svg);
    series.forEach((s, i) => {
      const cx = padL + slot * i + slot / 2;
      if (s.lag % 7 === 0 || s.lag === best.lag) caption(svg, cx, H - 14, String(s.lag), { size: 9.5, weight: s.lag === best.lag ? 700 : 400 });
      if (s.r == null) return;
      const h = Math.abs(s.r) * half;
      const up = s.r > 0;
      const rect = node("rect", {
        x: cx - slot * 0.32, y: up ? mid - h : mid, width: slot * 0.64, height: Math.max(1.5, h), rx: 3,
        fill: color, opacity: s.lag === best.lag ? 1 : 0.35,
      }, svg);
      if (animate) Motion.growRect(rect, { delay: i * 25, duration: 500, from: up ? "bottom" : "top" });
    });
    caption(svg, W / 2, H - 1, "Days Of Delay", { size: 9.5, weight: 500 });
  }

  function scatterChart(host, { points, color, xLabel, yLabel, height = 210, animate = true }) {
    if (!points || points.length < 6) return emptyChart(host, "Not enough paired days to plot this yet.");
    const H = height, padL = 40, padR = 12, padT = 22, padB = 34;
    const { svg, W } = frame(host, H);
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const xMin = Math.min(0, ...xs), xMax = Math.max(...xs) || 1;
    const yLo = Math.min(...ys), yHi = Math.max(...ys);
    const pad = (yHi - yLo) * 0.12 || 1;
    const yMin = yLo - pad, yMax = yHi + pad;
    const x = (v) => padL + ((v - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
    const y = (v) => padT + ((yMax - v) / (yMax - yMin)) * (H - padT - padB);

    [yLo, (yLo + yHi) / 2, yHi].forEach((v) => {
      node("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: "var(--outline-variant)", "stroke-width": 1, opacity: 0.7 }, svg);
      caption(svg, padL - 6, y(v) + 4, String(Math.round(v)), { anchor: "end", size: 10, weight: 400 });
    });
    [xMin, (xMin + xMax) / 2, xMax].forEach((v) => caption(svg, x(v), H - padB + 15, String(Math.round(v)), { size: 10, weight: 400 }));
    caption(svg, padL + (W - padL - padR) / 2, H - 3, xLabel, { size: 10, weight: 600 });
    caption(svg, 4, 12, yLabel, { anchor: "start", size: 10, weight: 600 });

    points.forEach((p, i) => {
      const dot = node("circle", { cx: x(p.x), cy: y(p.y), r: 4, fill: color, opacity: 0.8, stroke: "var(--surface-container-low)", "stroke-width": 1.5 }, svg);
      if (animate) Motion.fadeIn(dot, { delay: Math.min(i * 14, 700), duration: 340 });
    });
  }

  /* ---------------- the season ---------------- */

  function renderSeason() {
    const s = season;
    const weeks = s.weeks;
    const cur = s.current;

    let text;
    if (!cur) text = "Myaku names a pattern once a channel has three earlier weeks to compare against, so your season is still being learned.";
    else if (s.previous) text = `${cur.name} has held for ${plural(s.heldWeeks, "week")}, after ${plural(s.previous.weeks, "week")} of ${s.previous.name}.`;
    else text = `${cur.name} has held for ${plural(s.heldWeeks, "week")}, which is every week Myaku has been able to name so far.`;

    const cells = weeks.map((w, i) => `<button type="button" class="season-cell${w.state ? "" : " learning"}" data-i="${i}"
        ${w.state ? `style="--tone:${TONE_COLOR[w.state.tone] || "var(--outline)"}"` : ""}
        aria-pressed="${i === weeks.length - 1}"
        aria-label="Week of ${esc(shortDate(w.start))}, ${esc(w.state ? w.state.name : "Still Learning")}"></button>`).join("");

    const patterns = s.patterns.map((p) => `<div class="pattern-item">
        <span class="tone-dot" style="background:${TONE_COLOR[p.tone] || "var(--outline)"}"></span>
        <span>${esc(p.name)}</span>
        <span class="pattern-weeks">${plural(p.weeks, "Week")}</span>
      </div>`).join("");
    // The hatched cells get a legend entry too, so "not yet known" is never a mystery.
    const learning = weeks.filter((w) => !w.state).length;
    const learningItem = learning
      ? `<div class="pattern-item"><span class="tone-dot learning"></span><span>Still Learning</span><span class="pattern-weeks">${plural(learning, "Week")}</span></div>`
      : "";

    return `<section class="section" style="margin-top:14px;">
      <div class="card card-hero">
        <div class="card-title">Your Season</div>
        <div class="tiles">
          ${tile("Weeks Shown", String(weeks.length), "Up To Twelve")}
          ${tile("Held For", cur ? String(s.heldWeeks) : "—", cur ? (s.heldWeeks === 1 ? "Week" : "Weeks") : "No Pattern Yet")}
        </div>
        ${Explain.finding(esc(text), cur ? toneClass(cur.tone) : "")}
        <div class="season-strip" role="group" aria-label="Pattern By Week">${cells}</div>
        <div class="season-axis"><span>${esc(shortDate(weeks[0].start))}</span><span>This Week</span></div>
        <div class="season-readout" id="season-readout" aria-live="polite"></div>
        ${patterns || learningItem ? `<div class="pattern-list">${patterns}${learningItem}</div>` : ""}
      </div>
    </section>`;
  }

  function readout(i) {
    const w = season.weeks[i];
    /* A channel with a named pattern behind it is not still learning when a week
       comes back empty: nothing was logged that week, which is a different thing
       to say and a different thing to do about. */
    const word = (key) =>
      w.z[key] == null && w.state ? "Nothing Logged" : Explain.band(w.z[key], season.thresholds).short;
    const z = (key) => `<span style="color:${M.CHANNELS[key].color}">${M.CHANNELS[key].label} ${word(key)}</span>`;
    $("season-readout").innerHTML = `<strong>${esc(shortDate(w.start))} to ${esc(shortDate(w.end))} · ${esc(w.state ? w.state.name : "Still Learning")}</strong>
      <span>${z("autonomic")}  ·  ${z("cognitive")}  ·  ${z("psychological")}</span>`;
    document.querySelectorAll(".season-cell").forEach((cell) => cell.setAttribute("aria-pressed", String(Number(cell.dataset.i) === i)));
  }

  /* ---------------- channels and gaps ---------------- */

  function renderScale() {
    const ranked = Object.entries(M.CHANNELS)
      .map(([key, meta]) => ({ key, label: meta.label, z: div.channels[key].z, points: div.channels[key].points }))
      .filter((c) => c.z != null)
      .sort((a, b) => b.z - a.z);
    const top = ranked[0];
    const text = top
      ? `${top.label} is furthest from your normal this week, and it is ${Explain.band(top.z, div.thresholds).word.toLowerCase()}. ${Explain.rankSentence(top.points)}`
      : "Lines appear once a channel has three earlier weeks to compare against.";

    return section("One Shared Scale", card(
      badge("describe") +
      Explain.finding(esc(text), top ? toneClass(Explain.band(top.z, div.thresholds).tone) : "") +
      chartBox("chart-channels", "Each Channel By Week") +
      legend(Object.values(M.CHANNELS).map((m) => ({ label: m.label, color: m.color }))) +
      Explain.howToRead(`
        <p>The middle line is <strong>your own normal</strong>, worked out from your own history. Above it means that channel is worse than it usually is for you, and below means better. The band is the range where nothing unusual is happening at your sensitivity.</p>
        <dl>
          <dt>Body</dt><dd>${esc(Explain.channelMeaning("autonomic").measures)}</dd>
          <dt>Brain</dt><dd>${esc(Explain.channelMeaning("cognitive").measures)}</dd>
          <dt>Life</dt><dd>${esc(Explain.channelMeaning("psychological").measures)}</dd>
        </dl>
        <p>Three lines moving together is a week where everything agrees. One line pulling away from the others is the kind of week this app exists to notice.</p>`)
    ));
  }

  function renderGaps() {
    const weeks = season.weeks;
    const last = weeks[weeks.length - 1];
    const thr = season.thresholds.gap;

    let biggest = null;
    GAPS.forEach((g) => {
      const v = last.gaps[g.key];
      if (v != null && (!biggest || Math.abs(v) > Math.abs(biggest.v))) biggest = { ...g, v };
    });

    let text;
    let tone = "";
    if (!biggest) {
      text = "Gaps appear once two channels both have a reading for the same week.";
    } else if (Math.abs(biggest.v) < thr) {
      text = "All three channels agree with each other this week, within the range the model treats as noise.";
      tone = "good";
    } else {
      let run = 0;
      for (let i = weeks.length - 1; i >= 0; i--) {
        const v = weeks[i].gaps[biggest.key];
        if (v == null || Math.abs(v) < thr || Math.sign(v) !== Math.sign(biggest.v)) break;
        run++;
      }
      const title = Explain.gapMeaning(biggest.key).title;
      text = `${title} is the widest gap, and it has held for ${plural(run, "week")}. ${Explain.gapSentence(biggest.key, biggest.v, thr)}`;
      tone = "warn";
    }

    const rows = ["cognitiveVsAutonomic", "psychologicalVsAutonomic", "cognitiveVsPsychological", "sleepFeltVsMeasured"]
      .map((key) => {
        const value = div.gaps[key];
        const agrees = value != null && Math.abs(value) < thr;
        return `<div class="row" style="align-items:flex-start;">
          <span class="row-main">
            <span class="row-title">${esc(Explain.gapMeaning(key).title)}</span>
            <span class="row-sub">${esc(Explain.gapSentence(key, value, thr))}</span>
          </span>
          ${value == null ? "" : M.pill(agrees ? "Agree" : "Apart", agrees ? "good" : "warn")}
        </div>`;
      })
      .join("");

    return section("Where They Pull Apart",
      card(
        badge("describe") +
        Explain.finding(esc(text), tone) +
        chartBox("chart-gaps", "Channel Gaps By Week") +
        legend(GAPS.map((g) => ({ label: Explain.gapMeaning(g.key).title, color: g.color }))) +
        Explain.howToRead(`
          <p>Each line is one channel minus another, week by week. On the middle line the two agree. Above it, the first channel named is worse than the second; below it, the second is worse.</p>
          <p>A gap carries the noise of both channels at once, so the band is wider than the one on the chart above, and a gap only counts once it leaves the band.</p>`)
      ) + `<div class="group" style="margin-top:12px;">${rows}</div>`,
      "gaps-section");
  }

  /* ---------------- rhythm and load ---------------- */

  function renderRhythm() {
    const dow = stats.dayOfWeek;
    const text = dow.heaviest && dow.lightest
      ? `${dow.heaviest.day} is reliably your heaviest day, and ${dow.lightest.day} your lightest.`
      : "Not enough days logged to describe a weekly rhythm.";
    return section("Weekly Rhythm", card(
      badge("describe") +
      Explain.finding(esc(text)) +
      `<div class="card-title" style="margin:18px 0 0;">Load By Weekday</div>` +
      chartBox("chart-dow-load", "Load By Weekday") +
      `<div class="card-title" style="margin:22px 0 0;">Reaction Time By Weekday</div>` +
      chartBox("chart-dow-rt", "Reaction Time By Weekday") +
      Explain.howToRead(`
        <p>The first chart is how heavy you said each weekday was, averaged across your season. The second is your measured reaction time on those weekdays, drawn as milliseconds either side of your own average, so bars above the line are slower days.</p>
        <p>A day that is both heavy and slow is a different problem from a day that is only heavy, and only the second chart can tell them apart. Reaction time only appears on days you took the test.</p>`)
    ));
  }

  function renderLoad() {
    const lr = stats.loadRatio;
    const vol = stats.volatility;

    let text = "Four weeks of check-ins are needed before this comparison means anything.";
    let tone = "";
    if (lr.ready && lr.series.length) {
      const r = lr.series[lr.series.length - 1].ratio;
      const [lo, hi] = lr.sweetSpot;
      if (r > hi) { text = `Your last seven days felt about ${Math.round((r - 1) * 100)}% heavier than your last four weeks.`; tone = "warn"; }
      else if (r < lo) text = `Your last seven days felt about ${Math.round((1 - r) * 100)}% lighter than your last four weeks.`;
      else text = "Your last seven days felt about as heavy as your last four weeks.";
    }

    const spreads = vol.map((v) => v.spread).filter((s) => s != null);
    const lastSpread = spreads.length ? spreads[spreads.length - 1] : null;
    const typicalSpread = spreads.length > 2 ? Explain.median(spreads.slice(0, -1)) : null;
    const evenness = lastSpread == null || typicalSpread == null
      ? "A few full weeks are needed before evenness can be compared."
      : lastSpread > typicalSpread * 1.3
        ? "Your latest week also swung more between heavy and light days than usual."
        : lastSpread < typicalSpread * 0.7
          ? "Your latest week was also more even day to day than usual."
          : "Your latest week was about as even day to day as your others.";

    return section("Recent Against Normal", card(
      badge("describe") +
      Explain.finding(esc(text), tone) +
      chartBox("chart-ratio", "Recent Load Against Normal") +
      `<div class="tiles" style="margin-top:16px;">
        ${tile("Day To Day Swing", lastSpread == null ? "—" : lastSpread.toFixed(1), "Latest Week")}
        ${tile("Usual Swing", typicalSpread == null ? "—" : typicalSpread.toFixed(1), "Earlier Weeks")}
      </div>
      <p class="footnote secondary" style="margin-top:10px;">${esc(evenness)}</p>` +
      Explain.howToRead(`
        <p>The line compares the last seven days of reported load against the last twenty-eight. At one, this week matches your recent normal. Above one you are carrying more than you have been used to, and below one less.</p>
        <p>Swing is how much your daily load varied inside a week, rather than how high it was. A steady six every day and three nines with four twos average the same and feel nothing alike.</p>`) +
      caveat("The shaded 0.8 to 1.3 range comes from physical workload research that has since been strongly challenged, and it was never tested on how heavy days feel. Read this as a description of your weeks, not a warning.")
    ));
  }

  function renderPhases() {
    const phases = stats.phases;
    if (!phases.length) {
      return section("Busy Periods", card(`<p class="body secondary">Mark a stretch like exams or a road trip in More, and it will be compared against the rest of your season here.</p>
        <a class="btn btn-tinted btn-block" href="more.html" style="margin-top:14px;">Add A Busy Period</a>`));
    }

    const MEASURES = [
      { label: "Load", key: "load", worseUp: true, format: (v) => v.toFixed(1) },
      { label: "Recovery", key: "recovery", worseUp: false, format: (v) => v.toFixed(1) },
      { label: "Reaction Time", key: "reaction", worseUp: true, format: (v) => `${Math.round(v)} ms` },
      { label: "Sleep", key: "sleep", worseUp: false, format: (v) => Explain.duration(v) },
    ];

    return section("Busy Periods", phases.map((p) => {
      const scored = MEASURES.map((m) => {
        const { inside, outside } = p[m.key];
        if (inside == null || !outside) return { ...m, inside, outside, pct: null };
        const pct = ((inside - outside) / outside) * 100;
        return { ...m, inside, outside, pct, worseBy: m.worseUp ? pct : -pct };
      });
      const ranked = scored.filter((s) => s.pct != null).sort((a, b) => b.worseBy - a.worseBy);
      const worst = ranked[0];
      const text = !worst
        ? "Not enough data inside this period to compare it."
        : worst.worseBy < 5
          ? "Nothing moved much inside this period compared with the rest of your season."
          : `Your ${worst.label.toLowerCase()} was about ${Math.abs(worst.pct).toFixed(0)}% ${worst.pct > 0 ? "higher" : "lower"} during this period than across the rest of your season.`;

      const rows = scored.map((s) => {
        const bad = s.pct != null && s.worseBy >= 5;
        return `<tr>
          <th scope="row">${s.label}</th>
          <td class="num">${s.inside == null ? "—" : s.format(s.inside)}</td>
          <td class="num">${s.outside == null ? "—" : s.format(s.outside)}</td>
          <td class="num${bad ? " worse" : ""}">${s.pct == null ? "—" : `${s.pct > 0 ? "+" : ""}${s.pct.toFixed(0)}%`}</td>
        </tr>`;
      }).join("");

      return card(`
        <div class="spread">
          <div class="card-title" style="margin:0;">${esc(p.label)}</div>
          ${badge("describe")}
        </div>
        <p class="footnote secondary" style="margin-top:6px;">${esc(M.prettyDate(p.start))} to ${esc(M.prettyDate(p.end))}</p>
        ${Explain.finding(esc(text), worst && worst.worseBy >= 5 ? "warn" : "")}
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th scope="col">Measure</th><th scope="col" class="num">Inside</th><th scope="col" class="num">Rest Of Season</th><th scope="col" class="num">Difference</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`);
    }).join("") + `<p class="footnote secondary" style="margin-top:10px;padding:0 4px;">You marked these periods yourself before any comparison was run, which makes them the closest thing here to a natural experiment.</p>`);
  }

  /* ---------------- searches and the one test ---------------- */

  function lagSentence(p) {
    if (!p.best) return "Not enough overlapping days yet.";
    const r = Math.abs(p.best.r).toFixed(2);
    if (p.best.lag === 0) return `Strongest on the same day, at ${r}, across ${p.best.n} days.`;
    const days = plural(Math.abs(p.best.lag), "day");
    return p.best.lag > 0
      ? `Strongest when the first measure moved ${days} earlier, at ${r}, across ${p.best.n} days.`
      : `Strongest when the second measure moved ${days} earlier, at ${r}, across ${p.best.n} days.`;
  }

  function renderLeadLag() {
    const ll = stats.leadLag;
    return section("Which Moves First", card(
      badge("explore") +
      Explain.finding("A search for whether one measure tends to move before another.") +
      `<p class="subhead secondary" style="margin-top:6px;">This is a fishing expedition, and it is labelled as one.</p>` +
      ll.pairs.map((p) => `
        <div class="card-title" style="margin:22px 0 4px;">${esc(p.label)}</div>
        <p class="footnote secondary">${esc(lagSentence(p))}</p>
        ${chartBox(`chart-lag-${p.key}`, p.label)}`).join("") +
      Explain.howToRead(`
        <p>Each bar is one possible delay between the two measures, from seven days before to seven days after. Taller bars mean the two lined up more closely at that delay, above the line when they rose together and below it when one rose as the other fell.</p>
        <p>The solid bar is whichever delay happened to line up best. Fifteen delays are tried, and pure noise would still produce a tallest bar every time, so treat it as somewhere to look rather than as a result.</p>`) +
      caveat("No correction for multiple comparisons is applied, because nothing here is being reported as a finding.")
    ));
  }

  function renderCaffeineTest() {
    const cs = stats.caffeineSleep;
    return section("The Caffeine Test", card(
      badge("test") +
      Explain.finding(esc(Explain.correlationSentence(cs.rho, cs.n, { xLabel: "caffeine after two in the afternoon", yLabel: "sleep quality that night" }))) +
      `<p class="subhead secondary" style="margin-top:6px;">${esc(Explain.chanceSentence(cs.p))}</p>
      <div class="tiles" style="margin-top:16px;">
        ${tile("Nights Compared", String(cs.n), "Late Caffeine, Next Night")}
        ${tile("Pattern Strength", cs.rho == null ? "—" : `${cs.rho > 0 ? "+" : ""}${cs.rho.toFixed(2)}`, "Zero Means No Pattern")}
      </div>` +
      chartBox("chart-caffeine", "Late Caffeine Against Sleep") +
      Explain.howToRead(`
        <p>One dot per night. Left to right is how much caffeine you logged after two in the afternoon, and bottom to top is how well you slept that night by your wearable. If late caffeine hurt your sleep, the cloud would tilt down to the right.</p>
        <p>This is the only claim in the app written down before the data existed. A question fixed in advance can come out wrong, which is exactly what makes a result from it worth something.</p>`) +
      caveat(`${cs.confound} A correlation here cannot separate the caffeine from the week that caused it.`) +
      `<a class="btn btn-tinted btn-block" href="caffeine.html" style="margin-top:14px;">Open Caffeine</a>`
    ));
  }

  /* ---------------- drawing ---------------- */

  function drawAll(animate) {
    const weeks = season.weeks;
    const labels = weeks.map((w) => shortDate(w.start));

    const zs = weeks.flatMap((w) => Object.values(w.z)).filter((v) => v != null);
    lineChart($("chart-channels"), {
      labels,
      min: Math.max(-3, Math.min(-2, ...zs.map((v) => v - 0.3))),
      max: Math.min(3, Math.max(2.5, ...zs.map((v) => v + 0.3))),
      band: [-season.thresholds.notable, season.thresholds.notable], bandLabel: "Typical For You",
      zero: true, animate,
      // Words on the axis instead of signed numbers with no unit.
      format: (v) => (v >= season.thresholds.notable ? "Worse" : v <= -season.thresholds.notable ? "Better" : "Typical"),
      padL: 52,
      series: Object.entries(M.CHANNELS).map(([key, meta]) => ({ color: meta.color, values: weeks.map((w) => w.z[key]) })),
    });

    const gs = weeks.flatMap((w) => Object.values(w.gaps)).filter((v) => v != null);
    const reach = Math.max(season.thresholds.gap + 0.6, ...gs.map((v) => Math.abs(v) + 0.3));
    lineChart($("chart-gaps"), {
      labels, min: -Math.min(6, reach), max: Math.min(6, reach),
      band: [-season.thresholds.gap, season.thresholds.gap], bandLabel: "Within Noise", bandColor: "var(--outline)",
      zero: true, animate,
      format: (v) => (Math.abs(v) >= season.thresholds.gap ? "Apart" : "Agree"),
      padL: 48,
      series: GAPS.map((g) => ({ color: g.color, values: weeks.map((w) => w.gaps[g.key]) })),
    });

    const dow = stats.dayOfWeek;
    barChart($("chart-dow-load"), {
      items: dow.days.map((d) => ({ label: d.short, value: d.load })),
      color: "var(--ch-psy)", highlight: dow.heaviest ? dow.heaviest.short : null,
      format: (v) => v.toFixed(1), animate,
    });
    const rts = dow.days.map((d) => d.rt).filter((v) => v != null);
    const rtMean = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : null;
    divergingChart($("chart-dow-rt"), {
      items: dow.days.map((d) => ({ label: d.short, value: d.rt == null ? null : d.rt - rtMean })),
      colorFor: (it) => (it.value > 0 ? "var(--error)" : "var(--success)"),
      format: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}`,
      centreLabel: rtMean ? `Your Average ${Math.round(rtMean)} ms` : "",
      animate,
    });

    const lr = stats.loadRatio;
    if (lr.ready && lr.series.length >= 2) {
      const ratios = lr.series.map((s) => s.ratio);
      lineChart($("chart-ratio"), {
        labels: lr.series.map((s) => shortDate(s.date)),
        min: Math.min(0.5, ...ratios.map((v) => v - 0.1)), max: Math.max(1.6, ...ratios.map((v) => v + 0.1)),
        band: lr.sweetSpot, bandLabel: "Commonly Cited Range", bandColor: "var(--outline)",
        format: (v) => v.toFixed(1), animate,
        series: [{ color: "var(--ch-psy)", values: ratios }],
      });
    } else {
      emptyChart($("chart-ratio"), "Four weeks of check-ins are needed before this ratio means anything.");
    }

    stats.leadLag.pairs.forEach((p) => {
      const host = $(`chart-lag-${p.key}`);
      if (host) correlogramChart(host, { series: p.series, color: "var(--ch-cog)", animate });
    });

    const cs = stats.caffeineSleep;
    scatterChart($("chart-caffeine"), {
      points: cs.points.map((p) => ({ x: p.mg, y: p.sleep })),
      color: "var(--warning)", xLabel: "Late Caffeine, mg", yLabel: "Sleep Efficiency %", animate,
    });
  }

  /* ---------------- shell ---------------- */

  function render() {
    const view = $("view");
    if (!season.hasData) {
      $("sub").textContent = "Your season starts with your first check-in, test, or night of body data.";
      view.innerHTML = section("Nothing Yet", card(`<p class="body secondary">Log anything at all and this page will start drawing your season, one week at a time.</p>
        <a class="btn btn-filled btn-block" href="log.html" style="margin-top:14px;">Log Something</a>`));
      return;
    }

    $("sub").textContent = `${plural(season.weeks.length, "week")} of your season, each read the way Myaku read it at the time.`;
    view.innerHTML = [
      renderSeason(),
      renderScale(),
      renderGaps(),
      renderRhythm(),
      renderLoad(),
      renderPhases(),
      renderLeadLag(),
      renderCaffeineTest(),
    ].join("");

    readout(season.weeks.length - 1);
    view.querySelectorAll(".season-cell").forEach((cell) => {
      const i = Number(cell.dataset.i);
      cell.addEventListener("click", () => readout(i));
      cell.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") readout(i); });
    });

    drawAll(true);
    Motion.reveal(view);

    let lastWidth = $("chart-channels").clientWidth;
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => {
        const w = $("chart-channels").clientWidth;
        if (Math.abs(w - lastWidth) < 2) return;
        lastWidth = w;
        drawAll(false);
      }).observe($("chart-channels"));
    }
  }

  Promise.all([M.api("/api/trends"), M.api("/api/analytics"), M.api("/api/divergence")])
    .then(([t, s, d]) => {
      season = t;
      stats = s;
      div = d;
      render();
    })
    .catch(() => {
      $("sub").textContent = "Your season could not be loaded just now.";
      $("view").innerHTML = `<section class="section"><p class="empty">Nothing could be loaded. Check your connection and reload.</p></section>`;
    });
})();
