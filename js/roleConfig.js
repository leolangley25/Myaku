/* Myaku — role-aware domain labels, shared by Check-In and Calibration. */

const MYAKU_ROLE_DOMAINS = {
  student_athlete: [
    {
      id: "training",
      title: "Training Load",
      prompt: "Rate how demanding training felt this week.",
      baselinePrompt: "Rate how demanding training usually feels for you.",
    },
    {
      id: "academic",
      title: "Academic Load",
      prompt: "Rate how demanding coursework felt this week.",
      baselinePrompt: "Rate how demanding coursework usually feels for you.",
    },
    {
      id: "personal",
      title: "Personal Life",
      prompt: "Rate how much personal or social strain you felt this week.",
      baselinePrompt: "Rate how much personal or social strain you usually feel.",
    },
  ],
  individual: [
    {
      id: "training",
      title: "Activity Load",
      prompt: "Rate how demanding physical activity felt this week.",
      baselinePrompt: "Rate how demanding physical activity usually feels for you.",
    },
    {
      id: "academic",
      title: "Work Load",
      prompt: "Rate how demanding work or school felt this week.",
      baselinePrompt: "Rate how demanding work or school usually feels for you.",
    },
    {
      id: "personal",
      title: "Personal Life",
      prompt: "Rate how much personal or social strain you felt this week.",
      baselinePrompt: "Rate how much personal or social strain you usually feel.",
    },
  ],
};

function myakuDomainsForRole(role) {
  return MYAKU_ROLE_DOMAINS[role] || MYAKU_ROLE_DOMAINS.student_athlete;
}
