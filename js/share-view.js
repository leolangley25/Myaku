/* Myaku — the page a coach sees through a share link.
 *
 * Public and deliberately thin: a named state and nothing else. No raw channels,
 * no journal, no numbers. Moved out of an inline script so the content security
 * policy can refuse inline scripts everywhere.
 */

(function () {
  const token = new URLSearchParams(location.search).get("token");
  const view = document.getElementById("view");

  function fail(msg) {
    view.innerHTML = `<h1 class="large-title">Link Not Available</h1>
      <p class="nav-sub">${M.esc(msg)}</p>`;
  }

  if (!token) return fail("This link is invalid or has been removed.");

  const TONES = { good: "good", info: "info", warn: "warn", bad: "bad" };

  fetch("/api/share/public/" + encodeURIComponent(token))
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
    .then((d) => {
      view.innerHTML = `
        <h1 class="large-title">${M.esc(d.name)}</h1>
        <p class="nav-sub" style="margin-bottom:22px;">A limited summary, shared with you by them.</p>
        <div class="card">
          <div class="card-title">Where They Are</div>
          ${d.state ? M.pill(d.state, TONES[d.tone] || "warn") : M.pill("Still Calibrating", "info")}
          <p class="footnote secondary" style="margin-top:14px;">
            ${d.confidence === "established"
              ? "Based on several weeks of their own history, compared only against themselves."
              : "There is not enough history yet for this to mean very much."}
          </p>
        </div>
        <p class="footnote secondary" style="margin-top:16px;">
          This is all a share link shows. Their journal, their daily answers, and every underlying number stay private,
          and they can revoke this link at any time.
        </p>`;
    })
    .catch(() => fail("This link is invalid or has been removed."));
})();
