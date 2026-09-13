/* Myaku — onboarding.
 *
 * Six short steps: what this is, the privacy promise, body data, reminders, a
 * little calibration, and a first action. Every step past the second can be
 * skipped, because an onboarding flow that cannot be skipped is one people
 * abandon rather than finish.
 *
 * The step is remembered for the session, so the round trip to Whoop or Google
 * during step three lands back on step three instead of the start.
 */

(function () {
  const STEP_KEY = "myaku.welcome.step";
  const WORDS = ["One", "Two", "Three", "Four", "Five", "Six"];
  const LAST_SETUP_STEP = 4;

  const steps = [...document.querySelectorAll(".step")];
  const next = document.getElementById("next");
  const back = document.getElementById("back");
  const skip = document.getElementById("skip");
  const store = {};
  let step = 0;

  try {
    step = Math.min(steps.length - 1, Math.max(0, Number(sessionStorage.getItem(STEP_KEY)) || 0));
  } catch {
    step = 0;
  }

  const params = new URLSearchParams(location.search);
  if (params.get("connected") || params.get("error")) step = 2;

  /* ---------------- step rendering ---------------- */

  function show(index) {
    step = index;
    try {
      sessionStorage.setItem(STEP_KEY, String(step));
    } catch {
      /* the step just will not survive a reload */
    }

    steps.forEach((s, i) => (s.hidden = i !== step));
    document.querySelectorAll("#steps span").forEach((bar, i) => bar.classList.toggle("on", i <= Math.min(step, LAST_SETUP_STEP)));
    document.getElementById("step-count").textContent =
      step > LAST_SETUP_STEP ? "All Done" : `Step ${WORDS[step]} Of Five`;

    back.hidden = step === 0 || step > LAST_SETUP_STEP;
    skip.hidden = step < 2 || step > LAST_SETUP_STEP;
    next.hidden = step > LAST_SETUP_STEP;
    next.textContent = step === LAST_SETUP_STEP ? "Finish" : "Continue";
    document.getElementById("nav-buttons").hidden = step > LAST_SETUP_STEP;

    Motion.swapIn(steps[step]);
    const heading = steps[step].querySelector("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: Motion.reduced() ? "auto" : "smooth" });
  }

  /* ---------------- step three: body data ---------------- */

  const CONNECT_MESSAGES = {
    denied: "The connection was cancelled, so nothing was shared.",
    state: "That connection attempt expired, so please try again.",
    exchange: "The provider did not complete the connection, so please try again.",
    "not-configured": "That provider is not set up on this server yet.",
  };

  async function renderConnect() {
    const banner = document.getElementById("connect-banner");
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

    document.getElementById("connect-options").innerHTML = [
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

  /* ---------------- step four: reminders ---------------- */

  const pushStatus = document.getElementById("push-status");

  async function renderPush() {
    const blocked = M.push.blocker();
    const sub = await M.push.current().catch(() => null);
    if (sub) {
      pushStatus.className = "status-line ok";
      pushStatus.textContent = "Reminders are on for this device.";
      document.getElementById("push-on").textContent = "Reminders Are On";
    } else if (blocked) {
      pushStatus.className = "status-line";
      pushStatus.textContent = blocked;
    }
  }

  document.getElementById("push-on").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await M.push.subscribe();
      await M.api("/api/reminders", { method: "POST", body: { enabled: true, timezone: M.timezone() } });
      pushStatus.className = "status-line ok";
      pushStatus.textContent = "Reminders are on. You can change the times from More.";
      btn.textContent = "Reminders Are On";
    } catch (err) {
      pushStatus.className = "status-line error";
      pushStatus.textContent = err.message;
      btn.disabled = false;
    }
  });

  /* ---------------- step five: calibration ---------------- */

  const DOMAINS = [
    { key: "baseline_training", label: "Training Load" },
    { key: "baseline_academic", label: "Academic Load" },
    { key: "baseline_personal", label: "Personal Life" },
  ];

  document.getElementById("baselines").innerHTML = DOMAINS.map(
    (d) => `<div class="card">
      <div class="card-title">${M.esc(d.label)}</div>
      ${M.scale({ name: d.key, label: d.label, lowLabel: "Very Low", highLabel: "Very High" })}
    </div>`
  ).join("");
  M.bindScales(document.getElementById("baselines"), store);

  async function saveCalibration() {
    await M.api("/api/calibration", {
      method: "POST",
      body: {
        sport: document.getElementById("sport").value.trim(),
        trainingDays: document.getElementById("training-days").value || null,
        typicalBedtime: document.getElementById("bedtime").value || null,
        baselineTraining: store.baseline_training,
        baselineAcademic: store.baseline_academic,
        baselinePersonal: store.baseline_personal,
      },
    });
  }

  async function finish() {
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
    show(steps.length - 1);
  }

  /* ---------------- navigation ---------------- */

  next.addEventListener("click", async () => {
    if (step === LAST_SETUP_STEP) {
      next.disabled = true;
      await saveCalibration().catch(() => {});
      next.disabled = false;
      return finish();
    }
    show(step + 1);
  });

  back.addEventListener("click", () => show(Math.max(0, step - 1)));

  skip.addEventListener("click", () => {
    if (step === LAST_SETUP_STEP) return finish();
    show(step + 1);
  });

  M.api("/api/me")
    .then((me) => {
      if (me.calibration) {
        document.getElementById("sport").value = me.calibration.sport || "";
        document.getElementById("training-days").value = me.calibration.training_days ?? "";
        document.getElementById("bedtime").value = me.calibration.typical_bedtime || "";
      }
    })
    .catch(() => {});

  renderConnect();
  renderPush();
  show(step);
})();
