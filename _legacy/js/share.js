/* Myaku — manage selective-sharing links. */

(function () {
  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      /* clipboard unavailable */
    }
    document.body.removeChild(ta);
  }

  function copyText(text, btn) {
    const done = () => {
      const original = "Copy Link";
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = original), 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        fallbackCopy(text);
        done();
      });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function linkCardHTML(link) {
    const url = `${window.location.origin}/share-view.html?token=${link.token}`;
    const status = link.revoked
      ? `<span class="badge badge-neutral"><span class="badge-dot"></span>Revoked</span>`
      : `<span class="badge badge-low"><span class="badge-dot"></span>Active</span>`;
    return `
      <div class="card resource-card" data-id="${link.id}" style="flex-wrap: wrap;">
        <div>
          <div class="resource-name">${esc(link.label || "Untitled Link")}</div>
          <div class="resource-desc">${esc(url)}</div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
          ${status}
          ${
            link.revoked
              ? ""
              : `<button class="btn btn-secondary copy-btn-link" data-url="${esc(url)}">Copy Link</button>
                 <button class="btn btn-secondary revoke-btn" data-id="${link.id}">Revoke</button>`
          }
        </div>
      </div>
    `;
  }

  function load() {
    fetch("/api/share")
      .then((r) => r.json())
      .then((data) => {
        const el = document.getElementById("share-list");
        const links = data.links || [];
        if (!links.length) {
          el.innerHTML = `<p class="empty-note">You haven't created any share links yet.</p>`;
          return;
        }
        el.innerHTML = links.map(linkCardHTML).join("");

        el.querySelectorAll(".copy-btn-link").forEach((btn) => {
          btn.addEventListener("click", () => copyText(btn.getAttribute("data-url"), btn));
        });
        el.querySelectorAll(".revoke-btn").forEach((btn) => {
          btn.addEventListener("click", async () => {
            await fetch(`/api/share/${btn.getAttribute("data-id")}/revoke`, { method: "POST" });
            load();
          });
        });
      });
  }

  document.getElementById("share-create").addEventListener("click", async () => {
    const label = document.getElementById("share-label").value.trim();
    await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    document.getElementById("share-label").value = "";
    load();
  });

  load();
})();
