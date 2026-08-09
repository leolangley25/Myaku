/* Myaku — auth guard for protected pages, plus nav account block. */

(function () {
  fetch("/api/me")
    .then((r) => (r.status === 401 ? Promise.reject(new Error("unauthenticated")) : r.json()))
    .then((data) => {
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
