/* Myaku — the assistant, as a conversation.
 *
 * The thread lives in this tab and nowhere else: nothing is stored on the server,
 * so closing the page ends it. Each question is sent with the last few turns for
 * context and nothing more.
 *
 * When a model is running on this machine the assistant is already on, because
 * nothing leaves the device. A hosted model is a different promise, so that case
 * asks first.
 */

(function () {
  M.boot("ask");

  const STARTERS = [
    "What is my pattern telling me?",
    "What changed this week?",
    "How sure is this reading?",
    "What should I do about it?",
  ];

  const WHERE = {
    local: "Answers come from a model on this computer. Your readings never leave it, and no company sees them.",
    anthropic: "Asking sends a summary of your readings to Anthropic, the company that makes the model. Your journal, your name and your email are never included.",
    none: "No model is set up on this server, so the assistant shows you the reading itself rather than an answer.",
  };

  let turns = [];
  let busy = false;
  let engine = { provider: "none", model: null, onDevice: false, enabled: false, needsConsent: false };

  const $ = (id) => document.getElementById(id);

  function setStatus(tone, text) {
    const el = $("status");
    el.className = `status-line${tone ? " " + tone : ""}`;
    el.textContent = text;
  }

  /* ---------------- the engine, and what it promises ---------------- */

  function renderEngine() {
    $("engine-pill").innerHTML = engine.onDevice
      ? M.pill("On This Device", "good")
      : engine.provider === "anthropic"
        ? M.pill("Sent To Anthropic", "info")
        : M.pill("No Model", "warn");

    $("engine-line").textContent = !engine.enabled
      ? "Switched off. Turn it on from the settings button."
      : engine.model
        ? engine.onDevice
          ? `${engine.model}, running on this computer.`
          : `${engine.model}, answering from a summary of your readings.`
        : "No model is set up, so you will see the reading itself.";

    $("assistant-switch").checked = !!engine.enabled;
    $("switch-sub").textContent = engine.enabled ? "On, and answering from your own numbers." : "Off. Nothing is sent anywhere.";
    $("privacy-line").textContent = WHERE[engine.provider] || WHERE.none;

    $("question").disabled = !engine.enabled;
    $("send").disabled = !engine.enabled;
    $("starters").hidden = !engine.enabled || turns.length > 0;
  }

  async function setEnabled(on) {
    try {
      await M.api("/api/assistant/consent", { method: "POST", body: { enabled: on } });
      engine.enabled = on;
      renderEngine();
      setStatus("", on ? "" : "Switched off.");
    } catch (err) {
      setStatus("error", err.message);
      $("assistant-switch").checked = engine.enabled;
    }
  }

  /* ---------------- the thread ---------------- */

  function bubble(turn) {
    if (turn.role === "user") {
      return `<div class="msg msg-you"><div class="bubble">${M.esc(turn.content)}</div></div>`;
    }
    if (turn.pending) {
      return `<div class="msg msg-myaku"><div class="bubble typing" aria-label="Thinking">
        <span></span><span></span><span></span>
      </div></div>`;
    }
    const body = M.esc(turn.content)
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, "<br />")}</p>`)
      .join("");
    /* The disclaimer lives here rather than inside the answer, so the answer can
       be direct and the caveat is still on every single one. */
    return `<div class="msg msg-myaku">
      <div class="bubble">${body}</div>
      <span class="msg-note">Not medical advice, and it can be wrong.${turn.note ? ` ${M.esc(turn.note)}` : ""}</span>
    </div>`;
  }

  function renderThread() {
    $("intro").hidden = turns.length > 0;
    $("thread").innerHTML = turns.map(bubble).join("");
    $("starters").hidden = !engine.enabled || turns.length > 0;
    const scroller = $("chat-scroll");
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: Motion.reduced() ? "auto" : "smooth" });
  }

  function renderStarters() {
    $("starters").innerHTML = STARTERS.map(
      (s) => `<button type="button" class="chat-starter" data-ask="${M.esc(s)}">${M.esc(s)}</button>`
    ).join("");
    document.querySelectorAll("[data-ask]").forEach((b) =>
      b.addEventListener("click", () => {
        $("question").value = b.dataset.ask;
        send();
      })
    );
  }

  async function send() {
    if (busy || !engine.enabled) return;
    const question = $("question").value.trim();
    if (!question) return setStatus("error", "Type a question first.");

    busy = true;
    $("send").disabled = true;
    setStatus("", engine.onDevice ? "Thinking on this computer, which can take a moment." : "Reading your pages.");

    turns.push({ role: "user", content: question });
    turns.push({ role: "assistant", pending: true });
    $("question").value = "";
    $("question").style.height = "auto";
    renderThread();

    try {
      const history = turns.filter((t) => !t.pending).slice(0, -1).slice(-6);
      const r = await M.api("/api/assistant", { method: "POST", body: { question, history } });
      turns = turns.filter((t) => !t.pending);
      turns.push({
        role: "assistant",
        content: r.answer,
        note: r.onDevice ? "Answered on this device." : r.model ? "Answered from your own readings." : "",
      });
      setStatus("", "");
    } catch (err) {
      turns = turns.filter((t) => !t.pending);
      turns.pop();
      setStatus("error", err.message);
    }
    renderThread();
    busy = false;
    $("send").disabled = !engine.enabled;
    $("question").focus();
  }

  /* ---------------- wiring ---------------- */

  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });

  /* Enter sends, and shift with it starts a new line, the way a chat box does. */
  $("question").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  $("question").addEventListener("input", (e) => {
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  });

  $("settings-open").addEventListener("click", (e) => {
    const panel = $("settings-panel");
    panel.hidden = !panel.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
  });

  $("assistant-switch").addEventListener("change", (e) => setEnabled(e.target.checked));

  $("clear").addEventListener("click", () => {
    turns = [];
    renderThread();
    setStatus("", "");
  });

  renderStarters();
  renderEngine();

  M.api("/api/assistant/status")
    .then((s) => {
      engine = s;
      renderEngine();
      if (s.needsConsent) {
        $("settings-panel").hidden = false;
        $("settings-open").setAttribute("aria-expanded", "true");
        setStatus("", "Turn it on to start asking.");
      }
    })
    .catch(() => {});
})();
