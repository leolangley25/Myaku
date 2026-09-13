/* Myaku — Log hub. Entry points grouped by whether they feed a channel. */

(function () {
  M.boot("log");

  const I = {
    pvt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 12.5l4.5 4.5 10-10"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4h11a1 1 0 011 1v15H7a1 1 0 01-1-1V4z"/><path d="M9 9h6M9 13h6"/></svg>',
    cup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9h11v6a4 4 0 01-4 4H9a4 4 0 01-4-4V9z"/><path d="M16 11h1.5a2 2 0 010 4H16"/></svg>',
  };

  document.getElementById("channel-rows").innerHTML = [
    M.row({ title: "Reaction Test", sub: "Brain channel, three minutes.", href: "pvt.html", icon: I.pvt, tint: "var(--ch-cog)" }),
    M.row({ title: "Daily Check-In", sub: "Life channel, under a minute.", href: "checkin.html", icon: I.check, tint: "var(--ch-psy)" }),
    M.row({ title: "Weekly Reflection", sub: "Demand, control, and the three dimensions.", href: "weekly.html", icon: I.cal, tint: "var(--purple)" }),
  ].join("");

  document.getElementById("utility-rows").innerHTML = [
    M.row({ title: "Caffeine", sub: "Not a channel, but it confounds one.", href: "caffeine.html", icon: I.cup, tint: "var(--orange)" }),
    M.row({ title: "Journal", sub: "Optional, and only the rating counts.", href: "journal.html", icon: I.book, tint: "var(--gray)" }),
    M.row({
      title: "Body Data", sub: "Connect a wearable, import, or enter a night by hand.", href: "sources.html",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></svg>',
      tint: "var(--ch-auto)",
    }),
  ].join("");

  M.api("/api/pvt")
    .then(({ sessions }) => {
      const el = document.getElementById("recent");
      if (!sessions.length) {
        el.innerHTML = `<div class="row"><span class="row-main"><span class="row-title secondary">No sessions recorded yet.</span></span></div>`;
        return;
      }
      el.innerHTML = sessions
        .slice(0, 8)
        .map((s) =>
          M.row({
            title: M.prettyDate(s.date),
            sub: `${s.n_trials} trials, ${s.lapses} lapse${s.lapses === 1 ? "" : "s"}${
              s.caffeine_minutes_prior != null ? `, caffeine ${s.caffeine_minutes_prior} min before` : ""
            }.`,
            value: s.mean_rt ? `${Math.round(s.mean_rt)} ms` : "—",
          })
        )
        .join("");
    })
    .catch(() => {});
})();
