/* Myaku — journal.
 *
 * The text is stored and never analysed. What counts toward the psychological
 * channel is the rating the person puts on the same square the daily check-in
 * uses, which makes the journal a second chance to answer that question rather
 * than a document to be mined. Running sentiment analysis over somebody's
 * private writing would be a different product, and a worse one.
 */

(function () {
  M.boot("log");

  const DOMAINS = ["Training", "Competition", "School", "Work", "Personal", "Social", "Health"];

  const key = M.todayKey();
  const entry = document.getElementById("entry");
  const status = document.getElementById("status");
  const readAffect = document.getElementById("read-affect");
  const clearBtn = document.getElementById("clear-affect");
  const store = { domains: [] };

  document.getElementById("date-line").textContent = M.prettyDate(key);

  document.getElementById("pad-affect").innerHTML = M.padMarkup({
    id: "affect-pad", tint: "affect",
    top: "Activated", bottom: "Calm", left: "Unpleasant", right: "Pleasant",
  });

  const affectPad = M.bindPad("affect-pad", {
    onChange: (valence, arousal) => {
      readAffect.textContent = M.affectPhrase(valence, arousal) + ".";
      clearBtn.hidden = false;
      return valence >= 0 ? "var(--green)" : arousal >= 0 ? "var(--orange)" : "var(--ch-cog)";
    },
  });

  clearBtn.addEventListener("click", () => {
    affectPad.clear();
    clearBtn.hidden = true;
    readAffect.textContent = "Optional, and skipping it still saves the entry.";
  });

  document.getElementById("domains").innerHTML = DOMAINS.map(
    (d) => `<button type="button" class="chip" data-chip="${M.esc(d)}" aria-pressed="false">${M.esc(d)}</button>`
  ).join("");
  M.bindChips(document.getElementById("domains"), store, "domains");

  M.api("/api/journal?date=" + key)
    .then(({ entry: e }) => {
      if (!e) return;
      entry.value = e.content || "";
      if (e.valence != null && e.arousal != null) affectPad.set(e.valence, e.arousal);
      if (e.domains) {
        store.domains = e.domains.split(",").filter(Boolean);
        document.querySelectorAll("#domains [data-chip]").forEach((b) => {
          b.setAttribute("aria-pressed", String(store.domains.includes(b.getAttribute("data-chip"))));
        });
      }
    })
    .catch(() => {});

  function loadPast() {
    M.api("/api/journal")
      .then(({ entries }) => {
        const past = entries.filter((e) => e.entry_date !== key && e.content);
        document.getElementById("past").innerHTML = past.length
          ? past
              .map((e) => {
                /* "Activated" alone covers two opposite quadrants, so the
                   label keeps both words and only drops the joining one. */
                const rated = e.valence != null && e.arousal != null
                  ? `<span class="row-value footnote">${M.esc(M.quadrant(e.valence, e.arousal).replace(" And ", " "))}</span>`
                  : "";
                return `<div class="row" style="align-items:flex-start;">
                  <span class="row-main">
                    <span class="row-title">${M.esc(M.prettyDate(e.entry_date))}</span>
                    <span class="row-sub">${M.esc(e.content.length > 160 ? e.content.slice(0, 160) + "…" : e.content)}</span>
                  </span>
                  ${rated}
                </div>`;
              })
              .join("")
          : `<div class="row"><span class="row-main"><span class="row-title secondary">Nothing written yet.</span></span></div>`;
      })
      .catch(() => {});
  }

  document.getElementById("save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const affect = affectPad.get();
    try {
      await M.api("/api/journal", {
        method: "POST",
        body: {
          date: key,
          content: entry.value,
          valence: affect.x,
          arousal: affect.y,
          domains: store.domains,
        },
      });
      status.textContent = affect.x == null
        ? "Saved."
        : "Saved, and the rating counts toward this week.";
      loadPast();
    } catch (err) {
      status.textContent = err.message;
    }
    btn.disabled = false;
  });

  loadPast();
})();
