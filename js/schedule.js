/* Myaku — the schedule and the weeks where it collides.
 *
 * The page is the same in either direction: a calendar comes in, typed events go
 * out, and the weeks ahead are drawn against this athlete's own ordinary week.
 */

(function () {
  M.boot("log");

  const KINDS = [
    { id: "game", label: "Game" },
    { id: "practice", label: "Practice" },
    { id: "lift", label: "Lift" },
    { id: "travel", label: "Travel" },
    { id: "exam", label: "Exam" },
    { id: "deadline", label: "Deadline" },
    { id: "class", label: "Class" },
    { id: "other", label: "Other" },
  ];

  const TONE = {
    game: "var(--ch-auto)",
    practice: "var(--ch-auto)",
    lift: "var(--ch-auto)",
    travel: "var(--ch-cog)",
    exam: "var(--ch-psy)",
    deadline: "var(--ch-psy)",
    class: "var(--outline)",
    other: "var(--outline)",
  };

  let kind = "game";
  const $ = (id) => document.getElementById(id);

  function setStatus(el, tone, text) {
    el.className = `status-line${tone ? " " + tone : ""}`;
    el.textContent = text;
  }

  const label = (id) => (KINDS.find((k) => k.id === id) || { label: "Other" }).label;

  /* ---------------- the weeks ahead ---------------- */

  function renderSqueeze(season) {
    const strip = $("week-strip");
    if (!season.weeks.length) return;
    $("squeeze-section").hidden = false;

    const peak = Math.max(1, ...season.weeks.map((w) => w.score));
    strip.innerHTML = season.weeks
      .map((w, i) => {
        const height = Math.max(6, Math.round((w.score / peak) * 100));
        const when = i === 0 ? "Next Seven Days" : `Week ${i + 1}`;
        return `<div class="week-col${w.squeeze ? " squeeze" : ""}">
          <span class="week-bar" style="height:${height}%"></span>
          <span class="week-label">${when}</span>
          <span class="week-sub">${M.esc(summary(w.counts))}</span>
        </div>`;
      })
      .join("");

    const next = season.next;
    $("squeeze-headline").innerHTML = next
      ? `<div class="card-title">Busy Week Coming</div>
         <p class="body" style="margin-top:6px;">${M.esc(M.prettyDate(next.start))} to ${M.esc(M.prettyDate(next.end))}, with ${M.esc(summary(next.counts))}.</p>
         <p class="footnote secondary" style="margin-top:6px;">That is heavier than your usual week, and the hard days fall on ${next.hardDays} of them.</p>`
      : `<div class="card-title">Nothing Stacked Up</div>
         <p class="body" style="margin-top:6px;">No week ahead looks heavier than your usual one.</p>`;

    $("typical-note").textContent = season.typical.score
      ? `Your usual week scores about ${season.typical.score}, from the ${season.typical.weeks} weeks already in your calendar.`
      : "A few more weeks of calendar are needed before your usual week can be worked out.";
  }

  function summary(counts) {
    const parts = Object.entries(counts || {})
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${label(k).toLowerCase()}${n === 1 ? "" : "s"}`);
    return parts.length ? parts.join(", ") : "nothing scheduled";
  }

  function renderResponses(responses) {
    if (!responses.length) return;
    $("response-section").hidden = false;
    $("responses").innerHTML = responses
      .map((r) => {
        const less = r.deltaMinutes < 0;
        return M.row({
          title: `${label(r.kind)} Days`,
          sub: `Across ${r.nights} nights, against every other night.`,
          value: `${less ? "−" : "+"}${Math.abs(r.deltaMinutes)}m`,
        });
      })
      .join("");
  }

  /* ---------------- events ---------------- */

  function renderEvents(list, today) {
    const upcoming = list.filter((e) => (e.end_date || e.date) >= today).slice(0, 40);
    $("events").innerHTML = upcoming.length
      ? upcoming
          .map(
            (e) => `<div class="row">
              <span class="zone-dot" style="background:${TONE[e.kind] || "var(--outline)"};" aria-hidden="true"></span>
              <span class="row-main">
                <span class="row-title">${M.esc(e.title || label(e.kind))}</span>
                <span class="row-sub">${M.esc(label(e.kind))} · ${M.esc(M.prettyDate(e.date))}${e.end_date ? ` to ${M.esc(M.prettyDate(e.end_date))}` : ""}${e.start_time ? ` · ${M.esc(e.start_time)}` : ""}</span>
              </span>
              <button type="button" class="btn btn-danger btn-sm" data-remove="${e.id}" aria-label="Remove ${M.esc(e.title || label(e.kind))}">Remove</button>
            </div>`
          )
          .join("")
      : `<div class="row"><span class="row-main"><span class="row-title secondary">Nothing on the calendar yet.</span></span></div>`;

    document.querySelectorAll("[data-remove]").forEach((b) =>
      b.addEventListener("click", async () => {
        await M.api("/api/events/" + b.dataset.remove, { method: "DELETE" }).catch(() => {});
        load();
      })
    );
  }

  function renderKinds() {
    $("kind-chips").innerHTML = KINDS.map(
      (k) => `<button type="button" class="chip" data-kind="${k.id}" aria-pressed="${k.id === kind}">${k.label}</button>`
    ).join("");
    document.querySelectorAll("[data-kind]").forEach((b) =>
      b.addEventListener("click", () => {
        kind = b.dataset.kind;
        renderKinds();
      })
    );
  }

  /* ---------------- importing ---------------- */

  async function importCalendar(body) {
    const status = $("cal-status");
    setStatus(status, "", "Reading that calendar.");
    try {
      const r = await M.api("/api/calendar/import", { method: "POST", body });
      setStatus(status, "ok", `Imported ${r.count} entr${r.count === 1 ? "y" : "ies"}.`);
      load();
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

  $("event-add").addEventListener("click", async () => {
    const status = $("event-status");
    const date = $("event-date").value;
    if (!date) return setStatus(status, "error", "Pick a date for it first.");
    try {
      await M.api("/api/events", {
        method: "POST",
        body: { date, endDate: $("event-end").value || null, kind, title: $("event-title").value.trim() || null },
      });
      $("event-title").value = "";
      setStatus(status, "ok", "Added to your schedule.");
      load();
    } catch (err) {
      setStatus(status, "error", err.message);
    }
  });

  /* ---------------- load ---------------- */

  function load() {
    Promise.all([M.api("/api/events"), M.api("/api/schedule")])
      .then(([events, season]) => {
        renderEvents(events.events, events.today);
        renderSqueeze(season);
        renderResponses(season.responses || []);
      })
      .catch(() => {});
  }

  renderKinds();
  load();
})();
