/* Myaku — Today.
 *
 * The first screen answers three questions in order: where am I, what should I
 * look at, and what is left to do today. A new athlete gets a different first
 * answer — how close they are to a first reading — because "Still Calibrating"
 * on its own is a reason to close the app, and a progress bar is a reason to
 * come back.
 */

(function () {
  M.boot("today");

  const ICON = {
    pvt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5"/></svg>',
    checkin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 12.5l4.5 4.5 10-10"/></svg>',
    weekly: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4h11a1 1 0 011 1v15H7a1 1 0 01-1-1V4z"/><path d="M9 9h6M9 13h6"/></svg>',
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  const SOURCE_LABELS = {
    whoop: "Whoop",
    google: "Google Health",
    apple_health: "your Apple Health export",
    csv: "your spreadsheet",
    manual: "your manual entries",
    demo: "the demo season",
  };

  document.getElementById("date-line").textContent = M.prettyDate(M.todayKey());

  /* ---------------- where you are ---------------- */

  function nextUnlock(progress) {
    const need = progress.weeksNeeded;
    const weeks = Object.values(progress.channels).map((c) => c.weeks);
    const best = Math.max(0, ...weeks);
    if (best === 0) return "Start with any of the three below. Each one begins its own clock the day you first use it.";
    const remaining = Math.max(1, need - best);
    return `Your first reading arrives in about ${remaining} more week${remaining === 1 ? "" : "s"}, once one channel has ${need} weeks behind it.`;
  }

  function renderLearning(progress) {
    const need = progress.weeksNeeded;
    const meter = (label, weeks) => {
      const shown = Math.min(weeks, need);
      return `<div class="meter-row">
        <span class="meter-label">${M.esc(label)}</span>
        <span class="meter-count">${shown} of ${need} weeks</span>
        <div class="meter" role="progressbar" aria-label="${M.esc(label)} history" aria-valuemin="0" aria-valuemax="${need}" aria-valuenow="${shown}">
          <span style="width:${Math.round((shown / need) * 100)}%"></span>
        </div>
      </div>`;
    };
    document.getElementById("state-line").innerHTML = `
      <p class="title-1">Learning Your Normal</p>
      <p class="body" style="margin-top:10px;opacity:0.85;">
        Myaku only ever compares you against yourself, so it needs a few weeks of you before it names a pattern.
        Your readings below are real from the first day.
      </p>
      ${meter("Body", progress.channels.autonomic.weeks)}
      ${meter("Brain", progress.channels.cognitive.weeks)}
      ${meter("Life", progress.channels.psychological.weeks)}
      <p class="footnote" style="margin-top:16px;opacity:0.85;">${M.esc(nextUnlock(progress))}</p>`;
    Motion.swapIn(document.getElementById("state-line"));
  }

  function renderState(d) {
    const s = d.state;
    document.getElementById("state-line").innerHTML = `
      <p class="title-1">${M.esc(s.name)}</p>
      <p class="body" style="margin-top:10px;opacity:0.85;">${M.esc(s.detail)}</p>
      <div style="margin-top:16px;">${M.pill(M.confidenceLabel(d.confidence), s.tone)}</div>
      ${s.guidance && s.guidance.length
        ? `<p class="guidance-title">Things That Might Help</p>
           <ul class="guidance">${s.guidance.map((g) => `<li>${M.esc(g)}</li>`).join("")}</ul>`
        : ""}`;
    Motion.swapIn(document.getElementById("state-line"));
    document.getElementById("support-section").hidden = !s.support;
  }

  /* ---------------- getting started ---------------- */

  function renderChecklist(progress) {
    if (progress.confidence === "established") return;
    const c = progress.checklist;
    const items = [
      { done: c.bodyData, title: "Connect Body Data", sub: "A wearable, an Apple Health export, or a few nights by hand.", href: "sources.html" },
      { done: c.firstTest, title: "Take The Reaction Test", sub: "Three minutes, and the part a wearable cannot see.", href: "pvt.html" },
      { done: c.firstCheckin, title: "Do A Check-In", sub: "Under a minute, and only the first square is required.", href: "checkin.html" },
      { done: c.reminders, title: "Turn On Reminders", sub: "So consistency does not have to depend on memory.", href: "reminders.html" },
    ];
    const done = items.filter((i) => i.done).length;
    if (done === items.length) return;

    document.getElementById("checklist-section").hidden = false;
    document.getElementById("checklist-count").textContent = `${done} of ${items.length} done.`;
    document.getElementById("checklist").innerHTML = items
      .map((i) => `<a class="check-item${i.done ? " done" : ""}" href="${i.href}">
        <span class="check-box" aria-hidden="true">${ICON.tick}</span>
        <span class="row-main">
          <span class="row-title">${M.esc(i.title)}${i.done ? '<span class="sr-only"> (done)</span>' : ""}</span>
          <span class="row-sub">${M.esc(i.sub)}</span>
        </span>
        <span class="chevron" aria-hidden="true"></span>
      </a>`)
      .join("");
  }

  /* ---------------- channels ---------------- */

  function renderRings(d) {
    const el = document.getElementById("rings");
    el.innerHTML = Object.entries(M.CHANNELS)
      .map(([key, meta]) => {
        const ch = d.channels[key] || {};
        const b = Explain.band(ch.z, d.thresholds);
        return `<div class="ring-item" role="img" aria-label="${M.esc(meta.label)}: ${M.esc(b.word)}">
          ${M.ring(ch.z, meta.color)}
          <div class="ring-label">${meta.label}</div>
          <div class="ring-val" data-z="${ch.z == null ? "" : ch.z}" style="color:${ch.z == null ? "var(--label-3)" : meta.color}">${M.zLabel(ch.z)}</div>
        </div>`;
      })
      .join("");

    M.animateRings(el);
    // The number climbs alongside its own arc, so the two read as one gauge.
    el.querySelectorAll(".ring-val").forEach((node, i) => {
      const z = node.dataset.z;
      if (z === "") return;
      setTimeout(() => Motion.countSigned(node, Number(z), { duration: 1000, decimals: 1 }), i * 130);
    });

    document.getElementById("rings-note").textContent = {
      calibrating: "Rings fill in as each channel builds enough history to compare against.",
      provisional: "These are early readings until a few more weeks of history exist.",
      established: "Each ring compares this week against your own normal, not against anybody else.",
    }[d.confidence];

    /* A sentence per channel, because a ring and a number tell you a value has
       moved without telling you what has moved or which way is bad. */
    document.getElementById("channel-lines").innerHTML = Object.entries(M.CHANNELS)
      .map(([key, meta]) => {
        const ch = d.channels[key] || {};
        const b = Explain.band(ch.z, d.thresholds);
        return `<div class="hstack" style="align-items:flex-start;gap:10px;padding:8px 0;">
          <span aria-hidden="true" style="width:10px;height:10px;border-radius:50%;background:${meta.color};margin-top:6px;flex-shrink:0;"></span>
          <span class="subhead" style="flex:1;">
            <strong>${meta.label}</strong> · ${M.esc(b.word)}<br />
            <span class="secondary">${M.esc(Explain.channelSentence(key, ch.z, d.thresholds))}</span>
          </span>
        </div>`;
      })
      .join("");
  }

  /* The gaps, which are the only thing here that no single-channel app can
     tell you, so each one is named as well as stated. */
  function renderGaps(d) {
    const rows = Object.entries(d.gaps)
      .map(([key, value]) => ({ key, value, meaning: Explain.gapMeaning(key) }))
      .filter((g) => g.meaning.title && g.value != null && Math.abs(g.value) >= d.thresholds.gap);

    document.getElementById("readings-section").hidden = !rows.length;
    document.getElementById("readings-list").innerHTML = rows
      .map((g) => `<div class="row" style="align-items:flex-start;">
          <span class="row-main">
            <span class="row-title">${M.esc(g.meaning.title)}</span>
            <span class="row-sub">${M.esc(Explain.gapSentence(g.key, g.value, d.thresholds.gap))}</span>
          </span>
        </div>`)
      .join("");
  }

  /* ---------------- today ---------------- */

  async function renderActions(progress) {
    const journal = await M.api("/api/journal?date=" + M.todayKey()).catch(() => ({}));
    const w = progress.thisWeek;
    const done = (b) => (b ? "Done" : null);

    const actions = document.getElementById("actions");
    actions.innerHTML = [
      M.row({
        title: "Reaction Test", href: "pvt.html", icon: ICON.pvt, tint: "var(--ch-cog)",
        sub: `${w.pvt} of ${w.pvtTarget} this week. Take it at the same hour each time.`,
        value: done(progress.today.pvt),
      }),
      M.row({
        title: "Daily Check-In", href: "checkin.html", icon: ICON.checkin, tint: "var(--ch-psy)",
        sub: `${w.checkins} of ${w.checkinTarget} this week. Under a minute.`,
        value: done(progress.today.checkin),
      }),
      M.row({
        title: "Weekly Reflection", href: "weekly.html", icon: ICON.weekly, tint: "var(--purple)",
        sub: w.weekly ? "Done for this week." : "Once a week, on any day that suits you.",
        value: done(w.weekly),
      }),
      M.row({
        title: "Journal", href: "journal.html", icon: ICON.journal, tint: "var(--gray)",
        sub: "Optional, and only the rating you add is counted.",
        value: done(journal.entry && journal.entry.content),
      }),
    ].join("");

    /* The list arrives after the page does, so its rows get their own cascade
       rather than inheriting the section's single entrance. */
    if (Motion.reduced()) return;
    actions.querySelectorAll(".row").forEach((row, i) =>
      row.animate(
        [{ opacity: 0, transform: "translate3d(0, 16px, 0)" }, { opacity: 1, transform: "none" }],
        { duration: 480, delay: i * 70, easing: "cubic-bezier(0.05, 0.7, 0.1, 1)", fill: "backwards" }
      )
    );
  }

  /* ---------------- wearable readings ---------------- */

  /* The raw numbers a wearable already shows, kept here for two reasons. They
     are what most people actually want to look at, and Myaku's whole argument
     is about where these disagree with the other two channels — which is an
     argument you cannot follow without seeing them. */
  const SIGNALS = [
    {
      key: "sleep_minutes", label: "Sleep", color: "var(--ch-auto)",
      format: (v) => Explain.duration(v),
      compareOpts: {
        higherIsWorse: false, tolerance: 0.06,
        formatBase: (v) => Explain.duration(v),
        formatDelta: (v) => `${Math.round(v)} min`,
      },
    },
    {
      key: "sleep_efficiency", label: "Sleep Quality", color: "var(--ch-auto)",
      format: (v) => Math.round(v) + '<span class="unit">%</span>',
      compareOpts: { higherIsWorse: false, unit: "%", tolerance: 0.02 },
    },
    {
      key: "hrv_ms", label: "Heart Rate Variability", color: "var(--ch-cog)",
      format: (v) => Math.round(v) + '<span class="unit">ms</span>',
      compareOpts: { higherIsWorse: false, unit: " ms", tolerance: 0.06 },
    },
    {
      key: "rhr_bpm", label: "Resting Heart Rate", color: "var(--ch-psy)",
      format: (v) => Math.round(v) + '<span class="unit">bpm</span>',
      compareOpts: { higherIsWorse: true, unit: " bpm", tolerance: 0.03 },
    },
  ];

  async function renderSignals() {
    let days = [];
    try {
      ({ days } = await M.api("/api/metrics"));
    } catch {
      return;
    }

    const el = document.getElementById("readings");
    if (!days || !days.length) {
      el.innerHTML = `<div style="grid-column:1/-1;">
        <p class="body">No body data yet.</p>
        <p class="footnote secondary" style="margin-top:6px;">
          Connect a wearable, import from Apple Health, or enter a few nights by hand. Any of them gives your Body channel a start.
        </p>
        <a class="btn btn-tinted" href="sources.html" style="margin-top:14px;">Connect Body Data</a>
      </div>`;
      document.getElementById("signals-note").textContent = "";
      return;
    }

    const latest = days[days.length - 1];
    // The fourteen days before the latest one, which is the window a person
    // would themselves call "lately".
    const priorWindow = days.slice(Math.max(0, days.length - 15), days.length - 1);

    el.innerHTML = SIGNALS.map((s) => {
      const value = latest[s.key];
      const history = priorWindow.map((d) => d[s.key]).filter((v) => v != null);
      const cmp = Explain.compare(value, history, s.compareOpts);
      return `<div class="reading">
        <div class="reading-key">${M.esc(s.label)}</div>
        <div class="reading-val">${value == null ? "—" : s.format(value)}</div>
        <div class="reading-note ${cmp.tone}">${M.esc(cmp.sentence || (value == null ? "Not recorded that night." : "Not enough history to compare yet."))}</div>
        <div class="reading-spark" aria-hidden="true" data-spark="${s.key}" data-color="${s.color}"></div>
      </div>`;
    }).join("");

    el.querySelectorAll("[data-spark]").forEach((box) => {
      const key = box.getAttribute("data-spark");
      Charts.sparkline(box, { values: days.slice(-14).map((d) => d[key]), color: box.getAttribute("data-color") });
    });

    const stale = latest.date < M.shiftKey(M.todayKey(), -2);
    document.getElementById("signals-note").textContent =
      `From ${SOURCE_LABELS[latest.source] || "your connected source"}, recorded ${M.prettyDate(latest.date)}. ` +
      (stale ? "Nothing newer has arrived, so check your connection in Data Sources." : "Each line is your last fourteen days.");
  }

  /* A wearable that has not synced in six hours is synced now, quietly, and the
     readings redraw when it lands. */
  async function refreshStaleSources(me) {
    const stale = (me.integrations || []).filter(
      (i) => ["whoop", "google"].includes(i.provider) && Date.now() - M.parseStamp(i.last_synced_at || "1970-01-01 00:00:00") > 6 * 60 * 60 * 1000
    );
    for (const source of stale) {
      try {
        await M.api(`/api/integrations/${source.provider}/sync`, { method: "POST" });
        renderSignals();
      } catch {
        /* the Data Sources page shows the error in full */
      }
    }
  }

  async function renderCaffeine() {
    try {
      const { entries } = await M.api("/api/caffeine");
      const total = entries.reduce((s, e) => s + (e.mg || 0), 0);
      Motion.countUp(document.getElementById("caf-total"), Math.round(total), { duration: 900 });
    } catch { /* signed out, handled by the api layer */ }
  }

  async function renderPhase() {
    try {
      const { phases } = await M.api("/api/phases");
      const t = M.todayKey();
      const active = phases.find((p) => p.start_date <= t && t <= p.end_date);
      if (!active) return;
      document.getElementById("phase-section").hidden = false;
      document.getElementById("phase-pill").innerHTML = M.pill(active.label, "warn");
      document.getElementById("phase-note").textContent =
        "You marked this stretch as high load, so a raised reading here is less surprising.";
    } catch { /* ignore */ }
  }

  async function init() {
    let me;
    try {
      me = await M.api("/api/me");
    } catch {
      return;
    }
    if (!me.user.onboarded) {
      location.replace("welcome.html");
      return;
    }
    document.getElementById("greeting").textContent = `${M.greeting()}, ${String(me.user.name).split(" ")[0]}`;

    renderSignals();
    renderCaffeine();
    renderPhase();

    try {
      const [d, progress] = await Promise.all([M.api("/api/divergence"), M.api("/api/progress")]);
      if (d.state) renderState(d);
      else renderLearning(progress);
      renderChecklist(progress);
      renderRings(d);
      renderGaps(d);
      renderActions(progress);
    } catch {
      document.getElementById("state-line").textContent = "Your channels could not be loaded just now, so try again shortly.";
    }

    refreshStaleSources(me);
  }

  init();
})();
