/* Myaku — daily journal entry. */

(function () {
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function formatDateKey(key) {
    const d = new Date(key + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }

  const key = todayKey();
  document.getElementById("journal-date-label").textContent = formatDateKey(key);

  const textarea = document.getElementById("journal-entry");
  const savedNote = document.getElementById("journal-saved-note");

  fetch(`/api/journal?date=${key}`)
    .then((r) => r.json())
    .then((data) => {
      if (data.entry) textarea.value = data.entry.content || "";
    });

  document.getElementById("journal-save").addEventListener("click", async () => {
    await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: key, content: textarea.value }),
    });
    savedNote.style.display = "inline";
    setTimeout(() => (savedNote.style.display = "none"), 2000);
    loadPast();
  });

  function loadPast() {
    fetch("/api/journal")
      .then((r) => r.json())
      .then((data) => {
        const entries = (data.entries || []).filter((e) => e.entry_date !== key && e.content);
        const el = document.getElementById("journal-past");
        if (!entries.length) {
          el.innerHTML = `<p class="empty-note">You haven't written any journal entries yet.</p>`;
          return;
        }
        el.innerHTML = entries
          .map(
            (e) => `
            <div class="card" style="margin-bottom: 12px;">
              <div class="card-label">${formatDateKey(e.entry_date)}</div>
              <p class="page-intro">${esc(e.content.length > 220 ? e.content.slice(0, 220) + "…" : e.content)}</p>
            </div>
          `
          )
          .join("");
      });
  }

  loadPast();
})();
