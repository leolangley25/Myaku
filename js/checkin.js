/* Myaku — daily micro check-in.
 *
 * Eight numbers, five gestures. Every pair that can share a square does, which
 * is the only way the psychological channel gets to be as detailed as the two
 * channels that collect themselves. Three of the eight exist specifically to be
 * compared against something measured: focus against the vigilance test, sleep
 * quality against the wearable, and control against the load it modifies.
 *
 * Three things keep the burden down. Quick mode asks only the first square,
 * which is the one the model cannot do without. A missed night can be logged the
 * next day. And a half-finished check-in is kept on the device, so leaving the
 * page to answer a message does not throw the answers away.
 */

(function () {
  M.boot("log");

  const ATTRIBUTIONS = [
    "Training", "Competition", "School", "Work",
    "Personal", "Social", "Money", "Health", "Nothing Specific",
  ];

  const MODE_KEY = "myaku.checkin.mode";
  const draftKey = (date) => `myaku.draft.checkin.${date}`;

  const store = { attribution: [], sleep_quality: null, motivation: null };
  let date = M.todayKey();
  let mode = readMode();
  let restoring = false;

  function readMode() {
    try {
      return localStorage.getItem(MODE_KEY) === "quick" ? "quick" : "full";
    } catch {
      return "full";
    }
  }

  /* ---------------- pads ---------------- */

  document.getElementById("pad-load").innerHTML = M.padMarkup({
    id: "load-pad", tint: "strain",
    top: "Full Say", bottom: "No Say", left: "Light", right: "Crushing",
    corners: { tl: "Chosen And Easy", tr: "Chosen And Hard", bl: "Quiet But Imposed", br: "Heavy And Imposed" },
  });

  document.getElementById("pad-state").innerHTML = M.padMarkup({
    id: "state-pad", tint: "state",
    top: "Sharp", bottom: "Foggy", left: "Empty", right: "Recovered",
    corners: { tl: "Tired But Clear", tr: "Firing", bl: "Flat", br: "Rested But Fuzzy" },
  });

  document.getElementById("pad-affect").innerHTML = M.padMarkup({
    id: "affect-pad", tint: "affect",
    top: "Wired", bottom: "Calm", left: "Unpleasant", right: "Pleasant",
  });

  const readLoad = document.getElementById("read-load");
  const readState = document.getElementById("read-state");
  const readAffect = document.getElementById("read-affect");

  const loadPad = M.bindPad("load-pad", {
    xMin: 0, xMax: 10, yMin: 0, yMax: 10, step: 1,
    onChange: (load, control) => {
      const strained = load >= 6 && control <= 4;
      readLoad.textContent = `Demand ${load} of 10, control ${control} of 10. ${
        strained ? "High demand with little say over it." : "Within a workable range."
      }`;
      changed();
      return strained ? "var(--red)" : "var(--green)";
    },
  });

  const statePad = M.bindPad("state-pad", {
    xMin: 0, xMax: 10, yMin: 0, yMax: 10, step: 1,
    onChange: (recovery, focus) => {
      readState.textContent = `Body ${recovery} of 10, head ${focus} of 10.`;
      changed();
      return focus <= 4 ? "var(--ch-cog)" : recovery <= 4 ? "var(--ch-auto)" : "var(--green)";
    },
  });

  const affectPad = M.bindPad("affect-pad", {
    onChange: (valence, arousal) => {
      readAffect.textContent = M.affectPhrase(valence, arousal) + ".";
      changed();
      return valence >= 0 ? "var(--green)" : arousal >= 0 ? "var(--orange)" : "var(--ch-cog)";
    },
  });

  /* ---------------- rows and chips ---------------- */

  document.getElementById("sleep-quality").outerHTML =
    M.scale({ name: "sleep_quality", min: 0, max: 10, label: "How Last Night Felt", lowLabel: "Awful", highLabel: "Perfect" })
      .replace(/<div class="scale-ends"[\s\S]*<\/div>\s*$/, "");
  document.getElementById("motivation").outerHTML =
    M.scale({ name: "motivation", min: 0, max: 10, label: "Wanting To Be There", lowLabel: "None", highLabel: "All In" })
      .replace(/<div class="scale-ends"[\s\S]*<\/div>\s*$/, "");

  const chipBox = document.getElementById("attribution");
  chipBox.innerHTML = ATTRIBUTIONS.map(
    (a) => `<button type="button" class="chip" data-chip="${M.esc(a)}" aria-pressed="false">${M.esc(a)}</button>`
  ).join("");

  M.bindScales(document.body, store, changed);
  M.bindChips(chipBox, store, "attribution", changed);

  /* ---------------- progress and drafts ---------------- */

  function answered() {
    const parts = [
      loadPad.get().x != null,
      statePad.get().x != null,
      affectPad.get().x != null,
      store.sleep_quality != null,
      store.motivation != null,
      store.attribution.length > 0,
    ];
    return mode === "quick" ? { done: parts[0] ? 1 : 0, total: 1 } : { done: parts.filter(Boolean).length, total: parts.length };
  }

  function renderProgress() {
    const { done, total } = answered();
    document.getElementById("progress-line").textContent =
      mode === "quick"
        ? done ? "Ready to save. Quick mode records just the first square." : "Quick mode asks only the first square."
        : `${done} of ${total} answered. Only the first square is required.`;
  }

  function changed() {
    renderProgress();
    if (restoring) return;
    try {
      localStorage.setItem(draftKey(date), JSON.stringify({
        load: loadPad.get(), state: statePad.get(), affect: affectPad.get(),
        sleep_quality: store.sleep_quality, motivation: store.motivation,
        attribution: store.attribution, at: Date.now(),
      }));
    } catch {
      /* storage can be unavailable in private browsing; the check-in still works */
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(draftKey(date));
    } catch {
      /* nothing to clear */
    }
  }

  function readDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey(date)) || "null");
      // A draft older than two days is a forgotten one, not a paused one.
      return d && Date.now() - d.at < 2 * 24 * 60 * 60 * 1000 ? d : null;
    } catch {
      return null;
    }
  }

  function selectScale(name, value) {
    if (value == null) return;
    const btn = document.querySelector(`[data-scale="${name}"][data-value="${value}"]`);
    if (btn) btn.click();
  }

  function apply(values) {
    restoring = true;
    if (values.load && values.load.x != null) loadPad.set(values.load.x, values.load.y);
    if (values.state && values.state.x != null) statePad.set(values.state.x, values.state.y);
    if (values.affect && values.affect.x != null) affectPad.set(values.affect.x, values.affect.y);
    selectScale("sleep_quality", values.sleep_quality);
    selectScale("motivation", values.motivation);
    M.setChips(chipBox, store, "attribution", values.attribution || []);
    restoring = false;
    renderProgress();
  }

  function reset() {
    [loadPad, statePad, affectPad].forEach((p) => p.clear());
    M.resetScales(document.body, store);
    M.setChips(chipBox, store, "attribution", []);
    readLoad.textContent = readState.textContent = readAffect.textContent = "Tap anywhere on the square.";
  }

  /* ---------------- day and mode ---------------- */

  function setMode(next) {
    mode = next;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* the choice just will not persist */
    }
    document.querySelectorAll("#mode-toggle [data-mode]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode))
    );
    document.querySelectorAll("[data-full-only]").forEach((s) => (s.hidden = mode === "quick"));
    document.getElementById("mode-sub").textContent =
      mode === "quick"
        ? "One square, for the days that are already too full. It still counts."
        : "Three squares and two rows. Each square carries two answers, so this stays under a minute.";
    renderProgress();
  }

  async function setDay(offset) {
    date = M.shiftKey(M.todayKey(), offset);
    document.querySelectorAll("#day-toggle [data-day]").forEach((b) =>
      b.setAttribute("aria-pressed", String(Number(b.dataset.day) === offset))
    );
    document.getElementById("date-line").textContent = M.prettyDate(date);
    document.getElementById("status").textContent = "";
    reset();
    await prefill();
  }

  document.querySelectorAll("#mode-toggle [data-mode]").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode))
  );
  document.querySelectorAll("#day-toggle [data-day]").forEach((b) =>
    b.addEventListener("click", () => setDay(Number(b.dataset.day)))
  );

  /* ---------------- load existing ---------------- */

  async function prefill() {
    const status = document.getElementById("status");
    try {
      const { entry } = await M.api("/api/checkin/daily?date=" + date);
      if (entry) {
        apply({
          load: { x: entry.load_0_10, y: entry.control_0_10 },
          state: { x: entry.recovery_0_10, y: entry.focus_0_10 },
          affect: { x: entry.valence, y: entry.arousal },
          sleep_quality: entry.sleep_quality_0_10,
          motivation: entry.motivation_0_10,
          attribution: entry.attribution ? entry.attribution.split(",").filter(Boolean) : [],
        });
        status.textContent = "Already saved for this day, and saving again will replace it.";
        return;
      }
      const draft = readDraft();
      if (draft) {
        apply(draft);
        status.textContent = "Picked up where you left off.";
      }
    } catch {
      /* handled by the api layer */
    }
    renderProgress();
  }

  /* ---------------- save ---------------- */

  document.getElementById("save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const status = document.getElementById("status");

    const load = loadPad.get();
    const state = statePad.get();
    const affect = affectPad.get();

    /* The first square is the one the psychological channel cannot do without,
       so it is the only one that blocks a save. Everything else is allowed to
       be left blank rather than guessed at, because a made-up seven is worse
       than a missing value the model knows to skip. */
    if (load.x == null) {
      status.textContent = "Set the first square before saving.";
      document.getElementById("load-pad").focus();
      return;
    }

    const quick = mode === "quick";
    btn.disabled = true;
    try {
      await M.api("/api/checkin/daily", {
        method: "POST",
        body: {
          date,
          load: load.x, control: load.y,
          recovery: quick ? null : state.x, focus: quick ? null : state.y,
          valence: quick ? null : affect.x, arousal: quick ? null : affect.y,
          sleepQuality: quick ? null : store.sleep_quality,
          motivation: quick ? null : store.motivation,
          attribution: quick ? [] : store.attribution,
        },
      });
      clearDraft();
      status.textContent = "Saved.";
      setTimeout(() => (location.href = "index.html"), 500);
    } catch (err) {
      status.textContent = err.message;
      btn.disabled = false;
    }
  });

  setMode(mode);
  prefill();
})();
