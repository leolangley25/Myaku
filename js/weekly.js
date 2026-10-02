/* Myaku — weekly reflection.
 *
 * Demand and control used to be nine separate numbers on nine separate rows.
 * They are the two halves of one idea, so they now share one square per domain:
 * the same information in a third of the taps, and the strain corner is visible
 * while it is being answered rather than only in Trends afterwards.
 *
 * Feeling stays its own row on purpose. A light week can still carry dread, and
 * a brutal block can be the best part of someone's month.
 *
 * Every square and row speaks its own area's language. The same "No Say" and
 * "Asked A Lot" on all three squares read as filler by the third, and nobody
 * knew what "say" meant for a family week. A large survey experiment found
 * answer labels written for the specific question beat generic ones, so the
 * training square talks about the coach, the school square about deadlines, and
 * the life square about whether it is in your hands. The numbers stored are the
 * same one to seven they always were.
 */

(function () {
  M.boot("log");

  const say = (list, i) => list[Math.max(0, Math.min(list.length - 1, i - 1))];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const TRAINING = {
    key: "training", label: "Training", tint: "var(--ch-auto)",
    ask: "How hard was training this week, and how much of it was your call?",
    pad: {
      left: "Easy Week", right: "Brutal Week", bottom: "Coach Decided", top: "I Had Input",
      corners: { tl: "Easy, My Call", tr: "Hard, My Call", bl: "Easy, Just Told", br: "Hard, Just Told" },
    },
    hint: "Right for a harder week. Up for more input into it.",
    read: (d, c) => `${cap(say(["very light training", "light training", "lighter training than usual", "a normal training week", "harder training than usual", "hard training", "brutal training"], d))}, ${
      say(["with no input from you", "with very little input from you", "with a little input from you", "with some input from you", "with a fair say in it", "mostly on your terms", "fully on your terms"], c)}.`,
    strain: "Hard work you had little input on is the corner that wears athletes down.",
    feeling: { ask: "How did you feel walking into training?", low: "Dreaded It", high: "Could Not Wait" },
  };

  const SCHOOL = {
    key: "academic", label: "School", tint: "var(--ch-cog)",
    ask: "How much did school ask of you, and how much could you plan it your way?",
    pad: {
      left: "Caught Up", right: "Buried", bottom: "Deadlines Ruled", top: "My Own Pace",
      corners: { tl: "Light, My Pace", tr: "Heavy, My Pace", bl: "Light But Rushed", br: "Buried By Deadlines" },
    },
    hint: "Right for more work due. Up for more room to plan it.",
    read: (d, c) => `${cap(say(["almost nothing due", "a light school week", "lighter than a usual school week", "a normal school week", "heavier than a usual school week", "a heavy school week", "buried in schoolwork"], d))}, ${
      say(["with every deadline set for you", "with almost no room to plan it", "with a little room to plan it", "with some room to plan it", "with a fair amount of room to plan it", "mostly at your own pace", "entirely at your own pace"], c)}.`,
    strain: "A heavy load on someone else's deadlines is the school week most linked to burnout.",
    feeling: { ask: "How did you feel about classes and schoolwork?", low: "Dragging Myself", high: "Into It" },
  };

  const WORK = {
    ...SCHOOL,
    label: "Work",
    ask: "How much did work ask of you, and how much could you plan it your way?",
    pad: {
      left: "Quiet", right: "Slammed", bottom: "Set For Me", top: "My Own Pace",
      corners: { tl: "Quiet, My Pace", tr: "Busy, My Pace", bl: "Quiet But Rushed", br: "Slammed And Rushed" },
    },
    read: (d, c) => `${cap(say(["almost nothing on", "a quiet work week", "quieter than a usual work week", "a normal work week", "busier than a usual work week", "a busy work week", "slammed at work"], d))}, ${
      say(["with everything set for you", "with almost no room to plan it", "with a little room to plan it", "with some room to plan it", "with a fair amount of room to plan it", "mostly at your own pace", "entirely at your own pace"], c)}.`,
    strain: "A heavy load you cannot pace yourself is the work week most linked to burnout.",
    feeling: { ask: "How did you feel about work this week?", low: "Dragging Myself", high: "Into It" },
  };

  const PERSONAL = {
    key: "personal", label: "Life Outside", tint: "var(--ch-psy)",
    ask: "How much was going on away from sport and school, and how much of it could you handle your way?",
    pad: {
      left: "Quiet", right: "A Lot Going On", bottom: "Out Of My Hands", top: "Handling It",
      corners: { tl: "Quiet And Steady", tr: "Busy But Handled", bl: "Quiet But Stuck", br: "Piling Up" },
    },
    hint: "Right for more going on. Up for more of it in your hands.",
    read: (d, c) => `${cap(say(["almost nothing going on", "a quiet week", "quieter than usual", "a normal amount going on", "more going on than usual", "a lot going on", "everything at once"], d))}, ${
      say(["and none of it in your hands", "and very little of it in your hands", "and a little of it in your hands", "and some of it in your hands", "and a fair amount in your hands", "and mostly handled", "and all of it handled"], c)}.`,
    strain: "A lot landing at once that you cannot steer is worth telling someone about.",
    feeling: { ask: "How did life away from sport feel this week?", low: "Weighing On Me", high: "Lifting Me Up" },
  };

  /* Family, money, health and everything else, for anyone not in school. */
  const PERSONAL_WORK = { ...PERSONAL, ask: "How much was going on away from sport and work, and how much of it could you handle your way?" };

  let DOMAINS = [TRAINING, SCHOOL, PERSONAL];

  /* Balanced across all four corners of the mood square on purpose. A list
     weighted toward the negative would quietly reintroduce a deficit model. */
  const EMOTIONS = {
    "Charged Up": ["Excited", "Energised", "Motivated", "Proud", "Confident", "Driven", "Hopeful", "Inspired"],
    "Settled": ["Calm", "Content", "Relaxed", "Grateful", "Satisfied", "Steady", "Relieved", "Rested"],
    "On Edge": ["Anxious", "Frustrated", "Overwhelmed", "Angry", "Restless", "Tense", "Pressured", "Resentful"],
    "Running Low": ["Drained", "Flat", "Lonely", "Discouraged", "Bored", "Numb", "Detached", "Defeated"],
  };

  /* One item per Athlete Burnout Questionnaire dimension, each answered in its
     own words. "Not At All" to "Completely" three times over invited the same
     answer three times over. Stored one to five in the same direction as before:
     higher is more worn out, more accomplished, and caring less. */
  const burnoutItems = (sport) => [
    {
      name: "abq_exhaustion",
      title: "Worn Out",
      prompt: "How worn out were you by everything this week asked of you?",
      options: ["Fresh", "A Bit Tired", "Worn Down", "Running On Empty", "Spent"],
    },
    {
      name: "abq_accomplishment",
      title: "Getting Somewhere",
      prompt: "How much did it feel like you were getting somewhere with what matters to you?",
      options: ["Going Nowhere", "Barely Moving", "Some Progress", "Real Progress", "Best In A While"],
    },
    {
      name: "abq_devaluation",
      title: "Still Caring",
      prompt: `Compared with usual, how much did you care about ${sport}?`,
      options: ["As Much As Ever", "Slightly Less", "Clearly Less", "Much Less", "Barely At All"],
    },
  ];

  const store = { emotions: [] };
  const pads = {};
  const weekKey = M.weekStartKey();

  document.getElementById("week-line").textContent = "Week Of " + M.prettyDate(weekKey);

  /* ---------------- domains ---------------- */

  function renderDomains() {
    document.getElementById("domains").innerHTML = DOMAINS.map(
      (d) => `<section class="section">
        <div class="section-header">${M.esc(d.label)}</div>
        <div class="card">
          <p class="body" style="margin-bottom:12px;">${M.esc(d.ask)}</p>
          ${M.padMarkup({ id: "pad-" + d.key, tint: "strain", ...d.pad, label: d.ask })}
          <p class="footnote secondary pad-read" id="read-${d.key}" aria-live="polite">${M.esc(d.hint || "")}</p>
        </div>
        <div class="card">
          <p class="body" style="margin-bottom:10px;">${M.esc(d.feeling.ask)}</p>
          ${M.scale({ name: "feeling_" + d.key, label: d.feeling.ask, lowLabel: d.feeling.low, highLabel: d.feeling.high })}
        </div>
      </section>`
    ).join("");

    DOMAINS.forEach((d) => {
      const read = document.getElementById("read-" + d.key);
      pads[d.key] = M.bindPad("pad-" + d.key, {
        xMin: 1, xMax: 7, yMin: 1, yMax: 7, step: 1,
        onChange: (demand, control) => {
          const strained = demand >= 5 && control <= 3;
          read.textContent = `${d.read(demand, control)}${strained ? " " + d.strain : ""}`;
          return strained ? "var(--red)" : "var(--green)";
        },
      });
    });
  }

  /* ---------------- burnout dimensions ---------------- */

  function renderBurnout(sport) {
    document.getElementById("burnout").innerHTML = burnoutItems(sport).map(
      (b, i) => `<div style="${i ? "margin-top:22px;" : ""}">
        <div class="card-title">${M.esc(b.title)}</div>
        <p class="footnote secondary" style="margin:-4px 0 10px;">${M.esc(b.prompt)}</p>
        ${M.wordScale({ name: b.name, options: b.options, label: b.title })}
      </div>`
    ).join("");
  }

  /* ---------------- extras ---------------- */

  function renderExtras() {
    document.getElementById("extras").innerHTML = `
      <div class="card-title">People Around You</div>
      <p class="footnote secondary" style="margin:-4px 0 10px;">How connected did you feel to teammates, friends, or family?</p>
      ${M.scale({ name: "social_connection", label: "People Around You", lowLabel: "On My Own", highLabel: "Well Supported" })}
      <p class="footnote secondary" style="margin:10px 0 20px;">This one counts toward your Life channel, because feeling cut off from people is linked with burnout.</p>
      <div class="card-title">Sleep This Week</div>
      <p class="footnote secondary" style="margin:-4px 0 10px;">How did your sleep feel, whatever a wearable measured?</p>
      ${M.scale({ name: "sleep_satisfaction", label: "Sleep This Week", lowLabel: "Restless", highLabel: "Slept Great" })}`;

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
  }

  /* ---------------- prefill ---------------- */

  function prefill() {
    return M.api("/api/checkin/weekly")
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
  }

  /* ---------------- who is answering ---------------- */

  /* Anyone not in school gets a work square instead, and the sport they named in
     setup is the one the caring question asks about. */
  function setUp(cal) {
    const student = !cal.audience || cal.audience === "college" || cal.audience === "highschool";
    DOMAINS = student ? [TRAINING, SCHOOL, PERSONAL] : [TRAINING, WORK, PERSONAL_WORK];
    const sport = String(cal.sport || "").trim();
    renderDomains();
    renderBurnout(sport ? sport.toLowerCase() : "your sport");
    renderExtras();
    M.bindScales(document.body, store);
    M.bindChips(document.getElementById("emotions"), store, "emotions");
    return prefill();
  }

  M.api("/api/me")
    .then((me) => setUp(me.calibration || {}))
    .catch(() => setUp({}));

  /* ---------------- save ---------------- */

  document.getElementById("save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const status = document.getElementById("status");

    const answered = DOMAINS.filter((d) => pads[d.key] && pads[d.key].get().x != null);
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
