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

---

## Resume Summary

- Designed and built Myaku, a burnout-prevention app for student athletes that compares wearable data, a phone-based reaction test, and structured self-report, and reports where the three disagree.
- Developed a within-person statistical model using robust baselines, persistence rules, and adjustable sensitivity, and communicated its output in plain language labelled by strength of evidence.
- Integrated Whoop, Google Health, and Apple Health data using OAuth 2.0 with PKCE and encrypted token storage, after researching both providers' 2025 and 2026 API deprecations.
- Hardened the application with a content security policy, origin checks, rate limiting, and account export and deletion, and closed a file exposure that would have leaked the database.
- Shipped a Material 3 Expressive interface with keyboard and screen reader support, web push reminders, and thirty-six automated tests.
