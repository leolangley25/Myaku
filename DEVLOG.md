# Myaku — Build Log

A dated record of how Myaku was built, kept so the work can be linked from a resume,
portfolio site, or GitHub profile. Entries describe what was true on the day they were
written; later entries note where an earlier decision was replaced.

## 8/8/2026

### Concept

Reframed the product around burnout prevention instead of pure performance tracking.

**Skills:** Product Thinking, Problem Framing

### Core Loop

Separated the daily readiness score from the burnout-risk trend so a single bad night never
gets overweighted.

**Skills:** Data Modeling, UX Design

### Mental Layer

Replaced a generic mood slider with structured, domain-specific check-ins for training,
academics, and personal life.

**Skills:** Survey Design, Behavioral Data

### Safety Boundary

Made professional support resources persistent and visible instead of a one-time disclaimer,
and treated that as a hard requirement.

**Skills:** Ethical Design, Trust & Safety

## 8/9/2026

### Accounts And Privacy

Added real accounts, password hashing, and session-based sign-in backed by a SQLite database.

**Skills:** Backend Engineering, Data Security

### Onboarding Calibration

Added a calibration step at signup so readings start from a reference point on day one.

**Skills:** Onboarding Design, Product Thinking

## 9/11/2026

### The Divergence Model

Rebuilt the product around three channels — body from a wearable, brain from a reaction test,
and life from structured self-report — and reported where they disagree rather than combining
them into one score. Each channel is compared only against the athlete's own history using
robust statistics, with a floor on the spread so consistent athletes are never flagged as
degraded, and a persistence rule so one noisy week cannot name a pattern.

**Skills:** Statistical Modeling, Systems Design, Research Translation

### Reaction Test

Built a browser-based psychomotor vigilance test with frame-accurate stimulus timing, and
worked out from first principles that one session cannot resolve the effect being measured
but a pooled week can, which is why the channel is read weekly.

**Skills:** Measurement Design, Front-End Performance

### Sensitivity Settings

Added light, medium, and heavy sensitivity, trading early warnings against false alarms, and
verified that identical data produces different named patterns at each setting.

**Skills:** Product Design, Threshold Design

### Check-In Redesign

Replaced separate sliders with two-axis pads so one gesture captures two answers, taking the
daily check-in from four numbers to eight with fewer taps. Added the athlete burnout
questionnaire's three dimensions to the weekly reflection, and let a journal rating count
toward the life channel without ever analysing journal text.

**Skills:** Interaction Design, Survey Design, Ethical Design

### Trends Analytics

Built fourteen analyses, including lead and lag between channels, a pre-registered caffeine
test, felt against measured sleep, and demand against control. Every card is labelled as a
description, an exploratory search, or a pre-registered test so no pattern is presented as
more than it is.

**Skills:** Data Analysis, Statistical Communication

## 9/12/2026

### Material 3 Expressive

Moved the design system to Material 3 Expressive with colour roles, spring-based motion
sampled into native CSS easing, ripples, shape morphing, and animated charts, all of which
degrade to a still page for people who turn motion off.

**Skills:** Design Systems, Motion Design, Accessibility

### Plain-Language Data

Rewrote every chart to lead with a sentence derived from the athlete's own data, stated ranks
as counts rather than percentiles, replaced statistical jargon, and added an explanation
panel under every chart. Added last night's sleep, heart rate variability, and resting heart
rate to the home screen, each compared against the athlete's own recent normal.

**Skills:** Data Visualization, Health Communication, UX Writing

## 9/13/2026

### Real Data Integrations

Replaced the stubbed connections with working ones: Whoop over its v2 API, Google Health for
Fitbit and Pixel devices, a streaming importer for the Apple Health export, spreadsheet
import, and manual entry. Researched that Whoop removed its v1 API and that the Fitbit Web API
shuts down on September 30, 2026, and built against their replacements. OAuth uses PKCE and
tokens are encrypted at rest.

**Skills:** API Integration, OAuth 2.0, Data Engineering

### Reminders

Added web push notifications with a scheduler that runs in each athlete's own time zone, never
reminds about something already done, and has no streaks by design, plus a calendar file as a
fallback for devices without push.

**Skills:** Notification Design, Backend Engineering, Ethical Design

### Onboarding And Guidance

Built a skippable onboarding flow, a progress view that shows how close a new athlete is to a
first reading, plain-language pattern names, and low-stakes suggestions under each pattern
that point toward a person when the pattern warrants it.

