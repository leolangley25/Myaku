/* Myaku — Today.
 *
 * The first screen answers four questions in order: where am I, which channel is
 * behind it, what is left to do today, and what to do about tonight. Each channel
 * is a door into its own page rather than a number to decode here, and each card
 * names the part pulling that channel the wrong way.
 *
 * A new athlete gets a different first answer — how close they are to a first
 * reading — because "Still Calibrating" on its own is a reason to close the app,
 * and a progress bar is a reason to come back.
 */

(function () {
  M.boot("today");

  const $ = (id) => document.getElementById(id);

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

  const PAGES = { autonomic: "body.html", cognitive: "brain.html", psychological: "life.html" };
  // "Channel" means nothing on its own, so each card also names where its readings come from.
  const SOURCE_OF = { autonomic: "Wearable", cognitive: "Reaction Test", psychological: "Check-Ins" };

  $("date-line").textContent = M.prettyDate(M.todayKey());

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
    $("state-line").innerHTML = `
      <p class="title-1">Learning Your Normal</p>
      <p class="body" style="margin-top:10px;opacity:0.85;">
        Myaku only ever compares you against yourself. A first reading needs four weeks: three to learn your normal,
        and one to compare against it. Your readings below are real from the first day.
      </p>
      ${meter("Body", progress.channels.autonomic.weeks)}
      ${meter("Brain", progress.channels.cognitive.weeks)}
      ${meter("Life", progress.channels.psychological.weeks)}
      <p class="footnote" style="margin-top:16px;opacity:0.85;">${M.esc(nextUnlock(progress))}</p>`;
    $("hero-dial").hidden = true;
    Motion.swapIn($("state-line"));
  }

  function renderState(d) {
    const s = d.state;
    $("state-line").innerHTML = `
      <p class="title-1">${M.esc(s.name)}</p>
      <p class="body" style="margin-top:10px;opacity:0.85;">${M.esc(s.detail)}</p>
      <div class="hstack" style="margin-top:16px;flex-wrap:wrap;gap:12px;">
        ${M.pill(M.confidenceLabel(d.confidence), s.tone)}
        <a class="inline-link" href="method.html#patterns">What Patterns Mean</a>
      </div>
      <p class="footnote secondary" style="margin-top:8px;">${M.esc(M.confidenceSentence(d.confidence))}</p>
      ${s.guidance && s.guidance.length
        ? `<p class="guidance-title">Things That Might Help</p>
           <ul class="guidance">${s.guidance.map((g) => `<li>${M.esc(g)}</li>`).join("")}</ul>`
        : ""}`;
    Motion.swapIn($("state-line"));
    $("support-section").hidden = !s.support;
    renderDial(d);
  }

  /* All three channels on one dial. Markers bunched at the top is a week where
     everything agrees; markers pulled apart is exactly the disagreement the
     model exists to find, visible before a word of it is read. */
  function renderDial(d) {
    const host = $("hero-dial");
    const channels = Object.entries(M.CHANNELS).map(([key, meta]) => ({
      key, label: meta.label, color: meta.color, z: (d.channels[key] || {}).z,
    }));
    const known = channels.filter((c) => c.z != null);
    host.hidden = !known.length;
    if (!known.length) return;

    const furthest = [...known].sort((a, b) => b.z - a.z)[0];
    const allTypical = known.every((c) => Math.abs(c.z) < d.thresholds.notable);
    Channel.dial(host, {
      markers: channels, thresholds: d.thresholds, size: 224, word: true,
      value: allTypical ? "Typical" : Explain.band(furthest.z, d.thresholds).short,
      label: allTypical ? "All Three Channels" : `Furthest Out · ${furthest.label}`,
    });
    host.insertAdjacentHTML("beforeend", `<div class="dial-legend">${channels.map((c) => `
      <span class="dial-legend-item" style="color:${c.color}">
        <span class="dial-dot" style="background:${c.color}"></span>
        <span style="color:var(--on-surface-variant)">${c.label} · ${Explain.band(c.z, d.thresholds).short}</span>
      </span>`).join("")}</div>
      <p class="footnote secondary dial-help">The top of the dial is typical for you. Further right is worse than usual, and further left is better.</p>`);
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

    $("checklist-section").hidden = false;
    $("checklist-count").textContent = `${done} of ${items.length} done.`;
    $("checklist").innerHTML = items
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

  /* A ring shows how far a channel has moved; the sentence under it says which
     part moved it, so the card answers "why" before anyone has to tap through. */
  /* The week a channel's reading actually comes from. When nothing has been
     logged in the last seven days, the engine still shows the newest week it has,
     and calling that "the last seven days" would be untrue. */
  function staleSince(ch, anchor) {
    const points = (ch.points || []).filter((p) => p.z != null);
    if (!points.length || !anchor) return null;
    const latest = points[points.length - 1].week;
    const windowStart = M.shiftKey ? M.shiftKey(anchor, -6) : null;
    return windowStart && latest < windowStart ? latest : null;
  }

  function renderChannels(d) {
    const el = $("channel-cards");
    el.innerHTML = Object.entries(M.CHANNELS)
      .map(([key, meta]) => {
        const ch = d.channels[key] || {};
        const b = Explain.band(ch.z, d.thresholds);
        const top = Channel.topPart(key, ch.parts, d.thresholds);
        const stale = staleSince(ch, d.anchor);
        const sub = ch.z == null
          ? "Not enough history to compare yet."
          : stale
            ? `Nothing new in seven days, so this is from the week starting ${M.prettyDate(stale)}.`
            : top ? top.worse : Explain.channelSentence(key, ch.z, d.thresholds);
        return `<a class="channel-card" href="${PAGES[key]}" aria-label="${M.esc(meta.label)}: ${M.esc(b.word)}. ${M.esc(sub)}">
          <span class="channel-card-ring" aria-hidden="true">${M.ring(ch.z, meta.color, 60)}</span>
          <span class="channel-card-main">
            <span class="channel-card-label" style="color:${meta.color}">${meta.label} <span class="channel-card-source">· ${SOURCE_OF[key]}</span></span>
            <span class="channel-card-word">${M.esc(b.word)}</span>
            <span class="channel-card-sub">${M.esc(sub)}</span>
          </span>
          <span class="chevron" aria-hidden="true"></span>
        </a>`;
      })
      .join("");

    M.animateRings(el);

    $("rings-note").textContent = {
      calibrating: "Each gauge fills in once its channel has three earlier weeks to compare against.",
      provisional: "Each gauge shows your last seven days against your normal, and early readings can still shift.",
      established: "Each gauge shows your last seven days against your own normal. The top is typical, right is worse, and left is better.",
    }[d.confidence];
  }

  /* The gaps, which are the only thing here that no single-channel app can
     tell you, so each one is named as well as stated. */
  function renderGaps(d) {
    const rows = Object.entries(d.gaps)
      .map(([key, value]) => ({ key, value, meaning: Explain.gapMeaning(key) }))
      .filter((g) => g.meaning.title && g.value != null && Math.abs(g.value) >= d.thresholds.gap);

    $("readings-section").hidden = !rows.length;
    $("readings-list").innerHTML = rows
      .map((g) => `<div class="row" style="align-items:flex-start;">
          <span class="row-main">
            <span class="row-title">${M.esc(g.meaning.title)}</span>
            <span class="row-sub">${M.esc(Explain.gapSentence(g.key, g.value, d.thresholds.gap))}</span>
          </span>
        </div>`)
      .join("");
  }

  /* ---------------- today ---------------- */

  /* The first thing on the page is the one thing to do next. The full list of
     daily tasks used to sit two and a half screens down, under the dial, the
     guidance, the channels and the disagreements, so the app's own daily loop
     was the hardest thing in it to find. */
  async function renderActions(progress) {
    const journal = await M.api("/api/journal?date=" + M.todayKey()).catch(() => ({}));
    const w = progress.thisWeek;
    const hour = new Date().getHours();

    const tasks = [
      {
        key: "checkin", title: "Daily Check-In", href: "checkin.html", icon: ICON.checkin,
        sub: "Under a minute.", done: !!progress.today.checkin,
        /* Evenings are when a day can actually be rated. */
        weight: hour >= 16 ? 3 : 2,
      },
      {
        key: "pvt", title: "Reaction Test", href: "pvt.html", icon: ICON.pvt,
        sub: `Three minutes, ${w.pvt} of ${w.pvtTarget} this week.`,
        done: !!progress.today.pvt || w.pvt >= w.pvtTarget,
        weight: hour < 12 ? 3 : 1,
      },
      {
        key: "weekly", title: "Weekly Reflection", href: "weekly.html", icon: ICON.weekly,
        sub: "Once a week, about five minutes.", done: !!w.weekly,
        /* It only becomes the next thing late in the week. */
        weight: [0, 5, 6].includes(new Date().getDay()) ? 2.5 : 0.5,
      },
      {
        key: "journal", title: "Journal", href: "journal.html", icon: ICON.journal,
        sub: "Optional.", done: !!(journal.entry && journal.entry.content),
        weight: hour >= 20 ? 1.5 : 0.2,
      },
    ];

    const open = tasks.filter((t) => !t.done).sort((a, b) => b.weight - a.weight);
    const next = open[0];
    const others = tasks.filter((t) => t !== next);

    const pills = others
      .map((t) => `<a class="task-pill${t.done ? " done" : ""}" href="${t.href}">${M.esc(t.title)}</a>`)
      .join("");

    $("up-next").innerHTML = next
      ? `<a class="up-next-main" href="${next.href}">
           <span aria-hidden="true" style="display:grid;">${next.icon}</span>
           <span class="up-next-text">
             <span class="up-next-title">${M.esc(next.title)}</span>
             <span class="up-next-sub">${M.esc(next.sub)}</span>
           </span>
           <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
         </a>
         <div class="task-pills">${pills}</div>`
      : `<div class="up-next-done">
           <span class="tone-dot" style="background:var(--green)"></span>
           <span><strong>Done For Today</strong><br /><span class="footnote secondary">Everything that feeds your channels is in.</span></span>
         </div>
         <div class="task-pills">${pills}</div>`;
  }

  /* ---------------- tonight ---------------- */

  /* The same caffeine model the Caffeine page and the server use, so the number
     here always matches the one a tap away. */
  const doseLevel = (mg, elapsed) => (elapsed >= 0 ? mg * Math.min(1, elapsed / 0.75) * Math.pow(0.5, elapsed / 5) : 0);
  const hoursOf = (hhmm) => {
    const [h, m] = String(hhmm || "").split(":").map(Number);
    return (h || 0) + (m || 0) / 60;
  };
  const clock = (minutes) => {
    const v = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const h = Math.floor(v / 60);
    return `${h % 12 || 12}:${String(v % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };

  async function renderTonight() {
    const [body, caffeine, insights] = await Promise.all([
      M.api("/api/body").catch(() => null),
      M.api("/api/caffeine").catch(() => null),
      M.api("/api/caffeine/insights").catch(() => null),
    ]);
    const tiles = [];
    let planned = null;

    if (body && body.hasData && body.sleep) {
      const s = body.sleep;
      let wake = null;
      try { wake = localStorage.getItem("myaku.wake." + M.todayKey()); } catch { /* private mode */ }
      if (!/^\d{2}:\d{2}$/.test(wake || "")) wake = s.timing ? s.timing.usualWake : "07:00";
      const wakeMinutes = hoursOf(wake) * 60;
      planned = wakeMinutes - s.inBedNeeded;
      tiles.push({ key: "In Bed By", val: clock(planned), sub: `To Wake At ${clock(wakeMinutes)}`, words: true });
      if (s.week.average != null) {
        tiles.push({ key: "Sleep This Week", val: Explain.duration(s.week.average), sub: `Goal ${Explain.duration(body.goal)}`, words: true });
      }
    }

    if (caffeine && insights) {
      const entries = caffeine.entries || [];
      const yesterday = insights.yesterday || [];
      const level = (hour) =>
        entries.reduce((t, e) => t + doseLevel(Number(e.mg), hour - hoursOf(e.logged_at)), 0) +
        yesterday.reduce((t, e) => t + doseLevel(Number(e.mg), hour + 24 - hoursOf(e.logged_at)), 0);
      /* The same bedtime as the tile beside it. Two different bedtimes on one card
         used to leave caffeine measured at a time the plan never mentioned. */
      let bedHour = insights.bedHour;
      if (planned != null) {
        bedHour = (((Math.round(planned) % 1440) + 1440) % 1440) / 60;
        if (bedHour < 12) bedHour += 24;
      }
      const atBed = Math.round(Math.max(...[0, 0.25, 0.5, 0.75].map((k) => level(bedHour + k))));
      const zone = atBed < 30 ? "Clear" : atBed < 75 ? "Borderline" : "High";
      tiles.push({ key: "Caffeine At Bedtime", val: `${atBed}<span class="stat-unit"> mg</span>`, sub: `${zone} At ${clock(bedHour * 60)}` });
    }

    $("tonight-section").hidden = !tiles.length;
    $("tonight-tiles").innerHTML = tiles.map((t) => `<div class="tile">
      <div class="tile-key">${t.key}</div>
      <div class="tile-val${t.words ? " words" : ""}">${t.val}</div>
      <div class="tile-sub">${t.sub}</div>
    </div>`).join("");
  }

  /* ---------------- wearable readings ---------------- */

  /* The raw numbers a wearable already shows, kept here because they are what most
     people want to look at first. The Body page reads them properly. */
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
      key: "sleep_efficiency", label: "Sleep Efficiency", color: "var(--ch-auto)",
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

    const el = $("readings");
    if (!days || !days.length) {
      el.innerHTML = `<div style="grid-column:1/-1;">
        <p class="body">No body data yet.</p>
        <p class="footnote secondary" style="margin-top:6px;">
          Connect a wearable, import from Apple Health, or enter a few nights by hand. Any of them gives your Body channel a start.
        </p>
        <a class="btn btn-tinted" href="sources.html" style="margin-top:14px;">Connect Body Data</a>
      </div>`;
      $("signals-note").textContent = "";
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
    $("signals-note").textContent =
      `From ${SOURCE_LABELS[latest.source] || "your connected source"}, recorded ${M.prettyDate(latest.date)}. ` +
      (stale ? "Nothing newer has arrived, so check your connection in Data Sources." : "Each line is your last fourteen days.") +
      " Sleep efficiency is the share of your time in bed spent asleep.";
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

  async function renderPhase() {
    try {
      const { phases } = await M.api("/api/phases");
      const t = M.todayKey();
      const active = phases.find((p) => p.start_date <= t && t <= p.end_date);
      if (!active) return;
      $("phase-section").hidden = false;
      $("phase-pill").innerHTML = M.pill(active.label, "warn");
      $("phase-note").textContent = "You marked this as a busy period, so a raised reading here is less surprising.";
    } catch { /* ignore */ }
  }

  /* The week ahead, but only when there is one worth naming. An empty calendar
     says nothing, and a quiet fortnight does not need a card. */
  async function renderSqueeze() {
    try {
      const season = await M.api("/api/schedule");
      if (!season.next) return;
      const counts = Object.entries(season.next.counts || {})
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`)
        .join(", ");
      $("squeeze-section").hidden = false;
      $("squeeze-body").innerHTML = `
        <p class="body">${M.esc(M.prettyDate(season.next.start))} to ${M.esc(M.prettyDate(season.next.end))}, with ${M.esc(counts)}.</p>
        <p class="footnote secondary" style="margin-top:8px;">That is heavier than your usual week. Nothing has happened yet, and knowing early is the point.</p>
        <a class="inline-link" href="schedule.html">See The Weeks Ahead</a>`;
    } catch {
      /* a calendar is optional, so silence is the right failure here */
    }
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
    $("greeting").textContent = `${M.greeting()}, ${String(me.user.name).split(" ")[0]}`;

    renderSignals();
    renderTonight();
    renderPhase();
    renderSqueeze();

    try {
      const [d, progress] = await Promise.all([M.api("/api/divergence"), M.api("/api/progress")]);
      if (d.state) renderState(d);
      else renderLearning(progress);
      renderChecklist(progress);
      renderChannels(d);
      renderGaps(d);
      renderActions(progress);
    } catch {
      $("state-line").textContent = "Your channels could not be loaded just now, so try again shortly.";
    }

    refreshStaleSources(me);
  }

  init();
})();
