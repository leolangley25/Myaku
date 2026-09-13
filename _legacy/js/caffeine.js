/* Myaku — Caffeine page extras: quick-add presets, daily total, decay chart. */

(function () {
  const PRESETS = [
    { label: "Coffee", amount: 95 },
    { label: "Espresso", amount: 64 },
    { label: "Tea", amount: 40 },
    { label: "Energy Drink", amount: 80 },
    { label: "Soda", amount: 35 },
  ];

  function nowTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  const presetRow = document.getElementById("caffeine-presets");
  presetRow.innerHTML = PRESETS.map(
    (p, i) => `<button class="preset-chip" data-index="${i}" type="button">${p.label}<span class="preset-chip-amount">${p.amount}mg</span></button>`
  ).join("");

  presetRow.querySelectorAll(".preset-chip").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const p = PRESETS[Number(btn.getAttribute("data-index"))];
      btn.disabled = true;
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "caffeine", label: p.label, amount: p.amount, loggedAt: nowTime() }),
      });
      btn.disabled = false;
      document.dispatchEvent(new CustomEvent("myaku:caffeine-preset-added"));
      refresh();
    });
  });

  function formatHourLabel(h) {
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}${period}`;
  }

  function decayCurve(entries) {
    const points = [];
    const labels = [];
    for (let hour = 6; hour <= 23.5; hour += 0.5) {
      let total = 0;
      entries.forEach((e) => {
        if (e.amount == null || !e.logged_at) return;
        const [eh, em] = String(e.logged_at).split(":").map(Number);
        const doseTime = eh + em / 60;
        const elapsed = hour - doseTime;
        if (elapsed >= 0) {
          total += e.amount * Math.pow(0.5, elapsed / 5);
        }
      });
      points.push(Math.round(total));
      labels.push(hour % 3 === 0 ? formatHourLabel(Math.floor(hour)) : "");
    }
    return { points, labels };
  }

  function renderTotal(entries) {
    const total = entries.reduce((sum, e) => sum + (e.amount || 0), 0);
    document.getElementById("caffeine-total-number").textContent = total;

    const level = total >= 400 ? "elevated" : total >= 200 ? "moderate" : "low";
    const label = total >= 400 ? "Above Typical Guidance" : total >= 200 ? "Moderate Today" : "Low Today";
    document.getElementById("caffeine-total-badge").innerHTML = `<span class="badge badge-${level}"><span class="badge-dot"></span>${label}</span>`;
  }

  function renderDecayChart(entries) {
    const chartEl = document.getElementById("caffeine-decay-chart");
    const captionEl = document.getElementById("caffeine-decay-caption");
    const dosedEntries = entries.filter((e) => e.amount != null && e.logged_at);

    if (!dosedEntries.length) {
      chartEl.innerHTML = `<p class="empty-note">Log a drink to see your caffeine curve for today.</p>`;
      captionEl.textContent = "";
      return;
    }

    const { points, labels } = decayCurve(dosedEntries);
    MyakuCharts.renderLineChart(chartEl, {
      labels,
      series: [{ name: "Caffeine In System", color: cssVar("--accent"), width: 2.5, values: points }],
      min: 0,
      max: Math.max(100, ...points),
      height: 200,
    });
    captionEl.textContent = "Caffeine above 50mg at bedtime may affect your sleep.";
  }

  function refresh() {
    fetch("/api/logs?type=caffeine")
      .then((r) => r.json())
      .then((data) => {
        const entries = data.entries || [];
        renderTotal(entries);
        renderDecayChart(entries);
      });
  }

  document.addEventListener("myaku:logs-updated", (e) => {
    if (e.detail && e.detail.type === "caffeine") {
      renderTotal(e.detail.entries);
      renderDecayChart(e.detail.entries);
    }
  });

  refresh();
})();
