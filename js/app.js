/* Myaku — per-page rendering and interactivity. */

(function () {
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function badgeClassForLevel(level) {
    return { low: "badge-low", moderate: "badge-moderate", elevated: "badge-elevated", neutral: "badge-neutral", accent: "badge-accent" }[level] || "badge-neutral";
  }

  function readinessLevel(score) {
    if (score >= 75) return { level: "low", label: "Training Ready" };
    if (score >= 50) return { level: "moderate", label: "Monitor Closely" };
    return { level: "elevated", label: "Needs Recovery" };
  }

  function badgeHTML(level, label) {
    return `<span class="badge ${badgeClassForLevel(level)}"><span class="badge-dot"></span>${label}</span>`;
  }

  function getGreeting() {
    const h = new Date().getHours();
    if (h < 5) return "Good Night";
    if (h < 12) return "Good Morning";
    if (h < 17) return "Good Afternoon";
    if (h < 21) return "Good Evening";
    return "Good Night";
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function insightCardHTML(insight) {
    return `
      <div class="card insight-card">
        <div class="insight-top">
          <div class="insight-finding">${insight.finding}</div>
          ${badgeHTML(insight.tagLevel, insight.tag)}
        </div>
        <div class="insight-support">${insight.support}</div>
      </div>
    `;
  }

  /* ---------------- Dashboard ---------------- */

  function renderDashboard() {
    const dateEl = document.getElementById("today-date");
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    }

    const daily = MYAKU_DATA.dailyReadiness;
    const todayScore = daily[daily.length - 1].score;
    document.getElementById("readiness-number").textContent = todayScore;

    const rLevel = readinessLevel(todayScore);
    document.getElementById("readiness-badge").innerHTML = badgeHTML(rLevel.level, rLevel.label);

    MyakuCharts.renderSparkline(
      document.getElementById("readiness-sparkline"),
      daily.map((d) => d.score),
      cssVar("--accent")
    );

    const breakdownEl = document.getElementById("readiness-breakdown");
    breakdownEl.innerHTML = MYAKU_DATA.readinessBreakdown
      .map(
        (item) => `
        <div class="metric-row" style="flex-direction: column; align-items: flex-start; gap: 3px;">
          <div style="display: flex; justify-content: space-between; width: 100%;">
            <span class="metric-name">${item.name}</span>
            <span class="metric-value">${item.value}</span>
          </div>
          <span style="font-size: 11.5px; color: var(--text-faint);">${item.note}</span>
        </div>
      `
      )
      .join("");

    const burnout = MYAKU_DATA.burnoutRiskStatus;
    document.getElementById("burnout-badge").innerHTML = badgeHTML(burnout.level, burnout.label);
    document.getElementById("burnout-summary").textContent = burnout.summary;

    MyakuCharts.renderSparkline(
      document.getElementById("burnout-sparkline"),
      MYAKU_DATA.weeklyTrend.map((w) => w.burnoutRisk),
      cssVar("--risk-elevated")
    );

    if (burnout.level !== "low") {
      fetch("/api/phases")
        .then((r) => r.json())
        .then((data) => {
          const todayStr = todayKey();
          const active = (data.phases || []).find((p) => p.start_date <= todayStr && todayStr <= p.end_date);
          const contextEl = document.getElementById("phase-context");
          if (active) {
            contextEl.innerHTML = `
              <span class="badge badge-accent" style="margin-bottom: 6px; display: inline-flex;">${active.label}</span>
              <p class="page-intro">This overlaps with a high-load period you marked.</p>
            `;
          } else {
            contextEl.innerHTML = `<p class="page-intro">This pattern isn't explained by any high-load period you've marked.</p>`;
          }
        });
    }

    fetch("/api/checkins")
      .then((r) => r.json())
      .then((data) => {
        const entries = data.entries || [];
        if (!entries.length) return;
        const latest = entries[entries.length - 1];
        const daysSince = (Date.now() - new Date(latest.created_at + "Z").getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince <= 7) {
          document.getElementById("checkin-status").textContent = "You're all set for this week.";
          const btn = document.getElementById("checkin-btn");
          if (btn) btn.remove();
        }
      });

    document.getElementById("insight-preview").innerHTML = MYAKU_DATA.insights.slice(0, 2).map(insightCardHTML).join("");

    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const greetingEl = document.getElementById("greeting");
        if (!greetingEl) return;
        const firstName = data && data.user ? data.user.name.split(" ")[0] : "";
        greetingEl.textContent = firstName ? `${getGreeting()}, ${firstName}` : getGreeting();
      });

    fetch(`/api/journal?date=${todayKey()}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.entry && data.entry.content) {
          document.getElementById("journal-status").textContent = "You've already added today's journal entry.";
          document.getElementById("journal-btn").textContent = "Edit Entry";
        }
      });
  }

  /* ---------------- Check-In ---------------- */

  function renderCheckin() {
    const container = document.getElementById("domains-container");
    const selections = {};

    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const role = data && data.user ? data.user.role : "student_athlete";
        const domains = myakuDomainsForRole(role);

        container.innerHTML = domains
          .map(
            (d) => `
            <div class="domain-block" data-domain="${d.id}">
              <div class="domain-title">${d.title}</div>
              <div class="domain-prompt">${d.prompt}</div>
              <div class="scale">
                ${[1, 2, 3, 4, 5]
                  .map((n) => `<div class="scale-option" data-value="${n}">${n}</div>`)
                  .join("")}
              </div>
              <div class="scale-labels">
                <span>${MYAKU_DATA.scaleLabels[0]}</span>
                <span>${MYAKU_DATA.scaleLabels[4]}</span>
              </div>
              <textarea class="note-input" placeholder="Add an optional note here."></textarea>
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

        document.getElementById("submit-checkin").addEventListener("click", async () => {
          const complete = domains.every((d) => selections[d.id]);
          const errorEl = document.getElementById("checkin-error");
          if (!complete) {
            errorEl.style.display = "block";
            return;
          }
          errorEl.style.display = "none";

          await fetch("/api/checkins", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trainingStress: selections.training,
              academicStress: selections.academic,
              personalStress: selections.personal,
            }),
          });

          document.getElementById("checkin-form").style.display = "none";
          document.getElementById("checkin-confirmation").style.display = "block";
        });
      });
  }

  /* ---------------- Trends ---------------- */

  function renderTrends() {
    const weekly = MYAKU_DATA.weeklyTrend;
    const physioColor = cssVar("--risk-low");
    const psychColor = cssVar("--risk-moderate");
    const riskColor = cssVar("--risk-elevated");

    MyakuCharts.renderLineChart(document.getElementById("trend-chart"), {
      labels: weekly.map((w) => w.week),
      series: [
        { name: "Physiological Signal", color: physioColor, values: weekly.map((w) => w.physio) },
        { name: "Psychological Signal", color: psychColor, values: weekly.map((w) => w.psych) },
        { name: "Combined Risk", color: riskColor, width: 3, values: weekly.map((w) => w.burnoutRisk) },
      ],
      min: 0,
      max: 100,
      height: 240,
    });

    document.getElementById("trend-legend").innerHTML = `
      <div class="legend-item"><span class="legend-swatch" style="background:${physioColor}"></span>Physiological Signal</div>
      <div class="legend-item"><span class="legend-swatch" style="background:${psychColor}"></span>Psychological Signal</div>
      <div class="legend-item"><span class="legend-swatch" style="background:${riskColor}"></span>Combined Risk</div>
    `;

    document.getElementById("physio-badge").innerHTML = badgeHTML("elevated", "Trending Down");
    document.getElementById("psych-badge").innerHTML = badgeHTML("elevated", "Trending Up");
  }

  /* ---------------- Insights ---------------- */

  const LOG_TYPE_LABELS = { caffeine: "caffeine", hydration: "hydration", screen_time: "screen time" };

  function computedInsightCardHTML(result, domainLabel) {
    const strength = Math.abs(result.r) >= 0.6 ? "Strong Pattern" : "Moderate Pattern";
    const direction = result.r > 0 ? "tend to move together" : "tend to move in opposite directions";
    const finding = `Your ${LOG_TYPE_LABELS[result.logType]} logging and ${domainLabel.toLowerCase()} ratings ${direction}.`;
    const support = `Based on ${result.n} weeks of your own logged data.`;
    return `
      <div class="card insight-card">
        <div class="insight-top">
          <div class="insight-finding">${finding}</div>
          <span class="badge badge-accent"><span class="badge-dot"></span>${strength}</span>
        </div>
        <div class="insight-support">${support}</div>
      </div>
    `;
  }

  function renderInsights() {
    document.getElementById("insights-list").innerHTML = MYAKU_DATA.insights.map(insightCardHTML).join("");

    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((meData) => {
        const role = meData && meData.user ? meData.user.role : "student_athlete";
        const domains = myakuDomainsForRole(role);
        const domainLabelByKey = {
          training_stress: domains.find((d) => d.id === "training").title,
          academic_stress: domains.find((d) => d.id === "academic").title,
          personal_stress: domains.find((d) => d.id === "personal").title,
        };

        fetch("/api/insights/computed")
          .then((r) => r.json())
          .then((data) => {
            const el = document.getElementById("computed-insights");
            const results = data.results || [];
            if (!results.length) {
              el.innerHTML = `<p class="empty-note">Log a few weeks of check-ins and habits to see real patterns here.</p>`;
              return;
            }
            el.innerHTML = results.map((r) => computedInsightCardHTML(r, domainLabelByKey[r.domain])).join("");
          });
      });
  }

  /* ---------------- Experiments ---------------- */

  function experimentCardHTML(exp) {
    const detail =
      exp.status === "Active"
        ? `<div class="experiment-meta">${exp.progressLabel}</div>`
        : `<div class="insight-support" style="margin-top: 6px;">${exp.result}</div>`;
    return `
      <div class="card">
        <div class="experiment-card-top">
          <div class="experiment-title">${exp.title}</div>
          ${badgeHTML(exp.statusLevel, exp.status)}
        </div>
        <span class="badge badge-neutral" style="margin-bottom: 10px; display: inline-flex;">${exp.variable}</span>
        <p class="page-intro" style="margin-top: 10px;">${exp.description}</p>
        ${detail}
      </div>
    `;
  }

  function renderExperiments() {
    const list = document.getElementById("experiments-list");
    const render = () => {
      list.innerHTML = MYAKU_DATA.experiments.map(experimentCardHTML).join("");
    };
    render();

    const form = document.getElementById("new-experiment-form");
    const showBtn = document.getElementById("show-new-experiment");

    showBtn.addEventListener("click", () => {
      form.style.display = "block";
      showBtn.style.display = "none";
    });

    document.getElementById("exp-cancel").addEventListener("click", () => {
      form.style.display = "none";
      showBtn.style.display = "inline-flex";
    });

    document.getElementById("exp-submit").addEventListener("click", () => {
      const name = document.getElementById("exp-name").value.trim() || "Untitled Experiment";
      const variable = document.getElementById("exp-variable").value;
      const desc = document.getElementById("exp-desc").value.trim() || "No description was added for this experiment.";

      MYAKU_DATA.experiments.unshift({
        title: name,
        status: "Active",
        statusLevel: "accent",
        variable,
        description: desc,
        progressLabel: "Day 1 of 14",
      });

      document.getElementById("exp-name").value = "";
      document.getElementById("exp-desc").value = "";
      form.style.display = "none";
      showBtn.style.display = "inline-flex";
      render();
    });
  }

  /* ---------------- Support ---------------- */

  function renderSupport() {
    const crisis = MYAKU_DATA.crisisResource;
    document.getElementById("crisis-name").textContent = crisis.name;
    document.getElementById("crisis-desc").textContent = crisis.desc;
    document.getElementById("crisis-detail").textContent = crisis.detail;

    document.getElementById("resources-list").innerHTML = MYAKU_DATA.supportResources
      .map(
        (r) => `
        <div class="card resource-card">
          <div>
            <div class="resource-name">${r.name}</div>
            <div class="resource-desc">${r.desc}</div>
          </div>
          <span class="badge badge-accent" style="flex-shrink: 0;">${r.action}</span>
        </div>
      `
      )
      .join("");
  }

  /* ---------------- Build Log ---------------- */

  function renderBuildLog() {
    document.getElementById("buildlog-list").innerHTML = MYAKU_DATA.buildLog
      .map(
        (entry) => `
        <div class="log-entry">
          <div class="log-phase">
            <span class="badge badge-accent">${entry.phase}</span>
            <div class="log-date">${entry.date}</div>
          </div>
          <div class="log-body">
            <div class="log-desc">${entry.desc}</div>
            <div class="skill-tags">
              ${entry.skills.map((s) => `<span class="badge badge-neutral">${s}</span>`).join("")}
            </div>
          </div>
        </div>
      `
      )
      .join("");

    const resumeText = MYAKU_DATA.resumeBullets.map((b) => "• " + b).join("\n\n");
    document.getElementById("resume-block").textContent = resumeText;

    document.getElementById("copy-resume").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const done = () => {
        const original = "Copy Bullets";
        btn.textContent = "Copied To Clipboard";
        setTimeout(() => (btn.textContent = original), 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(resumeText).then(done).catch(() => fallbackCopy(resumeText, done));
      } else {
        fallbackCopy(resumeText, done);
      }
    });
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      /* clipboard unavailable — silently ignore in this prototype */
    }
    document.body.removeChild(ta);
    done();
  }

  /* ---------------- Init ---------------- */

  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.getAttribute("data-page");
    const renderers = {
      dashboard: renderDashboard,
      checkin: renderCheckin,
      trends: renderTrends,
      insights: renderInsights,
      experiments: renderExperiments,
      support: renderSupport,
      buildlog: renderBuildLog,
    };
    if (renderers[page]) renderers[page]();
  });
})();
