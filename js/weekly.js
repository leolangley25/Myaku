/* Myaku — weekly reflection.
 *
 * Demand and control used to be nine separate numbers on nine separate rows.
 * They are the two halves of one idea, so they now share one square per domain:
 * the same information in a third of the taps, and the strain corner is visible
 * while it is being answered rather than only in Trends afterwards.
 *
 * Feeling stays its own row on purpose. A light week can still carry dread, and
 * a brutal block can be the best part of someone's month.
 */

(function () {
  M.boot("log");

  const DOMAINS = [
    { key: "training", label: "Training", tint: "var(--ch-auto)", note: "Sessions, matches, and everything the sport asked of you." },
    { key: "academic", label: "Academics", tint: "var(--ch-cog)", note: "Classes, deadlines, and work you owed someone else." },
    { key: "personal", label: "Personal Life", tint: "var(--ch-psy)", note: "Family, money, health, and everything outside the other two." },
  ];

  /* Balanced across all four quadrants of the circumplex on purpose. A list
     weighted toward the negative would quietly reintroduce a deficit model. */
  const EMOTIONS = {
    "Activated And Positive": ["Excited", "Energised", "Motivated", "Proud", "Confident", "Driven", "Hopeful", "Inspired"],
    "Settled And Positive": ["Calm", "Content", "Relaxed", "Grateful", "Satisfied", "Settled", "Steady", "Relieved"],
    "Activated And Negative": ["Anxious", "Frustrated", "Overwhelmed", "Angry", "Restless", "Tense", "Pressured", "Resentful"],
    "Depleted And Negative": ["Drained", "Flat", "Lonely", "Discouraged", "Bored", "Numb", "Detached", "Defeated"],
  };

  /* One item per Athlete Burnout Questionnaire dimension. Worded rather than
     numbered because a bare one-to-five invites a reflexive three. */
  const BURNOUT = [
    {
      name: "abq_exhaustion",
      title: "Exhaustion",
      prompt: "How worn out were you by the physical and mental demands of this week?",
      options: ["Not At All", "A Little", "Somewhat", "Quite A Lot", "Completely"],
    },
    {
      name: "abq_accomplishment",
      title: "Accomplishment",
      prompt: "How much did you feel you were achieving things that matter to you?",
      options: ["Not At All", "A Little", "Somewhat", "Quite A Lot", "Completely"],
    },
    {
      name: "abq_devaluation",
      title: "Devaluation",
      prompt: "How much did you find yourself caring less about your sport than usual?",
      options: ["Not At All", "A Little", "Somewhat", "Quite A Lot", "Completely"],
    },
  ];

  const store = { emotions: [] };
  const pads = {};
  const weekKey = M.weekStartKey();

  document.getElementById("week-line").textContent = "Week Of " + M.prettyDate(weekKey);

  /* ---------------- domains ---------------- */

  document.getElementById("domains").innerHTML = DOMAINS.map(
    (d) => `<section class="section">
      <div class="section-header">${M.esc(d.label)}</div>
      <div class="card">
        <div class="card-title" style="color:${d.tint}">Demand Against Control</div>
        ${M.padMarkup({
          id: "pad-" + d.key, tint: "strain",
          top: "Full Say", bottom: "No Say", left: "Asked Little", right: "Asked A Lot",
          corners: { tl: "Easy And Yours", tr: "Hard And Yours", bl: "Quiet But Imposed", br: "The Strain Corner" },
        })}
        <p class="footnote secondary pad-read" id="read-${d.key}" aria-live="polite">Tap anywhere on the square.</p>
        <p class="footnote secondary" style="margin-top:12px;">${M.esc(d.note)}</p>
      </div>
      <div class="card">
        <div class="card-title" style="color:${d.tint}">Feeling</div>
        ${M.scale({ name: "feeling_" + d.key, label: `${d.label} Feeling`, lowLabel: "Dread", highLabel: "Love It" })}
      </div>
    </section>`
  ).join("");

  DOMAINS.forEach((d) => {
    const read = document.getElementById("read-" + d.key);
    pads[d.key] = M.bindPad("pad-" + d.key, {
      xMin: 1, xMax: 7, yMin: 1, yMax: 7, step: 1,
      onChange: (demand, control) => {
        const strained = demand >= 5 && control <= 3;
        read.textContent = `Demand ${demand} of 7, control ${control} of 7. ${
          strained ? "This is the corner that wears people down." : "Within a workable range."
        }`;
        return strained ? "var(--red)" : "var(--green)";
      },
    });
  });

  /* ---------------- burnout dimensions ---------------- */

  document.getElementById("burnout").innerHTML = BURNOUT.map(
    (b, i) => `<div style="${i ? "margin-top:22px;" : ""}">
      <div class="card-title">${M.esc(b.title)}</div>
      <p class="footnote secondary" style="margin:-4px 0 10px;">${M.esc(b.prompt)}</p>
      ${M.wordScale({ name: b.name, options: b.options, label: b.title })}
    </div>`
  ).join("");

  /* ---------------- extras ---------------- */

  document.getElementById("extras").innerHTML = `
    <div class="card-title">Sleep Satisfaction</div>
    ${M.scale({ name: "sleep_satisfaction", lowLabel: "Terrible", highLabel: "Excellent" })}
    <p class="footnote secondary" style="margin:10px 0 20px;">How your sleep felt, which is kept separate from what a wearable measured.</p>
    <div class="card-title">Social Connection</div>
    ${M.scale({ name: "social_connection", lowLabel: "Isolated", highLabel: "Connected" })}`;

  document.getElementById("emotions").innerHTML = Object.entries(EMOTIONS)
    .map(
      ([groupName, words]) => `<div style="margin-bottom:16px;">
        <div class="footnote secondary" style="margin-bottom:8px;">${M.esc(groupName)}</div>
        <div class="chips">${words
          .map((w) => `<button type="button" class="chip" data-chip="${M.esc(w)}" aria-pressed="false">${M.esc(w)}</button>`)
          .join("")}</div>
      </div>`
    )
    .join("");

  M.bindScales(document.body, store);
  M.bindChips(document.getElementById("emotions"), store, "emotions");

  /* ---------------- prefill ---------------- */

  M.api("/api/checkin/weekly")
    .then(({ entry }) => {
      if (!entry) return;

      DOMAINS.forEach((d) => {
        const demand = entry["demand_" + d.key];
        const control = entry["control_" + d.key];
        if (demand != null && control != null) pads[d.key].set(demand, control);
      });

      Object.keys(entry).forEach((col) => {
        if (entry[col] == null) return;
        const btn = document.querySelector(`[data-scale="${col}"][data-value="${entry[col]}"]`);
        if (btn) btn.click();
      });

      if (entry.emotions) {
        entry.emotions.split(",").filter(Boolean).forEach((w) => {
          const b = document.querySelector(`[data-chip="${CSS.escape(w)}"]`);
          if (b) b.click();
        });
      }
      document.getElementById("status").textContent = "Already saved this week, and saving again will replace it.";
    })
    .catch(() => {});

  /* ---------------- save ---------------- */

  document.getElementById("save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const status = document.getElementById("status");

    const answered = DOMAINS.filter((d) => pads[d.key].get().x != null);
    if (!answered.length) {
      status.textContent = "Set at least one square before saving.";
      return;
    }

    const camel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const body = { weekStart: weekKey, emotions: store.emotions };
    Object.keys(store).forEach((k) => {
      if (k !== "emotions") body[camel(k)] = store[k];
    });
    DOMAINS.forEach((d) => {
      const { x, y } = pads[d.key].get();
      body[camel("demand_" + d.key)] = x;
      body[camel("control_" + d.key)] = y;
    });

    btn.disabled = true;
    try {
      await M.api("/api/checkin/weekly", { method: "POST", body });
      status.textContent = "Saved.";
      setTimeout(() => (location.href = "index.html"), 500);
    } catch (err) {
      status.textContent = err.message;
      btn.disabled = false;
    }
  });
})();