**Skills:** Onboarding Design, Retention Design, Trust & Safety

### Security Hardening

Found and closed a static file configuration that exposed the database and session secret,
and added a content security policy, request-origin checks, rate limiting, input validation,
persistent SQLite sessions, account data export, and full account deletion.

**Skills:** Application Security, Privacy Engineering

### Accessibility And Tests

Made every custom control usable by keyboard and screen reader, including a slider fallback
for the two-axis pads, and added a suite of thirty-six automated tests covering the model,
the importers, the reminder rules, and the security guarantees end to end.

**Skills:** Accessibility, Automated Testing

## 9/14/2026

### Caffeine And Sleep

Rebuilt the caffeine page around what is left at bedtime rather than what was drunk. The
curve now shows every hour, each drink, the current level, and a sleep window shaded by zones
derived from a 2023 meta-analysis and a 2025 dose and timing trial, with a scrubber that works
by touch and keyboard. Athletes with body data see their own nights grouped by the caffeine
left at bedtime, labelled as a description, alongside their usual day and the latest time their
usual drinks still fit before bed.

**Skills:** Data Visualization, Research Translation, Health Communication

### Body Channel

Rebuilt the Body channel into its own page instead of adding a new feature beside the model.
The page opens with the channel exactly as the divergence engine scores it, split into the four
measures driving it, then reads each measure the way its research does: sleep against a goal
and a schedule, and heart rate variability and resting heart rate as seven-day averages against
a personal normal range. Extended all three importers to keep when each night started and
ended, which made bedtime consistency and a bedtime target for tonight possible, and added a
comparison of the nights after hard and easy days where the Life and Body channels meet.

**Skills:** Data Engineering, Sports Science Translation, Data Visualization

### Brain, Life, And Today

Rebuilt the Brain and Life channels the same way, on a shared channel card that shows each
channel as the model scores it and which of its parts are moving it. The Brain page checks
what decides whether a week of reaction tests can be trusted, including test count, a steady
hour, the same phone, and caffeine beforehand, and sets the tests against the nights before and
against felt sharpness. After reading a 2022 study showing the three-minute test tracks the
laboratory version only loosely for lapses, response speed was given twice the weight of lapses,
and a claim on the method page about practice effects was corrected. The Life page separates
demand against control, mood, the three burnout signs, and what shows up on heavy days. Today
now opens each channel as a card naming the part behind it, with a plan for tonight.

Fixed a model flaw where a reading on a Monday judged one day of data against full weeks, by
comparing the last seven days against the seven-day stretches before them.

**Skills:** Statistical Modeling, Measurement Validity, Product Design

### Night Session Design

Replaced the Material theme with a dark instrument-panel design language inspired by performance
hardware apps: a near-black canvas under a faint dot grid, hairline cards, a floating navigation
dock, dot-matrix numerals, and radial tick gauges. Today now opens with a divergence dial that
places all three channels on one gauge, so disagreement between them is visible before anything
is read. The colour scheme was chosen for late-night use by student athletes: a heart red, for
the pulse the app is named after, marks the one action on a screen, each channel has its own hue
that never doubles as the accent, and a warmer coral is reserved for the few things that need
attention. Also fixed a sticky header that let content slide under a
transparent title while scrolling.

**Skills:** Visual Design, Design Systems, Data Visualization

### Season Trends

Rebuilt Trends around the question a season raises: how did I get here. Each past week is
recomputed exactly as the model would have read it on the last day of that week, using only the
data that existed by then, and shown as a strip of named patterns with how long the current one
has held and what came before it. The page then shows all three channels and the gaps between
them across those weeks, the weekly rhythm, recent load against normal, marked periods, the
exploratory lead-and-lag scan, and the single pre-registered caffeine test, all drawn at real
width. Analyses that now live on the channel pages were moved there rather than repeated, and
the workload ratio is labelled as contested after reading the 2020 critique of it.

**Skills:** Longitudinal Analysis, Data Visualization, Research Translation

---

## Resume Summary

- Designed and built Myaku, a burnout-prevention app for student athletes that compares wearable data, a phone-based reaction test, and structured self-report, and reports where the three disagree.
- Developed a within-person statistical model using robust baselines, persistence rules, and adjustable sensitivity, and communicated its output in plain language labelled by strength of evidence.
- Integrated Whoop, Google Health, and Apple Health data using OAuth 2.0 with PKCE and encrypted token storage, after researching both providers' 2025 and 2026 API deprecations.
- Hardened the application with a content security policy, origin checks, rate limiting, and account export and deletion, and closed a file exposure that would have leaked the database.
- Shipped a Material 3 Expressive interface with keyboard and screen reader support, web push reminders, and thirty-six automated tests.

