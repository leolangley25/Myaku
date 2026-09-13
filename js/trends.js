/* Myaku — Trends.
 *
 * Four views over the same eight weeks. The rule that governs all of them is
 * that a description and a test are labelled differently and treated
 * differently: describing what happened costs nothing and needs no correction,
 * while claiming a relationship needs a hypothesis fixed in advance. Exactly one
 * claim in this app was fixed in advance, and it is marked as such.
 */

(function () {
  M.boot("trends");

  const VIEWS = [
    { id: "channels", label: "Channels" },
    { id: "rhythm", label: "Rhythm" },
    { id: "drivers", label: "Drivers" },
    { id: "tests", label: "Tests" },
  ];

  const COLOR = {
    load: "var(--ch-psy)",
    recovery: "var(--green)",
    control: "var(--purple)",
    focus: "var(--ch-cog)",
    motivation: "var(--teal)",
    sleep: "var(--ch-auto)",
  };

  let data = null;   // divergence
  let stats = null;  // analytics
  let active = "channels";

  /* ---------------- markup helpers ---------------- */

  const esc = M.esc;

  function section(title, inner) {
    return `<section class="section">
      <div class="section-header">${esc(title)}</div>
      ${inner}
    </section>`;
  }

  function card(inner) {
    return `<div class="card">${inner}</div>`;
  }

  function badge(kind) {
    const map = {
      test: ["badge-test", "Pre-Registered Test"],
      explore: ["badge-explore", "Exploratory"],
      describe: ["badge-describe", "Description"],
    };
    const [cls, label] = map[kind];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function chartBox(id, height) {
    return `<div class="chart" id="${id}" style="height:${height}px;"></div>`;
  }

  function legend(items) {
    return `<div class="legend">${items
      .map((i) => `<span class="legend-item"><span class="legend-swatch" style="background:${i.color}"></span>${esc(i.label)}</span>`)
      .join("")}</div>`;
  }

  /* A numeric tile carries its value in a data attribute so the count-up can
     find it after the markup lands; anything non-numeric is printed as-is. */
  function tile(key, value, sub) {
    const num = typeof value === "string" ? Number(value.replace(/[+%,]/g, "")) : Number(value);
    const countable = Number.isFinite(num) && String(value).trim() !== "";
    const decimals = /\.\d/.test(String(value)) ? (String(value).split(".")[1] || "").length : 0;
    return `<div class="tile">
      <div class="tile-key">${esc(key)}</div>
      <div class="tile-val${countable ? "" : " words"}"${countable ? ` data-count="${num}" data-decimals="${decimals}" data-suffix="${String(value).endsWith("%") ? "%" : ""}" data-signed="${String(value).startsWith("+") || String(value).startsWith("-")}"` : ""}>${esc(value)}</div>
      ${sub ? `<div class="tile-sub">${esc(sub)}</div>` : ""}
    </div>`;
  }

  function animateTiles(root) {
    root.querySelectorAll(".tile-val[data-count]").forEach((node, i) => {
      const to = Number(node.dataset.count);
      const decimals = Number(node.dataset.decimals) || 0;
      setTimeout(() => {
        if (node.dataset.signed === "true") Motion.countSigned(node, to, { decimals, duration: 800 });
        else Motion.countUp(node, to, { decimals, duration: 800, suffix: node.dataset.suffix || "" });
      }, i * 90);
    });
  }

  function caveat(textValue) {
    return `<p class="caveat">${esc(textValue)}</p>`;
  }

  const weekLabel = (wk) => wk.slice(5).replace("-", "/");
  const slug = (s) => String(s).replace(/\W+/g, "-").toLowerCase();

  /* ---------------- channels ---------------- */

  /* Names which of the three burnout dimensions moved most across the season,
     since the order they move in is the whole reason they are asked apart. */
  function burnoutFinding() {
    const rows = stats.burnout.filter((r) => r.exhaustion != null);
    if (rows.length < 3) return "Two or more weekly reflections are needed before this says anything.";
    const first = rows[0], last = rows[rows.length - 1];
    const moves = [
      { key: "exhaustion", phrase: "exhaustion has climbed most", delta: (last.exhaustion ?? 0) - (first.exhaustion ?? 0) },
      { key: "accomplishment", phrase: "sense of accomplishment has fallen most", delta: -((last.accomplishment ?? 0) - (first.accomplishment ?? 0)) },
      { key: "devaluation", phrase: "loss of interest has climbed most", delta: (last.devaluation ?? 0) - (first.devaluation ?? 0) },
    ].sort((a, b) => b.delta - a.delta);

    if (moves[0].delta <= 0.5) return "None of the three has moved much across your season.";
    const worst = moves[0];
    return `Your ${worst.phrase} across the season, by about ${Math.abs(worst.delta).toFixed(1)} of five points.`;
  }

  function renderChannels(el) {
    const weeks = [...new Set(
      Object.values(data.channels).flatMap((c) => (c.points || []).map((p) => p.week))
    )].sort();

    const t = data.thresholds.gap;
    const gapRows = ["cognitiveVsAutonomic", "psychologicalVsAutonomic", "cognitiveVsPsychological", "sleepFeltVsMeasured"]
      .map((key) => {
        const value = data.gaps[key];
        const meaning = Explain.gapMeaning(key);
        const agrees = value != null && Math.abs(value) < t;
        return `<div class="row" style="align-items:flex-start;">
          <span class="row-main">
            <span class="row-title">${esc(meaning.title)}</span>
            <span class="row-sub">${esc(Explain.gapSentence(key, value, t))}</span>
          </span>
          <span class="row-value">${value == null ? "—" : agrees ? "Agree" : "Apart"}</span>
        </div>`;
      })
      .join("");

    /* The headline: the channel furthest from its own normal, said in a
       sentence, before any chart appears. */
    const ranked = Object.entries(M.CHANNELS)
      .map(([k, m]) => ({ key: k, label: m.label, z: data.channels[k].z, points: data.channels[k].points }))
      .filter((c) => c.z != null)
      .sort((a, b) => b.z - a.z);
    const top = ranked[0];
    const topBand = top ? Explain.band(top.z, data.thresholds) : null;

    el.innerHTML = [
      section("The Short Version", card(
        top
          ? Explain.finding(
              `${esc(top.label)} is the channel furthest from your normal right now, and it is ${esc(topBand.word.toLowerCase())}.`,
              topBand.tone
            ) +
            `<p class="subhead secondary" style="margin-top:6px;">${esc(Explain.channelSentence(top.key, top.z, data.thresholds))} ${esc(Explain.rankSentence(top.points))}</p>`
          : `<p class="empty" style="padding:4px;">Not enough history yet to say anything useful.</p>`
      )),

      section("One Shared Scale", card(
        Explain.finding("Each line is one channel compared against your own normal.") +
        chartBox("chart-channels", 230) +
        legend(Object.entries(M.CHANNELS).map(([, m]) => ({ label: m.label, color: m.color }))) +
        Explain.howToRead(`
          <p>The flat line across the middle is <strong>your own normal</strong>, worked out from your own history. It is not an average of other people.</p>
          <p>A line <strong>above</strong> the middle means that channel is worse than it usually is for you. Below means better. The shaded band is the range where nothing unusual is happening.</p>
          <dl>
            <dt>Body</dt><dd>${esc(Explain.channelMeaning("autonomic").measures)}</dd>
            <dt>Brain</dt><dd>${esc(Explain.channelMeaning("cognitive").measures)}</dd>
            <dt>Life</dt><dd>${esc(Explain.channelMeaning("psychological").measures)}</dd>
          </dl>
          <p>Lines only start once there are three weeks behind them, because there is no "normal" to compare against before that.</p>`)
      )),

      `<section class="section"><div class="tiles">${Object.entries(M.CHANNELS)
        .map(([k, m]) => {
          const ch = data.channels[k];
          const b = Explain.band(ch.z, data.thresholds);
          return tile(m.label, b.word, Explain.channelSentence(k, ch.z, data.thresholds));
        })
        .join("")}</div></section>`,

      section("Where Two Channels Disagree",
        `<div class="group">${gapRows}</div>` +
        Explain.howToRead(`
          <p>Each row compares two channels against each other. When they agree, there is nothing to report. When they pull apart, the direction of the gap says which one is ahead.</p>
          <p>This is the part no single-source app can show you: a recovery score cannot disagree with itself.</p>
          <p>A gap carries the noise of both channels at once, so it has to move further than either one alone before it counts.</p>`)),

      section("What You Actually Answered", card(
        badge("describe") +
        Explain.finding("Your raw check-in answers, before any comparison to your normal.") +
        chartBox("chart-selfreport", 210) +
        legend([
          { label: "Load", color: COLOR.load },
          { label: "Recovery", color: COLOR.recovery },
          { label: "Control", color: COLOR.control },
          { label: "Focus", color: COLOR.focus },
          { label: "Motivation", color: COLOR.motivation },
        ]) +
        Explain.howToRead(`
          <p>These are the numbers you tapped, averaged per week, on the same zero-to-ten scale you answered them on. Nothing is transformed.</p>
          <p>It is here because the chart above hides the difference between a five that became a four and a nine that became a two. Both look the same once they are scaled against your normal; they are not the same.</p>
          <dl>
            <dt>Load</dt><dd>How much the week asked of you. Higher is heavier.</dd>
            <dt>Recovery</dt><dd>How recovered your body felt. Higher is better.</dd>
            <dt>Control</dt><dd>How much say you had over your week. Higher is better.</dd>
            <dt>Focus</dt><dd>How sharp you felt. Higher is better.</dd>
            <dt>Motivation</dt><dd>How much you wanted to be there. Higher is better.</dd>
          </dl>`)
      )),

      section("Burnout, In Three Parts", card(
        badge("describe") +
        Explain.finding(burnoutFinding()) +
        chartBox("chart-burnout", 200) +
        legend([
          { label: "Exhaustion", color: "var(--red)" },
          { label: "Accomplishment", color: "var(--green)" },
          { label: "Devaluation", color: "var(--purple)" },
        ]) +
        Explain.howToRead(`
          <p>Burnout is not one thing, so this asks about three separate ones each week, each on a one-to-five scale.</p>
          <dl>
            <dt>Exhaustion</dt><dd>How worn out the week left you. Rising is worse.</dd>
            <dt>Accomplishment</dt><dd>How much you felt you were achieving. Falling is worse.</dd>
            <dt>Devaluation</dt><dd>How much you stopped caring about your sport. Rising is worse.</dd>
          </dl>
          <p>The order they move in is the useful part. Exhaustion rising on its own usually points at workload. Devaluation rising is the one people notice last, and it is the one that tends to stick.</p>`) +
        caveat("These three items are modelled on a published athlete burnout questionnaire, shortened to one question each. That shortening means this tracks your own trend over time and is not a validated score.")
      )),
    ].join("");

    /* charts */
    if (weeks.length >= 2) {
      Charts.lines(document.getElementById("chart-channels"), {
        labels: weeks.map((w, i) => (weeks.length > 7 && i % 2 ? "" : weekLabel(w))),
        min: -2, max: 3, zeroLine: true,
        // The range where nothing unusual is happening, drawn rather than
        // described, so "normal" is a place on the chart and not a footnote.
        band: [-data.thresholds.notable, data.thresholds.notable],
        bandLabel: "Your Normal Range",
        bandColor: "var(--outline)",
        series: Object.entries(M.CHANNELS).map(([k, m]) => ({
          color: m.color,
          values: weeks.map((wk) => {
            const p = (data.channels[k].points || []).find((q) => q.week === wk);
            return p && p.z != null ? p.z : null;
          }),
        })),
      });
    } else {
      Charts.empty(document.getElementById("chart-channels"), "Two weeks of data are needed before a trend can be drawn.");
    }

    const sr = stats.selfReport;
    if (sr.length >= 2) {
      Charts.lines(document.getElementById("chart-selfreport"), {
        labels: sr.map((r, i) => (sr.length > 7 && i % 2 ? "" : weekLabel(r.week))),
        min: 0, max: 10,
        series: [
          { key: "load", color: COLOR.load },
          { key: "recovery", color: COLOR.recovery },
          { key: "control", color: COLOR.control },
          { key: "focus", color: COLOR.focus },
          { key: "motivation", color: COLOR.motivation },
        ].map((s) => ({ color: s.color, width: 2, values: sr.map((r) => r[s.key]) })),
      });
    } else {
      Charts.empty(document.getElementById("chart-selfreport"), "Not enough check-ins to draw this yet.");
    }

    const bd = stats.burnout;
    if (bd.length >= 2) {
      Charts.lines(document.getElementById("chart-burnout"), {
        labels: bd.map((r) => weekLabel(r.week)),
        min: 1, max: 5,
        series: [
          { key: "exhaustion", color: "var(--red)" },
          { key: "accomplishment", color: "var(--green)" },
          { key: "devaluation", color: "var(--purple)" },
        ].map((s) => ({ color: s.color, width: 2.5, values: bd.map((r) => r[s.key]) })),
      });
    } else {
      Charts.empty(document.getElementById("chart-burnout"), "These are asked weekly, so two reflections are needed first.");
    }
  }

  /* ---------------- rhythm ---------------- */

  function loadRatioFinding() {
    const lr = stats.loadRatio;
    if (!lr.ready || !lr.series.length) return "Four weeks of check-ins are needed before this means anything.";
    const r = lr.series[lr.series.length - 1].ratio;
    const [lo, hi] = lr.sweetSpot;
    if (r > hi) return `Your last week ran about ${Math.round((r - 1) * 100)}% heavier than your recent normal.`;
    if (r < lo) return `Your last week ran about ${Math.round((1 - r) * 100)}% lighter than your recent normal.`;
    return "Your last week was in line with your recent normal.";
  }

  function volatilityFinding() {
    const vol = stats.volatility;
    if (vol.length < 3) return "A few full weeks are needed before this comparison means anything.";
    const spreads = vol.map((v) => v.spread).filter((s) => s != null);
    const last = spreads[spreads.length - 1];
    const typical = Explain.median(spreads.slice(0, -1));
    if (typical == null) return "Not enough weeks yet.";
    if (last > typical * 1.3) return "Your most recent week swung more between heavy and light days than usual.";
    if (last < typical * 0.7) return "Your most recent week was more even, day to day, than usual.";
    return "Your most recent week was about as even as your others.";
  }

  /* Names the measure that moved furthest inside a marked period, in the
     direction that is worse for that particular measure. */
  function phaseFinding(p) {
    const MEASURES = [
      { label: "reported load", key: "load", worseUp: true },
      { label: "recovery", key: "recovery", worseUp: false },
      { label: "reaction time", key: "reaction", worseUp: true },
      { label: "sleep", key: "sleep", worseUp: false },
    ];
    const scored = MEASURES.map((m) => {
      const { inside, outside } = p[m.key];
      if (inside == null || !outside) return null;
      const pct = ((inside - outside) / outside) * 100;
      return { ...m, pct, worseBy: m.worseUp ? pct : -pct };
    }).filter(Boolean);

    if (!scored.length) return "Not enough data inside this period to compare it.";
    scored.sort((a, b) => b.worseBy - a.worseBy);
    const worst = scored[0];
    if (worst.worseBy < 5) return "Nothing moved much inside this period compared with the rest of your season.";
    const direction = worst.pct > 0 ? "higher" : "lower";
    return `Your ${worst.label} was about ${Math.abs(worst.pct).toFixed(0)}% ${direction} during this period than across the rest of your season.`;
  }

  function renderRhythm(el) {
    const dow = stats.dayOfWeek;
    const lr = stats.loadRatio;
    const vol = stats.volatility;
    const phases = stats.phases;

    const heaviestLine = dow.heaviest && dow.lightest
      ? `${dow.heaviest.day} is reliably your heaviest day, and ${dow.lightest.day} your lightest.`
      : "Not enough days logged to describe a weekly rhythm.";

    el.innerHTML = [
      section("Day By Day", card(
        badge("describe") +
        Explain.finding(heaviestLine) +
        chartBox("chart-dow-load", 190) +
        chartBox("chart-dow-rt", 200) +
        Explain.howToRead(`
          <p>The top chart is how heavy you said each weekday was, averaged across your whole season. Taller is heavier.</p>
          <p>The bottom chart is your measured reaction time on the same weekdays, drawn as milliseconds <strong>either side of your own average</strong>. Bars above the line are slower days, bars below are faster. Nobody has a reaction time near zero, so starting the axis at zero would squash every real difference flat.</p>
          <p>A day that is both heavy and slow is a different problem from a day that is only heavy. Only the bottom chart can tell you which you have.</p>
          <p>Reaction time only appears on the days you actually took the test.</p>`)
      )),

      section("Recent Versus Normal", card(
        badge("describe") +
        Explain.finding(loadRatioFinding()) +
        chartBox("chart-ratio", 210) +
        Explain.howToRead(`
          <p>This compares <strong>the last seven days</strong> of reported load against <strong>the last twenty-eight</strong>. A value of one means this week matches your recent normal exactly.</p>
          <p>Above one means you are doing more than you have been used to. Below one means less. The shaded band is the range usually treated as sustainable.</p>
          <p>The idea is borrowed from physical training monitoring, where it is applied to distance and minutes. Here it is applied to how heavy your weeks felt.</p>`) +
        caveat("Borrowed deliberately and carried over without validation. The original ratio is contested even for physical training, and applying it to psychological load is description, not evidence.")
      )),

      section("How Even Each Week", card(
        badge("describe") +
        Explain.finding(volatilityFinding()) +
        chartBox("chart-volatility", 190) +
        Explain.howToRead(`
          <p>This is how much your daily load <strong>varied inside</strong> each week, not how high it was.</p>
          <p>A low line means the days were all similar. A high line means the week swung between very heavy and very light days.</p>
          <p>Two weeks can average exactly the same and feel nothing alike. A steady six every day is a different week from three nines and four twos.</p>`)
      )),

      phases.length
        ? section("Inside Your Marked Periods",
            phases.map((p) => card(
              `<div class="card-title">${esc(p.label)}</div>
               <p class="footnote secondary" style="margin:-8px 0 10px;">${esc(p.start)} to ${esc(p.end)}</p>` +
              Explain.finding(phaseFinding(p)) +
              chartBox("chart-phase-" + slug(p.label), 200)
            )).join("") +
            Explain.howToRead(`
              <p>Each bar compares that period against <strong>the whole rest of your season</strong>, as a percentage. A bar at plus twenty percent means that measure ran a fifth higher inside the period than outside it.</p>
              <p><strong>Red always means the worse direction</strong> for that particular measure, which is not always the same as up. More load is worse; less recovery is worse; slower reaction is worse; less sleep is worse.</p>
              <p>You marked these periods yourself in More. They are the closest thing here to a natural experiment, because you flagged them before the comparison was run.</p>`))
        : section("Marked Periods", card(`<p class="empty" style="padding:4px;">Mark a stretch as high load in More, and it will be compared against the rest of your season here.</p>`)),
    ].join("");

    Charts.bars(document.getElementById("chart-dow-load"), {
      items: dow.days.map((d) => ({ label: d.short, value: d.load })),
      color: COLOR.load,
      highlight: dow.heaviest ? dow.heaviest.short : null,
      formatValue: (v) => v.toFixed(1),
    });

    const rts = dow.days.map((d) => d.rt).filter((v) => v != null);
    const rtMean = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : null;
    Charts.divergingBars(document.getElementById("chart-dow-rt"), {
      items: dow.days.map((d) => ({ label: d.short, value: d.rt == null ? null : d.rt - rtMean })),
      positive: "var(--red)", negative: "var(--green)",
      centreLabel: rtMean ? `Your Average, ${Math.round(rtMean)}ms` : "",
      formatValue: (v) => (v > 0 ? "+" : "") + Math.round(v),
    });

    const ratioEl = document.getElementById("chart-ratio");
    if (lr.ready && lr.series.length >= 2) {
      const step = Math.max(1, Math.ceil(lr.series.length / 8));
      Charts.lines(ratioEl, {
        labels: lr.series.map((s, i) => (i % step ? "" : s.date.slice(5).replace("-", "/"))),
        min: 0.4, max: 1.7, band: lr.sweetSpot,
        series: [{ color: COLOR.load, values: lr.series.map((s) => s.ratio) }],
      });
    } else {
      Charts.empty(ratioEl, "Four weeks of check-ins are needed before this ratio means anything.");
    }

    const volEl = document.getElementById("chart-volatility");
    if (vol.length >= 2) {
      Charts.lines(volEl, {
        labels: vol.map((v) => weekLabel(v.week)),
        min: 0, max: Math.max(3, ...vol.map((v) => v.spread || 0)) * 1.15,
        series: [{ color: "var(--purple)", values: vol.map((v) => v.spread) }],
      });
    } else {
      Charts.empty(volEl, "Two full weeks are needed to compare how steady they were.");
    }

    /* A percentage difference puts load, recovery, reaction time and sleep on
       one axis honestly, where rescaling their raw units to fit together would
       only have looked like it did. `worseUp` says which direction is bad for
       each measure, so the colour means the same thing on every bar. */
    const MEASURES = [
      { label: "Load", key: "load", worseUp: true },
      { label: "Recovery", key: "recovery", worseUp: false },
      { label: "Reaction", key: "reaction", worseUp: true },
      { label: "Sleep", key: "sleep", worseUp: false },
    ];

    phases.forEach((p) => {
      const box = document.getElementById("chart-phase-" + slug(p.label));
      if (!box) return;
      Charts.divergingBars(box, {
        items: MEASURES.map((m) => {
          const { inside, outside } = p[m.key];
          const value = inside == null || !outside ? null : ((inside - outside) / outside) * 100;
          return { label: m.label, value, worse: value != null && (value > 0) === m.worseUp };
        }),
        colorFor: (item) => (item.worse ? "var(--red)" : "var(--green)"),
        centreLabel: "Rest Of Season",
        formatValue: (v) => (v > 0 ? "+" : "") + v.toFixed(0) + "%",
      });
    });
  }

  /* ---------------- drivers ---------------- */

  /* States the largest heavy-versus-light difference as two counts rather than
     two percentages, because "nine of ten" is easier to hold than "ninety
     percent" and carries the sample size with it. */
  function attributionFinding() {
    const attr = stats.attribution;
    if (!attr.tags.length || !attr.nHeavy) return "Tag a few more days before this comparison means anything.";
    const top = attr.tags[0];
    const lift = top.heavy - top.light;
    if (lift < 0.15) return "No tag stands out between your heavy days and your light ones.";
    const heavyCount = Math.round(top.heavy * attr.nHeavy);
    return `${top.tag} appeared on ${heavyCount} of your ${attr.nHeavy} heaviest days, against ${Math.round(top.light * attr.nHeavy)} of your lightest.`;
  }

  /* The engine's quadrant names said in the same words the chart's own axes
     use, so the sentence and the picture do not disagree about vocabulary. */
  function quadrantInChartWords(name) {
    return {
      "Activated And Positive": "wired and pleasant",
      "Settled And Positive": "calm and pleasant",
      "Activated And Negative": "wired and unpleasant",
      "Depleted And Negative": "flat and unpleasant",
    }[name] || name.toLowerCase();
  }

  function renderDrivers(el) {
    const attr = stats.attribution;
    const affect = stats.affect;
    const dc = stats.demandControl;
    const cm = stats.controlMap;
    const jr = stats.journal;

    const quadCounts = Object.entries(affect.counts).sort((a, b) => b[1] - a[1]);
    const topQuad = quadCounts.length ? quadCounts[0] : null;

    el.innerHTML = [
      section("Heavy Days Versus Light", card(
        badge("describe") +
        Explain.finding(attributionFinding()) +
        chartBox("chart-attr", 190) +
        Explain.howToRead(`
          <p>Your days are sorted by how heavy you said they were, then split into thirds. This compares <strong>your heaviest third against your lightest third</strong> by the tags you attached.</p>
          <p>Each pair of bars is one tag. The red bar is how often it appeared on heavy days, the blue bar how often on light days. A tall red bar beside a short blue one means that tag shows up specifically when things are hard.</p>
          <p>Tags you rarely use will look dramatic on very few days, so read the tall pairs and ignore the short ones.</p>`) +
        caveat("These are the tags you chose, so this describes what you noticed, not what caused anything.")
      )),

      section("Demand Against Control", card(
        badge("describe") +
        Explain.finding("How much each area asked of you, against how much say you had over it.") +
        `<div class="segmented" id="domain-tabs" style="margin:14px 0 16px;"></div>` +
        chartBox("chart-dc", 265) +
        `<p class="footnote secondary" style="margin-top:12px;" id="dc-note"></p>` +
        Explain.howToRead(`
          <p>One dot per week. Left to right is <strong>how much that area asked of you</strong>. Bottom to top is <strong>how much say you had</strong> over when and how you did it.</p>
          <p>The dots fade from pale to solid across the season, and the dashed line joins them in order, so you can see which way you have been drifting. The solid dot is your most recent week.</p>
          <p><strong>The bottom right corner is the one that wears people down</strong>: a lot being asked, and little control over it. A dot there turns red.</p>
          <p>High demand on its own is not the problem. High demand with no say over it is the pattern the research keeps finding.</p>`)
      )),

      section("The Strain Corner", card(
        badge("describe") +
        (cm.n >= 6
          ? Explain.finding(
              `${cm.strainDays} of your ${cm.n} logged days were high demand with little say over it.`,
              cm.strainDays / cm.n > 0.3 ? "warn" : ""
            ) +
            `<div class="tiles" style="margin:14px 0 16px;">
               ${tile("Strain Days", `${cm.strainDays}`, `Out of ${cm.n} days logged.`)}
               ${tile("Share Of Days", `${Math.round((cm.strainDays / cm.n) * 100)}%`, "High demand, low say.")}
             </div>` + chartBox("chart-strain", 180) +
            Explain.howToRead(`
              <p>A day counts as a strain day when you rated demand at six or more out of ten <strong>and</strong> control at four or less.</p>
              <p>Each bar is one week, showing what share of that week's logged days met both conditions. A rising staircase means the corner is becoming your normal rather than your exception.</p>
              <p>The cutoffs are round numbers chosen for legibility, not thresholds from any study.</p>`)
          : `<p class="empty" style="padding:4px;">A week of check-ins with the first square filled will populate this.</p>`)
      )),

      section("Where Your Days Sit", card(
        badge("describe") +
        Explain.finding(
          topQuad
            ? `Most of your days landed in the ${quadrantInChartWords(topQuad[0])} corner.`
            : "Rate a few days on the mood square to fill this in."
        ) +
        chartBox("chart-affect", 265) +
        Explain.howToRead(`
          <p>Every day you rated on the mood square appears here as a small dot. Left to right is <strong>unpleasant to pleasant</strong>. Bottom to top is <strong>calm to wired</strong>.</p>
          <p>These two questions are separate on purpose. Being wired and happy before a match is a different state from being wired and miserable in the library, and a single "mood" number cannot tell them apart.</p>
          <p>The dashed line joins your weekly averages oldest to newest, so the direction of travel matters more than any one dot.</p>
          <p>The top-left corner — wired and unpleasant — is where stretches of sustained pressure tend to sit.</p>`)
      )),

      section("Journal", card(
        badge("describe") +
        Explain.finding(
          jr.total
            ? `You have written ${jr.total} ${jr.total === 1 ? "entry" : "entries"}, and rated ${jr.rated} of them.`
            : "Nothing written yet."
        ) +
        `<div class="tiles" style="margin:14px 0 0;">
           ${tile("Entries", String(jr.total), jr.total ? `${jr.rated} carry a rating.` : "Nothing written yet.")}
           ${tile("Most Written About", jr.domains.length ? jr.domains[0].tag : "—", jr.domains.length ? `${jr.domains[0].n} entries.` : "Tag an entry to fill this in.")}
         </div>` +
        caveat("Only entry counts and the tags you chose appear here. Myaku does not read your writing, and nothing on this page is derived from it. The only part of a journal entry that reaches your Life channel is the rating you set yourself.")
      )),
    ].join("");

    /* attribution */
    const attrEl = document.getElementById("chart-attr");
    if (attr.tags.length) {
      Charts.pairedBars(attrEl, {
        groups: attr.tags.slice(0, 5).map((t) => ({ label: t.tag.split(" ")[0], a: t.heavy, b: t.light })),
        colorA: "var(--red)", colorB: "var(--blue)",
        labelA: "Heavy Days", labelB: "Light Days",
      });
    } else {
      Charts.empty(attrEl, "Tag a few more days before this comparison means anything.");
    }

    /* demand-control, one domain at a time */
    const withData = dc.filter((d) => d.points.length);
    const tabs = document.getElementById("domain-tabs");
    const dcNote = document.getElementById("dc-note");

    function drawDomain(domain) {
      const box = document.getElementById("chart-dc");
      const scale = (v) => (v - 4) / 3;
      const pts = domain.points.map((p, i) => ({
        x: scale(p.demand), y: scale(p.control),
        opacity: 0.25 + (0.55 * i) / Math.max(1, domain.points.length - 1),
      }));
      Charts.quadrant(box, {
        points: pts, trail: pts,
        labels: { top: "Full Say", bottom: "No Say", left: "Asked Little", right: "Asked A Lot" },
        colorFor: (p) => (p.x > 0 && p.y < 0 ? "var(--red)" : "var(--blue)"),
      });
      const last = domain.points[domain.points.length - 1];
      dcNote.textContent = last
        ? `Latest week: demand ${last.demand} of 7, control ${last.control} of 7. The bottom right corner is the one that wears people down.`
        : "";
    }

    if (withData.length) {
      const NAMES = { training: "Training", academic: "Academics", personal: "Personal" };
      tabs.innerHTML = withData
        .map((d, i) => `<button type="button" data-domain="${d.domain}" aria-pressed="${i === 0}">${NAMES[d.domain]}</button>`)
        .join("");
      tabs.querySelectorAll("[data-domain]").forEach((b) =>
        b.addEventListener("click", () => {
          tabs.querySelectorAll("[data-domain]").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
          drawDomain(withData.find((d) => d.domain === b.getAttribute("data-domain")));
        })
      );
      drawDomain(withData[0]);
    } else {
      tabs.hidden = true;
      Charts.empty(document.getElementById("chart-dc"), "Save a weekly reflection to start this map.");
    }

    /* strain share */
    if (cm.n >= 6) {
      Charts.bars(document.getElementById("chart-strain"), {
        items: cm.weeks.map((w) => ({ label: weekLabel(w.week), value: w.share * 100 })),
        color: "var(--red)",
        formatValue: (v) => Math.round(v) + "%",
      });
    }

    /* affect */
    const affectEl = document.getElementById("chart-affect");
    if (affect.points.length) {
      Charts.quadrant(affectEl, {
        points: affect.points.map((p) => ({ x: p.valence, y: p.arousal, r: 3, opacity: 0.3 })),
        trail: affect.weekly.map((w) => ({ x: w.valence, y: w.arousal })),
        labels: { top: "Activated", bottom: "Calm", left: "Unpleasant", right: "Pleasant" },
        colorFor: (p) => (p.x >= 0 ? "var(--green)" : p.y >= 0 ? "var(--orange)" : "var(--ch-cog)"),
      });
    } else {
      Charts.empty(affectEl, "Rate a few days on the affect square to fill this in.");
    }
  }

  /* ---------------- tests ---------------- */

  function agreementLine(rho) {
    if (rho == null) return "Not enough rated nights yet.";
    if (rho >= 0.5) return "Your wearable tracks how your nights actually felt.";
    if (rho >= 0.2) return "Your wearable loosely tracks how your nights felt, and often misses.";
    if (rho > -0.2) return "How your nights felt and what your wearable measured barely relate.";
    return "Your best-measured nights were often your worst-feeling ones.";
  }

  function renderTests(el) {
    const cs = stats.caffeineSleep;
    const sp = stats.sleepPerception;
    const ll = stats.leadLag;

    el.innerHTML = [
      section("Caffeine And Sleep", card(
        badge("test") +
        Explain.finding(
          Explain.correlationSentence(cs.rho, cs.n, {
            xLabel: "caffeine after two in the afternoon",
            yLabel: "sleep quality that night",
          })
        ) +
        `<p class="subhead secondary" style="margin-top:6px;">${esc(Explain.chanceSentence(cs.p))}</p>` +
        `<div class="tiles" style="margin:16px 0;">
           ${tile("Nights Compared", String(cs.n), "Late caffeine against the night that followed.")}
           ${tile("Pattern Strength", cs.rho == null ? "—" : (cs.rho > 0 ? "+" : "") + cs.rho.toFixed(2), "Zero means none. One would mean perfect.")}
         </div>` +
        chartBox("chart-caffeine", 205) +
        Explain.howToRead(`
          <p>One dot per night. Left to right is <strong>how much caffeine you logged after two in the afternoon</strong>. Bottom to top is <strong>how well you slept that night</strong>, as recorded by your wearable.</p>
          <p>If late caffeine hurt your sleep, the cloud of dots would tilt downward from left to right. If it made no difference, the cloud would look flat or shapeless.</p>
          <p>The strength number runs from minus one to plus one. Around zero means no pattern. Negative means more caffeine went with worse sleep.</p>
          <p>The column of dots on the far left is every night you had no caffeine after two, which is most of them.</p>
          <p>This is the only claim in the app that was written down <strong>before</strong> the data existed. That matters: a question fixed in advance can be wrong, whereas a pattern found by searching will always find something.</p>`) +
        caveat(cs.confound + " A correlation here cannot separate the caffeine from the week that caused it.")
      )),

      section("Felt Against Measured", card(
        badge("describe") +
        (sp.n >= 6
          ? Explain.finding(agreementLine(sp.rho)) +
            `<div class="tiles" style="margin:14px 0 16px;">
               ${tile("Nights Compared", String(sp.n), "Nights you rated and your wearable recorded.")}
               ${tile("Rated Worse", String(sp.worseThanMeasured), "Your wearable was kinder than you were.")}
               ${tile("Rated Better", String(sp.betterThanMeasured), "You were kinder than your wearable.")}
             </div>` + chartBox("chart-sleep", 205) +
            Explain.howToRead(`
              <p>One dot per night. Left to right is <strong>how you rated the night</strong> the next morning, zero to ten. Bottom to top is <strong>what your wearable measured</strong>.</p>
              <p>If the two agreed perfectly, the dots would form a line running up to the right. Scatter means they disagree.</p>
              <p>Neither one is the truth. Your rating knows things a wrist sensor cannot, and the sensor catches things you slept through.</p>
              <p>The two counts are close to even by design, because both sides are put on the same scale before being compared. What carries information is how tightly they move together, and which way the gap drifts across the season.</p>`)
          : `<p class="empty" style="padding:4px;">Rate a week of nights on the check-in and this will fill in.</p>`)
      )),

      section("Which Moves First", card(
        badge("explore") +
        Explain.finding("A search for whether one measure tends to move before another.") +
        `<p class="subhead secondary" style="margin-top:6px;">This is a fishing expedition, and it is labelled as one.</p>` +
        ll.pairs.map((p) => `
          <div class="card-title" style="margin-top:20px;">${esc(p.label)}</div>
          <p class="footnote secondary" style="margin:-8px 0 8px;">${esc(
            p.best
              ? p.best.lag === 0
                ? `Strongest on the same day, across ${p.best.n} days.`
                : p.best.lag > 0
                  ? `Strongest when the first measure moved ${p.best.lag} day${p.best.lag === 1 ? "" : "s"} earlier, across ${p.best.n} days.`
                  : `Strongest when the second measure moved ${Math.abs(p.best.lag)} day${Math.abs(p.best.lag) === 1 ? "" : "s"} earlier, across ${p.best.n} days.`
              : "Not enough overlapping days yet."
          )}</p>
          ${chartBox("chart-lag-" + p.key, 180)}`).join("") +
        Explain.howToRead(`
          <p>Each bar is one possible delay between the two measures, from seven days before to seven days after. Taller bars mean the two lined up more closely at that delay.</p>
          <p>Bars above the centre line mean the two rose together. Bars below mean one rose as the other fell.</p>
          <p>The solid bar is whichever delay happened to line up best. <strong>Treat it as somewhere to look, not as a result.</strong></p>
          <p>Fifteen delays are tried here. Pure noise would still produce a tallest bar, every time, which is exactly why this card is marked exploratory and the caffeine card is not.</p>`) +
        caveat("No correction for multiple comparisons is applied, because nothing here is being reported as a finding.")
      )),
    ].join("");

    const cafEl = document.getElementById("chart-caffeine");
    if (cs.points.length >= 6) {
      Charts.scatter(cafEl, {
        points: cs.points.map((p) => ({ x: p.mg, y: p.sleep })),
        color: "var(--ch-auto)",
        xLabel: "Late Caffeine, Milligrams",
        yLabel: "Sleep %",
      });
    } else {
      Charts.empty(cafEl, "Log caffeine for a couple of weeks to run this.");
    }

    if (sp.n >= 6) {
      Charts.scatter(document.getElementById("chart-sleep"), {
        points: sp.points.map((p) => ({ x: p.rated, y: p.measured })),
        color: "var(--ch-psy)",
        xLabel: "Your Sleep Rating",
        yLabel: "Measured %",
      });
    }

    ll.pairs.forEach((p) => {
      Charts.correlogram(document.getElementById("chart-lag-" + p.key), {
        series: p.series, color: "var(--ch-cog)",
      });
    });
  }

  /* ---------------- accessibility and density ---------------- */

  /* Each chart is announced by the finding written above it, which is the one
     sentence that says what the picture shows. */
  function labelCharts(root) {
    root.querySelectorAll(".chart").forEach((box) => {
      const svg = box.querySelector("svg");
      if (!svg) return;
      const finding = box.closest(".card") && box.closest(".card").querySelector(".finding");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", finding ? finding.textContent.trim() : "Chart");
    });
  }

  /* A view used to be a long scroll of charts, each with its explanation. Now
     every card leads with its finding, the first two show their chart, and the
     rest open on request. The sentence is what most people need; the chart is
     there for anyone who wants to check it. */
  function foldCards(root, keepOpen = 2) {
    let charted = 0;
    root.querySelectorAll(".section > .card").forEach((card) => {
      const finding = card.querySelector(":scope > .finding");
      if (!finding || !card.querySelector(".chart")) return;

      const lead = document.createElement("div");
      while (card.firstChild && card.firstChild !== finding) lead.appendChild(card.firstChild);
      lead.appendChild(finding);

      const body = document.createElement("div");
      body.className = "fold-body";
      while (card.firstChild) body.appendChild(card.firstChild);

      const details = document.createElement("details");
      details.className = "fold";
      details.open = charted < keepOpen;
      charted++;

      const summary = document.createElement("summary");
      const head = document.createElement("div");
      head.className = "fold-head";
      head.appendChild(lead);
      head.insertAdjacentHTML(
        "beforeend",
        '<span class="fold-toggle" aria-hidden="true"><span class="fold-closed-label">Show Chart</span><span class="fold-open-label">Hide</span></span>'
      );
      summary.appendChild(head);
      details.append(summary, body);
      details.addEventListener("toggle", () => {
        if (details.open) Motion.swapIn(body);
      });
      card.appendChild(details);
    });
  }

  /* ---------------- shell ---------------- */

  const RENDER = { channels: renderChannels, rhythm: renderRhythm, drivers: renderDrivers, tests: renderTests };

  function show(id) {
    active = id;
    document.querySelectorAll("#tabs button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === id))
    );
    const el = document.getElementById("view");
    el.innerHTML = "";
    RENDER[id](el);
    labelCharts(el);
    foldCards(el);

    /* Switching views replaces a screenful at once, so the sections cascade in
       rather than appearing as one block. The charts inside each section run
       their own animations on top of this. */
    animateTiles(el);
    if (Motion.reduced()) return;
    el.querySelectorAll(".section").forEach((section, i) =>
      section.animate(
        [
          { opacity: 0, transform: "translate3d(0, 20px, 0)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 500, delay: i * 65, easing: "cubic-bezier(0.05, 0.7, 0.1, 1)", fill: "backwards" }
      )
    );
  }

  document.getElementById("tabs").innerHTML = VIEWS.map(
    (v) => `<button type="button" data-view="${v.id}" aria-pressed="${v.id === active}">${v.label}</button>`
  ).join("");
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.addEventListener("click", () => show(b.getAttribute("data-view")))
  );

  document.getElementById("view").innerHTML = '<div class="loader"></div>';

  Promise.all([M.api("/api/divergence"), M.api("/api/analytics")])
    .then(([d, s]) => {
      data = d;
      stats = s;
      const weeks = Math.max(
        d.channels.autonomic.weeks, d.channels.cognitive.weeks, d.channels.psychological.weeks
      );
      document.getElementById("sub").textContent =
        `${weeks} week${weeks === 1 ? "" : "s"} of history, compared against your own normal.`;
      show(active);
    })
    .catch(() => {
      document.getElementById("sub").textContent = "Your history could not be loaded just now.";
      document.getElementById("view").innerHTML =
        `<section class="section"><p class="empty">Nothing could be loaded. Check your connection and reload.</p></section>`;
    });
})();
