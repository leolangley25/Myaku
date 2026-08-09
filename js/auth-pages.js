/* Myaku — signup and login form handling. */

(function () {
  const FALLBACK_ERROR = "Something went wrong, please try again.";

  function showError(el, message) {
    el.textContent = message;
    el.style.display = "block";
  }

  const signupForm = document.getElementById("signup-form");
  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById("signup-error");
      errorEl.style.display = "none";

      const name = document.getElementById("name").value.trim();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;

      try {
        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          showError(errorEl, data.error || FALLBACK_ERROR);
          return;
        }
        window.location.href = "connect.html";
      } catch (err) {
        showError(errorEl, FALLBACK_ERROR);
      }
    });
  }

  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById("login-error");
      errorEl.style.display = "none";

      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;

      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          showError(errorEl, data.error || FALLBACK_ERROR);
          return;
        }
        window.location.href = "index.html";
      } catch (err) {
        showError(errorEl, FALLBACK_ERROR);
      }
    });
  }
})();
