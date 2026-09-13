/* Myaku — auth guard for protected pages, plus nav account block. */

(function () {
  const isAdminPage = document.body.getAttribute("data-admin") === "true";

  fetch("/api/me")
    .then((r) => (r.status === 401 ? Promise.reject(new Error("unauthenticated")) : r.json()))
    .then((data) => {
      const isAdminUser = data.user.role === "admin";
      if (isAdminUser && !isAdminPage) {
        window.location.href = "admin.html";
        return;
      }
      if (!isAdminUser && isAdminPage) {
        window.location.href = "index.html";
        return;
      }
      document.querySelectorAll("[data-user-name]").forEach((el) => {
        el.textContent = data.user.name;
      });
    })
    .catch(() => {
      window.location.href = "login.html";
    });

  document.querySelectorAll("[data-logout]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      fetch("/api/logout", { method: "POST" }).then(() => {
        window.location.href = "login.html";
      });
    });
  });
})();
