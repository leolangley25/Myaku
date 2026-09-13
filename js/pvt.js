/* Myaku — psychomotor vigilance test, Channel C.
 *
 * Timing notes, because this is what decides whether the channel is real:
 *
 *  - Onset is timestamped inside the requestAnimationFrame callback that makes
 *    the stimulus visible. That callback runs immediately before the frame
 *    paints, so it is accurate to within one refresh interval.
 *  - Responses use pointerdown, avoiding the delay browsers add while waiting
 *    to see whether a tap becomes a double tap.
 *  - rAF timestamps and performance.now() share a time origin, so subtracting
 *    one from the other is valid.
 *  - A hidden page receives no animation frames at all, so a session that
 *    loses focus is discarded rather than scored.
 *
 * Measured on real hardware, screen quantisation contributes a few
 * milliseconds against a trial spread of sixty or more. The limit here is
 * human variability, not the phone, which is why a single session is never
 * reported on its own and the model reads this channel weekly.
 */

(function () {
  M.boot("log");

  const ISI_MIN = 1000, ISI_MAX = 4000;
  const LAPSE_MS = 355;
  const FULL_MS = 180000, SHORT_MS = 60000;
  const SLEEP_EFFECT_MS = 25;
  const SESSIONS_PER_WEEK = 3, BASELINE_SESSIONS = 12;

  const surface = document.getElementById("task-surface");
  const stimulus = document.getElementById("task-stimulus");
  const hint = document.getElementById("task-hint");
  const feedback = document.getElementById("task-feedback");
  const bar = document.getElementById("task-progress-bar");
  const intro = document.getElementById("intro");
  const results = document.getElementById("results");

  let env = null;
  let s = null;

  const median = (n) => {
    if (!n.length) return 0;
    const a = [...n].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const sd = (n) => {
    if (n.length < 2) return 0;
    const m = n.reduce((a, b) => a + b, 0) / n.length;
    return Math.sqrt(n.reduce((a, b) => a + (b - m) ** 2, 0) / (n.length - 1));
  };

  /* ---------------- environment ---------------- */

  function probeFrames(count) {
    return new Promise((resolve, reject) => {
      const deltas = [];
      let last = null;
      // A hidden page never serves a frame, so this has to be able to give up.
      const bail = setTimeout(() => reject(new Error("no frames")), 4000);

      function step(ts) {
        if (last != null) deltas.push(ts - last);
        last = ts;
        if (deltas.length < count) {
          requestAnimationFrame(step);
        } else {
          clearTimeout(bail);
          resolve(deltas);
        }
      }

      requestAnimationFrame(step);
    });
  }

  function clockResolution() {
    let smallest = Infinity;
    for (let i = 0; i < 40; i++) {
      const a = performance.now();
      let b = performance.now(), guard = 0;
      while (b === a && guard++ < 100000) b = performance.now();
      const d = b - a;
      if (d > 0 && d < smallest) smallest = d;
    }
    return smallest === Infinity ? 0 : smallest;
  }

  async function measureEnvironment() {
    let deltas;
    try {
      deltas = await probeFrames(80);
    } catch {
      document.getElementById("env").innerHTML =
        `<div class="row"><span class="row-main"><span class="row-title">Timing Unavailable</span>
         <span class="row-sub">This page has to be visible on screen before the timing can be measured.</span></span></div>`;
      document.getElementById("start-btn").disabled = true;
      document.getElementById("short-btn").disabled = true;
      return;
    }

    const frameInterval = median(deltas);
    const sorted = [...deltas].sort((a, b) => a - b);
    const jitter = sd(sorted.slice(3, sorted.length - 3));
    // Onset lands on a frame boundary, so it carries uniform quantisation
    // noise across one interval, whose spread is width over root twelve.
    const quantSD = frameInterval / Math.sqrt(12);

    env = { frameInterval, refresh: 1000 / frameInterval, jitter, quantSD, clock: clockResolution() };

    document.getElementById("env").innerHTML = [
      ["Refresh Rate", `${env.refresh.toFixed(0)} Hz`],
      ["Frame Interval", `${env.frameInterval.toFixed(2)} ms`],
      ["Frame Jitter", `${env.jitter.toFixed(2)} ms`],
      ["Onset Quantisation", `${env.quantSD.toFixed(2)} ms`],
      ["Clock Resolution", `${env.clock.toFixed(3)} ms`],
    ]
      .map(([k, v]) => `<div class="row"><span class="row-main"><span class="row-title">${k}</span></span><span class="row-value mono">${v}</span></div>`)
      .join("");
  }

  /* ---------------- task ---------------- */

  function start(duration) {
    s = { duration, startedAt: performance.now(), trials: [], falseStarts: 0, onset: null, armed: false, timer: null, running: true };
    intro.hidden = true;
    results.hidden = true;
    surface.hidden = false;
    feedback.textContent = "";
    document.body.style.overflow = "hidden";
    surface.addEventListener("pointerdown", onTap);
    schedule();
    tick();
  }

  function schedule() {
    stimulus.style.visibility = "hidden";
    hint.style.visibility = "visible";
    s.armed = false;
    s.onset = null;
    s.timer = setTimeout(() => {
      if (!s.running) return;
      requestAnimationFrame((ts) => {
        stimulus.style.visibility = "visible";
        hint.style.visibility = "hidden";
        s.onset = ts;
        s.armed = true;
      });
    }, ISI_MIN + Math.random() * (ISI_MAX - ISI_MIN));
  }

  function onTap(e) {
    e.preventDefault();
    const now = performance.now();
    if (!s || !s.running) return;

    if (!s.armed) {
      s.falseStarts++;
      clearTimeout(s.timer);
      feedback.style.color = "var(--red)";
      feedback.textContent = "Too Early";
      setTimeout(() => (feedback.textContent = ""), 600);
      schedule();
      return;
    }

    const rt = now - s.onset;
    s.trials.push(rt);
    s.armed = false;
    stimulus.textContent = String(Math.round(rt)).padStart(3, "0");

    setTimeout(() => {
      if (!s.running) return;
      if (performance.now() - s.startedAt >= s.duration) finish();
      else schedule();
    }, 450);
  }

  function tick() {
    if (!s || !s.running) return;
    bar.style.width = Math.min(100, ((performance.now() - s.startedAt) / s.duration) * 100) + "%";
    requestAnimationFrame(tick);
  }

  function teardown() {
    s.running = false;
    clearTimeout(s.timer);
    surface.removeEventListener("pointerdown", onTap);
    surface.hidden = true;
    document.body.style.overflow = "";
  }

  function finish() {
    teardown();
    const m = score(s);
    render(m);
    persist(m);
  }

  function abort() {
    if (!s || !s.running) return;
    teardown();
    intro.hidden = false;
    results.hidden = true;
    document.getElementById("env").insertAdjacentHTML(
      "afterbegin",
      `<div class="row"><span class="row-main"><span class="row-title" style="color:var(--red)">Session Discarded</span>
       <span class="row-sub">The screen lost focus during the test, so those timings were thrown away.</span></span></div>`
    );
  }

  document.addEventListener("visibilitychange", () => { if (document.hidden) abort(); });

  /* ---------------- scoring ---------------- */

  function score(sess) {
    // Anything under 100 ms is an anticipation rather than a reaction.
    const valid = sess.trials.filter((rt) => rt >= 100);
    const sorted = [...valid].sort((a, b) => a - b);
    const tenth = Math.max(1, Math.round(valid.length * 0.1));
    const mean = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
    const recips = valid.map((rt) => 1000 / rt);
    const spread = sd(valid);

    return {
      n: valid.length,
      anticipations: sess.trials.length - valid.length,
      falseStarts: sess.falseStarts,
      mean,
      median: median(valid),
      meanReciprocal: recips.length ? recips.reduce((a, b) => a + b, 0) / recips.length : 0,
      sd: spread,
      sem: valid.length ? spread / Math.sqrt(valid.length) : 0,
      lapses: valid.filter((rt) => rt >= LAPSE_MS).length,
      fastest10: tenth ? sorted.slice(0, tenth).reduce((a, b) => a + b, 0) / tenth : 0,
      slowest10: tenth ? sorted.slice(-tenth).reduce((a, b) => a + b, 0) / tenth : 0,
      trials: valid,
      duration: sess.duration,
    };
  }

  /* ---------------- results ---------------- */

  function render(m) {
    results.hidden = false;
    document.getElementById("res-mean").textContent = m.n ? Math.round(m.mean) : "—";
    document.getElementById("res-lapses").textContent = m.lapses;
    document.getElementById("res-pill").innerHTML = M.pill(
      m.lapses <= 1 ? "Few Lapses" : m.lapses <= 4 ? "Some Lapses" : "Many Lapses",
      m.lapses <= 1 ? "good" : m.lapses <= 4 ? "warn" : "bad"
    );

    document.getElementById("res-detail").innerHTML = [
      ["Valid Trials", m.n],
      ["Median", `${Math.round(m.median)} ms`],
      ["Mean Reciprocal", `${m.meanReciprocal.toFixed(2)} per second`],
      ["Fastest Tenth", `${Math.round(m.fastest10)} ms`],
      ["Slowest Tenth", `${Math.round(m.slowest10)} ms`],
      ["Trial Spread", `${Math.round(m.sd)} ms`],
      ["False Starts", m.falseStarts],
      ["Anticipations", m.anticipations],
    ]
      .map(([k, v]) => `<div class="row"><span class="row-main"><span class="row-title">${k}</span></span><span class="row-value mono">${v}</span></div>`)
      .join("");

    drawTrials(m);
    drawPower(m);
  }

  function drawTrials(m) {
    const el = document.getElementById("res-chart");
    if (m.n < 3) { el.innerHTML = `<p class="empty">Too few trials to plot.</p>`; return; }

    const NS = "http://www.w3.org/2000/svg";
    const n = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const W = 600, H = 160, padL = 8, padR = 8, padT = 10, padB = 18;
    const max = Math.max(LAPSE_MS + 80, ...m.trials);
    const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, m.trials.length - 1);
    const y = (v) => H - padB - (v / max) * (H - padT - padB);

    const svg = n("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: "100%", preserveAspectRatio: "none" });
    svg.style.display = "block";
    svg.appendChild(n("line", { x1: padL, x2: W - padR, y1: y(LAPSE_MS), y2: y(LAPSE_MS), stroke: "var(--red)", "stroke-width": 1, "stroke-dasharray": "4 4" }));
    const d = m.trials.map((rt, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(rt).toFixed(1)).join(" ");
    svg.appendChild(n("path", { d, fill: "none", stroke: "var(--ch-cog)", "stroke-width": 2, "stroke-linejoin": "round" }));
    el.innerHTML = "";
    el.appendChild(svg);
  }

  function drawPower(m) {
    const el = document.getElementById("res-power");
    if (m.n < 5) { el.innerHTML = `<p class="empty">Run a full session to estimate this.</p>`; return; }

    // A single session against another is the wrong comparison, because the
    // model pools a week and scores it against a rolling baseline.
    const single = 2.8 * m.sem * Math.SQRT2;
    const weekSem = m.sem / Math.sqrt(SESSIONS_PER_WEEK);
    const baseSem = m.sem / Math.sqrt(BASELINE_SESSIONS);
    const weekly = 2.8 * Math.sqrt(weekSem ** 2 + baseSem ** 2);
    const platformShare = env && m.sd ? (env.quantSD / m.sd) * 100 : null;
    const ok = weekly <= SLEEP_EFFECT_MS;

    el.innerHTML =
      M.pill(ok ? "Adequate Resolution" : "Needs More Trials", ok ? "good" : "warn") +
      [
        ["Session Standard Error", `${m.sem.toFixed(1)} ms`],
        ["One Session Detects", `${single.toFixed(0)} ms`],
        ["A Week Pooled Detects", `${weekly.toFixed(0)} ms`],
        ["Effect Being Chased", `${SLEEP_EFFECT_MS} ms`],
        platformShare != null ? ["Screen Share Of Spread", `${platformShare.toFixed(1)} percent`] : null,
      ]
        .filter(Boolean)
        .map(([k, v]) => `<div class="row" style="padding-left:0;padding-right:0;"><span class="row-main"><span class="row-title">${k}</span></span><span class="row-value mono">${v}</span></div>`)
        .join("") +
      `<p class="footnote secondary" style="margin-top:10px;">${
        ok
          ? "Pooled across a week this resolves a shift smaller than sleep restriction produces, even though one session alone does not."
          : "Even pooled across a week this cannot yet resolve the shift being chased, so more trials or more sessions are needed."
      }</p>`;
  }

  async function persist(m) {
    const status = document.getElementById("save-status");
    try {
      const r = await M.api("/api/pvt", {
        method: "POST",
        body: {
          durationMs: m.duration, nTrials: m.n, meanRt: m.mean, medianRt: m.median,
          meanReciprocal: m.meanReciprocal, sdRt: m.sd, semRt: m.sem,
          lapses: m.lapses, falseStarts: m.falseStarts,
        },
      });
      status.textContent =
        r.caffeineMinutesPrior != null
          ? `Saved, with caffeine logged ${r.caffeineMinutesPrior} minutes before this session.`
          : "Saved to your history.";
    } catch (err) {
      status.textContent = err.message === "unauthenticated" ? "Not saved, because you are signed out." : err.message;
    }
  }

  /* How many sessions this week, and the hour this athlete usually tests at.
     The channel is only as good as its consistency, and the most useful thing to
     say before a session is "same hour as last time". */
  async function renderCoverage() {
    try {
      const r = await M.api("/api/pvt");
      const shown = Math.min(r.thisWeek, r.target);
      document.getElementById("coverage-section").hidden = false;
      document.getElementById("coverage-count").textContent = `${r.thisWeek} of ${r.target}`;
      const meter = document.getElementById("coverage-meter");
      meter.firstElementChild.style.width = `${Math.round((shown / r.target) * 100)}%`;
      meter.setAttribute("aria-valuenow", String(shown));

      const hours = r.sessions
        .map((sess) => new Date(M.parseStamp(sess.started_at)).getHours())
        .filter((h) => Number.isFinite(h));
      const usual = hours.length >= 3 ? [...hours].sort((a, b) => a - b)[Math.floor(hours.length / 2)] : null;
      const hourText = usual == null ? null : new Date(2000, 0, 1, usual).toLocaleTimeString([], { hour: "numeric" });

      document.getElementById("coverage-note").textContent = r.todayCount
        ? "You have already tested today. A second session on the same day adds very little."
        : hourText
          ? `You usually test around ${hourText}, so aim for about the same hour today.`
          : "Pick an hour you can repeat, since alertness follows a daily rhythm.";
    } catch {
      /* the api layer handles a signed-out session */
    }
  }

  document.getElementById("start-btn").addEventListener("click", () => start(FULL_MS));
  document.getElementById("short-btn").addEventListener("click", () => start(SHORT_MS));
  document.getElementById("again-btn").addEventListener("click", () => {
    results.hidden = true;
    intro.hidden = false;
    renderCoverage();
  });

  measureEnvironment();
  renderCoverage();
})();
