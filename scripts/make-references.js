/* Myaku — works cited.
 *
 * Every study, review, and guideline the app leans on, kept in one list and
 * written out twice: as references.html inside the app, and as REFERENCES.md for
 * anyone reading the repository. Each entry says what it shapes in Myaku, so a
 * source that stops shaping anything is easy to spot and remove.
 *
 * Every link here was checked to open the source it names. A test makes sure any
 * research link added to a page also appears in this list.
 *
 *   node scripts/make-references.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const GROUPS = [
  { id: "body", title: "Body", page: "body.html", intro: "Sleep, heart rate, and what a wearable can and cannot tell you." },
  { id: "brain", title: "Brain", page: "brain.html", intro: "The three-minute reaction test and what can throw it off." },
  { id: "life", title: "Life", page: "life.html", intro: "Check-ins, the weekly reflection, and what the Life channel reads." },
  { id: "journal", title: "Journal Prompts", page: "journal.html", intro: "Where each kind of entry comes from." },
  { id: "reading", title: "Reading Entries", page: "journal.html#counting-section", intro: "Reading journal entries on your own computer, and how much to trust it." },
  { id: "caffeine", title: "Caffeine", page: "caffeine.html", intro: "Timing, dose, and limits." },
  { id: "trends", title: "Trends And Schedule", page: "trends.html", intro: "Workload ratios and the weeks that collide." },
  { id: "later", title: "Reviewed For Later", page: null, intro: "Read while planning what comes next. Not yet part of any reading." },
];

/* authors: up to three names, then "and colleagues". venue ends without a period. */
const REFS = [
  /* ---------------- body ---------------- */
  {
    group: "body", authors: "Milewski, Skaggs, Bishop, and colleagues", year: 2014,
    title: "Chronic lack of sleep is associated with increased sports injuries in adolescent athletes",
    venue: "Journal of Pediatric Orthopaedics, 34(2), 129–133",
    url: "https://journals.lww.com/pedorthopaedics/fulltext/2014/03000/chronic_lack_of_sleep_is_associated_with_increased.1.aspx",
    shapes: "Athletes sleeping under eight hours were 1.7 times as likely to be injured, which is behind the sleep line on Body.",
  },
  {
    group: "body", authors: "American Academy of Sleep Medicine", year: 2016,
    title: "Teen sleep duration health advisory",
    venue: "Position statement, updated April 2016",
    url: "https://aasm.org/advocacy/position-statements/teen-sleep-duration-health-advisory/",
    shapes: "Eight to ten hours for ages 13 to 18, the sleep goal offered to high school athletes.",
  },
  {
    group: "body", authors: "Mah, Mah, Kezirian, and colleagues", year: 2011,
    title: "The effects of sleep extension on the athletic performance of collegiate basketball players",
    venue: "Sleep, 34(7), 943–950",
    url: "https://pubmed.ncbi.nlm.nih.gov/21731144/",
    shapes: "More sleep came with faster sprints and better shooting, which is why Body treats sleep as part of training.",
  },
  {
    group: "body", authors: "Phillips, Clerx, O'Brien, and colleagues", year: 2017,
    title: "Irregular sleep/wake patterns are associated with poorer academic performance and delayed circadian and sleep/wake timing",
    venue: "Scientific Reports, 7, 3216",
    url: "https://pubmed.ncbi.nlm.nih.gov/28607474/",
    shapes: "Irregular sleep went with lower grades even at the same total, which is behind the regularity reading on Body.",
  },
  {
    group: "body", authors: "Buchheit", year: 2014,
    title: "Monitoring training status with HR measures: do all roads lead to Rome?",
    venue: "Frontiers in Physiology, 5, 73",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3936188/",
    shapes: "What heart rate variability and resting heart rate can and cannot say about training, behind both readings on Body.",
  },

  /* ---------------- brain ---------------- */
  {
    group: "brain", authors: "Basner, Mollicone, and Dinges", year: 2011,
    title: "Validity and sensitivity of a brief psychomotor vigilance test (PVT-B) to total and partial sleep deprivation",
    venue: "Acta Astronautica, 69(11–12), 949–959",
    url: "https://pubmed.ncbi.nlm.nih.gov/22025811/",
    shapes: "The three-minute reaction test Brain runs, including the 355 millisecond line for a lapse.",
  },
  {
    group: "brain", authors: "Antler, Yamazaki, Casale, and colleagues", year: 2022,
    title: "The 3-minute psychomotor vigilance test demonstrates inadequate convergent validity relative to the 10-minute psychomotor vigilance test across sleep loss and recovery",
    venue: "Frontiers in Neuroscience, 16, 815697",
    url: "https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2022.815697/full",
    shapes: "The short test tracks the long one only loosely, which is why Brain compares weeks and gives speed the larger say.",
  },
  {
    group: "brain", authors: "Van Dongen, Maislin, Mullington, and colleagues", year: 2003,
    title: "The cumulative cost of additional wakefulness: dose-response effects on neurobehavioral functions and sleep physiology from chronic sleep restriction and total sleep deprivation",
    venue: "Sleep, 26(2), 117–126",
    url: "https://academic.oup.com/sleep/article-abstract/26/2/117/2709164",
    shapes: "Reaction time kept getting worse under short sleep while people stopped feeling it, which is why Brain measures rather than asks.",
  },
  {
    group: "brain", authors: "Kamimori, McLellan, Tate, and colleagues", year: 2015,
    title: "Caffeine improves reaction time, vigilance and logical reasoning during extended periods with restricted opportunities for sleep",
    venue: "Psychopharmacology, 232(12), 2031–2042",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4432086/",
    shapes: "Caffeine can hide fatigue on the test, which is why a dose before a session is noted.",
  },
  {
    group: "brain", authors: "Basner, Hermosillo, Nasrini, and colleagues", year: 2018,
    title: "Repeated administration effects on psychomotor vigilance test performance",
    venue: "Sleep, 41(1)",
    url: "https://pubmed.ncbi.nlm.nih.gov/29126328/",
    shapes: "Scores improve with practice, so a change across weeks is not mistaken for getting used to the test.",
  },
  {
    group: "brain", authors: "Nicosia, Wang, Aschenbrenner, and colleagues", year: 2023,
    title: "To BYOD or not: are device latencies important for bring-your-own-device (BYOD) smartphone cognitive testing?",
    venue: "Behavior Research Methods, 55(6), 2800–2812",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9918597/",
    shapes: "Phones differ by up to about 100 milliseconds in touch and display delay, which is why Brain records the device.",
  },

  /* ---------------- life ---------------- */
  {
    group: "life", authors: "Saw, Main, and Gastin", year: 2016,
    title: "Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures: a systematic review",
    venue: "British Journal of Sports Medicine, 50(5), 281–291",
    url: "https://pubmed.ncbi.nlm.nih.gov/26423706/",
    shapes: "Self-report responded to training more sensitively than objective markers, which is why Life counts as much as Body and Brain.",
  },
  {
    group: "life", authors: "Karasek", year: 1979,
    title: "Job demands, job decision latitude, and mental strain: implications for job redesign",
    venue: "Administrative Science Quarterly, 24(2), 285–308",
    url: "https://doi.org/10.2307/2392498",
    shapes: "The original demand and control model behind the strain corner.",
  },
  {
    group: "life", authors: "Kain and Jex", year: 2010,
    title: "Karasek's (1979) job demands-control model: a summary of current issues and recommendations for future research",
    venue: "Research in Occupational Stress and Well-being, 8, 237–268",
    url: "https://www.researchgate.net/publication/242179592_Karasek's_1979_job_demands-control_model_A_summary_of_current_issues_and_recommendations_for_future_research",
    shapes: "What has held up about that model since, cited on Life.",
  },
  {
    group: "life", authors: "Raedeke and Smith", year: 2001,
    title: "Development and preliminary validation of an athlete burnout measure",
    venue: "Journal of Sport and Exercise Psychology, 23(4), 281–306",
    url: "https://journals.humankinetics.com/view/journals/jsep/23/4/article-p281.xml",
    shapes: "The three burnout signs asked in the weekly reflection.",
  },
  {
    group: "life", authors: "Dišlere, Mārtinsone, Koļesņikova, and colleagues", year: 2025,
    title: "A scoping review of longitudinal studies of athlete burnout",
    venue: "Frontiers in Psychology, 16, 1502174",
    url: "https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1502174/full",
    shapes: "How burnout develops over a season, cited on Life.",
  },
  {
    group: "life", authors: "Li, Wang, Pyun, and Kee", year: 2013,
    title: "Burnout and its relations with basic psychological needs and motivation among athletes: a systematic review and meta-analysis",
    venue: "Psychology of Sport and Exercise, 14(5), 692–700",
    url: "https://doi.org/10.1016/j.psychsport.2013.04.009",
    shapes: "Unmet needs for control, competence, and connection go with burnout, which is why feeling connected now counts.",
  },
  {
    group: "life", authors: "Monteiro, Cid, Teixeira, and colleagues", year: 2020,
    title: "Understanding needs satisfaction and frustration in young athletes: factor structure and invariance analysis",
    venue: "International Journal of Environmental Research and Public Health, 17(11), 4046",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7312040/",
    shapes: "Needs being met and needs being frustrated behave as separate things in athletes, not two ends of one scale.",
  },
  {
    group: "life", authors: "Russell", year: 1980,
    title: "A circumplex model of affect",
    venue: "Journal of Personality and Social Psychology, 39(6), 1161–1178",
    url: "https://doi.org/10.1037/h0077714",
    shapes: "The two directions of the mood square, unpleasant to pleasant and calm to wired.",
  },
  {
    group: "life", authors: "Russell, Weiss, and Mendelsohn", year: 1989,
    title: "Affect grid: a single-item scale of pleasure and arousal",
    venue: "Journal of Personality and Social Psychology, 57(3), 493–502",
    url: "https://doi.org/10.1037/0022-3514.57.3.493",
    shapes: "Mood answered as one point on a grid, as the check-in and journal ask it.",
  },
  {
    group: "life", authors: "Saris, Revilla, Krosnick, and Shaeffer", year: 2010,
    title: "Comparing questions with agree/disagree response options to questions with item-specific response options",
    venue: "Survey Research Methods, 4(1), 61–79",
    url: "https://doi.org/10.18148/srm/2010.v4i1.2682",
    shapes: "Answers written for the specific question gave better data, which is why every reflection square has its own words.",
  },
  {
    group: "life", authors: "Mao", year: 2025,
    title: "Advancements in research on psychological and emotional aspects of student-athletes",
    venue: "Frontiers in Psychology, 16, 1645177",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12540375/",
    shapes: "Training load, academics, and coach or team relations were the stressors studies reported most, which is why the reader tags coach and team apart from training.",
  },

  /* ---------------- journal prompts ---------------- */
  {
    group: "journal", authors: "Frattaroli", year: 2006,
    title: "Experimental disclosure and its moderators: a meta-analysis",
    venue: "Psychological Bulletin, 132(6), 823–865",
    url: "https://pubmed.ncbi.nlm.nih.gov/17073523/",
    shapes: "Get It Out. Expressive writing helps on average across 146 trials, but the effect is small.",
  },
  {
    group: "journal", authors: "Kross and Ayduk", year: 2008,
    title: "Facilitating adaptive emotional analysis: distinguishing distanced-analysis of depressive experiences from immersed-analysis and distraction",
    venue: "Personality and Social Psychology Bulletin, 34(7), 924–938",
    url: "https://doi.org/10.1177/0146167208315938",
    shapes: "Step Outside It. Reflecting from a distance lowered distress compared with reliving it from inside.",
  },
  {
    group: "journal", authors: "Park, Ayduk, and Kross", year: 2016,
    title: "Stepping back to move forward: expressive writing promotes self-distancing",
    venue: "Emotion, 16(3), 349–364",
    url: "https://pubmed.ncbi.nlm.nih.gov/26461252/",
    shapes: "Step Outside It. Writing itself can create that distance.",
  },
  {
    group: "journal", authors: "Seligman, Steen, Park, and Peterson", year: 2005,
    title: "Positive psychology progress: empirical validation of interventions",
    venue: "American Psychologist, 60(5), 410–421",
    url: "https://pubmed.ncbi.nlm.nih.gov/16045394/",
    shapes: "Three Good Things. A week of it raised wellbeing six months later.",
  },
  {
    group: "journal", authors: "Emmons and McCullough", year: 2003,
    title: "Counting blessings versus burdens: an experimental investigation of gratitude and subjective well-being in daily life",
    venue: "Journal of Personality and Social Psychology, 84(2), 377–389",
    url: "https://pubmed.ncbi.nlm.nih.gov/12585811/",
    shapes: "Three Good Things. The weekly gratitude version that improved wellbeing.",
  },
  {
    group: "journal", authors: "Lyubomirsky, Sheldon, and Schkade", year: 2005,
    title: "Pursuing happiness: the architecture of sustainable change",
    venue: "Review of General Psychology, 9(2), 111–131",
    url: "https://doi.org/10.1037/1089-2680.9.2.111",
    shapes: "Three Good Things. Once a week worked better than three times a week, which is why it is suggested weekly.",
  },
  {
    group: "journal", authors: "Scullin, Krueger, Ballard, and colleagues", year: 2018,
    title: "The effects of bedtime writing on difficulty falling asleep: a polysomnographic study comparing to-do lists and completed activity lists",
    venue: "Journal of Experimental Psychology: General, 147(1), 139–146",
    url: "https://pubmed.ncbi.nlm.nih.gov/29058942/",
    shapes: "Tomorrow's List. A specific to-do list before bed came with falling asleep about nine minutes faster.",
  },
  {
    group: "journal", authors: "Treynor, Gonzalez, and Nolen-Hoeksema", year: 2003,
    title: "Rumination reconsidered: a psychometric analysis",
    venue: "Cognitive Therapy and Research, 27(3), 247–259",
    url: "https://doi.org/10.1023/A:1023910315561",
    shapes: "Brooding and reflecting are different, which is why no prompt asks why you feel this way and the journal watches for hard entries that circle.",
  },

  /* ---------------- reading entries ---------------- */
  {
    group: "reading", authors: "Ringwald, Taxali, Angstadt, and colleagues", year: 2026,
    title: "Scalable, context-sensitive psychiatric assessment with large language models and brief diaries",
    venue: "Psychological Medicine, 56, e231",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC13439252/",
    shapes: "Model readings of daily diaries agreed with self-reports at about .42 across people but .28 day to day, which is why your writing counts for half.",
  },
  {
    group: "reading", authors: "Soyebo, Donawa, Aguilar Barrios, and colleagues", year: 2026,
    title: "On-device language models for privacy-preserving stress prediction: a multimodal evaluation on mobile health",
    venue: "arXiv preprint 2609.11961",
    url: "https://arxiv.org/abs/2609.11961",
    shapes: "Small models running on the device itself are fast enough to read entries without sending them anywhere.",
  },
  {
    group: "reading", authors: "Eisele, Vachon, Lafit, and colleagues", year: 2022,
    title: "The effects of sampling frequency and questionnaire length on perceived burden, compliance, and careless responding in experience sampling data in a student population",
    venue: "Assessment, 29(2), 136–151",
    url: "https://pubmed.ncbi.nlm.nih.gov/32909448/",
    shapes: "Longer questionnaires, not more frequent ones, raised burden, which is why the journal counts a day instead of adding questions to it.",
  },
  {
    group: "reading", authors: "Wrzus and Neubauer", year: 2023,
    title: "Ecological momentary assessment: a meta-analysis on designs, samples, and compliance across research fields",
    venue: "Assessment, 30(3), 825–846",
    url: "https://doi.org/10.1177/10731911211067538",
    shapes: "Across 477 studies, how often people were asked did not predict whether they kept answering.",
  },

  /* ---------------- caffeine ---------------- */
  {
    group: "caffeine", authors: "Gardiner, Weakley, Burke, and colleagues", year: 2023,
    title: "The effect of caffeine on subsequent sleep: a systematic review and meta-analysis",
    venue: "Sleep Medicine Reviews, 69, 101764",
    url: "https://pubmed.ncbi.nlm.nih.gov/36870101/",
    shapes: "How much sleep caffeine costs and how timing changes it, behind the bedtime zones on Caffeine.",
  },
  {
    group: "caffeine", authors: "Gardiner, Weakley, Burke, and colleagues", year: 2025,
    title: "Dose and timing effects of caffeine on subsequent sleep: a randomized clinical crossover trial",
    venue: "Sleep, 48(4), zsae230",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11985402/",
    shapes: "400 mg twelve hours before bed still cut deep sleep, while 100 mg four hours before made no measurable difference.",
  },
  {
    group: "caffeine", authors: "Drake, Roehrs, Shambroom, and colleagues", year: 2013,
    title: "Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed",
    venue: "Journal of Clinical Sleep Medicine, 9(11), 1195–1200",
    url: "https://pubmed.ncbi.nlm.nih.gov/24235903/",
    shapes: "400 mg six hours before bed cost more than an hour of sleep that people did not notice.",
  },
  {
    group: "caffeine", authors: "Institute of Medicine", year: 2001,
    title: "Caffeine for the sustainment of mental task performance: formulations for military operations",
    venue: "National Academies Press",
    url: "https://www.nap.edu/catalog/10219",
    shapes: "Its pharmacology chapter puts caffeine's half-life near five hours, varying widely between people.",
  },
  {
    group: "caffeine", authors: "U.S. Food and Drug Administration", year: 2024,
    title: "Spilling the beans: how much caffeine is too much?",
    venue: "Consumer update",
    url: "https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much",
    shapes: "400 mg a day as the amount not generally linked with harm in healthy adults.",
  },
  {
    group: "caffeine", authors: "American Academy of Pediatrics", year: 2011,
    title: "Sports drinks and energy drinks for children and adolescents: are they appropriate?",
    venue: "Pediatrics, 127(6), 1182–1189",
    url: "https://pubmed.ncbi.nlm.nih.gov/21624882/",
    shapes: "Energy drinks have no place in young people's diets. The 100 mg a day ceiling for ages 12 to 18 is the figure widely attributed to the Academy's guidance.",
  },

  /* ---------------- trends and schedule ---------------- */
  {
    group: "trends", authors: "Gabbett", year: 2016,
    title: "The training-injury prevention paradox: should athletes be training smarter and harder?",
    venue: "British Journal of Sports Medicine, 50(5), 273–280",
    url: "https://pubmed.ncbi.nlm.nih.gov/26758673/",
    shapes: "Where the 0.8 to 1.3 workload range on Trends comes from.",
  },
  {
    group: "trends", authors: "Impellizzeri, Tenan, Kempton, and colleagues", year: 2020,
    title: "Acute:chronic workload ratio: conceptual issues and fundamental pitfalls",
    venue: "International Journal of Sports Physiology and Performance, 15(6), 907–913",
    url: "https://journals.humankinetics.com/view/journals/ijspp/15/6/article-p907.xml",
    shapes: "Why Trends shows that range with a warning rather than as a rule.",
  },
  {
    group: "trends", authors: "Heller, Herzog, Brager, and colleagues", year: 2024,
    title: "The negative effects of travel on student athletes through sleep and circadian disruption",
    venue: "Journal of Biological Rhythms, 39(1), 5–19",
    url: "https://pubmed.ncbi.nlm.nih.gov/37978840/",
    shapes: "Why travel weighs heavily when the schedule looks for weeks that collide.",
  },
  {
    group: "trends", authors: "Mann, Bryant, Johnstone, and colleagues", year: 2016,
    title: "Effect of physical and academic stress on illness and injury in Division 1 college football players",
    venue: "Journal of Strength and Conditioning Research, 30(1), 20–25",
    url: "https://pubmed.ncbi.nlm.nih.gov/26049791/",
    shapes: "Illness and injury peaked in exam weeks, which is why exams weigh heavily in the same check.",
  },

  /* ---------------- reviewed for later ---------------- */
  {
    group: "later", authors: "Kölling, Schaffran, Bibbey, and colleagues", year: 2020,
    title: "Validation of the Acute Recovery and Stress Scale (ARSS) and the Short Recovery and Stress Scale (SRSS) in three English-speaking regions",
    venue: "Journal of Sports Sciences, 38(2), 130–139",
    url: "https://doi.org/10.1080/02640414.2019.1684790",
    shapes: "An eight-item daily recovery and stress scale the check-in could align with.",
  },
  {
    group: "later", authors: "Gouttebarge, Bindra, Blauwet, and colleagues", year: 2021,
    title: "International Olympic Committee (IOC) Sport Mental Health Assessment Tool 1 (SMHAT-1) and Sport Mental Health Recognition Tool 1 (SMHRT-1): towards better support of athletes' mental health",
    venue: "British Journal of Sports Medicine, 55(1), 30–37",
    url: "https://pubmed.ncbi.nlm.nih.gov/32948518/",
    shapes: "A screening tool meant to be run with a clinician, which is why Myaku points to it rather than building it in.",
  },
  {
    group: "later", authors: "Rice, Olive, Gouttebarge, and colleagues", year: 2020,
    title: "Mental health screening: severity and cut-off point sensitivity of the Athlete Psychological Strain Questionnaire in male and female elite athletes",
    venue: "BMJ Open Sport and Exercise Medicine, 6(1), e000712",
    url: "https://pubmed.ncbi.nlm.nih.gov/32231792/",
    shapes: "The cut-off scores used by that screen.",
  },
  {
    group: "later", authors: "Dragoiu, Furtunescu, Caramoci, and colleagues", year: 2026,
    title: "International validity of the Athlete Psychological Strain Questionnaire (APSQ): a scoping review",
    venue: "Diagnostics, 16",
    url: "https://pubmed.ncbi.nlm.nih.gov/41681805/",
    shapes: "How well that screen holds up across countries.",
  },
];

