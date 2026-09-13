/* Myaku — onboarding calibration step, role-aware. */

(function () {
  const container = document.getElementById("baseline-domains");
  const selections = {};

  function renderDomains(role) {
    const domains = myakuDomainsForRole(role);

    container.innerHTML = domains
      .map(
        (d) => `
        <div class="domain-block" data-domain="${d.id}">
          <div class="domain-title">${d.title}</div>
          <div class="domain-prompt">${d.baselinePrompt}</div>
          <div class="scale">
            ${[1, 2, 3, 4, 5].map((n) => `<div class="scale-option" data-value="${n}">${n}</div>`).join("")}
          </div>
          <div class="scale-labels">
            <span>${MYAKU_DATA.scaleLabels[0]}</span>
            <span>${MYAKU_DATA.scaleLabels[4]}</span>
          </div>
        </div>
      `
      )
      .join("");

    container.querySelectorAll(".domain-block").forEach((block) => {
      const domainId = block.getAttribute("data-domain");
      block.querySelectorAll(".scale-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          block.querySelectorAll(".scale-option").forEach((o) => o.classList.remove("selected"));
          opt.classList.add("selected");
          selections[domainId] = Number(opt.getAttribute("data-value"));
        });
      });
    });
  }

  fetch("/api/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const role = data && data.user ? data.user.role : "student_athlete";
      renderDomains(role);

      if (role === "individual") {
        document.getElementById("athlete-fields").style.display = "none";
        document.getElementById("course-load-label").textContent = "Work Or School Load";
      }
    });

  document.getElementById("calibrate-submit").addEventListener("click", async () => {
    const sportField = document.getElementById("sport");
    const trainingDaysField = document.getElementById("training-days");

    const body = {
      sport: sportField.offsetParent ? sportField.value.trim() : null,
      trainingDaysPerWeek: trainingDaysField.offsetParent ? trainingDaysField.value || null : null,
      typicalBedtime: document.getElementById("bedtime").value || null,
      courseLoad: document.getElementById("course-load").value || null,
      baselineTrainingStress: selections.training || null,
      baselineAcademicStress: selections.academic || null,
      baselinePersonalStress: selections.personal || null,
    };

    await fetch("/api/calibration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    window.location.href = "connect.html";
  });
})();
