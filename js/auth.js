/* Myaku — sign in and sign up. One file, both forms. */

(function () {
  const form = document.getElementById("form");
  if (!form) return;

  const isSignup = !!document.getElementById("name");
  const errorEl = document.getElementById("error");

  function fail(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;

    const body = {
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value,
    };
    if (isSignup) body.name = document.getElementById("name").value.trim();

    try {
      const r = await M.api(isSignup ? "/api/signup" : "/api/login", { method: "POST", body });
      // The server decides: a new account, or one that never finished setup,
      // goes to onboarding rather than to an empty home screen.
      location.href = r.next || (isSignup ? "welcome.html" : "index.html");
    } catch (err) {
      fail(err.message);
      btn.disabled = false;
    }
  });
})();
