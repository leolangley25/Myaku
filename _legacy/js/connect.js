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

  const tokenList = document.getElementById("token-list");
  const tokenEmpty = document.getElementById("token-empty");
  const tokenNewBanner = document.getElementById("token-new-banner");
  const tokenLabelInput = document.getElementById("token-label");
  const createTokenBtn = document.getElementById("create-token-btn");

  function formatDate(iso) {
    const d = new Date(iso.replace(" ", "T") + "Z");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  async function loadTokens() {
    const res = await fetch("/api/tokens");
    if (!res.ok) return;
    const data = await res.json();
    const tokens = data.tokens || [];

    tokenEmpty.style.display = tokens.length === 0 ? "block" : "none";
    tokenList.innerHTML = tokens
      .map(
        (t) => `
      <div class="card resource-card" data-token-id="${t.id}" style="margin-bottom: 8px;">
        <div>
          <div class="resource-name">${esc(t.label || "Untitled Token")}</div>
          <div class="resource-desc">Created ${formatDate(t.created_at)}${t.last_used_at ? " · Last Used " + formatDate(t.last_used_at) : " · Never Used"}</div>
        </div>
        <button class="btn btn-secondary" data-action="revoke-token" style="flex-shrink: 0;">Revoke</button>
      </div>
    `
      )
      .join("");

    tokenList.querySelectorAll("button[data-action='revoke-token']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-token-id]").getAttribute("data-token-id");
        btn.disabled = true;
        await fetch(`/api/tokens/${id}/revoke`, { method: "POST" });
        loadTokens();
      });
    });
  }

  createTokenBtn.addEventListener("click", async () => {
    createTokenBtn.disabled = true;
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: tokenLabelInput.value.trim() || "Hada" }),
      });
      const data = await res.json();
      if (res.ok) {
        tokenNewBanner.style.display = "block";
        tokenNewBanner.innerHTML = `<strong>New Token:</strong> ${data.token}<br>Copy this now, you won't be able to see it again. Paste it into Hada's integrations page.`;
        tokenLabelInput.value = "";
        loadTokens();
      }
    } finally {
      createTokenBtn.disabled = false;
    }
  });

  loadTokens();
})();
