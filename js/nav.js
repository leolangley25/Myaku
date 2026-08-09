/* Myaku — shared nav, injected into #nav-root on every page.
   Active page is read from <body data-page="..."> */

(function () {
  const icons = {
    dashboard:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12 12 4l8 8"/><path d="M6 10.5V20h12v-9.5"/></svg>',
    checkin:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-5.2"/></svg>',
    trends:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 16l5-5 4 4 7-8"/><path d="M15 7h5v5"/></svg>',
    insights:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6h5.4c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3Z"/></svg>',
    experiments:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6"/><path d="M10 3v6.5L4.8 18a1.6 1.6 0 0 0 1.4 2.4h11.6a1.6 1.6 0 0 0 1.4-2.4L14 9.5V3"/><path d="M8 15h8"/></svg>',
    support:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><path d="M6.2 6.2l3.3 3.3M18 6l-3.3 3.3M6 18l3.3-3.3M18 18l-3.3-3.3"/></svg>',
    buildlog:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3.5h9l3 3V20a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"/><path d="M9 12h6M9 15.5h6M9 8.5h3"/></svg>',
    devices:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="8" width="8" height="8" rx="1.5"/><path d="M12 10.5h4a2.5 2.5 0 0 1 2.5 2.5v0a2.5 2.5 0 0 1-2.5 2.5h-4"/><path d="M18.5 10v5"/><path d="M7 5.5v2.5M9.5 5.5v2.5"/></svg>',
    lock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="10.5" width="14" height="9" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  };

  const links = [
    { id: "dashboard", href: "index.html", label: "Dashboard", icon: icons.dashboard },
    { id: "checkin", href: "checkin.html", label: "Check-In", icon: icons.checkin },
    { id: "trends", href: "trends.html", label: "Trends", icon: icons.trends },
    { id: "insights", href: "insights.html", label: "Insights", icon: icons.insights },
    { id: "experiments", href: "experiments.html", label: "Experiments", icon: icons.experiments },
    { id: "support", href: "support.html", label: "Support", icon: icons.support },
    { id: "devices", href: "connect.html", label: "Devices", icon: icons.devices },
    { id: "buildlog", href: "buildlog.html", label: "Build Log", icon: icons.buildlog },
  ];

  const active = document.body.getAttribute("data-page");

  const sidebarLinks = links
    .map(
      (l) =>
        `<a class="sidebar-link${l.id === active ? " active" : ""}" href="${l.href}">${l.icon}<span>${l.label}</span></a>`
    )
    .join("");

  const topbarLinks = links
    .map((l) => `<a class="topbar-link${l.id === active ? " active" : ""}" href="${l.href}">${l.label}</a>`)
    .join("");

  const markup = `
    <nav class="sidebar">
      <div class="sidebar-brand">Myaku</div>
      <div class="sidebar-tagline">Coaches and staff never see this data.</div>
      <div class="sidebar-nav">${sidebarLinks}</div>
      <div class="sidebar-account">
        <div class="sidebar-account-name" data-user-name>&nbsp;</div>
        <a href="#" class="sidebar-account-logout" data-logout>Log Out</a>
      </div>
      <div class="sidebar-footer">${icons.lock}<span>Private by default. Every reading here belongs to you.</span></div>
    </nav>
    <div class="topbar">
      <div class="topbar-brand">Myaku</div>
      <div class="topbar-nav">${topbarLinks}<a href="#" class="topbar-link" data-logout>Log Out</a></div>
    </div>
  `;

  document.getElementById("nav-root").innerHTML = markup;
})();
