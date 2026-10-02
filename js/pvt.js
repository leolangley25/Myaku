/* Myaku — the reaction test, Brain channel.
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
 * Screen quantisation contributes a few milliseconds against a trial spread of
 * sixty or more. The larger unknown is the phone's own touch and display delay,
 * which differs between models, so every test records the device that ran it.
 *
 * The results screen says one thing first: whether this test sits inside the
 * athlete's usual range. The timing arithmetic is kept, folded away, because it
 * explains why a single test is never judged on its own.
 */

(function () {
  M.boot("log");

  const $ = (id) => document.getElementById(id);
  const { node, caption, frame } = Channel;

  const ISI_MIN = 1000, ISI_MAX = 4000;
  const LAPSE_MS = 355;
  const FULL_MS = 180000, SHORT_MS = 60000;
  const SESSIONS_PER_WEEK = 3, BASELINE_SESSIONS = 12;
  const CAFFEINE_WINDOW_MINUTES = 180;
  const REFRESH_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];

  const surface = $("task-surface");
  const stimulus = $("task-stimulus");
  const hint = $("task-hint");
  const feedback = $("task-feedback");
  const bar = $("task-progress-bar");
  const intro = $("intro");
  const results = $("results");

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

  const detailRow = ([k, v]) =>
    `<div class="row"><span class="row-main"><span class="row-title">${k}</span></span><span class="row-value mono">${v}</span></div>`;

  function setFinding(text, tone) {
    const el = $("res-finding");
    el.classList.remove("finding-good", "finding-warn", "finding-bad");
    if (tone) el.classList.add("finding-" + tone);
    el.textContent = text;
  }

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

  /* A short description of the device, so tests from different phones can be told
     apart later. Nothing here identifies the athlete. */
  function deviceLabel() {
    const ua = navigator.userAgent;
    const ipad = /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const kind = /iPhone/.test(ua) ? "iPhone"
      : ipad ? "iPad"
        : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android Phone" : "Android Tablet")
          : /CrOS/.test(ua) ? "Chromebook"
            : /Mac/.test(ua) ? "Mac"
              : /Windows/.test(ua) ? "Windows"
                : /Linux/.test(ua) ? "Linux" : "Device";
    const input = window.matchMedia && window.matchMedia("(pointer: coarse)").matches ? "Touch" : "Mouse";
    const hz = env
      ? REFRESH_RATES.reduce((best, r) => (Math.abs(r - env.refresh) < Math.abs(best - env.refresh) ? r : best), 60)
      : null;
    return [kind, input, hz ? `${hz} Hz` : null].filter(Boolean).join(" · ");
  }

  async function measureEnvironment() {
    let deltas;
    try {
      deltas = await probeFrames(80);
    } catch {
      $("env").innerHTML = detailRow(["Timing Unavailable", "—"]);
      $("discard-status").className = "status-line error";
      $("discard-status").textContent = "This page has to be visible on screen before the test can start.";
      $("start-btn").disabled = true;
      $("short-btn").disabled = true;
      return;
    }

    const frameInterval = median(deltas);
    const sorted = [...deltas].sort((a, b) => a - b);
    const jitter = sd(sorted.slice(3, sorted.length - 3));
    // Onset lands on a frame boundary, so it carries uniform quantisation
    // noise across one interval, whose spread is width over root twelve.
    const quantSD = frameInterval / Math.sqrt(12);

    env = { frameInterval, refresh: 1000 / frameInterval, jitter, quantSD, clock: clockResolution() };

    $("env").innerHTML = [
      ["This Device", deviceLabel()],
      ["Refresh Rate", `${env.refresh.toFixed(0)} Hz`],
      ["Frame Interval", `${env.frameInterval.toFixed(2)} ms`],
      ["Frame Jitter", `${env.jitter.toFixed(2)} ms`],
      ["Onset Rounding", `${env.quantSD.toFixed(2)} ms`],
      ["Clock Resolution", `${env.clock.toFixed(3)} ms`],
    ].map(detailRow).join("");
  }

  /* ---------------- task ---------------- */

  function start(duration) {
    s = { duration, startedAt: performance.now(), trials: [], falseStarts: 0, onset: null, armed: false, timer: null, running: true };
    intro.hidden = true;
    results.hidden = true;
    surface.hidden = false;
    feedback.textContent = "";
    $("discard-status").textContent = "";
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
    $("discard-status").className = "status-line error";
    $("discard-status").textContent = "That test was discarded, because the screen lost focus partway through.";
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
    window.scrollTo(0, 0);
    $("res-mean").textContent = m.n ? Math.round(m.mean) : "—";
    $("res-lapses").textContent = m.lapses;
    setFinding(m.n >= 5 ? "Saving and comparing with your usual range." : "Too few responses were recorded to score this test.", "");
    $("res-context").textContent = "";
    $("res-caffeine").hidden = true;
    $("save-status").textContent = "";

    $("res-detail").innerHTML = [
      ["Responses Counted", m.n],
      ["Middle Response", `${Math.round(m.median)} ms`],
      ["Response Speed", `${m.meanReciprocal.toFixed(2)} per second`],
      ["Fastest Tenth", `${Math.round(m.fastest10)} ms`],
      ["Slowest Tenth", `${Math.round(m.slowest10)} ms`],
      ["Spread", `${Math.round(m.sd)} ms`],
      ["Taps Too Early", m.falseStarts],
      ["Anticipations", m.anticipations],
    ].map(detailRow).join("");

    drawTrials(m);
    drawPower(m);
  }

  function drawTrials(m) {
    const host = $("res-chart");
    if (m.n < 3) {
      host.innerHTML = `<p class="empty">Too few responses to plot.</p>`;
      return;
    }
    const H = 190, padL = 38, padR = 14, padT = 18, padB = 24;
    const { svg, W } = frame(host, H);
    const hi = Math.max(LAPSE_MS + 60, ...m.trials) * 1.04;
    const lo = Math.max(0, Math.min(...m.trials) - 40);
    const x = (i) => padL + (i / Math.max(1, m.trials.length - 1)) * (W - padL - padR);
    const y = (v) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);

    node("rect", { x: padL, y: padT, width: W - padL - padR, height: Math.max(0, y(LAPSE_MS) - padT), fill: "var(--red)", opacity: 0.07 }, svg);
    node("line", { x1: padL, x2: W - padR, y1: y(LAPSE_MS), y2: y(LAPSE_MS), stroke: "var(--error)", "stroke-width": 1.25, "stroke-dasharray": "5 4" }, svg);
    caption(svg, W - padR - 2, y(LAPSE_MS) - 6, "Lapse", { anchor: "end", size: 10, weight: 700, fill: "var(--error)" });
    [lo, LAPSE_MS, hi].forEach((v) => caption(svg, padL - 6, y(v) + 4, String(Math.round(v)), { anchor: "end", size: 10, weight: 400 }));

    m.trials.forEach((rt, i) => {
      const dot = node("circle", { cx: x(i), cy: y(rt), r: 3.5, fill: rt >= LAPSE_MS ? "var(--error)" : "var(--ch-cog)", opacity: 0.85 }, svg);
      Motion.fadeIn(dot, { delay: Math.min(i * 12, 600), duration: 300 });
    });
    caption(svg, padL, H - 6, "First", { anchor: "start", size: 10, weight: 400 });
    caption(svg, W - padR, H - 6, "Last", { anchor: "end", size: 10, weight: 400 });
  }

  function drawPower(m) {
    const el = $("res-power");
    if (m.n < 5) {
      el.innerHTML = "";
      return;
    }
    // A single test against another is the wrong comparison, because the model
    // pools a week and scores it against a rolling baseline.
    const single = 2.8 * m.sem * Math.SQRT2;
    const weekSem = m.sem / Math.sqrt(SESSIONS_PER_WEEK);
    const baseSem = m.sem / Math.sqrt(BASELINE_SESSIONS);
    const weekly = 2.8 * Math.sqrt(weekSem ** 2 + baseSem ** 2);
    const platformShare = env && m.sd ? (env.quantSD / m.sd) * 100 : null;

    el.innerHTML =
      `<div class="group">${[
        ["One Test Can Detect", `${single.toFixed(0)} ms`],
        ["Three Tests Can Detect", `${weekly.toFixed(0)} ms`],
        platformShare != null ? ["Screen Share Of Spread", `${platformShare.toFixed(1)}%`] : null,
      ].filter(Boolean).map(detailRow).join("")}</div>` +
      `<p style="margin-top:10px;">One test can only notice a large change, which is why tests are pooled into weeks before anything is compared.</p>`;
  }

  async function persist(m) {
    if (m.n < 5) return;
    let saved;
    try {
      saved = await M.api("/api/pvt", {
        method: "POST",
        body: {
          durationMs: m.duration, nTrials: m.n, meanRt: m.mean, medianRt: m.median,
          meanReciprocal: m.meanReciprocal, sdRt: m.sd, semRt: m.sem,
          lapses: m.lapses, falseStarts: m.falseStarts, device: deviceLabel(),
        },
      });
    } catch (err) {
      setFinding(err.message === "unauthenticated" ? "Not saved, because you are signed out." : err.message, "");
      return;
    }
    $("save-status").textContent = "Saved to your history.";

    let brain = null;
    try {
      brain = await M.api("/api/brain");
    } catch {
      /* the result still stands without the comparison */
    }
    compare(m, saved, brain);
  }

  /* Against the athlete's own usual range, never against a population norm, and
     never as a verdict on its own. */
  function compare(m, saved, brain) {
    const u = brain && brain.usual;
    const range = u ? `${Math.round(u.low)} to ${Math.round(u.high)} ms` : "";
    if (!u) setFinding("Your usual range appears once there are a few weeks of earlier tests.", "");
    else if (m.mean > u.high) setFinding(`Slower than your usual range of ${range}.`, "warn");
    else if (m.mean < u.low) setFinding(`Faster than your usual range of ${range}.`, "good");
    else setFinding(`Inside your usual range of ${range}.`, "good");

    if (brain && brain.week) {
      $("res-context").textContent =
        `This is test ${brain.week.sessions} of ${brain.target} in the last seven days. One test is too noisy to judge on its own, so it joins your weekly average instead.`;
    }

    const gap = saved.caffeineMinutesPrior;
    if (gap != null && gap <= CAFFEINE_WINDOW_MINUTES) {
      $("res-caffeine").hidden = false;
      $("res-caffeine").textContent =
        `Caffeine was logged ${gap} minutes before this test. It speeds reactions and can hide fatigue, so this result may look better than you are.`;
    }
  }

  /* How many tests this week, and the hour this athlete usually tests at. The
     channel is only as good as its consistency, and the most useful thing to say
     before a test is "same hour as last time". */
  async function renderCoverage() {
    try {
      const r = await M.api("/api/pvt");
      const shown = Math.min(r.thisWeek, r.target);
      $("coverage-section").hidden = false;
      $("coverage-count").textContent = `${r.thisWeek} of ${r.target}`;
      const meter = $("coverage-meter");
      meter.firstElementChild.style.width = `${Math.round((shown / r.target) * 100)}%`;
      meter.setAttribute("aria-valuenow", String(shown));

      const hours = r.sessions
        .map((sess) => (sess.local_time ? Number(sess.local_time.slice(0, 2)) : new Date(M.parseStamp(sess.started_at)).getHours()))
        .filter((h) => Number.isFinite(h));
      const usual = hours.length >= 3 ? [...hours].sort((a, b) => a - b)[Math.floor(hours.length / 2)] : null;
      const hourText = usual == null ? null : new Date(2000, 0, 1, usual).toLocaleTimeString([], { hour: "numeric" });

      $("coverage-note").textContent = r.todayCount
        ? "You have already tested today. A second test on the same day adds very little."
        : hourText
          ? `You usually test around ${hourText}, so aim for about the same hour today.`
          : "Pick an hour you can repeat, since alertness follows a daily rhythm.";
    } catch {
      /* the api layer handles a signed-out session */
    }
  }

  $("start-btn").addEventListener("click", () => start(FULL_MS));
  $("short-btn").addEventListener("click", () => start(SHORT_MS));
  $("again-btn").addEventListener("click", () => {
    results.hidden = true;
    intro.hidden = false;
    renderCoverage();
  });

  measureEnvironment();
  renderCoverage();
})();
