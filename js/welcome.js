/* Myaku — setup.
 *
 * The point of this flow is that nobody lands on an empty app. By the end of it a
 * channel already has something to compare against: the wearable backfill gives
 * Body months of history in one step, the usual levels give Life a reference from
 * today, and the sleep answers give the caffeine zones and the short-night line
 * something real to work from.
 *
 * Every step past the second can be skipped, because an onboarding flow that
 * cannot be skipped is one people abandon rather than finish. What is answered is
 * saved as it goes, so a flow abandoned halfway still leaves a better start than
 * no flow at all.
 */

(function () {
  const STEP_KEY = "myaku.welcome.step";
  const WORDS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  const LAST_SETUP_STEP = 8;
  const TOTAL_LABEL = "Nine";

  const steps = [...document.querySelectorAll(".step")];
  const next = document.getElementById("next");
  const back = document.getElementById("back");
  const skip = document.getElementById("skip");
  const store = {};
  let step = 0;
  let audience = "college";
  let seasonPhase = "inseason";
  let sleepGoal = 480;

  /* Who the app is for. The model never changes; the wording and the questions
     around it do, because a club swimmer has no semester and a masters runner has
     no coach setting their week. */
  const AUDIENCES = [
    { id: "college", title: "College Athlete", sub: "A full season, a team schedule, and classes on top of it." },
    { id: "highschool", title: "High School Athlete", sub: "School, practice, and a body still growing." },
    { id: "club", title: "Club Or Travel Team", sub: "Training and competing outside a school season." },
    { id: "recreational", title: "Training On My Own", sub: "Your own plan, your own schedule, no team calendar." },
    { id: "masters", title: "Masters Athlete", sub: "Competing around work and everything else." },
  ];

  const PHASES = [
    { id: "preseason", label: "Preseason" },
    { id: "inseason", label: "In Season" },
    { id: "postseason", label: "Postseason" },
    { id: "offseason", label: "Off Season" },
  ];

  /* Adults are advised seven hours or more, and teenagers eight to ten, so the
     choices and the default move with who is using it. */
  const GOALS = [
    { minutes: 420, label: "7 h" },
    { minutes: 450, label: "7.5 h" },
    { minutes: 480, label: "8 h" },
    { minutes: 510, label: "8.5 h" },
    { minutes: 540, label: "9 h" },
  ];

  const isStudent = () => audience === "college" || audience === "highschool";

  const DOMAINS = () => [
    { key: "baseline_training", label: "Training Load" },
    { key: "baseline_academic", label: isStudent() ? "Academic Load" : "Work Or Study Load" },
    { key: "baseline_personal", label: "Personal Life" },
  ];

  const $ = (id) => document.getElementById(id);

  function setStatus(el, tone, text) {
    el.className = `status-line${tone ? " " + tone : ""}`;
    el.textContent = text;
  }

  try {
    step = Math.min(steps.length - 1, Math.max(0, Number(sessionStorage.getItem(STEP_KEY)) || 0));
  } catch {
    step = 0;
  }

  const params = new URLSearchParams(location.search);
  if (params.get("connected") || params.get("error")) step = 3;

  /* ---------------- step rendering ---------------- */

  $("steps").innerHTML = Array.from({ length: LAST_SETUP_STEP + 1 }, () => "<span></span>").join("");

  function show(index) {
    step = index;
    try {
      sessionStorage.setItem(STEP_KEY, String(step));
    } catch {
      /* the step just will not survive a reload */
    }

    steps.forEach((s, i) => (s.hidden = i !== step));
    document.querySelectorAll("#steps span").forEach((bar, i) => bar.classList.toggle("on", i <= Math.min(step, LAST_SETUP_STEP)));
    $("step-count").textContent = step > LAST_SETUP_STEP ? "All Done" : `Step ${WORDS[step]} Of ${TOTAL_LABEL}`;

    back.hidden = step === 0 || step > LAST_SETUP_STEP;
    skip.hidden = step < 3 || step > LAST_SETUP_STEP;
    next.hidden = step > LAST_SETUP_STEP;
    next.textContent = step === LAST_SETUP_STEP ? "Finish" : "Continue";
    $("nav-buttons").hidden = step > LAST_SETUP_STEP;

    if (step === 6) renderBaselines();

    Motion.swapIn(steps[step]);
    const heading = steps[step].querySelector("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: Motion.reduced() ? "auto" : "smooth" });
  }

  /* ---------------- step two: audience ---------------- */

  function renderAudience() {
    $("audience-options").innerHTML = AUDIENCES.map(
      (a) => `<button type="button" class="option" data-audience="${a.id}" aria-pressed="${a.id === audience}">
        <span class="intro-dot" style="background:${a.id === audience ? "var(--primary)" : "var(--outline)"}" aria-hidden="true"></span>
        <span class="row-main"><span class="row-title">${a.title}</span><span class="row-sub">${a.sub}</span></span>
      </button>`
    ).join("");
    document.querySelectorAll("[data-audience]").forEach((b) =>
      b.addEventListener("click", () => {
        audience = b.dataset.audience;
        if (audience === "highschool") sleepGoal = 540;
        renderAudience();
        renderGoals();
      })
    );
  }

  /* ---------------- step three: body data ---------------- */

  const CONNECT_MESSAGES = {
    denied: "The connection was cancelled, so nothing was shared.",
    state: "That connection attempt expired, so please try again.",
    exchange: "The provider did not complete the connection, so please try again.",
    "not-configured": "That provider is not set up on this server yet.",
  };

  async function renderConnect() {
    const banner = $("connect-banner");
    if (params.get("connected")) {
      banner.innerHTML = `<div class="banner ok">Connected. Your past data is importing in the background.</div>`;
    } else if (params.get("error")) {
      banner.innerHTML = `<div class="banner error">${M.esc(CONNECT_MESSAGES[params.get("error")] || "The connection did not complete, so please try again.")}</div>`;
    }

    let providers = [];
    try {
      ({ providers } = await M.api("/api/integrations"));
    } catch {
      return;
    }

    const oauth = providers.filter((p) => p.kind === "oauth");
    const option = ({ href, title, sub, dot, disabled }) => `
      <${disabled ? "div" : "a"} class="option" ${disabled ? 'aria-disabled="true"' : `href="${href}"`}>
        <span class="intro-dot" style="background:${dot}" aria-hidden="true"></span>
        <span class="row-main"><span class="row-title">${M.esc(title)}</span><span class="row-sub">${M.esc(sub)}</span></span>
        ${disabled ? "" : '<span class="chevron" aria-hidden="true"></span>'}
      </${disabled ? "div" : "a"}>`;

    $("connect-options").innerHTML = [
      ...oauth.map((p) =>
        option({
          href: `/api/integrations/${p.id}/start?return=welcome`,
          title: p.connected ? `${p.label} Connected` : `Connect ${p.label}`,
          sub: p.connected
            ? "Connected. You can manage it later from Data Sources."
            : p.available
              ? p.id === "google" ? "For Fitbit Air, Fitbit, and Pixel Watch." : "Recovery, sleep, and heart rate variability."
              : "Not set up on this server yet, so this option is unavailable.",
          dot: p.id === "whoop" ? "var(--ch-auto)" : "var(--ch-cog)",
          disabled: !p.available || p.connected,
        })
      ),
      option({
        href: "sources.html?from=welcome",
        title: "Import From Apple Health",
        sub: "Upload the export file from the Health app on your iPhone.",
        dot: "var(--ch-psy)",
      }),
    ].join("");
  }

  /* ---------------- steps five and six: the week and the night ---------------- */

  function renderPhases() {
    $("phase-chips").innerHTML = PHASES.map(
      (p) => `<button type="button" class="chip" data-phase="${p.id}" aria-pressed="${p.id === seasonPhase}">${p.label}</button>`
    ).join("");
    document.querySelectorAll("[data-phase]").forEach((b) =>
      b.addEventListener("click", () => {
        seasonPhase = b.dataset.phase;
        renderPhases();
      })
    );
  }

  function renderGoals() {
    $("goal-chips").innerHTML = GOALS.map(
      (g) => `<button type="button" class="chip" data-goal="${g.minutes}" aria-pressed="${g.minutes === sleepGoal}">${g.label}</button>`
    ).join("");
    document.querySelectorAll("[data-goal]").forEach((b) =>
      b.addEventListener("click", () => {
        sleepGoal = Number(b.dataset.goal);
        renderGoals();
      })
    );
    $("goal-note").textContent = isStudent() && audience === "highschool"
      ? "Teenagers are advised eight to ten hours, which is more than most schedules allow for."
      : "Adults are advised seven hours or more. Myaku measures your nights against whatever you set here.";
  }

  function renderBaselines() {
    $("baselines").innerHTML = DOMAINS()
      .map(
        (d) => `<div class="card">
          <div class="card-title">${M.esc(d.label)}</div>
          ${M.scale({ name: d.key, label: d.label, lowLabel: "Very Low", highLabel: "Very High" })}
        </div>`
      )
      .join("");
    M.bindScales($("baselines"), store);
  }

  /* ---------------- step eight: the calendar ---------------- */

  async function importCalendar(body) {
    const status = $("cal-status");
    setStatus(status, "", "Reading that calendar.");
    try {
      const r = await M.api("/api/calendar/import", { method: "POST", body });
      setStatus(status, "ok", `Imported ${r.count} entr${r.count === 1 ? "y" : "ies"}.`);
    } catch (err) {
      setStatus(status, "error", err.message);
    }
  }

  $("cal-import").addEventListener("click", () => {
    const url = $("cal-url").value.trim();
    if (!url) return setStatus($("cal-status"), "error", "Paste a calendar link first.");
    importCalendar({ url });
  });

  $("cal-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 5_000_000) return setStatus($("cal-status"), "error", "That file is too large to import.");
    importCalendar({ text: await file.text() });
    e.target.value = "";
  });

  /* ---------------- step nine: reminders ---------------- */

  const pushStatus = $("push-status");

  async function renderPush() {
    const blocked = M.push.blocker();
    const sub = await M.push.current().catch(() => null);
    if (sub) {
      setStatus(pushStatus, "ok", "Reminders are on for this device.");
      $("push-on").textContent = "Reminders Are On";
    } else if (blocked) {
      setStatus(pushStatus, "", blocked);
    }
  }

  $("push-on").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await M.push.subscribe();
      await M.api("/api/reminders", { method: "POST", body: { enabled: true, timezone: M.timezone() } });
      setStatus(pushStatus, "ok", "Reminders are on. You can change the times from More.");
      btn.textContent = "Reminders Are On";
    } catch (err) {
      setStatus(pushStatus, "error", err.message);
      btn.disabled = false;
    }
  });

  /* ---------------- saving ---------------- */

  /* Saved as it goes rather than at the end, so an abandoned setup still leaves
     the app with something to compare against. */
  function saveSetup() {
    return M.api("/api/setup", {
      method: "POST",
      body: {
        audience,
        seasonPhase,
        sport: $("sport").value.trim(),
        trainingDays: $("training-days").value || null,
        typicalBedtime: $("bedtime").value || null,
        wakeTime: $("waketime").value || null,
        sleepGoalMinutes: sleepGoal,
        baselineTraining: store.baseline_training,
        baselineAcademic: store.baseline_academic,
        baselinePersonal: store.baseline_personal,
      },
    }).catch(() => {});
  }

  function renderSummary(me) {
    const cal = (me && me.calibration) || {};
    const lines = [];
    if (cal.sport) lines.push(`Sport: ${cal.sport}`);
    if (cal.training_days != null) lines.push(`Training days: ${cal.training_days} a week`);
    if (cal.typical_bedtime) lines.push(`Bedtime: ${cal.typical_bedtime}`);
    if (cal.sleep_goal_minutes) lines.push(`Sleep goal: ${(cal.sleep_goal_minutes / 60).toFixed(1)} hours`);
    if (cal.baseline_training) lines.push("Usual Levels Recorded");
    const connected = (me && me.integrations ? me.integrations : []).filter((i) => i.provider !== "calendar").length;
    if (connected) lines.push(`${connected} body data source connected`);

    $("baseline-summary").innerHTML = lines.length
      ? `<div class="card"><div class="card-title">What Myaku Starts With</div>
         <div class="group" style="margin-top:8px;">${lines.map((l) => `<div class="row"><span class="row-main"><span class="row-title">${M.esc(l)}</span></span></div>`).join("")}</div></div>`
      : "";
  }

  async function finish() {
    await saveSetup();
    try {
      await M.api("/api/onboarding/complete", { method: "POST" });
    } catch {
      /* the api layer handles a signed-out session */
    }
    try {
      sessionStorage.removeItem(STEP_KEY);
    } catch {
      /* nothing to remove */
    }
    M.api("/api/me").then(renderSummary).catch(() => {});
    show(steps.length - 1);
  }

  /* ---------------- navigation ---------------- */

  next.addEventListener("click", async () => {
    if (step === LAST_SETUP_STEP) {
      next.disabled = true;
      await finish();
      next.disabled = false;
      return;
    }
    /* The three steps that collect answers save them before moving on. */
    if (step === 1 || step === 4 || step === 5 || step === 6) await saveSetup();
    show(step + 1);
  });

  back.addEventListener("click", () => show(Math.max(0, step - 1)));

  skip.addEventListener("click", () => {
    if (step === LAST_SETUP_STEP) return finish();
    show(step + 1);
  });

  M.api("/api/me")
    .then((me) => {
      const cal = me.calibration || {};
      if (cal.audience) audience = cal.audience;
      if (cal.season_phase) seasonPhase = cal.season_phase;
      if (cal.sleep_goal_minutes) sleepGoal = cal.sleep_goal_minutes;
      $("sport").value = cal.sport || "";
      $("training-days").value = cal.training_days ?? "";
      $("bedtime").value = cal.typical_bedtime || "";
      $("waketime").value = cal.wake_time || "";
      renderAudience();
      renderGoals();
    })
    .catch(() => {});

  renderAudience();
  renderPhases();
  renderGoals();
  renderConnect();
  renderPush();
  show(step);
})();
