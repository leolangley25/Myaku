/* Myaku — mock dataset for the prototype.
   Deterministic (not random) so the compounding burnout pattern in the
   trend chart and insights is reproducible on every load. */

const MYAKU_DATA = {

  athlete: {
    firstName: "Jordan",
  },

  // Last 7 days, physiological signal only — feeds the dashboard readiness score.
  dailyReadiness: [
    { label: "Mon", score: 74 },
    { label: "Tue", score: 71 },
    { label: "Wed", score: 68 },
    { label: "Thu", score: 69 },
    { label: "Fri", score: 63 },
    { label: "Sat", score: 61 },
    { label: "Sun", score: 64 },
  ],

  readinessBreakdown: [
    { name: "Sleep", value: "6h 42m", note: "Below Your Usual Range" },
    { name: "HRV", value: "54 ms", note: "Down from a 63 ms baseline." },
    { name: "Resting Heart Rate", value: "61 bpm", note: "Slightly Above Baseline" },
    { name: "Training Load", value: "80 / 100", note: "Highest of the last 8 weeks." },
  ],

  // 8 weeks, oldest to newest. physio/psych/burnoutRisk are 0-100 indices.
  weeklyTrend: [
    { week: "Wk 1", physio: 80, psych: 22, burnoutRisk: 18 },
    { week: "Wk 2", physio: 79, psych: 24, burnoutRisk: 20 },
    { week: "Wk 3", physio: 76, psych: 30, burnoutRisk: 26 },
    { week: "Wk 4", physio: 73, psych: 36, burnoutRisk: 32 },
    { week: "Wk 5", physio: 69, psych: 44, burnoutRisk: 41 },
    { week: "Wk 6", physio: 63, psych: 52, burnoutRisk: 52 },
    { week: "Wk 7", physio: 57, psych: 60, burnoutRisk: 61 },
    { week: "Wk 8", physio: 52, psych: 66, burnoutRisk: 68 },
  ],

  burnoutRiskStatus: {
    level: "elevated", // low | moderate | elevated
    label: "Elevated",
    summary: "Your burnout-risk trend has climbed for three straight weeks.",
  },

  checkInDue: true,

  domains: [
    {
      id: "training",
      title: "Training Load",
      prompt: "Rate how demanding training felt this week.",
    },
    {
      id: "academic",
      title: "Academic Load",
      prompt: "Rate how demanding coursework felt this week.",
    },
    {
      id: "personal",
      title: "Personal Life",
      prompt: "Rate how much personal or social strain you felt this week.",
    },
  ],

  scaleLabels: ["Very Low", "Low", "Moderate", "High", "Very High"],

  insights: [
    {
      tag: "Needs Attention",
      tagLevel: "elevated",
      finding: "Your stress tends to rise before your sleep quality drops.",
      support: "Based on the last 6 weeks of logged data.",
    },
    {
      tag: "Needs Attention",
      tagLevel: "elevated",
      finding: "Your burnout-risk trend has climbed for three straight weeks.",
      support: "Academic-stress logging rose across the same period.",
    },
    {
      tag: "New",
      tagLevel: "moderate",
      finding: "Your training-stress ratings rose faster than your training load did.",
      support: "This gap opened up starting in Week 6.",
    },
    {
      tag: "Stable",
      tagLevel: "low",
      finding: "Your resting heart rate has stayed steady this month.",
      support: "No unusual signal here right now.",
    },
  ],

  experiments: [
    {
      id: "wind-down",
      title: "Wind-Down Routine",
      status: "Active",
      statusLevel: "accent",
      variable: "Psychological",
      description: "Testing whether a consistent bedtime routine lowers evening stress.",
      progressLabel: "Day 4 of 14",
    },
    {
      id: "study-block",
      title: "Study Block Scheduling",
      status: "Complete",
      statusLevel: "neutral",
      variable: "Psychological",
      description: "Testing whether blocking dedicated study time changes academic-stress ratings on heavy-training days.",
      result: "Academic-stress ratings were slightly lower on scheduled days, but the sample is still small.",
    },
    {
      id: "caffeine-cutoff",
      title: "Afternoon Caffeine Cutoff",
      status: "Complete",
      statusLevel: "neutral",
      variable: "Physiological",
      description: "Testing whether cutting caffeine after 2pm improved sleep quality.",
      result: "Sleep score was modestly higher on cutoff days, consistent across most of the two-week window.",
    },
  ],

  supportResources: [
    {
      name: "Campus Sports Psychology",
      desc: "Confidential support for performance and mental health.",
      action: "View Contact Info",
    },
    {
      name: "Counseling Services",
      desc: "Free, confidential counseling for enrolled students.",
      action: "View Contact Info",
    },
    {
      name: "Athletic Trainer",
      desc: "For anything involving physical symptoms alongside stress.",
      action: "View Contact Info",
    },
  ],

  crisisResource: {
    name: "Crisis Support",
    desc: "If you are in crisis, immediate help is available right now.",
    detail: "Call or text 988 to reach the Suicide & Crisis Lifeline, available 24 hours a day.",
  },

  buildLog: [
    {
      date: "8/8/2026",
      phase: "Concept",
      desc: "Reframed the product around burnout prevention instead of pure performance tracking.",
      skills: ["Product Thinking", "Problem Framing"],
    },
    {
      date: "8/8/2026",
      phase: "Core Loop",
      desc: "Separated the daily readiness score from the burnout-risk trend so a single bad night never gets overweighted.",
      skills: ["Data Modeling", "UX Design"],
    },
    {
      date: "8/8/2026",
      phase: "Mental Layer",
      desc: "Replaced a generic mood slider with structured, domain-specific check-ins for training, academics, and personal life.",
      skills: ["Survey Design", "Behavioral Data"],
    },
    {
      date: "8/8/2026",
      phase: "Insights Engine",
      desc: "Combined physiological and psychological signals into one pattern engine instead of two separate dashboards.",
      skills: ["Systems Design", "Data Design"],
    },
    {
      date: "8/8/2026",
      phase: "Safety Boundary",
      desc: "Made professional support resources persistent and visible instead of a one-time disclaimer, and treated that as a hard requirement.",
      skills: ["Ethical Design", "Trust & Safety"],
    },
    {
      date: "8/8/2026",
      phase: "Self-Experiments",
      desc: "Extended the self-experiment feature to psychological variables, using the same hedged before-and-after readout as physical ones.",
      skills: ["Experiment Design", "Statistical Framing"],
    },
    {
      date: "8/9/2026",
      phase: "Accounts & Privacy",
      desc: "Added real accounts, password hashing, and session-based sign-in backed by a SQLite database.",
      skills: ["Backend Engineering", "Data Security"],
    },
    {
      date: "8/9/2026",
      phase: "Device Connections",
      desc: "Wired a stubbed Whoop, Fitbit, and Apple Health connect flow into onboarding.",
      skills: ["API Design", "Third-Party Integration"],
    },
    {
      date: "8/9/2026",
      phase: "Onboarding Calibration",
      desc: "Added a calibration step at signup so burnout-risk readings start from a real baseline.",
      skills: ["Onboarding Design", "Product Thinking"],
    },
    {
      date: "8/9/2026",
      phase: "Daily Habit Logs",
      desc: "Added persistent Caffeine, Hydration, and Screen Time pages tied to sleep and HRV correlations.",
      skills: ["Data Modeling", "UX Design"],
    },
    {
      date: "8/9/2026",
      phase: "Calendar Reminders",
      desc: "Added a one-click export for a recurring weekly check-in reminder.",
      skills: ["Feature Design"],
    },
  ],

  resumeBullets: [
    "Designed Myaku, a burnout-prevention app for student athletes that pairs physiological data with structured, domain-specific self-reports.",
    "Built a combined insights engine that surfaces compounding physical-and-mental patterns instead of reporting isolated metrics.",
    "Designed a self-experiment feature supporting hedged, evidence-based readouts for both physiological and psychological variables.",
  ],
};