## 9/21/2026

### Setup Portal

Rebuilt onboarding as a nine-step setup portal that leaves an account with a real starting
point instead of an empty app: who is using it, the training week, both ends of a normal
night with a sleep goal, usual levels, a season calendar, and reminders. Answers are saved
step by step, so an abandoned setup still leaves something to compare against.

**Skills:** Onboarding Design, Product Thinking

### Beyond One Audience

Added an audience to calibration, covering college, high school, club, self-coached and
masters athletes. It changes wording and which questions are asked, never the model, and the
sleep goal defaults follow the guidance for that age group.

**Skills:** Product Strategy, Inclusive Design

### The Squeeze

Turned the stub calendar import into a schedule: an imported feed or file becomes typed
events, weeks ahead are weighted by what each kind of day usually costs a night, and a week
is called busy only when it is both heavy and heavier than that athlete's own ordinary week.
The page also reports how this athlete's own nights have gone on game, travel and exam days.

**Skills:** Feature Design, Time Series Analysis

### The Assistant

Added an opt-in assistant that answers questions about an athlete's own readings. It is given
a fact sheet built by the same functions the pages draw from, told to answer only from it, and
never handed journal text, names or email. Without a key it says so rather than guessing.

**Skills:** LLM Application Design, Privacy Engineering

### A Model On This Machine

Gave the assistant a local engine through Ollama, preferred over any hosted model whenever
one is running, so an athlete's readings never leave their own device. The Ask page asks the
server which engine will answer and changes what it promises accordingly, and with no model
anywhere it shows the reading itself rather than sending anything.

**Skills:** Local Inference, Privacy Engineering

### Chat, And A Time For Every Drink

Gave the assistant its own place in the navigation bar and rebuilt it as a conversation:
bubbles, a composer that grows with what you type, a thinking indicator, and a switch on the
page itself. With a model on this machine it is on from the start, since nothing leaves the
device; a hosted model still asks first.

Fixed caffeine logging, where the time field only applied to the custom form. Quick Add always
recorded the moment you tapped it, so a coffee had at eight and logged at noon moved the curve
and the bedtime estimate by four hours. One control now sets the time for every way of adding
a drink, and the page says what time the next one will land at.

**Skills:** Interface Design, Bug Fixing

### Answers, Not Summaries

Rewrote the assistant after the first version answered every question with a summary of the
whole fact sheet. Three causes: the prompt was mostly hedging rules, the model was handed every
section whatever was asked, and the fact sheet used column names and bare spreads it could not
read the direction of. Now the question decides which sections it sees, measures are named the
way the pages name them with the direction spelled out, and the prompt asks for the answer
first, a position taken, and a real time or amount.

The medical caveat moved out of the answer and onto a line under every reply, so the answer
itself can be direct. The one line it still holds is describing the pattern rather than the
person: it will not tell an athlete they are burning out.

**Skills:** Prompt Engineering, Product Writing

### The Journal, Rebuilt

Turned the journal from a text box into something with a reason to open it. It now asks once,
before the first entry, whether the rating that follows an entry may reach the Life channel,
and the answer decides whether journal entries are passed to the model at all. The text itself
is still never read.

Five prompts replace the blank page, each drawn from a study and each saying what it is for and
what it costs: expressive writing, self-distanced reflection, three good things, post-session
reflection, and a to-do list before bed. The page suggests one based on the hour, whether there
was a session today, and what the last check-in looked like. None of them ask why you feel a
certain way, since that question sits on the rumination scale itself.

Afterwards an entry is measured against that athlete's own usual: length, how they rated the
day, and the night that followed. Over a season the page reports writing streaks, which prompts
they actually use, and how nights after a written day compare with nights without one, labelled
as description rather than cause. When several hard entries land on low days in one week, the
page says so and points at a different prompt and at a person.

**Skills:** Research Translation, Behavioral Design, Feature Design

### Seeing The Journal Before Shipping It

Built a throwaway harness that loaded the real journal markup and script against canned
answers, so the page could be looked at without an account. Three rounds of fixes came out of
it, and one real bug: the list of prompts and the count of how often each had been used were
both called modes in the same response, so the list quietly replaced the counts and the usage
section never appeared.

