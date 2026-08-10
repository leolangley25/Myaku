/* Myaku — signup and login form handling. */

(function () {
  const FALLBACK_ERROR = "Something went wrong, please try again.";

  function showError(el, message) {
    el.textContent = message;
    el.style.display = "block";
  }

  const signupForm = document.getElementById("signup-form");
  if (signupForm) {
    let selectedRole = "student_athlete";
    document.querySelectorAll(".role-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        document.querySelectorAll(".role-option").forEach((o) => o.classList.remove("selected"));
        opt.classList.add("selected");
        selectedRole = opt.getAttribute("data-role");
      });
    });

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
          body: JSON.stringify({ name, email, password, role: selectedRole }),
        });
        const data = await res.json();
        if (!res.ok) {
          showError(errorEl, data.error || FALLBACK_ERROR);
          return;
        }
        window.location.href = data.role === "admin" ? "admin.html" : "calibrate.html";
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
        window.location.href = data.role === "admin" ? "admin.html" : "index.html";
      } catch (err) {
        showError(errorEl, FALLBACK_ERROR);
      }
    });
  }
})();
