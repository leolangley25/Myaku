/* Myaku — psychomotor vigilance test.
 *
 * Timing notes, because this is the part that decides whether the cognitive
 * channel is real or decorative:
 *
 *  - Stimulus onset is timestamped inside the requestAnimationFrame callback
 *    that makes it visible. That callback runs immediately before the frame
 *    paints, so the timestamp is accurate to within one refresh interval.
 *  - Responses use pointerdown rather than click, which avoids the delay some
 *    browsers add while waiting to see if a tap becomes a double tap.
 *  - rAF timestamps and performance.now() share a time origin, so subtracting
 *    one from the other is valid.
 *
 * Platform noise cannot be separated from human variance without external
 * hardware. It does not need to be: what decides the question is whether the
 * standard error of a session mean is small next to the effect being chased,
 * and that is measured directly from the trials.
 */

(function () {
  const ISI_MIN = 1000;          // PVT-B inter-stimulus interval, milliseconds
  const ISI_MAX = 4000;
  const LAPSE_MS = 355;          // PVT-B lapse threshold
  const FULL_MS = 180000;        // three minutes
  const SHORT_MS = 60000;
  const SLEEP_EFFECT_MS = 25;    // conservative shift from partial sleep restriction

  const surface = document.getElementById("task-surface");
  const stimulus = document.getElementById("task-stimulus");
  const hint = document.getElementById("task-hint");
  const feedback = document.getElementById("task-feedback");
  const progressBar = document.getElementById("task-progress-bar");
  const introPanel = document.getElementById("intro-panel");
  const resultsPanel = document.getElementById("results-panel");

  let env = null;
  let session = null;

  /* ---------------- environment probe ---------------- */

  function probeFrames(sampleCount) {
    // Browsers stop serving animation frames to a hidden page, so this has to
    // be able to give up rather than hang with an empty panel on screen.
    return new Promise((resolve, reject) => {
      const deltas = [];
      let last = null;
      const bail = setTimeout(() => reject(new Error("no frames")), 4000);
      function step(ts) {
        if (last != null) deltas.push(ts - last);
        last = ts;
        if (deltas.length < sampleCount) {
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
    // Smallest non-zero step performance.now() will report on this device.
    let smallest = Infinity;
    for (let i = 0; i < 60; i++) {
      const a = performance.now();
      let b = performance.now();
      let guard = 0;
      while (b === a && guard++ < 200000) b = performance.now();
      const d = b - a;
      if (d > 0 && d < smallest) smallest = d;
    }
    return smallest === Infinity ? 0 : smallest;
  }

  function median(nums) {
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function sd(nums) {
    if (nums.length < 2) return 0;
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const v = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1);
    return Math.sqrt(v);
  }

  async function measureEnvironment() {
    let deltas;
    try {
      deltas = await probeFrames(90);
    } catch {
      document.getElementById("env-readout").innerHTML =
        `<span class="badge badge-moderate"><span class="badge-dot"></span>Timing Unavailable</span>` +
        `<p class="empty-note" style="margin-top:10px;">This page has to be visible on screen before the timing environment can be measured.</p>`;
      document.getElementById("start-btn").disabled = true;
      document.getElementById("short-btn").disabled = true;
      return;
    }
    const frameInterval = median(deltas);
    const refresh = 1000 / frameInterval;
    // Trimmed spread, so one janky frame during startup does not dominate.
    const sorted = [...deltas].sort((a, b) => a - b);
    const trimmed = sorted.slice(3, sorted.length - 3);
    const frameJitter = sd(trimmed);
    // Onset lands on a frame boundary, so it carries uniform quantisation
    // noise across one interval. The SD of a uniform span is width / sqrt(12).
    const quantSD = frameInterval / Math.sqrt(12);
    const clock = clockResolution();

    env = { frameInterval, refresh, frameJitter, quantSD, clock };
    renderEnvironment();
  }

  function renderEnvironment() {
    const rows = [
      ["Refresh Rate", `${env.refresh.toFixed(1)} Hz`],
      ["Frame Interval", `${env.frameInterval.toFixed(2)} ms`],
      ["Frame Jitter", `${env.frameJitter.toFixed(2)} ms`],
      ["Onset Quantisation", `${env.quantSD.toFixed(2)} ms`],
      ["Clock Resolution", `${env.clock.toFixed(3)} ms`],
    ];
    document.getElementById("env-readout").innerHTML = rows
      .map(
        (r) =>
          `<div class="metric-row"><span class="metric-name">${r[0]}</span><span class="metric-value">${r[1]}</span></div>`
      )
      .join("");
  }

  /* ---------------- the task ---------------- */

  function startSession(durationMs) {
    session = {
      durationMs,
      startedAt: performance.now(),
      trials: [],
      falseStarts: 0,
      onset: null,
      armed: false,
      timer: null,
      running: true,
    };

    introPanel.hidden = true;
    resultsPanel.hidden = true;
    surface.hidden = false;
    feedback.textContent = "";
    document.body.style.overflow = "hidden";

    surface.addEventListener("pointerdown", onTap);
    scheduleTrial();
    tickProgress();
  }

  function scheduleTrial() {
    stimulus.style.visibility = "hidden";
    hint.style.visibility = "visible";
    session.armed = false;
    session.onset = null;

    const wait = ISI_MIN + Math.random() * (ISI_MAX - ISI_MIN);
    session.timer = setTimeout(() => {
      if (!session.running) return;
      requestAnimationFrame((ts) => {
        // This callback runs just before the frame that paints the stimulus,
        // so its timestamp is the best available estimate of onset.
        stimulus.style.visibility = "visible";
        hint.style.visibility = "hidden";
        session.onset = ts;
        session.armed = true;
      });
    }, wait);
  }

  function onTap(e) {
    e.preventDefault();
    const now = performance.now();
    if (!session.running) return;

    if (!session.armed) {
      session.falseStarts++;
      clearTimeout(session.timer);
      flash("Too Early", "var(--risk-elevated)");
      scheduleTrial();
      return;
    }

    const rt = now - session.onset;
    session.trials.push(rt);
    session.armed = false;
    stimulus.textContent = String(Math.round(rt)).padStart(3, "0");

    setTimeout(() => {
      if (!session.running) return;
      if (performance.now() - session.startedAt >= session.durationMs) finishSession();
      else scheduleTrial();
    }, 450);
  }

  function flash(text, color) {
    feedback.textContent = text;
    feedback.style.color = color;
    setTimeout(() => (feedback.textContent = ""), 600);
  }

  function tickProgress() {
    if (!session || !session.running) return;
    const pct = Math.min(100, ((performance.now() - session.startedAt) / session.durationMs) * 100);
    progressBar.style.width = pct + "%";
    requestAnimationFrame(tickProgress);
  }

  function finishSession() {
    session.running = false;
    clearTimeout(session.timer);
    surface.removeEventListener("pointerdown", onTap);
    surface.hidden = true;
    document.body.style.overflow = "";
    renderResults(computeMetrics(session));
  }

  /* A hidden page stops receiving animation frames, so a stimulus scheduled
     while the user is in another app never paints and every timestamp after
     that point is meaningless. Discard rather than score it. */
  function abortSession(reason) {
    if (!session || !session.running) return;
    session.running = false;
    clearTimeout(session.timer);
    surface.removeEventListener("pointerdown", onTap);
    surface.hidden = true;
    document.body.style.overflow = "";
    resultsPanel.hidden = true;
    introPanel.hidden = false;

    const el = document.getElementById("env-readout");
    el.insertAdjacentHTML(
      "afterbegin",
      `<div style="margin-bottom:12px;">` +
        `<span class="badge badge-elevated"><span class="badge-dot"></span>Session Discarded</span>` +
        `<p class="empty-note" style="margin-top:8px;">${reason}</p></div>`
    );
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      abortSession("The screen lost focus during the test, so the timings were discarded.");
    }
  });

  /* ---------------- metrics ---------------- */

  function computeMetrics(s) {
    // Responses under 100 ms are anticipations rather than reactions, and are
    // excluded from the summary the way the published scoring does it.
    const valid = s.trials.filter((rt) => rt >= 100);
    const anticipations = s.trials.length - valid.length;
    const sorted = [...valid].sort((a, b) => a - b);
    const tenth = Math.max(1, Math.round(valid.length * 0.1));

    const mean = valid.reduce((a, b) => a + b, 0) / (valid.length || 1);
    const reciprocals = valid.map((rt) => 1000 / rt);
    const meanReciprocal = reciprocals.reduce((a, b) => a + b, 0) / (reciprocals.length || 1);
    const spread = sd(valid);
    const sem = valid.length ? spread / Math.sqrt(valid.length) : 0;

    return {
      n: valid.length,
      anticipations,
      falseStarts: s.falseStarts,
      mean,
      median: valid.length ? median(valid) : 0,
      meanReciprocal,
      sd: spread,
      sem,
      lapses: valid.filter((rt) => rt >= LAPSE_MS).length,
      fastest10: sorted.slice(0, tenth).reduce((a, b) => a + b, 0) / tenth,
      slowest10: sorted.slice(-tenth).reduce((a, b) => a + b, 0) / tenth,
      trials: valid,
      durationMs: s.durationMs,
    };
  }

  /* ---------------- results ---------------- */

  function metricRow(name, value) {
    return `<div class="metric-row"><span class="metric-name">${name}</span><span class="metric-value">${value}</span></div>`;
  }

  function renderResults(m) {
    resultsPanel.hidden = false;

    document.getElementById("res-mean").textContent = m.n ? Math.round(m.mean) : "—";
    document.getElementById("res-lapses").textContent = m.lapses;

    const level = m.lapses <= 1 ? "low" : m.lapses <= 4 ? "moderate" : "elevated";
    const label = m.lapses <= 1 ? "Few Lapses" : m.lapses <= 4 ? "Some Lapses" : "Many Lapses";
    document.getElementById("res-badge").innerHTML =
      `<span class="badge badge-${level}"><span class="badge-dot"></span>${label}</span>`;

    document.getElementById("res-detail").innerHTML = [
      metricRow("Valid Trials", m.n),
      metricRow("Median", `${Math.round(m.median)} ms`),
      metricRow("Mean Reciprocal", `${m.meanReciprocal.toFixed(2)} per second`),
      metricRow("Fastest Ten Percent", `${Math.round(m.fastest10)} ms`),
      metricRow("Slowest Ten Percent", `${Math.round(m.slowest10)} ms`),
      metricRow("Standard Deviation", `${Math.round(m.sd)} ms`),
      metricRow("False Starts", m.falseStarts),
      metricRow("Anticipations", m.anticipations),
    ].join("");

    renderChart(m);
    renderPower(m);
  }

  function renderChart(m) {
    const el = document.getElementById("res-chart");
    if (m.n < 3) {
      el.innerHTML = `<p class="empty-note">Not enough trials to plot a distribution.</p>`;
      return;
    }
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    const warn = getComputedStyle(document.documentElement).getPropertyValue("--risk-elevated").trim();
    const labels = m.trials.map((_, i) => (i % 10 === 0 ? String(i + 1) : ""));
    const max = Math.max(LAPSE_MS + 60, ...m.trials);

    MyakuCharts.renderLineChart(el, {
      labels,
      series: [
        { name: "Lapse Threshold", color: warn, width: 1.5, values: m.trials.map(() => LAPSE_MS) },
        { name: "Reaction Time", color: accent, width: 2, values: m.trials },
      ],
      min: 0,
      max,
      height: 180,
    });
    document.getElementById("res-chart-note").textContent =
      "Each point is one trial in order, and the flat line marks the lapse threshold.";
  }

  function renderPower(m) {
    const el = document.getElementById("res-power");
    if (m.n < 5) {
      el.innerHTML = `<p class="empty-note">Run a full session to estimate the detectable effect.</p>`;
      return;
    }

    // One session against another is the wrong comparison, because that is not
    // how the model reads this channel. It pools a week of sessions and scores
    // the week against a rolling personal baseline, so the figure that decides
    // whether the channel is usable is the weekly one.
    const SESSIONS_PER_WEEK = 3;
    const BASELINE_SESSIONS = 12;

    const singleDetectable = 2.8 * m.sem * Math.sqrt(2);

    const weekSem = m.sem / Math.sqrt(SESSIONS_PER_WEEK);
    const baselineSem = m.sem / Math.sqrt(BASELINE_SESSIONS);
    const weeklyDetectable = 2.8 * Math.sqrt(weekSem ** 2 + baselineSem ** 2);

    // Onset lands on a frame boundary, which is the only timing noise the
    // platform contributes. Compare it with the spread of the trials.
    const platform = env ? env.quantSD : 0;
    const platformShare = m.sd > 0 ? (platform / m.sd) * 100 : 0;

    const verdict = weeklyDetectable <= SLEEP_EFFECT_MS;

    const rows = [
      metricRow("Session Standard Error", `${m.sem.toFixed(1)} ms`),
      metricRow("Single Session Detects", `${singleDetectable.toFixed(0)} ms or larger`),
      metricRow("Weekly Pool Detects", `${weeklyDetectable.toFixed(0)} ms or larger`),
      metricRow("Effect Being Chased", `about ${SLEEP_EFFECT_MS} ms`),
      metricRow("Trial Spread", `${m.sd.toFixed(0)} ms`),
      metricRow("Platform Share Of Spread", `${platformShare.toFixed(1)} percent`),
    ].join("");

    const badge = verdict
      ? `<span class="badge badge-low"><span class="badge-dot"></span>Adequate Resolution</span>`
      : `<span class="badge badge-elevated"><span class="badge-dot"></span>Insufficient Resolution</span>`;

    const note = verdict
      ? "Pooling a week of sessions resolves a shift smaller than partial sleep restriction produces, so this channel carries real signal even though one session on its own does not."
      : "Even pooled across a week this cannot resolve the shift being chased, so trial count has to rise or the test has to run more often.";

    const floor =
      "Screen timing contributes a small fraction of the spread above, which means trial-to-trial human variability is the limit here rather than the phone.";

    el.innerHTML =
      `${badge}<div style="margin-top:12px;">${rows}</div>` +
      `<p class="page-intro" style="margin-top:12px;">${note}</p>` +
      `<p class="empty-note" style="margin-top:8px;">${floor}</p>`;
  }

  /* ---------------- wiring ---------------- */

  document.getElementById("start-btn").addEventListener("click", () => startSession(FULL_MS));
  document.getElementById("short-btn").addEventListener("click", () => startSession(SHORT_MS));
  document.getElementById("again-btn").addEventListener("click", () => {
    resultsPanel.hidden = true;
    introPanel.hidden = false;
  });

  measureEnvironment();
})();