The page itself was rebuilt around the writing. It opens on the week as seven bars rather than
a form, the prompts became a swipeable rail of cards with their own colour, mark and minutes,
the chosen prompt is the headline above the box with its reasoning folded away behind a toggle,
and the timer is a ring that empties as it runs. After saving, an entry is drawn against the
athlete's own usual as three bars rather than described in a sentence, and eight weeks of
writing sit underneath as a block of days.

**Skills:** Interface Design, Visual Design, Debugging

## 10/1/2026

### An Ease-Of-Use Audit, Signed In

Scanned every page as a signed-in athlete at phone width, measuring length in screens, word
count, small print, tap targets, and where each page's main action sits. Two real bugs came out
of it before any redesign. The journal was blank for every signed-in user, because its container
and the page wrapper both had the id the app gives its main landmark, so the code revealed the
wrapper and left the journal hidden. And Trends labelled a week with nothing logged as Still
Learning, while Today presented a reading more than a week old as the last seven days.

The fixes, in order of what they save. Today now opens on the next thing to do as a single tap,
where the daily tasks used to sit two and a half screens down. The check-in opens on its one
required square, and the full set is a tap away, so it runs 1.6 screens instead of 3.5. Every
page that is not a tab has a way back, every long page carries its sections as chips in the
sticky header, the research behind each channel folds to its heading, and the save button on
every form stays in reach instead of sitting at the bottom of five screens.

**Skills:** Usability Auditing, Interaction Design, Debugging

## 10/2/2026

### Answer Words Written For Each Question

Every square in the weekly reflection used the same four labels, so by the third one "No Say"
and "Asked A Lot" read as filler, and nobody could say what "say" meant for a family week.
Survey research comparing answer formats finds that labels written for the specific question
produce better data than generic ones, so each area now speaks its own language. Training asks
whether the coach decided or you had input, school asks whether deadlines ruled or you set your
own pace, and life outside asks whether it was in your hands. Anyone not in school gets a work
square instead, the caring question names the sport they gave in setup, and the three burnout
signs are answered in their own words rather than "Not At All" to "Completely" three times over.
The stored numbers did not change, so every earlier week still compares.

**Skills:** Survey Design, UX Writing

### Journal Entries Read On The Athlete's Own Computer

The Life channel is the reason the app exists, and the most honest record of a day is often
what someone wrote about it. With the athlete's permission, a model running locally through
Ollama now reads each entry for mood, pressure, whether it was their call, what it was about,
and whether exhaustion, caring less, or not getting anywhere came up. There is no online
fallback, so when no model is running an entry simply waits. The model answers in words from a
fixed list rather than numbers, which small models place far more consistently, and the athlete
sees exactly what was taken from every entry and can correct it or leave it out. A 2026 study
of brief daily diaries found model readings track the same person's day-to-day changes only
weakly, around r = .28, so the reading counts for half as much as each answered part. It still
earns its place: a day the athlete wrote about counts without asking them a single extra
question, and in daily tracking it is longer questionnaires, not more frequent ones, that raise
burden. The Life page now shows what the writing keeps coming back to, the last two weeks
against the six before.

Feeling connected to people, already asked weekly, joined the channel as well, because
self-determination research links unmet needs, connection among them, with athlete burnout, and
the channel was not reading it.

**Skills:** Local AI Integration, Privacy Engineering, Research Synthesis, Testing

### Works Cited

Every study, review, and guideline the app leans on now lives in one list, written out as a
Works Cited page inside the app, reachable from More and from How Myaku Works, and as
REFERENCES.md for the repository. There are 48 sources across Body, Brain, Life, the journal,
caffeine, and trends, each with a line on what it shapes, and every link was checked against
PubMed, Crossref, or the publisher. A test fails if a page links to research the list is missing.

Checking every source turned up three claims from earlier the same day that did not hold. The
agreement figure for model-read diaries had come from a study of depression ratings, and the
study that does fit puts day-to-day agreement for the same person near r = .28, so writing now
counts for half rather than three quarters. Two studies of daily tracking found longer
questionnaires, not more frequent ones, are what wear people down, so that reason for reading
entries was rewritten. And a paper cited for answer labels stretching with each person's frame of
reference had in fact found little such effect, so it was dropped.

**Skills:** Research Verification, Technical Writing, Testing
