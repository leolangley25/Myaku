/* Myaku — motion layer.
 *
 * Everything here is decoration, so everything here is optional. Each piece
 * checks the reduced-motion preference first and, when it is set, does the
 * job instantly rather than skipping it: a count-up still ends on the right
 * number, a reveal still reveals. Nothing in this file may be load-bearing for
 * reading the page, because animation that carries meaning excludes people who
 * have turned animation off.
 */

const Motion = (() => {
  const reduced = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- ripple ---------------- */

  /* One delegated listener for the whole document rather than a listener per
     control, so lists that re-render keep their ripples without rebinding. */
  const RIPPLE_TARGETS = ".btn, .chip, .scale-opt, .segmented button, .nav-indicator, a.row, button.row";

  function ripple(host, clientX, clientY) {
    if (reduced()) return;
    const r = host.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    // Reach the furthest corner so the wave always covers the control.
    const radius = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));

    const el = document.createElement("span");
    el.className = "ripple";
    el.style.left = x - radius + "px";
    el.style.top = y - radius + "px";
    el.style.width = el.style.height = radius * 2 + "px";
    host.appendChild(el);

    const anim = el.animate(
      [
        { transform: "scale(0)", opacity: 0.22 },
        { transform: "scale(1)", opacity: 0 },
      ],
      { duration: 520, easing: "cubic-bezier(0.2, 0, 0, 1)" }
    );
    /* onfinish never fires on a page that is not being composited — a hidden
       tab, a minimised window — so without a second route out, every tap
       leaves a ripple node behind for the life of the page. */
    const drop = () => el.remove();
    anim.onfinish = drop;
    setTimeout(drop, 900);
  }

  function bindRipples() {
    document.addEventListener(
      "pointerdown",
      (e) => {
        const host = e.target.closest && e.target.closest(RIPPLE_TARGETS);
        if (!host || host.disabled) return;
        ripple(host, e.clientX, e.clientY);
      },
      { passive: true }
    );
  }

  /* ---------------- staggered entrance ---------------- */

  /* Sections above the fold animate on load with a stagger; anything further
     down waits until it is scrolled near, so the stagger is never spent on
     content nobody has reached yet. */
  function reveal(root = document, selector = ".section, .nav-large", startDelay = 0) {
    const nodes = [...root.querySelectorAll(selector)].filter((n) => !n.dataset.revealed);
    if (reduced()) {
      nodes.forEach((n) => (n.dataset.revealed = "1"));
      return;
    }

    const fold = window.innerHeight + 80;
    let i = 0;

    const play = (node, delay) => {
      node.dataset.revealed = "1";
      node.style.animationDelay = delay + "ms";
      node.classList.add("reveal");
    };

    const observer = "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries, obs) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              play(entry.target, 0);
              obs.unobserve(entry.target);
            });
          },
          { rootMargin: "0px 0px -8% 0px" }
        )
      : null;

    nodes.forEach((node) => {
      if (node.getBoundingClientRect().top < fold || !observer) {
        play(node, startDelay + i * 55);
        i++;
      } else {
        node.style.animationDelay = "0ms";
        observer.observe(node);
      }
    });
  }

  /* ---------------- number count-up ---------------- */

  function countUp(el, to, { duration = 900, decimals = 0, prefix = "", suffix = "" } = {}) {
    const target = Number(to);
    const render = (v) => (el.textContent = prefix + v.toFixed(decimals) + suffix);

    if (!Number.isFinite(target)) return;

    /* The final value is written before the animation starts, so a page that
       never receives an animation frame — a hidden tab, a background window —
       still shows the right number rather than a placeholder forever. The
       first frame overwrites it within a few milliseconds when frames do run. */
    render(target);
    if (reduced()) return;

    const from = 0;
    const started = performance.now();
    // Decelerating, because a number racing past its value and settling back
    // reads as a glitch rather than as momentum.
    const ease = (t) => 1 - Math.pow(1 - t, 3);

    function frame(now) {
      // A list that re-renders mid-count would otherwise leave this loop
      // running against a node nobody can see.
      if (!el.isConnected) return;
      const t = Math.min(1, (now - started) / duration);
      render(from + (target - from) * ease(t));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* Signed values keep their sign while counting, which the plain formatter
     above cannot express on its own. */
  function countSigned(el, to, opts = {}) {
    const target = Number(to);
    const decimals = opts.decimals ?? 1;
    if (!Number.isFinite(target)) { el.textContent = "—"; return; }

    // Same contract as countUp: land on the value first, then animate over it.
    el.textContent = (target > 0 ? "+" : "") + target.toFixed(decimals);
    if (reduced()) return;

    const started = performance.now();
    const duration = opts.duration ?? 900;
    const ease = (t) => 1 - Math.pow(1 - t, 3);

    function frame(now) {
      if (!el.isConnected) return;
      const t = Math.min(1, (now - started) / duration);
      const v = target * ease(t);
      el.textContent = (v > 0 ? "+" : "") + v.toFixed(decimals);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- collapsing top app bar ---------------- */

  function bindAppBar() {
    const bar = document.querySelector(".nav-large");
    if (!bar) return;
    let collapsed = false;
    const onScroll = () => {
      // Two thresholds rather than one, so a page resting near the boundary
      // does not flicker between states on every pixel of scroll.
      const y = window.scrollY;
      if (!collapsed && y > 56) { collapsed = true; bar.classList.add("collapsed"); }
      else if (collapsed && y < 24) { collapsed = false; bar.classList.remove("collapsed"); }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------------- svg helpers ---------------- */

  /* Draw a path on as though it were being written. */
  function drawPath(path, { duration = 900, delay = 0 } = {}) {
    if (reduced()) return;
    let length = 0;
    try { length = path.getTotalLength(); } catch { return; }
    if (!length) return;
    path.animate(
      [
        { strokeDasharray: `${length} ${length}`, strokeDashoffset: length },
        { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 },
      ],
      { duration, delay, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" }
    );
  }

  /* Grow a rectangle from an edge. SVG rects cannot be scaled about an
     arbitrary origin without a transform box, so the height is animated. */
  function growRect(rect, { duration = 650, delay = 0, from = "bottom" } = {}) {
    if (reduced()) return;
    const y = parseFloat(rect.getAttribute("y"));
    const h = parseFloat(rect.getAttribute("height"));
    const anchor = from === "top" ? y : y + h;
    rect.animate(
      [
        { height: "0px", y: `${anchor}px` },
        { height: `${h}px`, y: `${y}px` },
      ],
      { duration, delay, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" }
    );
  }

  function popIn(el, { duration = 520, delay = 0 } = {}) {
    if (reduced()) return;
    el.animate(
      [
        { transform: "scale(0)", opacity: 0 },
        { transform: "scale(1)", opacity: Number(el.getAttribute("opacity") || 1) },
      ],
      { duration, delay, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.3)", fill: "backwards" }
    );
  }

  function fadeIn(el, { duration = 420, delay = 0 } = {}) {
    if (reduced()) return;
    el.animate(
      [{ opacity: 0 }, { opacity: Number(el.getAttribute("opacity") || 1) }],
      { duration, delay, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" }
    );
  }

  /* Swap the contents of a container with a short cross-dissolve and rise. */
  function swapIn(el, { duration = 420 } = {}) {
    if (reduced()) return;
    el.animate(
      [
        { opacity: 0, transform: "translate3d(0, 14px, 0)" },
        { opacity: 1, transform: "none" },
      ],
      { duration, easing: "cubic-bezier(0.05, 0.7, 0.1, 1)" }
    );
  }

  function init() {
    bindRipples();
    bindAppBar();
    reveal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { reduced, reveal, countUp, countSigned, drawPath, growRect, popIn, fadeIn, swapIn, ripple };
})();
