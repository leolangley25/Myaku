/* Myaku — the journal.
 *
 * Three jobs. Give somebody something worth writing tonight, make the writing
 * itself easy, and then show whether any of it moved anything. The prompts and
 * the reasons behind them come from the server, so the page and the method
 * cannot drift apart.
 *
 * The page opens on the week rather than on a form, because whether you have
 * been writing is the thing you actually want to know when you arrive.
 */

(function () {
  M.boot("log");

  const DOMAINS = ["Training", "Academics", "Personal", "Team", "Injury", "Sleep", "Money", "Home"];

  /* Each prompt gets its own colour and mark, so the rail is read at a glance
     rather than word by word. */
  const LOOK = {
    free: {
      tone: "var(--outline)",
      icon: '<path d="M4 19h16M6 15.5 15.5 6l2.5 2.5L8.5 18H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    },
    expressive: {
      tone: "var(--primary)",
      icon: '<path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    },
    distanced: {
      tone: "var(--ch-cog)",
      icon: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.8 12S6 5.8 12 5.8 21.2 12 21.2 12 18 18.2 12 18.2 2.8 12 2.8 12z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    },
    good: {
      tone: "var(--green)",
      icon: '<path d="m12 4 2.3 5 5.4.6-4 3.7 1.1 5.3L12 15.9 7.2 18.6l1.1-5.3-4-3.7 5.4-.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    },
    performance: {
      tone: "var(--ch-auto)",
      icon: '<path d="M4 19V9m5 10V5m5 14v-7m5 7V8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    },
    tomorrow: {
      tone: "var(--ch-psy)",
      icon: '<rect x="4" y="5.5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3.5v4M16 3.5v4M8.5 13l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    },
  };

  const DAY = 86400000;
  const $ = (id) => document.getElementById(id);

  let prompts = [];
  let mode = "free";
  let entries = [];
  let domains = new Set();
  let pad = null;
  let timer = null;
  let timerLeft = 0;
  let timerTotal = 0;

  function setStatus(tone, text) {
    const el = $("status");
    el.className = `status-line${tone ? " " + tone : ""}`;
    el.textContent = text;
  }

  const modeById = (id) => prompts.find((m) => m.id === id) || prompts[0] || {};
  const look = (id) => LOOK[id] || LOOK.free;
  const dayKey = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

  /* ---------------- the week ---------------- */

  function renderWeek(data) {
    const written = new Set(entries.map((e) => e.entry_date));
    const names = ["S", "M", "T", "W", "T", "F", "S"];
    $("week-dots").innerHTML = Array.from({ length: 7 }, (_, i) => {
      const offset = i - 6;
      const key = dayKey(offset);
      const letter = names[new Date(Date.now() + offset * DAY).getDay()];
      return `<span class="week-dot${written.has(key) ? " on" : ""}${offset === 0 ? " today" : ""}">
        <i></i><span>${letter}</span>
      </span>`;
    }).join("");

    const thisWeek = [...written].filter((d) => d >= dayKey(-6)).length;
    $("streak-sub").textContent = thisWeek
      ? `${thisWeek} entr${thisWeek === 1 ? "y" : "ies"} in the last seven days.`
      : "Nothing yet this week.";
    $("streak-pill").innerHTML = data.streak > 1 ? M.pill(`${data.streak} Day Streak`, "good") : "";
    $("header-sub").textContent = data.total
      ? `${data.total} entr${data.total === 1 ? "y" : "ies"} so far, and a record of whether any of it moved anything.`
      : "Writing that has somewhere to go.";
  }

  /* ---------------- choosing a prompt ---------------- */

  function renderRail() {
    $("prompt-rail").innerHTML = prompts
      .map((m) => {
        const l = look(m.id);
        return `<button type="button" class="prompt-card" data-mode="${m.id}" aria-pressed="${m.id === mode}" style="--tone:${l.tone}">
          <span class="prompt-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${l.icon}</svg></span>
          <span class="prompt-name">${M.esc(m.name)}</span>
          <span class="prompt-lead">${M.esc(m.lead)}</span>
          <span class="prompt-meta">${m.minutes} Min</span>
        </button>`;
      })
      .join("");

    document.querySelectorAll("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        mode = b.dataset.mode;
        stopTimer();
        renderRail();
        renderWriter();
        $("entry").focus();
      })
    );

    /* The chosen prompt is brought into view, so a suggestion made further along
       the rail is not a card nobody ever scrolls to. */
    const current = document.querySelector('.prompt-card[aria-pressed="true"]');
    if (current) current.scrollIntoView({ inline: "center", block: "nearest", behavior: Motion.reduced() ? "auto" : "smooth" });
  }

  function renderWriter() {
    const m = modeById(mode);
    const l = look(mode);
    $("writer").style.setProperty("--tone", l.tone);
    $("mode-prompt").textContent = m.prompt || "";
    $("mode-why").textContent = m.why || "";
    $("mode-evidence").textContent = m.evidence || "";
    $("why-summary").textContent = m.caution ? "What This One Costs" : "Why This One";
    $("entry").placeholder = m.lead || "Write what is there.";
    renderTimer();
  }

  /* ---------------- the clock ---------------- */

  /* Expressive writing is a fifteen-minute exercise and a list before bed is a
     five-minute one, so the clock comes from the prompt, not from a setting. */
  function renderTimer() {
    const m = modeById(mode);
    const ring = $("timer-arc");
    const circumference = 50.3;
    if (timer) {
      $("timer-label").textContent = `${Math.floor(timerLeft / 60)}:${String(timerLeft % 60).padStart(2, "0")}`;
      $("timer-toggle").classList.add("running");
      ring.setAttribute("stroke-dashoffset", String(circumference * (1 - timerLeft / timerTotal)));
    } else {
      $("timer-label").textContent = `Write For ${m.minutes || 5} Min`;
      $("timer-toggle").classList.remove("running");
      ring.setAttribute("stroke-dashoffset", String(circumference));
    }
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    renderTimer();
  }

  $("timer-toggle").addEventListener("click", () => {
    if (timer) return stopTimer();
    timerTotal = (modeById(mode).minutes || 5) * 60;
    timerLeft = timerTotal;
    timer = setInterval(() => {
      timerLeft -= 1;
      if (timerLeft <= 0) {
        stopTimer();
        setStatus("ok", "That is the time. Finish the sentence you are on, then stop.");
        return;
      }
      renderTimer();
    }, 1000);
    $("entry").focus();
    renderTimer();
  });

  $("entry").addEventListener("input", (e) => {
    const words = e.target.value.trim().split(/\s+/).filter(Boolean).length;
    $("word-count").textContent = `${words} Word${words === 1 ? "" : "s"}`;
    e.target.style.height = "auto";
    e.target.style.height = `${Math.max(200, e.target.scrollHeight)}px`;
  });

  /* ---------------- rating the day ---------------- */

  function renderPad() {
    $("pad-host").innerHTML = M.padMarkup({
      id: "journal-pad",
      tint: "affect",
      top: "Wired",
      bottom: "Flat",
      left: "Rough",
      right: "Good",
      label: "How The Day Landed",
    });
    pad = M.bindPad("journal-pad", {
      onChange: (x, y) => {
        $("pad-readout").textContent = `${M.affectPhrase(x, y)}.`;
        return x >= 0 ? "var(--green)" : y >= 0 ? "var(--orange)" : "var(--ch-cog)";
      },
    });

    $("domain-chips").innerHTML = DOMAINS.map(
      (d) => `<button type="button" class="chip" data-domain="${d}" aria-pressed="false">${d}</button>`
    ).join("");
    document.querySelectorAll("[data-domain]").forEach((b) =>
      b.addEventListener("click", () => {
        const name = b.dataset.domain;
        if (domains.has(name)) domains.delete(name);
        else domains.add(name);
        b.setAttribute("aria-pressed", String(domains.has(name)));
      })
    );
  }

  /* ---------------- after saving ---------------- */

  function bar({ label, value, note, fraction, tone }) {
    return `<div class="bar-row" style="--tone:${tone || "var(--primary)"}">
      <span class="bar-row-top"><span class="bar-label">${M.esc(label)}</span><span class="bar-value">${M.esc(value)}</span></span>
      <span class="bar-track"><i class="bar-fill" style="width:${Math.max(4, Math.min(100, fraction * 100)).toFixed(0)}%"></i></span>
      ${note ? `<span class="bar-note">${M.esc(note)}</span>` : ""}
    </div>`;
  }

  function renderEntryInsight(insight) {
    if (!insight) return;
    const rows = [];

    if (insight.words != null) {
      const usual = insight.usualWords || insight.words;
      rows.push(
        bar({
          label: "Length",
          value: `${insight.words} words`,
          fraction: insight.words / Math.max(usual * 2, insight.words, 1),
          note: insight.usualWords ? `Your usual entry runs ${insight.usualWords} words.` : "Your first entry to measure against.",
          tone: look(insight.mode).tone,
        })
      );
    }

    if (insight.valence != null) {
      rows.push(
        bar({
          label: "How You Rated It",
          value: M.affectPhrase(insight.valence, 0).split(" ")[0],
          fraction: (insight.valence + 1) / 2,
          note:
            insight.usualValence == null
              ? "Nothing to compare it with yet."
              : insight.valence > insight.usualValence
                ? "Better than you usually rate a day you write about."
                : insight.valence < insight.usualValence
                  ? "Lower than you usually rate a day you write about."
                  : "Right on your usual.",
          tone: insight.valence >= 0 ? "var(--green)" : "var(--orange)",
        })
      );
    }

    if (insight.nightAfter != null) {
      const hours = Math.round((insight.nightAfter / 60) * 10) / 10;
      rows.push(
        bar({
          label: "The Night After",
          value: `${hours} h`,
          fraction: insight.nightAfter / 600,
          note: insight.usualNight
            ? `Against ${Math.round((insight.usualNight / 60) * 10) / 10} hours on nights you did not write.`
            : "Once more nights arrive this gets a comparison.",
          tone: "var(--ch-auto)",
        })
      );
    }

    $("entry-insight").hidden = false;
    $("entry-insight").innerHTML = `<div class="card-title">This Entry</div>
      <div style="display:grid;gap:16px;margin-top:12px;">${rows.join("")}</div>
      <p class="footnote secondary" style="margin-top:12px;">A description of what followed, not proof that writing caused it.</p>`;
    Motion.swapIn($("entry-insight"));
  }

  /* ---------------- looking back ---------------- */

  function renderHeat() {
    const counts = {};
    entries.forEach((e) => (counts[e.entry_date] = (counts[e.entry_date] || 0) + (e.word_count || 1)));
    const cells = [];
    /* Eight weeks, ending on today, laid out a week to a row. */
    for (let i = 55; i >= 0; i--) {
      const key = dayKey(-i);
      const words = counts[key] || 0;
      const level = words === 0 ? "" : words < 120 ? "l1" : words < 300 ? "l2" : "l3";
      cells.push(`<i class="${level}" title="${key}"></i>`);
    }
    $("heat").innerHTML = cells.join("");
  }

  function renderTrends(data) {
    const tiles = [
      { key: "Entries", value: data.total, sub: "All Time" },
      { key: "Streak", value: `${data.streak}`, sub: data.streak === 1 ? "Day In A Row" : "Days In A Row" },
      { key: "Typical Length", value: `${data.averageWords}`, sub: "Words An Entry" },
    ];
    if (data.nights) {
      tiles.push({
        key: "Nights After",
        value: `${data.nights.difference > 0 ? "+" : "−"}${Math.abs(data.nights.difference)}m`,
        sub: "Against A Quiet Night",
      });
    }

    $("trends-section").hidden = data.total === 0;
    $("trend-tiles").innerHTML = tiles
      .map(
        (t) => `<div class="tile">
          <div class="tile-key">${M.esc(t.key)}</div>
          <div class="tile-val">${M.esc(String(t.value))}</div>
          <div class="tile-sub">${M.esc(t.sub)}</div>
        </div>`
      )
      .join("");

    renderHeat();

    const lines = [];
    if (data.nights) {
      lines.push(
        `On the ${data.nights.nights} nights after a day you wrote about, you slept ${Math.abs(data.nights.difference)} minutes ${data.nights.difference >= 0 ? "more" : "less"} than on nights you did not.`
      );
    }
    if (data.mood) {
      const gap = Math.round((data.mood.written - data.mood.notWritten) * 100) / 100;
      lines.push(
        `Across ${data.mood.days} days you rated the days you wrote about ${Math.abs(gap)} ${gap >= 0 ? "higher" : "lower"} than the days you did not. Writing tends to happen on the days that need it, so this is not a score for writing.`
      );
    }
    if (!lines.length) lines.push("A few more entries and a few more nights, and this fills in.");
    $("trend-detail").innerHTML = lines.map((l) => `<p class="body" style="margin-bottom:8px;">${M.esc(l)}</p>`).join("");

    const used = (data.modes || []).filter((m) => m.entries > 0);
    $("modes-section").hidden = used.length === 0;
    $("mode-usage").innerHTML = used
      .map(
        (m) => `<div class="row">
          <span class="row-icon" aria-hidden="true" style="color:${look(m.mode).tone}"><svg viewBox="0 0 24 24">${look(m.mode).icon}</svg></span>
          <span class="row-main">
            <span class="row-title">${M.esc(m.name)}</span>
            <span class="row-sub">${m.averageWords} words on average.</span>
          </span>
          <span class="row-value">${m.entries}</span>
        </div>`
      )
      .join("");
  }

  /* A read entry opens what was taken from it, so any one of them can be checked
     and corrected, not only tonight's. */
  function renderRecent() {
    $("recent").innerHTML = entries.length
      ? entries
          .slice(0, 12)
          .map((e) => {
            const m = prompts.find((x) => x.id === (e.mode || "free")) || { name: "Free Write" };
            const r = level === "words" ? e.reading : null;
            const tag = r ? wordFor("mood", r.mood) : e.valence == null ? "" : e.valence > 0.15 ? "Good" : e.valence < -0.15 ? "Hard" : "Even";
            const inner = `<span class="row-icon" aria-hidden="true" style="color:${look(e.mode || "free").tone}"><svg viewBox="0 0 24 24">${look(e.mode || "free").icon}</svg></span>
              <span class="row-main">
                <span class="row-title">${M.esc(M.prettyDate(e.entry_date))}</span>
                <span class="row-sub">${r && r.summary ? M.esc(r.summary) : `${M.esc(m.name)} · ${e.word_count || 0} words`}</span>
              </span>
              <span class="row-value">${M.esc(tag)}</span>`;
            return r
              ? `<button type="button" class="row row-button" data-open="${e.entry_date}">${inner}<span class="chevron" aria-hidden="true"></span></button>`
              : `<div class="row">${inner}</div>`;
          })
          .join("")
      : `<div class="row"><span class="row-main"><span class="row-title secondary">Nothing written yet. Pick a prompt above and write three lines.</span></span></div>`;

    document.querySelectorAll("[data-open]").forEach((b) =>
      b.addEventListener("click", () => {
        const e = entries.find((x) => x.entry_date === b.dataset.open);
        if (!e) return;
        editing = false;
        renderReading(e);
        $("reading-section").scrollIntoView({ block: "start", behavior: Motion.reduced() ? "auto" : "smooth" });
        Motion.swapIn($("reading-card"));
      })
    );
  }

  /* ---------------- what was read ---------------- */

  /* The words a model on this machine chose, shown back in the same words, with
     every one of them changeable. Title Case versions of the stored values. */
  const SCALES = {
    mood: { title: "Mood", values: ["very low", "low", "mixed", "good", "very good"], words: ["Very Low", "Low", "Mixed", "Good", "Very Good"], good: 3 },
    energy: { title: "Energy", values: ["drained", "tired", "steady", "energised", "wired"], words: ["Drained", "Tired", "Steady", "Energised", "Wired"] },
    pressure: { title: "Pressure", values: ["none", "light", "moderate", "heavy", "overwhelming"], words: ["None", "Light", "Moderate", "Heavy", "Overwhelming"], bad: 3 },
    say: { title: "Your Call", values: ["not mentioned", "none", "some", "most of it"], words: ["Not Mentioned", "None Of It", "Some Of It", "Most Of It"] },
  };

  let labels = { about: {}, signs: {}, lifts: {} };
  let level = null;
  let readerInfo = { available: false, model: null, unread: 0 };
  let shown = null;
  let editing = false;

  const wordFor = (key, value) => {
    const s = SCALES[key];
    const i = s.values.indexOf(value);
    return i === -1 ? "Unknown" : s.words[i];
  };

  function toneFor(key, value) {
    const i = SCALES[key].values.indexOf(value);
    if (key === "mood") return i >= 3 ? "good" : i <= 1 ? "warn" : "";
    if (key === "pressure") return i >= 3 ? "warn" : "";
    if (key === "say") return i === 1 ? "warn" : i === 3 ? "good" : "";
    return "";
  }

  const chipList = (keys, map, tone) =>
    keys.length
      ? `<div class="chips reading-chips">${keys.map((k) => `<span class="chip static${tone ? " " + tone : ""}">${M.esc(map[k] || k)}</span>`).join("")}</div>`
      : `<p class="footnote secondary">None.</p>`;

  function readingShell(inner) {
    $("reading-section").hidden = false;
    $("reading-card").innerHTML = inner;
  }

  function renderReadingWait(text) {
    readingShell(`<div class="reading-wait"><span class="reading-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      <span>${M.esc(text)}</span></div>`);
  }

  function renderReading(entry) {
    shown = entry;
    const r = entry && entry.reading;
    if (!r) return;
    if (editing) return renderReadingEdit(entry);

    const left = !!entry.read_excluded;
    const fields = ["mood", "pressure", "say", "energy"]
      .map((k) => `<div class="reading-field">
        <span class="reading-field-key">${SCALES[k].title}</span>
        <span class="reading-field-val ${toneFor(k, r[k])}">${M.esc(wordFor(k, r[k]))}</span>
      </div>`)
      .join("");

    readingShell(`
      <div class="spread" style="align-items:flex-start;">
        <span class="footnote secondary">${M.esc(M.prettyDate(entry.entry_date))}</span>
        ${M.pill(left ? "Left Out" : entry.read_edited ? "Corrected By You" : "Counts Toward Life", left ? "" : "good")}
      </div>
      ${r.summary ? `<p class="reading-summary">${M.esc(r.summary)}</p>` : ""}
      <div class="reading-fields">${fields}</div>
      <p class="field-label">What It Was About</p>
      ${chipList(r.about, labels.about)}
      <p class="field-label">Signs It Picked Up</p>
      ${chipList(r.signs, labels.signs, "warn")}
      <p class="field-label">What Helped</p>
      ${chipList(r.lifts, labels.lifts, "good")}
      ${r.unsafe ? `<div class="support-card" style="margin-top:16px;">
        <p class="title-3">You Do Not Have To Hold This Alone</p>
        <p class="body" style="margin-top:8px;">Something in this entry sounded heavy. If you are not safe, call or text <a href="tel:988">988</a> any hour, or tell someone you trust tonight.</p>
      </div>` : ""}
      <div class="grid-2" style="margin-top:16px;">
        <button type="button" class="btn btn-tinted" id="reading-fix">Fix Something</button>
        <button type="button" class="btn btn-gray" id="reading-leave">${left ? "Count This One" : "Leave This One Out"}</button>
      </div>
      <p class="footnote secondary" style="margin-top:10px;">Read on this computer${entry.read_model && entry.read_model !== "you" ? ` by ${M.esc(entry.read_model)}` : ""}. Nothing was sent anywhere. <a class="inline-link" href="life.html#writing-section">See What Your Writing Says</a></p>`);

    $("reading-fix").addEventListener("click", () => {
      editing = true;
      renderReadingEdit(entry);
    });
    $("reading-leave").addEventListener("click", () => saveReading({ excluded: !left }));
  }

  function renderReadingEdit(entry) {
    const r = entry.reading;
    const draft = { about: [...r.about], signs: [...r.signs], lifts: [...r.lifts] };
    const scaleStore = {};

    const scaleBlock = (k) => {
      const s = SCALES[k];
      return `<p class="field-label">${s.title}</p>${M.wordScale({ name: "read_" + k, options: s.words, label: s.title })}`;
    };
    const chipBlock = (field, title) => `<p class="field-label">${title}</p>
      <div class="chips" data-field="${field}">${Object.entries(labels[field])
        .map(([k, v]) => `<button type="button" class="chip" data-chip="${k}" aria-pressed="${draft[field].includes(k)}">${M.esc(v)}</button>`)
        .join("")}</div>`;

    readingShell(`
      <p class="body">Change anything that is not right. Your version replaces the model's and is never overwritten.</p>
      ${["mood", "pressure", "say", "energy"].map(scaleBlock).join("")}
      ${chipBlock("about", "What It Was About")}
      ${chipBlock("signs", "Signs It Picked Up")}
      ${chipBlock("lifts", "What Helped")}
      <div class="grid-2" style="margin-top:16px;">
        <button type="button" class="btn btn-filled" id="reading-save">Save Changes</button>
        <button type="button" class="btn btn-gray" id="reading-cancel">Cancel</button>
      </div>`);

    const card = $("reading-card");
    M.bindScales(card, scaleStore);
    ["mood", "pressure", "say", "energy"].forEach((k) => {
      const i = SCALES[k].values.indexOf(r[k]);
      if (i !== -1) {
        const b = card.querySelector(`[data-scale="read_${k}"][data-value="${i + 1}"]`);
        if (b) b.click();
      }
    });
    card.querySelectorAll("[data-field]").forEach((box) => M.bindChips(box, draft, box.dataset.field));

    $("reading-cancel").addEventListener("click", () => {
      editing = false;
      renderReading(entry);
    });
    $("reading-save").addEventListener("click", () => {
      const edits = { about: draft.about, signs: draft.signs, lifts: draft.lifts };
      ["mood", "pressure", "say", "energy"].forEach((k) => {
        const v = scaleStore["read_" + k];
        if (v != null) edits[k] = SCALES[k].values[v - 1];
      });
      editing = false;
      saveReading({ edits });
    });
  }

  async function saveReading(body) {
    if (!shown) return;
    try {
      const r = await M.api("/api/journal/reading", { method: "PUT", body: { date: shown.entry_date, ...body } });
      renderReading(r.entry);
      Motion.swapIn($("reading-card"));
      load();
    } catch (err) {
      setStatus("error", err.message);
    }
  }

  /* Asked for after the save has already landed, so a slow model never makes
     saving feel slow. The first read after the model has been idle can take a
     while longer, because it has to load first. */
  async function readSaved(date) {
    renderReadingWait("Reading it on this computer. Nothing leaves it.");
    try {
      const r = await M.api("/api/journal/read", { method: "POST", body: { date } });
      if (r.reading) {
        const { entry } = await M.api("/api/journal?date=" + date);
        renderReading(entry);
        Motion.swapIn($("reading-card"));
        load();
      } else if (r.reason === "offline") {
        readingShell(`<p class="body">No model is running on this computer right now, so this entry will be read once one is. Your save is safe either way.</p>`);
      } else {
        $("reading-section").hidden = true;
      }
    } catch (err) {
      readingShell(`<p class="body">${M.esc(err.message)}.</p>`);
    }
  }

  /* ---------------- consent ---------------- */

  const LEVELS = [
    {
      id: "words",
      title: "Read My Entries",
      sub: "A model running on this computer reads each entry for mood, pressure, and what it was about, and adds that to your Life channel. Nothing is sent anywhere, and you can see and fix everything it takes.",
    },
    {
      id: "rating",
      title: "Count My Rating Only",
      sub: "Only the grid you set under an entry counts. The words themselves are never read.",
    },
    {
      id: "off",
      title: "Keep It Separate",
      sub: "Your journal stays a private place to think, and your Life channel comes from check-ins alone.",
    },
  ];

  const LEVEL_SUB = {
    words: "Each entry is read on this computer, and what it took counts toward your Life channel alongside your check-ins.",
    rating: "The grid under each entry counts toward your Life channel. The words are never read.",
    off: "Your journal stays out of your Life channel entirely.",
  };

  const PAD_NOTE = {
    words: "Drag the dot, or skip it. Your words already count, and this sharpens them.",
    rating: "Drag the dot. This rating is the part that counts toward your Life channel.",
    off: "Drag the dot, or skip it. Your journal stays out of your Life channel.",
  };

  let picked = null;

  function engineLine() {
    return readerInfo.available
      ? `A model is running on this computer (${readerInfo.model}), so reading works right now.`
      : "No model is running on this computer right now. Entries will wait, unread, until one is.";
  }

  function renderConsentOptions() {
    $("consent-options").innerHTML = LEVELS.map(
      (l) => `<button type="button" class="option" role="radio" data-pick="${l.id}" aria-checked="${l.id === picked}" aria-pressed="${l.id === picked}">
        <span class="intro-dot" style="background:${l.id === picked ? "var(--primary)" : "var(--outline)"}" aria-hidden="true"></span>
        <span class="row-main"><span class="row-title">${M.esc(l.title)}</span><span class="row-sub">${M.esc(l.sub)}</span></span>
      </button>`
    ).join("");
    document.querySelectorAll("[data-pick]").forEach((b) =>
      b.addEventListener("click", () => {
        picked = b.dataset.pick;
        renderConsentOptions();
        document.querySelector(`[data-pick="${picked}"]`).focus();
      })
    );
    $("consent-save").disabled = !picked;
    $("consent-engine").textContent = engineLine();
  }

  function renderConsent(asked) {
    $("consent-section").hidden = !!asked;
    /* Not "main": every page's wrapper is given that id for screen readers, and
       two elements sharing it meant this unhid the wrapper and left the journal
       itself hidden. */
    $("journal-body").hidden = !asked;
    if (!asked) return renderConsentOptions();

    document.querySelectorAll("#level-toggle [data-level]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.level === level))
    );
    $("level-sub").textContent = LEVEL_SUB[level] || "";
    $("level-engine").textContent = level === "words" ? engineLine() : "";
    $("pad-note").textContent = PAD_NOTE[level] || PAD_NOTE.off;

    const unread = level === "words" ? readerInfo.unread : 0;
    $("read-back").hidden = !unread;
    $("read-back-btn").textContent = `Read ${unread} Earlier Entr${unread === 1 ? "y" : "ies"}`;
    $("read-back-btn").disabled = !readerInfo.available;
  }

  async function setLevel(next) {
    try {
      await M.api("/api/journal/consent", { method: "POST", body: { level: next } });
      level = next;
      renderConsent(true);
      load();
    } catch (err) {
      setStatus("error", err.message);
    }
  }

  $("consent-save").addEventListener("click", () => picked && setLevel(picked));
  document.querySelectorAll("#level-toggle [data-level]").forEach((b) =>
    b.addEventListener("click", () => b.dataset.level !== level && setLevel(b.dataset.level))
  );

  /* Entries from before reading was on, a few at a time, so progress is visible
     rather than one long silence. */
  $("read-back-btn").addEventListener("click", async () => {
    const btn = $("read-back-btn");
    const status = $("read-back-status");
    btn.disabled = true;
    let total = 0;
    let offline = false;
    try {
      for (;;) {
        status.className = "status-line";
        status.textContent = total ? `Read ${total} so far. Still going.` : "Reading on this computer. Nothing leaves it.";
        const r = await M.api("/api/journal/read-back", { method: "POST" });
        total += r.read;
        if (r.offline || !r.remaining || !r.read) {
          offline = !!r.offline;
          break;
        }
      }
      status.className = offline ? "status-line error" : "status-line ok";
      status.textContent = offline
        ? "No model is running on this computer right now, so nothing could be read."
        : `Done. Read ${total} entr${total === 1 ? "y" : "ies"}, and your Life channel now includes them.`;
    } catch (err) {
      status.className = "status-line error";
      status.textContent = `${err.message}.`;
    }
    btn.disabled = false;
    load();
  });

  /* ---------------- saving ---------------- */

  $("save").addEventListener("click", async () => {
    const content = $("entry").value.trim();
    if (!content) return setStatus("error", "Write something first, even a line.");
    const point = pad ? pad.get() : { x: null, y: null };
    const date = M.todayKey();
    $("save").disabled = true;
    try {
      const r = await M.api("/api/journal", {
        method: "POST",
        body: { date, content, mode, valence: point.x, arousal: point.y, domains: [...domains] },
      });
      stopTimer();
      setStatus("ok", level === "words" ? "Saved. Only this computer reads it." : "Saved. Nobody reads it but you.");
      renderEntryInsight(r.insight);
      editing = false;
      if (r.toRead) readSaved(date);
      else if (r.reading) M.api("/api/journal?date=" + date).then(({ entry }) => renderReading(entry)).catch(() => {});
      else if (level === "words") readingShell(`<p class="body">Too short to read a day from. A few sentences is enough.</p>`);
      load();
    } catch (err) {
      setStatus("error", err.message);
    }
    $("save").disabled = false;
  });

  /* ---------------- load ---------------- */

  function renderSuggestion(data) {
    const s = data.suggestion;
    const m = s && prompts.find((x) => x.id === s.mode);
    if (!m) return;
    $("suggestion-line").textContent = `Suggested tonight: ${m.name}. ${s.because}`;
    /* The suggestion is the one that opens, unless something is already typed. */
    if (!$("entry").value.trim()) {
      mode = m.id;
      renderRail();
      renderWriter();
    }
  }

  function renderWatch(watch) {
    if (!watch || !watch.raised) return;
    $("watch-card").hidden = false;
    $("watch-line").textContent =
      "Three or more hard entries on low days this week. Writing helps most when it moves toward making sense of something, and least when it circles. Step Outside It is the prompt for that, and talking to someone you trust beats both.";
  }

  function load() {
    Promise.all([M.api("/api/journal/insights"), M.api("/api/journal")])
      .then(([data, list]) => {
        prompts = data.prompts || [];
        entries = list.entries || [];
        level = data.level;
        readerInfo = data.reader || readerInfo;
        labels = data.labels || labels;
        renderConsent(data.asked);
        renderRail();
        renderWriter();
        renderSuggestion(data);
        renderWatch(data.watch);
        renderWeek(data);
        renderTrends(data);
        renderRecent();
      })
      .catch(() => {});
  }

  renderPad();
  load();
})();
