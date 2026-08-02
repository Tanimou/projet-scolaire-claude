# Lakoli — deep interactive workflow evidence (round 5)

Date: 2026-08-02  
Method: authenticated, interactive in-app browser exploration; desktop and narrow viewport checks; every available guided tour replayed; safe synthetic records only.  
Evidence grading: **CONFIRMED** = directly observed or executed; **DEDUCED** = strongly supported by UI behaviour and route structure; **NEEDS VALIDATION** = unavailable role, unsafe external effect, or missing dependency.

## Scope and completion statement

All discoverable Lakoli navigation entries, command-palette destinations, linked subroutes, detail screens made reachable by synthetic data, forms, tabs, buttons, filters, export controls, guides and public entry points were opened and inspected. “Revoir le guide” was explicitly used wherever available; its steps are incorporated into the workflow descriptions in report 01. The remaining gaps are explicit: teacher-only pages, sensitive-follow-up authorisation, real provider callbacks, real external messaging/payment, destructive actions, and detail states that require production data.

## Executed workflow evidence

| Workflow | Status | Direct observation |
|---|---|---|
| Class creation | EXECUTED | A synthetic class was created and became available to subsequent student and enrollment forms. The desktop modal was usable; at narrow width the fixed mobile navigation obscured its lower actions. |
| Student + guardian creation | EXECUTED | The multi-step wizard created a synthetic student and associated guardian. The class selector initially displayed a false empty/loading state, then populated asynchronously. |
| Enrollment | EXECUTED | The new-student workflow linked the synthetic student to the created class. The separate “mass enrollment” page is actually a mass **re-enrollment** transfer from a source class/year to a destination class/year. |
| Fee and receivable | EXECUTED | A synthetic fee and related receivable were created; the accounting chain was visible across categories, receivables and payment views. |
| Cash payment | EXECUTED | A synthetic payment was recorded and appeared in the journal/cash context. No real payment provider or charge was used. |
| Cafeteria | EXECUTED | Synthetic cafeteria configuration/use was created and re-opened. |
| HR and timekeeping | EXECUTED | A synthetic staff member and time entry were created. Turning that staff record into a teaching assignment exposed an email/account dependency deadlock. |
| Club/activity | EXECUTED | A synthetic activity/club was created. After navigation/reload, part of the activity state reset instead of remaining consistent. |
| Calendar | EXECUTED | A synthetic event was created and revisited. |
| Budget | EXECUTED | A synthetic budget line was created and checked in the budget surface. |
| Attendance future date | EXECUTED EDGE CASE | A future-dated attendance entry was accepted. This is a business-rule defect, not a hypothetical concern. |
| Discipline | EXECUTED EDGE CASE | The recorded discipline event was displayed under an incorrect date after save. |
| Public pre-enrollment | EXECUTED SAFE PATH | The public/parent pre-enrollment entry was inspected. It operates as a separate queue from the authenticated administrative pre-enrollment pipeline. |
| Parent payment lookup | EXECUTED READ PATH | The public matricule-based payment entry and cashier session recap were inspected. No provider callback or real charge was triggered. |

## Guide-derived workflow model

Guides describe an intended operational sequence: configure school/year/classes and fee rules; accept or create an application; verify documents; enforce payment gates; enroll; generate receivables; collect and reconcile money; produce documents; then carry the student into re-enrollment. Guides also cover finance reports, messaging campaigns, attendance, school life and configuration. Two guide mismatches were confirmed:

1. The guide on `/app/inscriptions/masse` describes the broader enrollment pipeline, while the page itself performs class/year-to-class/year mass re-enrollment.
2. The transport guide implies routes/stops, but the operational surface does not expose a complete route/stop management workflow.

## Confirmed defects and edge cases

| ID | Severity | Finding |
|---|---|---|
| L5-01 | Critical | Attendance accepts future dates, allowing impossible registers. |
| L5-02 | High | Discipline save/read path changes or misrepresents the event date. |
| L5-03 | High | Debt KPI and detailed ledger disagree (approximately 5k headline versus 8k ledger in the audited state). |
| L5-04 | High | Documents can include a refused applicant, weakening admission-state boundaries. |
| L5-05 | High | HR-to-teacher assignment requires an account/email state that the preceding workflow cannot satisfy cleanly. |
| L5-06 | High | The absence-alert tab transition crashes the application; the direct alerts route can render. |
| L5-07 | High | Period and academic-year forms reset/fail with server errors in tested paths. |
| L5-08 | Medium | Activity state does not remain stable after save/navigation. |
| L5-09 | Medium | The new-class dialog is partly hidden by fixed mobile navigation at narrow width. |
| L5-10 | Medium | Public and administrative pre-enrollment queues are not presented as one reconciled funnel. |
| L5-11 | Medium | SMS campaign credit counters briefly contradict one another (0 versus 99) during asynchronous loading. |
| L5-12 | Medium | “Other services” exposes no usable create path in the tested configuration. |
| L5-13 | Medium | Transport lacks the route/stop depth implied by onboarding material. |
| L5-14 | Medium | AI health/audit did not surface several defects reproduced manually. |
| L5-15 | Low | A staff deep link without the `/app` prefix resolves to 404. |
| L5-16 | Low | `/app/setup` remains reachable from an authenticated tenant; the subscription callback without expected parameters terminated the session. |

## Authorisation and safety boundaries

- `/app/espace-enseignant/listes` refused the super-administrator, confirming role separation; teacher workflows remain **BLOCKED_BY_ROLE**.
- `/app/vie-scolaire/suivi-sensible` requires nominative habilitation and remained **BLOCKED_BY_ROLE**.
- Real SMS/WhatsApp/email campaigns, provider payments, subscription purchases, destructive deletions, tenant exports and callbacks remained **NOT_TRIGGERED_SAFETY**.
- Two automatic SMS attempts were generated by the application during synthetic workflow execution, addressed only to a reserved synthetic test number.

## Test residue

The audit intentionally left recoverable synthetic data (class, student, guardian, fee/payment, cafeteria item, staff/time entry, club/activity, calendar event and budget entry) so the observed cross-module propagation can be rechecked. No real person, payment instrument or production contact endpoint was used.

