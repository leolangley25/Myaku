/* Myaku — Brain.
 *
 * The Brain channel, opened up. A week of reaction tests becomes one number in the
 * model; this page shows the tests behind it and checks what decides whether that
 * number means anything: enough tests, a steady hour, the same phone, and no
 * caffeine just beforehand. Then it sets the channel against the other two, the
 * nights before from the Body channel and felt sharpness from the Life channel.
 */

(function () {
  M.boot("today");

  const $ = (id) => document.getElementById(id);
  const { node, caption, frame, shortDate, table } = Channel;
  const DAY = 24 * 60 * 60 * 1000;

  let data = null;
  let divergence = null;

  const ms = (v) => (v == null ? "—" : `${Math.round(v)} ms`);
  const one = (v) => (v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1));
  const dur = (m) => Explain.duration(m);

  function clockText(hhmm) {
    const [h, m] = String(hhmm).split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }

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

  /* ---------------- the week ---------------- */

  function renderWeek() {
    const w = data.week;
    const u = data.usual;

    $("week-tiles").innerHTML = [
      { key: "Tests", val: `${w.sessions}<span class="stat-unit"> of ${data.target}</span>`, sub: "Last Seven Days" },
      { key: "Average", val: w.meanRt == null ? "—" : `${Math.round(w.meanRt)}<span class="stat-unit"> ms</span>`, sub: u ? `Usually ${Math.round(u.meanRt)} ms` : "No Usual Yet" },
      { key: "Lapses Per Test", val: one(w.lapses), sub: u ? `Usually ${one(u.lapses)}` : "No Usual Yet" },
    ].map(tile).join("");

    const meter = $("week-meter");
    meter.firstElementChild.style.width = `${Math.min(100, (w.sessions / data.target) * 100)}%`;
    meter.setAttribute("aria-valuenow", String(Math.min(w.sessions, data.target)));

    let text;
    let tone = "";
    const range = u ? `${Math.round(u.low)} to ${Math.round(u.high)} ms` : "";
    if (!w.sessions) text = "No reaction tests in the last seven days, so the Brain channel has nothing new to compare.";
    else if (!u) text = `You averaged ${ms(w.meanRt)} this week. Your usual range appears once there are a few weeks of earlier tests.`;
    else if (w.meanRt > u.high) { text = `You averaged ${ms(w.meanRt)} this week, slower than your usual range of ${range}.`; tone = "warn"; }
    else if (w.meanRt < u.low) { text = `You averaged ${ms(w.meanRt)} this week, faster than your usual range of ${range}.`; tone = "good"; }
    else text = `You averaged ${ms(w.meanRt)} this week, inside your usual range of ${range}.`;
    if (w.sessions && w.sessions < data.target) text += ` With fewer than ${data.target} tests, one unusual test can move the whole week.`;
    setFinding("week-finding", text, tone);

    $("week-precision").textContent = w.precision
      ? `Pooled together, this week's tests pin your average down to within about ${Math.round(w.precision * 2)} ms either way.`
      : "";
  }

  /* ---------------- every test ---------------- */

  function sessionsChart(animate) {
    const host = $("sessions-chart");
    const pts = data.sessions;
    if (pts.length < 2) {
      host.innerHTML = `<p class="empty">This chart appears after your second test.</p>`;
      return;
    }
    const H = 220, padL = 38, padR = 12, padT = 24, padB = 24;
    const { svg, W } = frame(host, H);
    const end = Date.parse(data.today + "T00:00:00Z");
    const start = end - 59 * DAY;
    const u = data.usual;
    const values = pts.map((p) => p.meanRt).concat(u ? [u.low, u.high] : []);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.15 || 10;
    const yMin = lo - pad, yMax = hi + pad;
    const xOf = (t) => padL + ((t - start) / (end - start)) * (W - padL - padR);
    const x = (d) => xOf(Date.parse(d + "T00:00:00Z"));
    const y = (v) => padT + ((yMax - v) / (yMax - yMin)) * (H - padT - padB);

    const weekX = xOf(end - 6 * DAY);
    node("rect", { x: weekX, y: padT, width: W - padR - weekX, height: H - padT - padB, fill: "var(--on-surface)", opacity: 0.05 }, svg);
    caption(svg, W - padR - 2, padT - 10, "Last Seven Days", { anchor: "end", size: 10, weight: 600 });
    caption(svg, padL - 6, padT - 10, "ms", { anchor: "end", size: 10, weight: 400 });

    [lo, (lo + hi) / 2, hi].forEach((v) => {
      node("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: "var(--outline-variant)", "stroke-width": 1, opacity: 0.6 }, svg);
      caption(svg, padL - 6, y(v) + 4, String(Math.round(v)), { anchor: "end", size: 10, weight: 400 });
    });

    if (u) {
      node("rect", {
        x: padL, y: y(u.high), width: W - padL - padR, height: Math.max(3, y(u.low) - y(u.high)),
        rx: 4, fill: "var(--green)", opacity: 0.2,
      }, svg);
      caption(svg, padL + 6, y(u.low) + 14, "Your Usual Range", { anchor: "start", size: 10, weight: 600 });
    }

    pts.forEach((p, i) => {
      const t = Date.parse(p.date + "T00:00:00Z");
      if (t < start) return;
      const attrs = p.caffeine
        ? { cx: x(p.date), cy: y(p.meanRt), r: 4.5, fill: "var(--surface-container-low)", stroke: "var(--ch-cog)", "stroke-width": 2 }
        : { cx: x(p.date), cy: y(p.meanRt), r: 4.5, fill: "var(--ch-cog)", opacity: 0.9 };
      const dot = node("circle", attrs, svg);
      if (animate) Motion.fadeIn(dot, { delay: Math.min(i * 15, 600), duration: 360 });
    });

    [[start, "start"], [start + 30 * DAY, "middle"], [end, "end"]].forEach(([t, anchor]) =>
      caption(svg, xOf(t), H - 6, shortDate(new Date(t).toISOString()), { size: 10, weight: 400, anchor })
    );
  }

  /* ---------------- consistency ---------------- */

  function renderTiming() {
    const t = data.timing;
    if (!t) {
      $("timing-tiles").innerHTML = "";
      $("timing-sentence").textContent = "Your usual test time appears after three tests.";
      return;
    }
    $("timing-tiles").innerHTML = [
      { key: "Usual Time", val: clockText(t.usualTime), sub: "Middle Of Your Tests", words: true },
      { key: "Within An Hour", val: `${t.withinHour}<span class="stat-unit"> of ${t.of}</span>`, sub: "Recent Tests" },
    ].map(tile).join("");
    $("timing-sentence").textContent = t.withinHour / t.of >= 0.8
      ? "Nearly all your recent tests are within an hour of your usual time, which keeps your body clock out of the comparison."
      : "Your test times move around. Alertness rises and falls through the day, so a moving hour can look like a change in you.";
  }

  function renderCaffeine() {
    const c = data.caffeine;
    const enough = c.withN >= 3 && c.withoutN >= 3;
    let text;
    let tone = "";
    if (!c.withN) {
      text = "None of your tests were taken within three hours of logged caffeine, so none of them are being flattered by it.";
    } else if (!enough) {
      text = `${c.withN} of your tests came within three hours of logged caffeine, which is too few to compare yet.`;
    } else {
      const diff = c.withRt - c.withoutRt;
      text = Math.abs(diff) < 5
        ? "Tests soon after caffeine look about the same as the rest, so it is not flattering your results much."
        : `Tests within three hours of caffeine averaged ${Math.abs(Math.round(diff))} ms ${diff < 0 ? "faster" : "slower"} than the rest.`;
    }
    if (c.recentWith) {
      text += ` ${c.recentWith} of this week's tests came soon after caffeine, so treat this week's average with some care.`;
      tone = "warn";
    }
    setFinding("caffeine-finding", text, tone);
    $("caffeine-table").innerHTML = enough
      ? table(["Measure", "After Caffeine", "Without"], [
        ["Reaction Time", ms(c.withRt), ms(c.withoutRt)],
        ["Lapses Per Test", one(c.withLapses), one(c.withoutLapses)],
        ["Tests", c.withN, c.withoutN],
      ])
      : "";
  }

  /* ---------------- the other two channels ---------------- */

  function renderSleep() {
    const s = data.sleep;
    $("sleep-section").hidden = !s;
    if (!s) return;
    const diff = s.short.rt - s.long.rt;
    const text = Math.abs(diff) < 5
      ? "Your reaction time was about the same after your shortest nights as after your longest ones."
      : `After your shortest nights, around ${dur(s.short.sleep)}, you tested ${Math.abs(Math.round(diff))} ms ${diff > 0 ? "slower" : "faster"} than after your longest, around ${dur(s.long.sleep)}.`;
    setFinding("sleep-finding", text, diff >= 5 ? "warn" : "");
    $("sleep-table").innerHTML = table(["Measure", "Shortest Nights", "Longest Nights"], [
      ["Sleep", dur(s.short.sleep), dur(s.long.sleep)],
      ["Reaction Time", ms(s.short.rt), ms(s.long.rt)],
      ["Lapses Per Test", one(s.short.lapses), one(s.long.lapses)],
      ["Tests", s.groupSize, s.groupSize],
    ]);
    $("sleep-note").textContent = `From your ${s.n} tests with a night of sleep recorded before them, split into your shortest third and your longest third.`;
  }

  function renderFelt() {
    const f = data.felt;
    $("felt-section").hidden = !f;
    if (!f) return;
    let text;
    let tone = "";
    if (f.foggyN >= 3 && f.sharpN >= 3) {
      const diff = f.foggyRt - f.sharpRt;
      if (Math.abs(diff) < 5) {
        text = "On days you felt foggy you tested about the same as on days you felt sharp, so your sense of sharpness is not tracking the test.";
        tone = "warn";
      } else if (diff > 0) {
        text = `On days you felt foggy you tested ${Math.round(diff)} ms slower than on days you felt sharp, so your sense of it is tracking the test.`;
      } else {
        text = `On days you felt foggy you actually tested ${Math.round(-diff)} ms faster than on days you felt sharp.`;
        tone = "warn";
      }
      $("felt-table").innerHTML = table(["Measure", "Felt Foggy", "Felt Sharp"], [
        ["Reaction Time", ms(f.foggyRt), ms(f.sharpRt)],
        ["Tests", f.foggyN, f.sharpN],
      ]);
    } else {
      text = "Rate your focus on more check-ins, including the days that feel foggy, and this will show whether your sense of sharpness matches the test.";
      $("felt-table").innerHTML = "";
    }
    setFinding("felt-finding", text, tone);
  }

  function renderDevices() {
    const d = data.devices;
    $("device-section").hidden = !d.list.length;
    if (!d.list.length) return;
    $("device-rows").innerHTML = d.list.map((x) => M.row({ title: x.label, value: `${x.count} ${x.count === 1 ? "Test" : "Tests"}` })).join("");
    $("device-caveat").hidden = !d.mixedRecently;
    $("device-caveat").textContent = d.mixedRecently
      ? "Your recent tests came from more than one device. Phones register taps at different speeds, so weeks from the same phone compare best."
      : "";
  }

  /* ---------------- flow ---------------- */

  function renderAll(animate) {
    ["week-section", "sessions-section", "timing-section", "caffeine-section"].forEach((id) => ($(id).hidden = false));
    renderWeek();
    sessionsChart(animate);
    renderTiming();
    renderCaffeine();
    renderSleep();
    renderFelt();
    renderDevices();
  }

  async function init() {
    try {
      [data, divergence] = await Promise.all([M.api("/api/brain"), M.api("/api/divergence")]);
    } catch {
      $("channel-state").textContent = "Your reaction tests could not be loaded just now, so try again shortly.";
      return;
    }
    Channel.render({ key: "cognitive", divergence, color: "var(--ch-cog)", animate: true, ids: Channel.IDS });
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
        Channel.render({ key: "cognitive", divergence, color: "var(--ch-cog)", animate: false, ids: Channel.IDS });
        sessionsChart(false);
      }).observe($("channel-chart"));
    }
  }

  init();
})();
