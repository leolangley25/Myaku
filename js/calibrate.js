/* Myaku — onboarding calibration. Gives Channel P a day-one reference. */

(function () {
  const DOMAINS = [
    { key: "baseline_training", label: "Training Load" },
    { key: "baseline_academic", label: "Academic Load" },
    { key: "baseline_personal", label: "Personal Life" },
  ];

  const store = {};

  document.getElementById("baselines").innerHTML = DOMAINS.map(
    (d) => `<div class="card">
      <div class="card-title">${M.esc(d.label)}</div>
      ${M.scale({ name: d.key, lowLabel: "Very Low", highLabel: "Very High" })}
    </div>`
  ).join("");

  M.bindScales(document.body, store);

  document.getElementById("save").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
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
    }).catch(() => {});
    location.href = new URLSearchParams(location.search).get("from") === "more" ? "more.html" : "index.html";
  });
})();
