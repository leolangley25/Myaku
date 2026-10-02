/* Myaku — Body.
 *
 * The Body channel, opened up. Today shows one ring for it; this page shows what
 * is inside that ring, reads each measure the way its own research reads it, and
 * turns the sleep part into something to do tonight.
 *
 * It stays inside the model rather than beside it. The first card is the channel
 * exactly as the divergence engine sees it, split into the four measures that make
 * it up, and the last analysis is the one place a single night shows the Life
 * channel and the Body channel together.
 */

(function () {
  M.boot("today");

  const $ = (id) => document.getElementById(id);

  const GOALS = [420, 450, 480, 510, 540, 570, 600];

  const SOURCE_LABELS = {
    whoop: "Whoop",
    google: "Google Health",
    apple_health: "your Apple Health export",
    csv: "your spreadsheet",
    manual: "your manual entries",
    demo: "the demo season",
  };

  let data = null;
  let divergence = null;
  let metrics = [];
  let tonightBed = null;

  /* ---------------- formatting ---------------- */

  const pad2 = (n) => String(n).padStart(2, "0");
  const dur = (m) => Explain.duration(m);
  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm || "").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const wrap = (m) => ((Math.round(m) % 1440) + 1440) % 1440;
  const hhmm = (m) => `${pad2(Math.floor(wrap(m) / 60))}:${pad2(wrap(m) % 60)}`;
  // Minutes on a line starting at noon, so an evening and the morning after it stay in order.
  const fromNoon = (m) => (wrap(m) < 720 ? wrap(m) + 1440 : wrap(m));

  function clockText(m) {
    const v = wrap(m);
    const h = Math.floor(v / 60);
    return `${h % 12 || 12}:${pad2(v % 60)} ${h < 12 ? "AM" : "PM"}`;
  }

  function span(m) {
    const v = Math.round(m);
    if (v < 60) return `${v} ${v === 1 ? "minute" : "minutes"}`;
    return dur(v);
  }

  const goalHours = (g) => (g % 60 ? dur(g) : `${g / 60} hours`);
  const goalAdjective = (g) => (g % 60 ? dur(g) : `${g / 60}-hour`);
  const shortDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const dayLabel = (d) => {
    const t = new Date(d + "T00:00:00Z");
    return `${t.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${t.getUTCDate()}`;
  };

  /* ---------------- svg ---------------- */

  const { node, caption, frame } = Channel;

  /* ---------------- the channel ---------------- */

  function renderChannel(animate) {
    Channel.render({ key: "autonomic", divergence, color: "var(--ch-auto)", animate, ids: Channel.IDS });
  }

  /* ---------------- last night ---------------- */

  const SIGNALS = [
    {
      key: "sleep_minutes", label: "Sleep", href: "#sleep-section", format: (v) => dur(v),
      opts: { higherIsWorse: false, tolerance: 0.06, formatBase: (v) => dur(v), formatDelta: (v) => `${Math.round(v)} min` },
    },
    {
      key: "sleep_efficiency", label: "Sleep Efficiency", href: "#sleep-section", format: (v) => `${Math.round(v)}<span class="unit">%</span>`,
      opts: { higherIsWorse: false, unit: "%", tolerance: 0.02 },
    },
    {
      key: "hrv_ms", label: "Heart Rate Variability", href: "#hrv-section", format: (v) => `${Math.round(v)}<span class="unit">ms</span>`,
      opts: { higherIsWorse: false, unit: " ms", tolerance: 0.06 },
    },
    {
      key: "rhr_bpm", label: "Resting Heart Rate", href: "#rhr-section", format: (v) => `${Math.round(v)}<span class="unit">bpm</span>`,
      opts: { higherIsWorse: true, unit: " bpm", tolerance: 0.03 },
    },
  ];

  function renderReadings() {
    const latest = metrics[metrics.length - 1];
    const prior = metrics.slice(Math.max(0, metrics.length - 15), metrics.length - 1);
    $("readings").innerHTML = SIGNALS.map((s) => {
      const value = latest[s.key];
      const cmp = Explain.compare(value, prior.map((d) => d[s.key]).filter((v) => v != null), s.opts);
      const note = cmp.sentence || (value == null ? "Not recorded that night." : "Not enough history to compare yet.");
      return `<a class="reading reading-link" href="${s.href}">
        <div class="reading-key">${M.esc(s.label)}</div>
        <div class="reading-val">${value == null ? "—" : s.format(value)}</div>
        <div class="reading-note ${cmp.tone}">${M.esc(note)}</div>
      </a>`;
    }).join("");

    const stale = latest.date < M.shiftKey(M.todayKey(), -2);
    $("readings-note").textContent =
      `From ${SOURCE_LABELS[latest.source] || "your connected source"}, recorded ${M.prettyDate(latest.date)}. ` +
      (stale ? "Nothing newer has arrived, so check your connection in Data Sources." : "Each one is compared with your previous two weeks.") +
      " Sleep efficiency is the share of your time in bed spent asleep, which is different from how the night felt.";
  }

  /* ---------------- sleep ---------------- */

  function renderSleep(animate) {
    const s = data.sleep;
    const goal = data.goal;
    $("sleep-section").hidden = !s;
    if (!s) return;

    $("week-avg").textContent = s.week.average == null ? "—" : dur(s.week.average);
    $("week-avg-sub").textContent = s.usualAverage == null ? `${s.week.nights} Of 7 Nights Recorded` : `Usually ${dur(s.usualAverage)}`;
    $("week-short").textContent = dur(s.week.shortfall);
    $("week-short-sub").textContent = `${s.week.atGoal} Of ${s.week.nights} Nights At Goal`;

    let text;
    let tone = "";
    if (s.week.nights < 3) {
      text = `Only ${s.week.nights} ${s.week.nights === 1 ? "night was" : "nights were"} recorded in the last seven days, so this is a partial picture.`;
    } else if (s.week.average >= goal - 10) {
      text = `You averaged ${dur(s.week.average)} over the last seven nights, which meets your ${goalAdjective(goal)} goal.`;
      tone = "good";
    } else {
      text = `You averaged ${dur(s.week.average)} over the last seven nights, ${span(goal - s.week.average)} a night under your ${goalAdjective(goal)} goal.`;
      tone = "warn";
    }
    $("sleep-finding").className = "finding" + (tone ? " finding-" + tone : "");
    $("sleep-finding").textContent = text;

    scheduleChart($("schedule"), s, goal, animate);

    const options = GOALS.includes(goal) ? GOALS : [...GOALS, goal].sort((a, b) => a - b);
    $("goal").innerHTML = options.map((m) => `<option value="${m}"${m === goal ? " selected" : ""}>${dur(m)}</option>`).join("");
    $("goal-note").textContent = data.goalSaved
      ? "Your goal is saved to your account."
      : "Eight hours is the starting goal, based on the athlete injury research below.";

    renderConsistency(s);
    renderTonight();
  }

  function scheduleChart(host, s, goal, animate) {
    const nights = s.nights;
    const timed = nights.filter((n) => n.start && n.end);
    const atGoal = (n) => n.minutes >= goal - 10;
    const legend = [
      `<span class="legend-item"><span class="legend-swatch zone" style="background:var(--green);opacity:0.85;"></span>At Goal</span>`,
      `<span class="legend-item"><span class="legend-swatch zone" style="background:var(--orange);opacity:0.85;"></span>Under Goal</span>`,
    ];

    if (timed.length >= 3) {
      /* The schedule view: one row a night, drawn from falling asleep to waking,
         so a drifting or scattered bedtime is visible at a glance. */
      const rowH = 22, padT = 30, padB = 28, padL = 54, padR = 58;
      const { svg, W } = frame(host, padT + nights.length * rowH + padB);
      const H = padT + nights.length * rowH + padB;
      const spanOf = (n) => {
        const a = fromNoon(toMinutes(n.start.slice(11)));
        let b = fromNoon(toMinutes(n.end.slice(11)));
        if (b <= a) b += 1440;
        return [a, b];
      };
      const spans = timed.map(spanOf);
      const lo = Math.floor((Math.min(...spans.map((p) => p[0])) - 30) / 60) * 60;
      const hi = Math.ceil((Math.max(...spans.map((p) => p[1])) + 30) / 60) * 60;
      const x = (m) => padL + ((m - lo) / (hi - lo)) * (W - padL - padR);

      const every = W < 460 ? 240 : 120;
      for (let m = Math.ceil(lo / every) * every; m <= hi; m += every) {
        node("line", { x1: x(m), x2: x(m), y1: padT - 6, y2: H - padB + 4, stroke: "var(--outline-variant)", "stroke-width": 1, opacity: 0.55 }, svg);
        caption(svg, x(m), H - 8, clockText(m).replace(":00", ""), { size: 10, weight: 400 });
      }

      if (s.timing) {
        const bed = fromNoon(toMinutes(s.timing.usualBedtime));
        let wake = fromNoon(toMinutes(s.timing.usualWake));
        if (wake <= bed) wake += 1440;
        [[bed, "Usual Bedtime"], [wake, "Usual Wake"]].forEach(([m, label]) => {
          if (m < lo || m > hi) return;
          node("line", { x1: x(m), x2: x(m), y1: padT - 6, y2: H - padB + 4, stroke: "var(--on-surface-variant)", "stroke-width": 1.25, "stroke-dasharray": "4 3" }, svg);
          caption(svg, Math.min(W - padR, Math.max(padL, x(m))), 14, label, { size: 10, weight: 600 });
        });
        legend.push(`<span class="legend-item"><span class="legend-swatch dashed"></span>Your Usual Times</span>`);
      }

      nights.forEach((n, i) => {
        const cy = padT + i * rowH + rowH / 2;
        caption(svg, padL - 8, cy + 4, dayLabel(n.date), { anchor: "end", size: 10, weight: 500 });
        caption(svg, W - padR + 8, cy + 4, dur(n.minutes), { anchor: "start", size: 10, weight: 600, fill: "var(--on-surface)" });
        if (!n.start || !n.end) {
          caption(svg, padL + 6, cy + 4, "No Times Recorded", { anchor: "start", size: 10, weight: 400 });
          return;
        }
        const [a, b] = spanOf(n);
        const bar = node("rect", {
          x: x(a), y: cy - 6, width: Math.max(4, x(b) - x(a)), height: 12, rx: 6,
          fill: atGoal(n) ? "var(--green)" : "var(--orange)", opacity: 0.85,
        }, svg);
        if (animate && !Motion.reduced()) {
          bar.style.transformBox = "fill-box";
          bar.style.transformOrigin = "left center";
          bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
            duration: 620, delay: i * 35, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards",
          });
        }
      });
    } else {
      /* No start and end times from this source, so the nights are drawn as
         lengths against the goal instead. */
      const H = 200, padL = 34, padR = 10, padT = 16, padB = 26;
      const { svg, W } = frame(host, H);
      const yMax = Math.ceil(Math.max(goal + 60, ...nights.map((n) => n.minutes)) / 60) * 60;
      const y = (v) => padT + (1 - v / yMax) * (H - padT - padB);
      const slot = (W - padL - padR) / nights.length;

      for (let v = 0; v <= yMax; v += 120) {
        node("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: "var(--outline-variant)", "stroke-width": 1, opacity: 0.6 }, svg);
        caption(svg, padL - 6, y(v) + 4, `${v / 60}h`, { anchor: "end", size: 10, weight: 400 });
      }
      nights.forEach((n, i) => {
        const bx = padL + i * slot + slot * 0.18;
        const bar = node("rect", {
          x: bx, y: y(n.minutes), width: slot * 0.64, height: y(0) - y(n.minutes), rx: 5,
          fill: atGoal(n) ? "var(--green)" : "var(--orange)", opacity: 0.85,
        }, svg);
        if (animate) Motion.growRect(bar, { delay: i * 35 });
        if (i % 2 === (nights.length - 1) % 2) caption(svg, bx + slot * 0.32, H - 8, dayLabel(n.date), { size: 10, weight: 400 });
      });
      node("line", { x1: padL, x2: W - padR, y1: y(goal), y2: y(goal), stroke: "var(--on-surface)", "stroke-width": 1.25, "stroke-dasharray": "5 4" }, svg);
      caption(svg, W - padR - 2, y(goal) - 6, "Goal", { anchor: "end", size: 10, weight: 700, fill: "var(--on-surface)" });
    }

    $("schedule-legend").innerHTML = legend.join("");
  }

  function renderConsistency(s) {
    const t = s.timing;
    if (!t) {
      $("consistency-tiles").innerHTML = "";
      $("consistency-sentence").textContent =
        "Bedtime and wake time appear once five nights arrive with a start and an end, which Whoop, Google Health, and Apple Health all provide.";
      return;
    }
    const tiles = [
      { key: "Usual Bedtime", val: clockText(toMinutes(t.usualBedtime)), sub: `Across ${t.nights} Nights` },
      { key: "Bedtime Swing", val: `±${t.bedtimeSpread}`, unit: "min", sub: "Typical Night To Night" },
      { key: "Usual Wake", val: clockText(toMinutes(t.usualWake)), sub: `Across ${t.nights} Nights` },
      { key: "Wake Swing", val: `±${t.wakeSpread}`, unit: "min", sub: "Typical Night To Night" },
    ];
    $("consistency-tiles").innerHTML = tiles.map((x) => `<div class="tile">
      <div class="tile-key">${x.key}</div>
      <div class="tile-val words">${x.val}${x.unit ? `<span class="stat-unit"> ${x.unit}</span>` : ""}</div>
      <div class="tile-sub">${x.sub}</div>
    </div>`).join("");

    const swing = t.bedtimeSpread;
    $("consistency-sentence").textContent =
      swing <= 30 ? "Your bedtime is steady, usually within half an hour either way, which is what regular sleepers look like."
        : swing <= 60 ? `Your bedtime moves by about ${swing} minutes either way. Pulling it closer together is often easier than finding extra hours.`
          : `Your bedtime moves by more than an hour either way. In college students, schedules this irregular went with lower grades and a later body clock.`;
  }

  function loadWake() {
    try {
      const v = localStorage.getItem("myaku.wake." + M.todayKey()) || "";
      return /^\d{2}:\d{2}$/.test(v) ? v : null;
    } catch {
      return null;
    }
  }

  function renderTonight() {
    const s = data.sleep;
    if (!$("wake").value) $("wake").value = loadWake() || (s && s.timing ? s.timing.usualWake : "07:00");
    const wake = $("wake").value || "07:00";
    const inBed = s ? s.inBedNeeded : data.goal;
    tonightBed = toMinutes(wake) - inBed;
    $("lights-out").textContent = clockText(tonightBed);

    let text = s && s.efficiency
      ? `Sleeping ${goalHours(data.goal)} at your usual ${Math.round(s.efficiency)}% sleep efficiency takes about ${dur(inBed)} in bed, so aim to be in bed by ${clockText(tonightBed)}.`
      : `Sleeping ${goalHours(data.goal)} takes at least that long in bed, so aim to be in bed by ${clockText(tonightBed)}.`;
    if (s && s.timing) {
      const diff = fromNoon(toMinutes(s.timing.usualBedtime)) - fromNoon(tonightBed);
      if (Math.abs(diff) >= 15) text += ` That is ${span(Math.abs(diff))} ${diff > 0 ? "earlier" : "later"} than your usual bedtime.`;
    }
    $("tonight-sentence").textContent = text;
  }

  /* ---------------- heart measures ---------------- */

  const HEART = {
    hrv: {
      pill: { within: "Normal Range", below: "Below Normal", above: "Above Normal" },
      tone: { within: "good", below: "warn", above: "good" },
      finding: {
        within: "Your seven-day average is inside your normal range, so your body is handling its load the way it usually does.",
        below: "Your seven-day average has dropped below your normal range. Hard training, short sleep, illness, and stress can all do this.",
        above: "Your seven-day average is above your normal range, which most often goes with being well recovered.",
      },
    },
    rhr: {
      pill: { within: "Normal Range", below: "Below Normal", above: "Above Normal" },
      tone: { within: "good", below: "good", above: "warn" },
      finding: {
        within: "Your seven-day average is inside your normal range.",
        below: "Your seven-day average is below your normal range, which usually goes with being well recovered.",
        above: "Your seven-day average has risen above your normal range. Heavy training, short sleep, illness, heat, and stress can all raise it.",
      },
    },
  };

  function renderHeart(kind, unit, animate) {
    const sig = data[kind];
    $(`${kind}-section`).hidden = !sig;
    if (!sig) return;
    const words = HEART[kind];

    $(`${kind}-now`).textContent = sig.current == null ? "—" : Math.round(sig.current);
    $(`${kind}-pill`).innerHTML = sig.status ? M.pill(words.pill[sig.status], words.tone[sig.status]) : "";

    let text;
    if (sig.current == null) text = "Fewer than three readings arrived in the last seven days, so there is no current average yet.";
    else if (!sig.status) text = "Your normal range appears once there are about three weeks of readings.";
    else text = `${words.finding[sig.status]} Your normal range is ${Math.round(sig.normal.low)} to ${Math.round(sig.normal.high)} ${unit}.`;

    /* The normal range here is deliberately more sensitive than the bar the model
       uses to name a pattern, so a measure can leave its range while the channel
       above still reads typical. Said out loud, so the two never look like they
       disagree. */
    const worseSide = kind === "hrv" ? "below" : "above";
    const part = divergence && divergence.channels.autonomic.parts
      ? divergence.channels.autonomic.parts[kind === "hrv" ? "hrv_ms" : "rhr_bpm"]
      : null;
    if (sig.status === worseSide && (part == null || part < divergence.thresholds.notable)) {
      text += " This early drift is not yet large enough to move your Body channel.";
    }
    const tone = sig.status ? words.tone[sig.status] : "";
    $(`${kind}-finding`).className = "finding" + (tone === "warn" ? " finding-warn" : "");
    $(`${kind}-finding`).textContent = text;

    rollingChart($(`${kind}-chart`), sig, animate);
  }

  function rollingChart(host, sig, animate) {
    const days = sig.days;
    const values = days.flatMap((d) => [d.value, d.average]).filter((v) => v != null);
    if (values.length < 3) {
      host.innerHTML = `<p class="empty">A few more mornings are needed to draw this.</p>`;
      return;
    }
    const H = 200, padL = 34, padR = 40, padT = 20, padB = 24;
    const { svg, W } = frame(host, H);
    const band = sig.normal ? [sig.normal.low, sig.normal.high] : [];
    const lo = Math.min(...values, ...band);
    const hi = Math.max(...values, ...band);
    const pad = (hi - lo) * 0.15 || 1;
    const yMin = lo - pad, yMax = hi + pad;
    const x = (i) => padL + (i / (days.length - 1)) * (W - padL - padR);
    const y = (v) => padT + ((yMax - v) / (yMax - yMin)) * (H - padT - padB);

    [lo, (lo + hi) / 2, hi].forEach((v) => {
      node("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: "var(--outline-variant)", "stroke-width": 1, opacity: 0.6 }, svg);
      caption(svg, padL - 6, y(v) + 4, String(Math.round(v)), { anchor: "end", size: 10, weight: 400 });
    });

    if (sig.normal) {
      node("rect", {
        x: padL, y: y(band[1]), width: W - padL - padR, height: Math.max(3, y(band[0]) - y(band[1])),
        rx: 4, fill: "var(--green)", opacity: 0.2,
      }, svg);
      caption(svg, padL + 6, y(band[1]) - 6, "Your Normal Range", { anchor: "start", size: 10, weight: 600 });
    }

    days.forEach((d, i) => {
      if (d.value != null) node("circle", { cx: x(i), cy: y(d.value), r: 2.75, fill: "var(--ch-auto)", opacity: 0.38 }, svg);
    });

    let path = "";
    let pen = false;
    let last = null;
    days.forEach((d, i) => {
      if (d.average == null) { pen = false; return; }
      path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(d.average).toFixed(1)}`;
      pen = true;
      last = [i, d.average];
    });
    if (path) {
      const line = node("path", { d: path, fill: "none", stroke: "var(--ch-auto)", "stroke-width": 2.75, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      if (animate) Motion.drawPath(line, { duration: 1100 });
    }
    if (last) {
      node("circle", { cx: x(last[0]), cy: y(last[1]), r: 5, fill: "var(--ch-auto)", stroke: "var(--surface-container-low)", "stroke-width": 2 }, svg);
      caption(svg, x(last[0]) + 9, y(last[1]) + 4, String(Math.round(last[1])), { anchor: "start", size: 11, weight: 700, fill: "var(--ch-auto)" });
    }

    [0, 21, days.length - 1].forEach((i, k) => caption(svg, x(i), H - 6, shortDate(days[i].date), {
      size: 10, weight: 400, anchor: k === 0 ? "start" : k === 2 ? "end" : "middle",
    }));
  }

  function renderDeviceCaveat() {
    const notes = [];
    if (data.sources.sdnn) notes.push("Some of these readings come from Apple Watch, which reports SDNN rather than the RMSSD that Whoop and Fitbit report, so the two should not be compared with each other.");
    else if (data.sources.hrv.length > 1) notes.push("These readings come from more than one device, which can shift the average without any change in you.");
    $("hrv-caveat").hidden = !notes.length;
    $("hrv-caveat").textContent = notes.join(" ");
  }

  /* ---------------- life against body ---------------- */

  function renderHardDays() {
    const h = data.afterHardDays;
    const section = $("hard-section");
    const rows = [
      { key: "sleepMinutes", label: "Sleep", format: (v) => dur(v), betterUp: true, tolerance: 10, amount: (d) => span(d), subject: "you slept", up: "more", down: "less" },
      { key: "sleepEfficiency", label: "Sleep Efficiency", format: (v) => `${Math.round(v)}%`, betterUp: true, tolerance: 1, amount: (d) => `${d.toFixed(1)} points`, subject: "your sleep efficiency was", up: "higher", down: "lower" },
      { key: "hrv", label: "Heart Rate Variability", format: (v) => `${Math.round(v)} ms`, betterUp: true, tolerance: 2, amount: (d) => `${Math.round(d)} ms`, subject: "your heart rate variability was", up: "higher", down: "lower" },
      { key: "rhr", label: "Resting Heart Rate", format: (v) => `${Math.round(v)} bpm`, betterUp: false, tolerance: 1, amount: (d) => `${Math.round(d)} bpm`, subject: "your resting heart rate was", up: "higher", down: "lower" },
    ].filter((r) => h.measures[r.key].hardN >= 3 && h.measures[r.key].easyN >= 3);

    section.hidden = !data.hasData;
    if (!rows.length) {
      $("hard-body").innerHTML = `<p class="body">Rate your load on a few check-ins, and this will show how your body responds on the nights after hard days compared with easy ones.</p>
        <a class="btn btn-tinted btn-block" href="checkin.html" style="margin-top:14px;">Do A Check-In</a>`;
      return;
    }

    const clauses = [];
    let worse = false;
    rows.forEach((r) => {
      const m = h.measures[r.key];
      const diff = m.hard - m.easy;
      if (Math.abs(diff) < r.tolerance || clauses.length >= 2) return;
      clauses.push(`${r.subject} ${r.amount(Math.abs(diff))} ${diff > 0 ? r.up : r.down}`);
      if (r.betterUp ? diff < 0 : diff > 0) worse = true;
    });
    const finding = clauses.length
      ? `After days you rated as hard, ${clauses.join(", and ")} than after easy days.`
      : "Your body looked about the same on the nights after hard days as after easy ones.";

    const table = rows.map((r) => {
      const m = h.measures[r.key];
      const diff = m.hard - m.easy;
      const bad = Math.abs(diff) >= r.tolerance && (r.betterUp ? diff < 0 : diff > 0);
      const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
      const shown = r.key === "sleepMinutes" ? `${Math.round(Math.abs(diff))} min` : r.key === "sleepEfficiency" ? Math.abs(diff).toFixed(1) : Math.round(Math.abs(diff));
      return `<tr>
        <th scope="row">${r.label}</th>
        <td class="num">${r.format(m.easy)}</td>
        <td class="num">${r.format(m.hard)}</td>
        <td class="num${bad ? " worse" : ""}">${sign}${shown}</td>
      </tr>`;
    }).join("");

    $("hard-body").innerHTML = `
      <div class="spread">
        <div class="card-title" style="margin:0;">Your Nights After Hard Days</div>
        <a class="badge badge-describe" href="method.html#labels">Description</a>
      </div>
      ${Explain.finding(finding, worse ? "warn" : "")}
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th scope="col">Measure</th><th scope="col" class="num">Easy Days</th><th scope="col" class="num">Hard Days</th><th scope="col" class="num">Difference</th></tr></thead>
          <tbody>${table}</tbody>
        </table>
      </div>
      <p class="footnote secondary" style="margin-top:12px;">
        Hard days are check-ins with load rated 7 or higher, and easy days are 4 or lower. Each is paired with the night that followed, across ${h.hardDays} hard and ${h.easyDays} easy days.
      </p>
      <p class="caveat">This describes your nights and does not prove the day caused them. Hard days often bring late finishes and early starts along with them.</p>`;
  }

  /* ---------------- flow ---------------- */

  function render(animate) {
    if (!data.hasData) {
      $("empty-section").hidden = false;
      ["readings-section", "sleep-section", "hrv-section", "rhr-section", "hard-section"].forEach((id) => ($(id).hidden = true));
      return;
    }
    $("empty-section").hidden = true;
    $("readings-section").hidden = false;
    renderReadings();
    renderSleep(animate);
    renderHeart("hrv", "ms", animate);
    renderHeart("rhr", "bpm", animate);
    renderDeviceCaveat();
    renderHardDays();
  }

  async function init() {
    try {
      const [body, div, m] = await Promise.all([M.api("/api/body"), M.api("/api/divergence"), M.api("/api/metrics")]);
      data = body;
      divergence = div;
      metrics = m.days || [];
    } catch {
      $("channel-state").textContent = "Your body data could not be loaded just now, so try again shortly.";
      return;
    }
    renderChannel(true);
    render(true);

    /* Charts are laid out at a real width, so a change of width redraws them
       rather than leaving them stretched. */
    let lastWidth = $("channel-chart").clientWidth;
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => {
        const w = $("channel-chart").clientWidth;
        if (Math.abs(w - lastWidth) < 2) return;
        lastWidth = w;
        renderChannel(false);
        render(false);
      }).observe($("channel-chart"));
    }
  }

  $("goal").addEventListener("change", async () => {
    try {
      await M.api("/api/calibration/sleep-goal", { method: "POST", body: { minutes: Number($("goal").value) } });
      data = await M.api("/api/body");
      render(false);
    } catch { /* the previous goal stays in place */ }
  });

  $("wake").addEventListener("change", () => {
    if (!/^\d{2}:\d{2}$/.test($("wake").value)) return;
    try { localStorage.setItem("myaku.wake." + M.todayKey(), $("wake").value); } catch { /* private mode */ }
    if (data) renderTonight();
  });

  $("use-bedtime").addEventListener("click", async () => {
    const status = $("use-status");
    status.className = "status-line";
    if (tonightBed == null) return;
    try {
      await M.api("/api/calibration/bedtime", { method: "POST", body: { bedtime: hhmm(tonightBed) } });
      status.classList.add("ok");
      status.textContent = "Saved. The caffeine page now uses this bedtime.";
    } catch {
      status.classList.add("error");
      status.textContent = "That could not be saved just now, so try again shortly.";
    }
  });

  init();
})();
