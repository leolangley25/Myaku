/* Myaku — the season, week by week.
 *
 * The divergence engine answers "where am I now". Trends asks the question a season
 * raises instead: how did I get here. Each past week is recomputed exactly as the
 * model would have read it on the last day of that week, using only the data that
 * existed by then, so a pattern shown for three weeks ago is the pattern Myaku
 * would actually have named three weeks ago rather than a rewrite with hindsight.
 */

const { compute } = require("./divergence");

const CHANNELS = ["autonomic", "cognitive", "psychological"];

function shift(d, days) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

function season({ metrics = [], sessions = [], daily = [], weekly = [], journal = [], sensitivity, today, weeks = 12 }) {
  const dates = [
    ...metrics.map((r) => r.date), ...sessions.map((r) => r.date), ...daily.map((r) => r.date),
    ...weekly.map((r) => r.week_start), ...journal.map((r) => r.entry_date),
  ].filter(Boolean).map((d) => String(d).slice(0, 10)).sort();
  if (!dates.length) return { hasData: false, weeks: [], patterns: [] };

  const end = /^\d{4}-\d{2}-\d{2}$/.test(today || "") ? today : dates[dates.length - 1];
  const first = dates[0];

  const timeline = [];
  let thresholds = null;
  for (let k = 0; k < weeks; k++) {
    const anchor = shift(end, -7 * k);
    if (anchor < first) break;
    const start = shift(anchor, -6);
    const d = compute({ metrics, sessions, daily, weekly, journal, sensitivity, today: anchor });
    if (!thresholds) thresholds = d.thresholds;

    // A channel's reading for this exact week, never an older week standing in for it.
    const zAt = (key) => {
      const p = (d.channels[key].points || []).find((q) => q.week === start);
      return p && p.z != null ? round2(p.z) : null;
    };
    const z = Object.fromEntries(CHANNELS.map((c) => [c, zAt(c)]));
    const gap = (a, b) => (z[a] != null && z[b] != null ? round2(z[a] - z[b]) : null);

    timeline.unshift({
      start,
      end: anchor,
      state: d.state ? { key: d.state.key, name: d.state.name, tone: d.state.tone } : null,
      confidence: d.confidence,
      z,
      gaps: {
        cognitiveVsAutonomic: gap("cognitive", "autonomic"),
        psychologicalVsAutonomic: gap("psychological", "autonomic"),
        cognitiveVsPsychological: gap("cognitive", "psychological"),
      },
    });
  }

  /* How long the current pattern has held, and what came before it, which is the
     sentence a season actually needs: not only where you are, but since when. */
  const last = timeline[timeline.length - 1];
  const current = last.state;
  let heldWeeks = 0;
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (!current || !timeline[i].state || timeline[i].state.key !== current.key) break;
    heldWeeks++;
  }
  let previous = null;
  const before = timeline.length - 1 - heldWeeks;
  if (current && before >= 0 && timeline[before].state) {
    const key = timeline[before].state.key;
    let n = 0;
    for (let i = before; i >= 0 && timeline[i].state && timeline[i].state.key === key; i--) n++;
    previous = { ...timeline[before].state, weeks: n };
  }

  const counts = {};
  timeline.forEach((w) => {
    if (!w.state) return;
    const c = (counts[w.state.key] = counts[w.state.key] || { ...w.state, weeks: 0 });
    c.weeks++;
  });

  return {
    hasData: true,
    today: end,
    thresholds,
    weeks: timeline,
    current,
    heldWeeks,
    previous,
    patterns: Object.values(counts).sort((a, b) => b.weeks - a.weeks),
  };
}

module.exports = { season };
