/* Myaku — how it works.
 *
 * The thresholds and pattern descriptions are read from the server rather than
 * copied here, so this page cannot drift out of step with the model it explains.
 */

(function () {
  M.boot("more");

  document.getElementById("channels").innerHTML = Object.entries(M.CHANNELS)
    .map(([key, meta]) => `<div class="intro-item">
      <span class="intro-dot" style="background:${meta.color}" aria-hidden="true"></span>
      <span><strong>${M.esc(meta.label)}.</strong> <span class="secondary">${M.esc(Explain.channelMeaning(key).measures)}</span></span>
    </div>`)
    .join("");

  const LEVEL_NAMES = { light: "Light", medium: "Medium", heavy: "Heavy" };

  M.api("/api/method")
    .then((m) => {
      document.getElementById("levels").innerHTML = ["heavy", "medium", "light"]
        .map((key) => {
          const l = m.levels[key];
          const current = key === m.sensitivity;
          return `<tr class="${current ? "current" : ""}">
            <td>${LEVEL_NAMES[key]}${current ? '<span class="sr-only"> (your setting)</span>' : ""}</td>
            <td>${l.notable}</td><td>${l.marked}</td><td>${l.gap}</td><td>${l.persistence}</td>
          </tr>`;
        })
        .join("");

      document.getElementById("states").innerHTML = Object.values(m.states)
        .map((s) => `<div class="row" style="align-items:flex-start;"><span class="row-main">
          <span class="row-title">${M.esc(s.name)}</span>
          <span class="row-sub">${M.esc(s.detail)}</span>
        </span></div>`)
        .join("");
    })
    .catch(() => {});
})();
