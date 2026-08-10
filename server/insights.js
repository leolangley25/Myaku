/* Myaku — real correlation engine.
   Buckets checkins and logs into consistent 7-day windows (not calendar-aligned,
   just consistent), then computes Pearson correlation between weekly-averaged
   log amounts and weekly-averaged domain stress ratings. */

function weekBucket(dateStr) {
  const d = new Date(dateStr);
  const epoch = new Date("2024-01-01T00:00:00Z");
  const days = Math.floor((d - epoch) / (1000 * 60 * 60 * 24));
  return Math.floor(days / 7);
}

function average(nums) {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const meanX = average(x);
  const meanY = average(y);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

const DOMAINS = ["training_stress", "academic_stress", "personal_stress"];
const LOG_TYPES = ["caffeine", "hydration", "screen_time"];

function computeCorrelations(checkins, logs) {
  const checkinsByWeek = {};
  checkins.forEach((c) => {
    const wk = weekBucket(c.created_at);
    (checkinsByWeek[wk] = checkinsByWeek[wk] || []).push(c);
  });

  const logsByTypeWeek = {};
  logs.forEach((l) => {
    if (l.amount == null) return;
    const wk = weekBucket(l.created_at);
    logsByTypeWeek[l.type] = logsByTypeWeek[l.type] || {};
    (logsByTypeWeek[l.type][wk] = logsByTypeWeek[l.type][wk] || []).push(l.amount);
  });

  const weeksWithCheckins = Object.keys(checkinsByWeek);
  const results = [];

  LOG_TYPES.forEach((logType) => {
    const logWeeks = logsByTypeWeek[logType] || {};
    DOMAINS.forEach((domain) => {
      const sharedWeeks = weeksWithCheckins.filter((wk) => logWeeks[wk]);
      if (sharedWeeks.length < 3) return;

      const x = [];
      const y = [];
      sharedWeeks.forEach((wk) => {
        x.push(average(logWeeks[wk]));
        const domainValues = checkinsByWeek[wk].map((c) => c[domain]).filter((v) => v != null);
        if (domainValues.length) y.push(average(domainValues));
      });
      if (x.length !== y.length || x.length < 3) return;

      const r = pearson(x, y);
      if (r == null || Math.abs(r) < 0.3) return;

      results.push({ logType, domain, r, n: sharedWeeks.length });
    });
  });

  results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return results.slice(0, 4);
}

module.exports = { computeCorrelations, weekBucket, pearson };