/* ---------------- writing it out ---------------- */

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const end = (s) => (/[.?!]$/.test(s) ? s : s + ".");
const host = (url) => new URL(url).hostname.replace(/^www\./, "");

function html() {
  const sections = GROUPS.map((g) => {
    const refs = REFS.filter((r) => r.group === g.id);
    if (!refs.length) return "";
    const items = refs.map((r) => `          <a class="row ref-row" href="${esc(r.url)}" target="_blank" rel="noopener">
            <span class="row-main">
              <span class="row-title">${esc(end(r.title))}</span>
              <span class="row-sub">${esc(r.authors)} (${r.year}). <em>${esc(r.venue)}</em>.</span>
              <span class="ref-shapes">${esc(r.shapes)}</span>
            </span>
            <span class="ref-host" aria-hidden="true">${esc(host(r.url))}</span>
          </a>`).join("\n");
    return `
    <section class="section" id="refs-${g.id}">
      <div class="section-header">${esc(g.title)}</div>
      <p class="footnote secondary ref-intro">${esc(g.intro)}${g.page ? ` <a class="inline-link" href="${esc(g.page)}">Open ${esc(g.title.split(" ")[0])}</a>` : ""}</p>
      <div class="group">
${items}
      </div>
    </section>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Myaku — Works Cited</title>
  <meta name="theme-color" content="#060708" />
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="icon" type="image/png" href="icons/favicon-32.png" />
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Myaku" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Doto:wght@600;800&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" />
  <link rel="stylesheet" href="css/app.css" />
</head>
<!-- Generated by scripts/make-references.js. Edit the list there, not this file. -->
<body>
  <div class="screen">
    <header class="nav-large">
      <div class="eyebrow">Method</div>
      <h1 class="large-title">Works Cited</h1>
      <p class="nav-sub">Every study, review, and guideline behind Myaku, grouped by the part of the app it shapes.</p>
    </header>

    <section class="section">
      <div class="card">
        <div class="tiles">
          <div class="tile"><div class="tile-key">Sources</div><div class="tile-val">${REFS.length}</div><div class="tile-sub">Each Opens The Original</div></div>
          <div class="tile"><div class="tile-key">Newest</div><div class="tile-val">${Math.max(...REFS.map((r) => r.year))}</div><div class="tile-sub">Oldest ${Math.min(...REFS.map((r) => r.year))}</div></div>
        </div>
        <p class="footnote secondary" style="margin-top:14px;">Under each source is what it shapes in the app. Several are weaker than they sound, and the page that uses them says so where it matters.</p>
      </div>
    </section>
${sections}

    <section class="section">
      <div class="group">
        <a class="row" href="method.html">
          <span class="row-main">
            <span class="row-title">How Myaku Works</span>
            <span class="row-sub">The method behind the readings, in plain language.</span>
          </span>
          <span class="chevron" aria-hidden="true"></span>
        </a>
      </div>
    </section>

    <div style="height:24px;"></div>
  </div>

  <script src="js/motion.js"></script>
  <script src="js/explain.js"></script>
  <script src="js/core.js"></script>
  <script src="js/references.js"></script>
</body>
</html>
`;
}

function markdown() {
  const lines = [
    "# Works Cited",
    "",
    "Every study, review, and guideline behind Myaku, grouped by the part of the app it shapes. The same list is in the app at `references.html`.",
    "",
    "_Generated by `scripts/make-references.js`. Edit the list there, not this file._",
    "",
  ];
  for (const g of GROUPS) {
    const refs = REFS.filter((r) => r.group === g.id);
    if (!refs.length) continue;
    lines.push(`## ${g.title}`, "", g.intro, "");
    for (const r of refs) {
      lines.push(`- ${r.authors} (${r.year}). [${end(r.title)}](${r.url}) *${r.venue}*.  `, `  ${r.shapes}`, "");
    }
  }
  return lines.join("\n");
}

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, "references.html"), html());
  fs.writeFileSync(path.join(ROOT, "REFERENCES.md"), markdown());
  console.log(`Wrote ${REFS.length} sources to references.html and REFERENCES.md.`);
}

module.exports = { REFS, GROUPS };
