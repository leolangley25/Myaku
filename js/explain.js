/* Myaku — the interpretation layer.
 *
 * Every number this app computes is meaningless to the person it describes
 * until it is said in a sentence. A z of plus two point nine is not information;
 * "this is the highest of your eight recorded weeks" is.
 *
 * Two rules govern everything here.
 *
 * Counts beat abstractions. Where a rank can be stated as "the highest of your
 * eight weeks" it is stated that way rather than as a percentile, because a
 * percentile drawn from eight observations implies a precision that eight
 * observations cannot support.
 *
 * Nothing here is a verdict. These are descriptions of one person's own
 * history, and the wording is chosen so that no line can be read as a
 * diagnosis or as an instruction about what to do next.
 */

const Explain = (() => {
  /* ---------------- bands ---------------- */

  /* The thresholds come from the engine so this respects the sensitivity the
     person chose, rather than hard-coding a second opinion about what counts
     as a large move. */
  function band(z, thresholds) {
    const notable = (thresholds && thresholds.notable) || 1.0;
    const marked = (thresholds && thresholds.marked) || 1.5;

    if (z == null) return { key: "unknown", word: "Not Enough Data", tone: "" };
    if (z >= marked) return { key: "high", word: "Well Above Usual", tone: "bad" };
    if (z >= notable) return { key: "raised", word: "Above Usual", tone: "warn" };
    if (z <= -notable) return { key: "low", word: "Better Than Usual", tone: "good" };
    return { key: "typical", word: "Typical For You", tone: "good" };
  }

  /* Where this week sits among the weeks actually recorded. A count of real
     observations, not a percentile invented from six of them. */
  function rankSentence(points, noun = "week") {
    const zs = (points || []).map((p) => p.z).filter((z) => z != null);
    if (zs.length < 3) return "";
    const last = zs[zs.length - 1];
    const higher = zs.filter((z) => z > last).length;
    const n = zs.length;

    if (higher === 0) return `This is the highest of your ${n} recorded ${noun}s.`;
    if (higher === n - 1) return `This is the lowest of your ${n} recorded ${noun}s.`;
    if (higher === 1) return `Only one of your ${n} ${noun}s has been higher.`;
    return `${higher} of your ${n} ${noun}s have been higher than this.`;
  }

  /* ---------------- channels ---------------- */

  const CHANNEL_MEANING = {
    autonomic: {
      plain: "what your body is doing",
      high: "Your body is under more strain than it usually is.",
      typical: "Your body is running about where it normally does.",
      low: "Your body is in better shape than it usually is.",
      measures: "Sleep, heart rate variability, and resting heart rate from your wearable.",
    },
    cognitive: {
      plain: "how fast you are reacting",
      high: "You are reacting more slowly than you normally do.",
      typical: "You are reacting about as fast as you normally do.",
      low: "You are reacting faster than you normally do.",
      measures: "Your reaction time and lapses on the vigilance test, pooled by week.",
    },
    psychological: {
      plain: "how the weeks are landing on you",
      high: "Things are landing harder on you than they usually do.",
      typical: "Things are landing about the way they usually do.",
      low: "Things are landing more lightly than they usually do.",
      measures: "Your check-ins, weekly reflections, and any journal entry you rated.",
    },
  };

  function channelSentence(key, z, thresholds) {
    const meaning = CHANNEL_MEANING[key];
    if (!meaning) return "";
    if (z == null) return "There is not enough history to place this yet.";
    const b = band(z, thresholds);
    if (b.key === "high" || b.key === "raised") return meaning.high;
    if (b.key === "low") return meaning.low;
    return meaning.typical;
  }

  const channelMeaning = (key) => CHANNEL_MEANING[key] || {};

  /* ---------------- wearable readings ---------------- */

  function median(nums) {
    if (!nums.length) return null;
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* Compares one reading against that person's own recent normal and says the
     difference out loud. `higherIsWorse` decides which direction gets the
     warning colour, because a rise in resting heart rate and a rise in heart
     rate variability mean opposite things. */
  function compare(value, history, { higherIsWorse = false, unit = "", decimals = 0, tolerance = 0.05, formatBase, formatDelta } = {}) {
    if (value == null || !history || history.length < 5) {
      return { word: "", tone: "", delta: null, sentence: "" };
    }
    const base = median(history);
    if (base == null || base === 0) return { word: "", tone: "", delta: null, sentence: "" };

    const delta = value - base;
    const share = Math.abs(delta) / Math.abs(base);
    const plain = (v) => (decimals ? v.toFixed(decimals) : Math.round(v).toString()) + unit;
    /* Minutes of sleep want to be read back as hours and minutes, not as the
       four hundred and thirty two the arithmetic happens to be in. */
    const fmtBase = formatBase || plain;
    const fmtDelta = formatDelta || plain;

    if (share < tolerance) {
      return {
        word: "Typical For You",
        tone: "good",
        delta,
        base,
        sentence: `About your usual, which is ${fmtBase(base)}.`,
      };
    }

    const up = delta > 0;
    const worse = up === higherIsWorse;
    return {
      word: up ? `Up ${fmtDelta(Math.abs(delta))}` : `Down ${fmtDelta(Math.abs(delta))}`,
      tone: worse ? "warn" : "good",
      delta,
      base,
      sentence: `${fmtDelta(Math.abs(delta))} ${up ? "above" : "below"} your usual ${fmtBase(base)}.`,
    };
  }

  function duration(minutes) {
    if (minutes == null) return "—";
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }

  /* ---------------- relationships ---------------- */

  /* Strength first, direction second, and never the Greek letter. */
  /* "Higher" and "lower" rather than "more" and "less", because the second
     measure is usually a quality rather than a quantity and "less sleep
     quality" is not a sentence anybody would say. */
  function correlationSentence(rho, n, { xLabel, yLabel } = {}) {
    if (rho == null) return `There are not enough paired days to look at this yet.`;
    const mag = Math.abs(rho);
    const strength =
      mag >= 0.5 ? "a strong pattern" : mag >= 0.3 ? "a moderate pattern" : mag >= 0.15 ? "a weak pattern" : "almost no pattern";

    if (mag < 0.15) {
      return `Across ${n} days there is almost no pattern between ${xLabel} and ${yLabel}.`;
    }
    return `Across ${n} days there is ${strength}: more ${xLabel} went with ${rho > 0 ? "higher" : "lower"} ${yLabel}.`;
  }

  /* A p value said as what it is, which is a statement about how easily chance
     alone could have produced this, and nothing more than that. */
  function chanceSentence(p) {
    if (p == null) return "There is not enough data to say whether this is chance.";
    if (p < 0.01) return "Chance alone would rarely produce a pattern this clear.";
    if (p < 0.05) return "This clears the usual bar for a real pattern, and that bar is low.";
    if (p < 0.15) return "This is suggestive, but chance could easily produce it.";
    return "This is what no relationship looks like, and that is a real answer.";
  }

  /* ---------------- gaps ---------------- */

  const GAP_MEANING = {
    cognitiveVsAutonomic: {
      title: "Brain Against Body",
      plain: "Whether your reaction time agrees with what your wearable says.",
      positive: "Your reaction time looks worse than your body does. A recovery score would miss this.",
      negative: "Your body looks worse than your reaction time does. You are coping better than the numbers suggest.",
      none: "These two agree with each other at the moment.",
    },
    psychologicalVsAutonomic: {
      title: "Life Against Body",
      plain: "Whether what you report agrees with what your wearable says.",
      positive: "This is landing harder on you than your body shows. That gap is the point of this app.",
      negative: "Your body is carrying more than this feels like. Worth not pushing through.",
      none: "These two agree with each other at the moment.",
    },
    cognitiveVsPsychological: {
      title: "Brain Against Life",
      plain: "Whether your measured sharpness agrees with your felt sharpness.",
      positive: "You are measurably slower than you are reporting. People under-report this one.",
      negative: "You feel worse than your reaction time shows.",
      none: "These two agree with each other at the moment.",
    },
    sleepFeltVsMeasured: {
      title: "Felt Against Measured",
      plain: "Whether your nights feel like the numbers your wearable records.",
      positive: "Your nights are rating worse than they are measuring.",
      negative: "Your sleep is measuring worse than it is feeling.",
      none: "Your rating and your wearable agree at the moment.",
    },
  };

  function gapSentence(key, value, gapThreshold) {
    const m = GAP_MEANING[key];
    if (!m) return "";
    if (value == null) return "Not enough data yet.";
    if (Math.abs(value) < gapThreshold) return m.none;
    return value > 0 ? m.positive : m.negative;
  }

  const gapMeaning = (key) => GAP_MEANING[key] || {};

  /* ---------------- markup ---------------- */

  /* Progressive disclosure: the finding is always visible, the method is one
     tap away. Hiding the method entirely would be a different kind of
     dishonesty from showing it to everyone whether they asked or not. */
  function howToRead(bodyHtml) {
    return `<details class="howto">
      <summary>How To Read This</summary>
      <div class="howto-body">${bodyHtml}</div>
    </details>`;
  }

  function finding(text, tone = "") {
    return `<p class="finding${tone ? " finding-" + tone : ""}">${text}</p>`;
  }

  return {
    band, rankSentence, channelSentence, channelMeaning,
    compare, duration, median,
    correlationSentence, chanceSentence,
    gapSentence, gapMeaning,
    howToRead, finding,
  };
})();
