# Lakoli live interactive browser audit — round 4

**Date:** 2026-08-02  
**Method:** authenticated audit in the Codex in-app browser, using visible DOM state, real clicks, form inspection, screenshots, and console evidence. No record was created or changed; no payment, message, upload, export, audit run, or destructive action was submitted.

This file is the authoritative runtime supplement to the earlier bundle-derived evidence. The static bundle remains useful for discovering routes and latent code, but it does not prove that a capability is available to the audited tenant.

## Coverage achieved

- 71 distinct authenticated Lakoli routes were opened and inspected live, including every route in the five visible navigation spaces and the principal URL-only configuration routes.
- The live sidebar exposed 43 application links. The settings hub exposed 18 additional configuration tiles.
- Desktop and 390 px responsive layouts were inspected. The narrow layout exposes a fixed five-action bottom bar: Accueil, Élèves, Encaisser, Créances, Plus.
- Populated-state behavior remains unverified because the tenant contains no students, payments, staff, attendance, or messaging history.
- Teacher-only, sensitive-data, record-detail, callback, communication-send, payment-submit, archive-generation, and destructive actions remain blocked, data-dependent, or deliberately unexecuted.

## Interactions actually exercised

| Surface | Live interaction | Result |
|---|---|---|
| Sidebar | Expanded Scolarité and read the rendered link tree | React state committed normally; the previous Claude browser limitation does not apply here |
| Global search | Opened the command dialog and filtered for `paiement` | Results narrowed to Paiements en ligne, Nouveau paiement, and Caisse |
| Dashboard | Switched Vue générale → Activité → Absences | Each view rendered; the empty-tenant messages were coherent |
| Financial reports | Switched Versements reçus → Impayés → Bilan financier | Selected state changed; Bilan rendered recettes, dépenses, and résultat net |
| Attendance | Opened Registre mensuel, Statistiques, and Rapport retards | All three views committed and rendered their distinct content |
| Attendance alerts | Clicked Alertes absences from `/app/presences` | Reproducible global error boundary; see defect L-R4-01 |
| SMS | Opened Message individuel, Email aux parents, Historique, Listes, Modèles, Automatisations | All seven spaces rendered distinct controls or empty states; no message was sent |
| Cash | Opened Entrées, Sorties, Aperçu, then Clôture | Entrées/Sorties/Aperçu switch in place; Clôture navigates to `/app/cloture-caisse` |
| Canteen | Opened Dépenses, Résumé, Liste accès, Abonnés | All four views rendered |
| Transport | Opened Dépenses, Résumé, Abonnés | All three views rendered |
| Staff time clock | Opened Saisie manuelle, Anomalies et corrections, Terminaux, Rapport mensuel, Journal, Aujourd'hui | Six distinct views rendered; manual entry form was inspected but not submitted |
| Notifications | Opened the top-bar panel | Panel currently reports SMS delivery failures over the last seven days; no recent failure was present |
| Forms/modals | Opened new class, calendar event, user, staff member, and fee-category forms | Fields, validation, defaults, and action buttons were captured; all forms were closed without submission |

## Runtime corrections to the earlier audit

| Item | Live result | Correct classification |
|---|---|---|
| `/app/conformite` | Explicit `Module bientôt disponible` screen | Visible but not operational in this tenant. Latent bundle/API code is not evidence of entitlement availability |
| `/app/orientation` | Explicit `Module bientôt disponible` screen | Visible but not operational in this tenant. The route search also labels Orientation DOB `À venir` |
| `/app/programmes` | Renders 12 curriculum grids across preschool, primary, and middle school | Operational read surface; synchronization/edit actions were not submitted |
| `/app/parametres` | 18 real navigation buttons | Fully inventoried; major target routes opened individually |
| `/app/messagerie` | Seven tabs respond to live clicks | Structurally explored rather than merely recovered from JavaScript |
| `/app/presences` | Five tabs are visible; four stable, one crashes when mounted from the parent page | Partially operational with a confirmed navigation defect |
| Responsive UI | Real 390 px layout inspected | Mobile structure is assessed; full accessibility conformance is not |

## Confirmed runtime defect

### L-R4-01 — Attendance alerts tab crashes the entire application

**Severity:** High  
**Path:** `/app/presences` → `Alertes absences`  
**Reproduction:** open Présences, click the Alertes absences tab.  
**Observed result:** the application is replaced by `Quelque chose s'est mal passé` and asks the user to reload.  
**Console evidence:** minified React error 185, with the stack entering the lazy `alertes` chunk and a select component.  
**Control:** direct navigation to `/app/presences/alertes` rendered the alert dashboard successfully.  
**Inference:** mounting the alerts view inside the presence tab triggers an update loop; the alerts component itself is not universally broken.

## UX and accessibility observations from live interaction

- Calendar, user, and fee-category modals expose dialog semantics. The new-class and new-staff overlays do not expose `role="dialog"`, so screen-reader focus and modal context are inconsistent.
- Browser console warnings report missing dialog descriptions on several modal openings.
- Duplicate hidden top-bar controls coexist with visible controls at some breakpoints. Automation and assistive technologies must filter for visibility.
- Several view switchers use plain buttons rather than tab semantics, despite behaving like tabs (cash, services, staff time clock).
- The narrow financial-report view remains usable and adds the fixed bottom navigation, but the three report tabs overflow horizontally.
- The command search is one of the strongest discoverability features and accurately identifies `À venir` items.

## Screenshots

All screenshots below avoid credentials and full personal identifiers.

- `screenshots/lakoli_dashboard_configuration-progress-01.png`
- `screenshots/lakoli_pedagogy_new-class-modal-01.png`
- `screenshots/lakoli_calendar_new-event-modal-01.png`
- `screenshots/lakoli_hr_new-staff-form-01.png`
- `screenshots/lakoli_finance_new-fee-category-modal-01.png`
- `screenshots/lakoli_finance_reports-balance-tab-01.png`
- `screenshots/lakoli_communication_automations-tab-01.png`
- `screenshots/lakoli_attendance_alerts-runtime-error-01.png`
- `screenshots/lakoli_mobile_financial-reports-01.png`

## Remaining limits

- Other Lakoli roles were not available, so route-role matrices are code-derived except for the live Super Admin denials.
- Record detail pages could not be exercised on an empty tenant.
- Send, publish, payment, export-generation, archive-generation, activation, and deletion actions were deliberately not executed.
- Network payloads and server-side authorization enforcement were not probed.
- Visual checks cover normal desktop and one 390 px layout; they are not a WCAG audit or device lab.
