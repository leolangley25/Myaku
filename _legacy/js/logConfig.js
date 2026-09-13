/* Myaku — shared config for the Caffeine / Hydration / Screen Time log pages. */

const MYAKU_LOG_CONFIGS = {
  caffeine: {
    labelField: "What You Drank",
    labelPlaceholder: "Ex. Coffee, Energy Drink, Tea",
    amountField: "Caffeine (mg)",
    amountPlaceholder: "Ex. 95",
    submitLabel: "Log Caffeine",
    emptyNote: "No caffeine logged yet today.",
    unit: "mg",
    insight: {
      tag: "Needs Attention",
      tagLevel: "moderate",
      finding: "Caffeine after 4 PM lines up with lower sleep scores the next day.",
      support: "Based on the last 2 weeks of caffeine and sleep data.",
    },
  },
  hydration: {
    labelField: "Source",
    labelPlaceholder: "Ex. Water, Sports Drink",
    amountField: "Amount (oz)",
    amountPlaceholder: "Ex. 16",
    submitLabel: "Log Water",
    emptyNote: "No water logged yet today.",
    unit: "oz",
    insight: {
      tag: "New",
      tagLevel: "moderate",
      finding: "Low hydration days tend to line up with a higher resting heart rate.",
      support: "Based on the last 2 weeks of hydration and HRV data.",
    },
  },
  screen_time: {
    labelField: "Activity",
    labelPlaceholder: "Ex. Phone, Laptop, TV",
    amountField: "Minutes",
    amountPlaceholder: "Ex. 30",
    submitLabel: "Log Screen Time",
    emptyNote: "No screen time logged yet today.",
    unit: "min",
    insight: {
      tag: "Needs Attention",
      tagLevel: "elevated",
      finding: "Screen use after 10 PM lines up with lower sleep scores.",
      support: "Based on the last 2 weeks of screen-time and sleep data.",
    },
  },
};
