/* Myaku — tiny dependency-free SVG chart helpers. */

const MyakuCharts = (function () {
  const NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  function scaleY(value, min, max, top, bottom) {
    if (max === min) return bottom;
    return bottom - ((value - min) / (max - min)) * (bottom - top);
  }

  // Multi-series line chart with gridlines and x-axis labels.
  function renderLineChart(container, { series, labels, min = 0, max = 100, height = 220 }) {
    container.innerHTML = "";
    const width = 640;
    const padL = 30;
    const padR = 12;
    const padT = 14;
    const padB = 28;
    const top = padT;
    const bottom = height - padB;
    const left = padL;
    const right = width - padR;

    const svg = el("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width: "100%",
      height: "100%",
      preserveAspectRatio: "none",
    });
    svg.style.display = "block";
    svg.style.overflow = "visible";

    // gridlines
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const y = top + ((bottom - top) / gridSteps) * i;
      svg.appendChild(
        el("line", {
          x1: left,
          x2: right,
          y1: y,
          y2: y,
          stroke: "#ecdfe2",
          "stroke-width": 1,
        })
      );
    }

    const n = labels.length;
    const stepX = n > 1 ? (right - left) / (n - 1) : 0;

    series.forEach((s) => {
      const points = s.values.map((v, i) => {
        const x = left + stepX * i;
        const y = scaleY(v, min, max, top, bottom);
        return [x, y];
      });

      const d = points.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");

      svg.appendChild(
        el("path", {
          d,
          fill: "none",
          stroke: s.color,
          "stroke-width": s.width || 2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        })
      );

      // last point marker
      const last = points[points.length - 1];
      svg.appendChild(
        el("circle", {
          cx: last[0],
          cy: last[1],
          r: 4,
          fill: s.color,
        })
      );
    });

    // x labels
    labels.forEach((label, i) => {
      const x = left + stepX * i;
      const t = el("text", {
        x,
        y: height - 8,
        "font-size": 10.5,
        fill: "#ac989b",
        "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle",
      });
      t.textContent = label;
      svg.appendChild(t);
    });

    container.appendChild(svg);
  }

  // Minimal sparkline, no axes — for compact dashboard widgets.
  function renderSparkline(container, values, color, { height = 56, fill = true } = {}) {
    container.innerHTML = "";
    const width = 240;
    const padY = 6;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const top = padY;
    const bottom = height - padY;

    const svg = el("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width: "100%",
      height: "100%",
      preserveAspectRatio: "none",
    });
    svg.style.display = "block";

    const n = values.length;
    const stepX = n > 1 ? width / (n - 1) : 0;
    const points = values.map((v, i) => [stepX * i, scaleY(v, min, max, top, bottom)]);

    if (fill) {
      const areaD =
        "M" +
        points.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L") +
        ` L${width},${bottom} L0,${bottom} Z`;
      svg.appendChild(
        el("path", {
          d: areaD,
          fill: color,
          opacity: 0.12,
          stroke: "none",
        })
      );
    }

    const lineD = points.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
    svg.appendChild(
      el("path", {
        d: lineD,
        fill: "none",
        stroke: color,
        "stroke-width": 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      })
    );

    const last = points[points.length - 1];
    svg.appendChild(el("circle", { cx: last[0], cy: last[1], r: 3.5, fill: color }));

    container.appendChild(svg);
  }

  return { renderLineChart, renderSparkline };
})();
