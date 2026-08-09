/* Myaku — Connect Your Data page: stubbed provider connections. */

(function () {
  const PROVIDERS = [
    { id: "whoop", name: "Whoop", desc: "Syncs sleep, strain, and recovery data automatically." },
    { id: "fitbit", name: "Fitbit", desc: "Syncs activity, sleep, and heart-rate data automatically." },
    { id: "apple_health", name: "Apple Health", desc: "Requires the Myaku companion app on your iPhone." },
  ];

  const list = document.getElementById("providers-list");

  function cardHTML(provider, connected) {
    return `
      <div class="card resource-card" data-provider="${provider.id}">
        <div>
          <div class="resource-name">${provider.name}</div>
          <div class="resource-desc">${provider.desc}</div>
        </div>
        <button class="btn ${connected ? "btn-secondary" : "btn-primary"}" data-action="${connected ? "disconnect" : "connect"}" style="flex-shrink: 0;">
          ${connected ? "Disconnect" : "Connect"}
        </button>
      </div>
    `;
  }

  function render(connectedProviders) {
    list.innerHTML = PROVIDERS.map((p) => cardHTML(p, connectedProviders.includes(p.id))).join("");

    list.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-provider]");
        const provider = card.getAttribute("data-provider");
        const action = btn.getAttribute("data-action");
        btn.disabled = true;
        try {
          const res = await fetch(`/api/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider }),
          });
          const data = await res.json();
          if (res.ok) render(data.connectedProviders);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  fetch("/api/me")
    .then((r) => (r.status === 401 ? Promise.reject(new Error("unauthenticated")) : r.json()))
    .then((data) => render(data.connectedProviders))
    .catch(() => {
      window.location.href = "login.html";
    });
})();
