# 04 — Exploration Coverage Matrix

> **ROUND-5 AUTHORITATIVE COVERAGE (2026-08-02).** This matrix supersedes previous coverage classifications. “Inspected” means the page and its visible interactive states were opened; it does not imply that consequential external or destructive actions were executed.

The revision applies all five requested methods. Route coverage is challenged against the reports (**Critique and Refine**), decomposed into controls and transitions (**Problem Decomposition**), reconciled with browser/guide/source/live-stack evidence (**Source Triangulation**), expanded with negative and boundary paths (**Boundary & Edge Case Sweep**) and labelled by the stakeholder required to accept the remaining evidence (**Stakeholder Lens Rotation**). This prevents “page opened” from being mistaken for “feature proven.”

## 1. Status definitions

| Code | Meaning |
|---|---|
| **E2E** | A safe create/update workflow was executed and its propagation/read-back checked. |
| **INSPECTED** | Page, tabs, forms, links, buttons, filters and available detail states were interactively inspected. |
| **REDIRECT** | Intentional alias; canonical target was inspected. |
| **BROKEN** | Reproduced 404, crash, server error or no-op defect. |
| **BLOCKED_ROLE** | Correctly refused because the audited identity lacks the required role/habilitation. |
| **BLOCKED_DATA** | Page exists but requires a record type not present in the audited data. |
| **NOT_TRIGGERED_SAFETY** | Control was inspected but execution would contact people, move money, delete/close data or materially change security. |
| **NEEDS_VALIDATION** | Provider, server-side control, performance, accessibility or environment dependency remains. |
| **IMPLEMENTED_BUT_GATED** | A substantial implementation is present in the shipped client, but the audited tenant/entitlement exposes only a gate. |
| **SOURCE_ONLY** | Code/data contracts exist in the repository, but the hosted runtime does not currently deliver the feature. |
| **BLOCKED_BY_DEPENDENCY** | A provider, record, installed dependency or controlled environment required for execution was unavailable. |

## 2. Coverage summary

| Platform | Inventory basis | Result |
|---|---|---|
| Lakoli | Sidebar, settings hub, command palette, linked/hidden routes, public entries and shipped route metadata | Every discovered route accounted for; every super-admin/public page inspected; safe synthetic workflows executed; two role-gated domains explicit. |
| Pilotage | Every repository `page.tsx`, runtime navigation/redirect, public landing/auth links | Every source page requested/accounted; every portal browsed with populated demo data; two pages blocked only by missing dependent records. |
| Pilotage static | Workspace, API/worker modules, Prisma schema, compose/production files, auth/tenancy and test inventory | Architecture audited; clean test/typecheck execution blocked by missing worktree dependencies/generated artefacts. |

Action coverage is deliberately bounded. No real payment, real campaign, destructive deletion, subscription purchase, import apply/rollback, tenant export, role mutation or security bypass was triggered.

## 3. Lakoli route coverage

### 3.1 Steering and calendar

| Route | Status | Controls/states covered |
|---|---|---|
| `/app/` | INSPECTED | Dashboard tabs/KPIs, onboarding, priorities, error/reload boundary. |
| `/app/rapports` | INSPECTED | Date/class/cycle filters, three report tabs, CSV/print controls, guide. |
| `/app/analytics` | INSPECTED | Financial KPI/chart blocks and guide. |
| `/app/calendrier` | E2E | Month/list controls, event types, create form, synthetic event read-back. |

### 3.2 Admissions, records and year transition

| Route | Status | Controls/states covered |
|---|---|---|
| `/app/inscriptions` | INSPECTED | KPIs, tabs, filters, payment-gate language, guide. |
| `/app/inscriptions/nouvelle` | E2E | Complete three-step student/guardian/enrollment wizard; async class selector edge. |
| `/app/eleves/nouveau` | INSPECTED | Alias/alternate entry to the same creation flow. |
| `/app/inscriptions/masse` | INSPECTED | Source/destination year/class, eligibility; identified as mass re-enrollment; mismatched guide. |
| `/app/inscriptions/fin-annee` | INSPECTED | End-of-year actions/disclaimers; no bulk transition applied. |
| `/app/preinscriptions` | INSPECTED | Administrative funnel states, filters, review actions. |
| `/app/preinscriptions/nouvelle` | INSPECTED | Public/new dossier form; submission not needed after synthetic staff wizard. |
| `/app/reinscriptions/suivi` | INSPECTED | Campaign pipeline, counters, filters, Excel controls. |
| `/app/eleves` | INSPECTED | Search/filter/export, synthetic populated state. |
| `/app/eleves/import` | INSPECTED | File/column specification and receivable side effect; no import applied. |
| `/app/eleves/:id` | E2E | Synthetic identity/family/financial/detail states. |
| `/app/eleves/:id/cursus` | INSPECTED | Synthetic academic history/enrollment context. |
| `/app/parents` | INSPECTED | List/search/export and populated state. |
| `/app/parents/nouveau` | INSPECTED | Form fields; guardian already created through wizard. |
| `/app/parents/:id` | E2E | Synthetic guardian detail and linked student. |
| `/app/affectations-etat` | INSPECTED | Statuses, filters and administrative disclaimer. |
| `/app/orientation` | IMPLEMENTED_BUT_GATED | Tenant showed “coming soon”; shipped referential/campaign/wishes/freeze/export implementation was deeply inspected. |
| `/app/examens-nationaux` | INSPECTED | BEPC/BAC register/grid, save/export controls; no official submission. |
| `/app/trombinoscope` | INSPECTED | Class/student selector and synthetic populated state. |

### 3.3 Pedagogy and attendance

| Route | Status | Controls/states covered |
|---|---|---|
| `/app/classes` | E2E | List/capacity, create dialog, synthetic class, narrow-screen obstruction. |
| `/app/matieres` | INSPECTED | List/create/edit affordances and dependencies. |
| `/app/periodes` | BROKEN | Form interaction reproduced reset/server-error behaviour. |
| `/app/annees-scolaires` | BROKEN | Create/edit interaction reproduced reset/server-error behaviour. |
| `/app/programmes` | INSPECTED | Curriculum grids and editing/sync affordances; no mass overwrite. |
| `/app/affectations-enseignants` | BROKEN WORKFLOW | Assignment controls inspected; HR/account/email deadlock reproduced. |
| `/app/emploi-du-temps` | INSPECTED | Class/teacher views, edit/print affordances. |
| `/app/suivi-enseignants` | INSPECTED | KPIs, filters, Excel/PV/print controls. |
| `/app/cahier-textes` | INSPECTED | Entry/visa states and governance text. |
| `/app/notes` | INSPECTED | Context selectors, grade-entry structure and empty/populated dependencies. |
| `/app/planification-evaluations` | INSPECTED | Planner and prerequisite gates. |
| `/app/bulletins` | INSPECTED | Class/period selectors and print controls; output dependency explicit. |
| `/app/presences` | E2E/BROKEN | Register/stats/monthly/lateness tabs; future attendance accepted; embedded alerts transition crashes. |
| `/app/presences/alertes` | INSPECTED | Direct route renders despite tab-transition crash. |
| `/app/exports-cio` | INSPECTED | Three-step export and compatibility disclaimer; no official file transmitted. |

### 3.4 School life and restricted teacher space

| Route | Status | Controls/states covered |
|---|---|---|
| `/app/vie-scolaire/discipline` | E2E/BROKEN | Incident/sanction form; saved date read-back defect. |
| `/app/vie-scolaire/activites` | E2E/BROKEN | Activity domains/types/create; synthetic state reset inconsistency. |
| `/app/vie-scolaire/suivi-sensible` | BLOCKED_ROLE | Nominative habilitation correctly required. |
| `/app/espace-enseignant/listes` | BLOCKED_ROLE | Teacher-only space correctly refuses super-admin. |
| `/app/espace-enseignant/classes/:id` | BLOCKED_ROLE | Not probed after explicit role refusal. |
| `/app/espace-enseignant/` | BROKEN | No index page/404. |

### 3.5 Finance, cash and services

| Route | Status | Controls/states covered |
|---|---|---|
| `/app/paiement-parent` | E2E | Guided counter payment using synthetic receivable; no external provider. |
| `/app/paiements` | E2E | Journal/search/filter and synthetic payment read-back. |
| `/app/paiements/session` | INSPECTED | Cashier-session recap and totals. |
| `/app/paiements-en-ligne` | INSPECTED | Reconciliation statuses/configuration; provider unconfigured. |
| `/app/paiements-en-ligne/portail` | INSPECTED | Public matricule lookup/payment entry; no charge. |
| `/app/paiements-en-ligne/callback` | NOT_TRIGGERED_SAFETY | Provider callback requires signed sandbox/real transaction. |
| `/app/caisse` | E2E | Session/balance/journal tabs and synthetic payment effect. |
| `/app/cloture-caisse` | INSPECTED/NOT_TRIGGERED_SAFETY | Closing/PV controls; no accounting close. |
| `/app/creances` | E2E/BROKEN DATA | Synthetic ledger and filters; headline ≈5k versus detail ≈8k contradiction. |
| `/app/categories-frais` | E2E | Category/rule controls and synthetic charge. |
| `/app/remises` | INSPECTED | Criteria/restrictions/form; no real balance adjustment. |
| `/app/budget` | E2E | Synthetic budget line and KPI/read-back. |
| `/app/reconciliation` | INSPECTED | Reconciliation table/states; provider data absent. |
| `/app/anti-fraude` | INSPECTED | Status/severity/filter and review affordances. |
| `/app/cantine` | E2E | Tabs/configuration and synthetic state. |
| `/app/transport` | INSPECTED/PARTIAL | Surface and guide; no complete route/stop workflow exposed. |
| `/app/autres-services` | BROKEN/NO-OP | Configuration dependency shown; no usable create path. |

### 3.6 Communication and family portal

| Route | Status | Controls/states covered |
|---|---|---|
| `/app/messagerie` | INSPECTED | All message tabs, templates, audiences, automation, individual/bulk controls; no real send. |
| `/app/messagerie/campagnes` | INSPECTED | Full campaign builder, scheduling/audience/template; 0/99 async credit contradiction. |
| `/app/whatsapp` | INSPECTED | Seven templates and individual/bulk/debt/re-enrollment deep-link flows. |
| `/app/credit-communication` | INSPECTED | Packs, wallet and ledger; no purchase. |
| `/app/sms-logs` | INSPECTED | Delivery/status filters and development/simulated indicators. |
| `/app/portail-parent` | INSPECTED | Activation/configuration overview; no tenant-wide activation change. |
| `/app/portail-parent/preinscriptions` | INSPECTED | Separate public-dossier queue and filters. |
| `/app/portail-parent/dossier/:id` | BLOCKED_DATA | No submitted public dossier. |
| `/app/portail-parent/parametres` | INSPECTED | Portal settings and form controls. |

### 3.7 HR, administration, settings and public/auth

| Route | Status | Controls/states covered |
|---|---|---|
| `/app/rh` | E2E | Staff list/KPIs/departments and synthetic staff. |
| `/app/rh/:id` | E2E | Synthetic staff detail and identity/assignment edge. |
| `/app/rh/pointages` | E2E | Six tabs and synthetic time entry. |
| `/app/parametres/rh` | INSPECTED | Social/tax/settings fields. |
| `/app/documents` | INSPECTED/BROKEN DATA | 12 generators; refused applicant included in eligible population. |
| `/app/conformite` | IMPLEMENTED_BUT_GATED | Tenant showed “coming soon”; shipped preparation/reconciliation/ActuMoyenne implementation was deeply inspected. |
| `/app/utilisateurs` | INSPECTED | List/create/activation/role controls; no real-user mutation. |
| `/app/audit` | INSPECTED | Actor/action/module/IP/time fields and filters. |
| `/app/audit-ia` | INSPECTED/WEAK RESULT | Health controls/results; failed to flag reproduced defects. |
| `/app/admin/suppressions` | INSPECTED/NOT_TRIGGERED_SAFETY | Approval-gated deletion queue; no deletion. |
| `/app/abonnement` | INSPECTED/NOT_TRIGGERED_SAFETY | Plans/consent/payment controls; no purchase. |
| `/app/abonnement/callback` | BROKEN EDGE | Missing parameters ended the session. |
| `/app/parametres` | INSPECTED | All settings tiles opened or target reconciled. |
| `/app/parametres/infos-generales` | INSPECTED | Full school identity/administrative form. |
| `/app/parametres/paiement` | INSPECTED | Paystack/CinetPay/provider configuration; no secret change. |
| `/app/parametres/export-resiliation` | NOT_TRIGGERED_SAFETY | Tenant-wide portable archive control. |
| `/app/aide` | INSPECTED/PARTIAL | Article/tutorial tree; some article click-throughs fail to load. |
| `/app/conditions-et-tarifs` | INSPECTED | Terms/tariff surface. |
| `/app/login` | INSPECTED | Login/recovery fields and session transitions. |
| `/app/espaces` | INSPECTED/EDGE | Space chooser/session behaviour inspected. |
| `/app/setup` | INSPECTED/EDGE | Blank/new-school setup remains accessible from authenticated tenant. |

### 3.8 Lakoli controls and edge-case coverage

| Control class | Coverage |
|---|---|
| Guided tours | Every available “Revoir le guide” tour was replayed; mismatches documented. |
| Create forms | Class, student/guardian/enrollment, fee/payment, cafeteria, HR/time, activity, calendar and budget executed with synthetic data. Remaining forms inspected without consequential submit. |
| Edit/delete | Safe read/edit states inspected; destructive deletes/closing/tenant export not triggered. |
| Filters/tabs | Every visible tab/filter in major pages exercised; absence-alert tab crash reproduced. |
| Public flow | Pre-enrollment and matricule payment entries inspected; no real application/provider charge. |
| Responsive | Desktop and narrow viewport; mobile navigation obstruction reproduced. |
| RBAC | Super-admin and two explicit denials tested; other role UIs require credentials. |
| External channels | Builder/log inspected; real SMS/email/WhatsApp/provider effects not triggered. |

## 4. Pilotage route coverage

### 4.1 Public and missing non-source pages

| Route | Status | Observation |
|---|---|---|
| `/` | INSPECTED | Marketing, navigation, claims and portal links. |
| `/admin/login`, `/teacher/login`, `/parent/login`, `/student/login` | INSPECTED | Login, recovery, wrong-portal behaviour. |
| `/admin/register`, `/teacher/register` | INSPECTED | Invitation-only forms; hosted Maildev development leak. |
| `/parent/register` | INSPECTED | Open registration form, password/consent rules; not submitted. |
| `/legal/privacy`, `/legal/terms`, `/legal/cookies` | BROKEN | 404 despite consent links. |
| `/pricing`, `/contact`, `/help` | BROKEN | 404 despite landing/header links. |
| `/admin/reports`, `/admin/classes/new` | BROKEN | Expected/linked routes absent or crashing; no source page. |
| `/teacher/profile`, `/parent/profile`, `/teacher/messaging` | BROKEN | Header/class links lead to absent routes. |

### 4.2 Admin source pages

| Source route | Status | Principal coverage/result |
|---|---|---|
| `/admin/dashboard` | INSPECTED | KPIs/action centre; numerous cross-page contradictions. |
| `/admin/academic-years` | INSPECTED | Current 2023–24; create form/default-active edge. |
| `/admin/alerts` | INSPECTED | Rule types/toggles/evaluate/actions; 4-vs-0 contradiction. |
| `/admin/analytics` | INSPECTED | Tables/charts/filters; 417/420 assessment-grade contradiction. |
| `/admin/announcements` | REDIRECT | Redirects to communications; target inspected. |
| `/admin/announcements/new` | INSPECTED | Composer/audience estimate/role breakdown; no publish. |
| `/admin/announcements/[id]` | INSPECTED | Recipients/read status/actions; seed metadata. |
| `/admin/assessments` | INSPECTED | Filters/table/zero state contradicts analytics/teacher. |
| `/admin/assignments` | INSPECTED | 290 rows/118 warnings; filters/actions/scale. |
| `/admin/attendance` | INSPECTED | Counts/filters/records and year context. |
| `/admin/audit` | BROKEN | Server component error reproduced. |
| `/admin/calendar` | E2E | Event/filter/form; no-confirmation import added 22 holidays. |
| `/admin/child-claims` | INSPECTED | Queue/empty state/actions; no pending claim. |
| `/admin/classes` | INSPECTED | List/capacity/search/action links. |
| `/admin/classes/[id]` | E2E | Detail/roster/capacity; synthetic enrollment propagated. |
| `/admin/communications` | INSPECTED | Announcement list/KPIs/actions. |
| `/admin/conversations` | INSPECTED | Moderation list/filter/report context. |
| `/admin/cycles` | REDIRECT | Redirects to levels; target inspected. |
| `/admin/enrollment-requests` | REDIRECT | Redirects to enrollments; target inspected. |
| `/admin/enrollments` | E2E/CONTRADICTORY | Full-class rejection and successful enrollment; queue says zero vs dashboard 28. |
| `/admin/establishment` | INSPECTED | Identity/branding fields and tabs. |
| `/admin/exports` | INSPECTED | Export types/history/download controls; no job generated. |
| `/admin/guardians` | INSPECTED | List/search/detail links and relation columns. |
| `/admin/imports` | INSPECTED | History/empty state. |
| `/admin/imports/new` | INSPECTED | Five types, file constraints and generic wizard; no upload. |
| `/admin/imports/[id]` | BLOCKED_DATA | No import batch exists. |
| `/admin/integrations` | INSPECTED | OneRoster/REST surfaces; REST incomplete. |
| `/admin/levels` | INSPECTED | Cycles/levels/counter inconsistencies/forms. |
| `/admin/meeting-requests` | INSPECTED | Queue/status/actions. |
| `/admin/notifications` | INSPECTED | List/empty/read controls and preferences links. |
| `/admin/remediation` | INSPECTED | Catalogue/plan management/forms. |
| `/admin/roles` | INSPECTED | Four system roles, permissions/custom role state. |
| `/admin/roles/new` | INSPECTED | Permission builder; no role created. |
| `/admin/roles/[id]` | INSPECTED | System-role detail and immutability. |
| `/admin/roles/[id]/edit` | BLOCKED_DATA | No custom role; system roles cannot be edited. |
| `/admin/school/branding` | REDIRECT | Redirects to establishment. |
| `/admin/school/structure` | INSPECTED | Hierarchy/capacity including 29/28 class. |
| `/admin/schools` | INSPECTED | List/create/switch controls; no school created. |
| `/admin/settings` | INSPECTED | General/security/notifications/retention/export tabs. |
| `/admin/students` | INSPECTED | Search/filter/pagination/KPIs. |
| `/admin/students/new` | E2E/BROKEN FIELD | Synthetic create; date of birth silently dropped. |
| `/admin/students/[id]` | E2E | Profile/enrollment/guardian tabs and synthetic record. |
| `/admin/subjects` | INSPECTED | Subjects/coefficient/staffing controls. |
| `/admin/teachers` | INSPECTED | List/search/pagination; 177-vs-187 contradiction. |
| `/admin/teachers/[id]` | INSPECTED | Profile/assignments/custom role anomaly. |
| `/admin/teaching-assignments` | REDIRECT | Redirects to assignments. |
| `/admin/users` | INSPECTED | 191 users, role assign controls, connection states. |
| `/admin/users/invite` | INSPECTED/NOT_TRIGGERED_SAFETY | Invitation fields/roles and Maildev leak; no email sent. |

### 4.3 Teacher source pages

| Source route | Status | Principal coverage/result |
|---|---|---|
| `/teacher/dashboard` | INSPECTED/BROKEN LINK | Classes/action centre/quick actions; assessment URL uses wrong ID. |
| `/teacher/classes` | INSPECTED | Two classes, counts/links. |
| `/teacher/classes/[id]` | INSPECTED | Roster/actions; 25-vs-26 count mismatch. |
| `/teacher/classes/[id]/grades` | BROKEN | Expects teachingAssignmentId but receives class ID. |
| `/teacher/classes/[id]/attendance` | INSPECTED | Date/status/session controls; no session for class, 2026-vs-2023 year edge. |
| `/teacher/classes/[id]/lessons` | INSPECTED | Create form/status; defaults Published. |
| `/teacher/assessments` | INSPECTED/CONTRADICTORY | Zero vs dashboard/reports/grades. |
| `/teacher/grades` | INSPECTED/CONTRADICTORY | 46 rows, KPI 42, average/filter/export. |
| `/teacher/students` | INSPECTED | Student list/search/count inconsistencies. |
| `/teacher/calendar` | INSPECTED | Event modal/filters; 37-vs-39 totals. |
| `/teacher/documents` | INSPECTED | Empty list/filter; direct upload explicitly deferred. |
| `/teacher/messages` | INSPECTED | Published message list/row actions/empty state. |
| `/teacher/messages/new` | INSPECTED/BROKEN DATA | Audience builder calculates zero for known families; no send. |
| `/teacher/conversations` | INSPECTED | Thread list/unread/report filters. |
| `/teacher/conversations/[id]` | INSPECTED | Context/reply/report; opening marked read, no send. |
| `/teacher/meeting-requests` | INSPECTED | List/status/action controls. |
| `/teacher/remediation` | INSPECTED | Weekly slot, pending booking, publish/form governance mismatch. |
| `/teacher/reports` | INSPECTED/CONTRADICTORY | 2 assessments/46 grades/11.1 average vs other pages. |
| `/teacher/notifications` | INSPECTED | Empty state despite announcement/conversation. |
| `/teacher/settings` | INSPECTED | Preference toggles and parent-copy leak. |

### 4.4 Parent source pages

| Source route | Status | Principal coverage/result |
|---|---|---|
| `/parent/dashboard` | INSPECTED | Active child, grade, attendance, rank, remediation. |
| `/parent/children` | INSPECTED/CONTRADICTORY | Says no active enrollment despite dashboard/detail. |
| `/parent/children/[id]` | INSPECTED | Active child/grade/attendance details. |
| `/parent/children/[id]/report` | INSPECTED | Printable report and rounding/year edge. |
| `/parent/grades` | BROKEN DATA | Returns zero with valid child while other portals show grade. |
| `/parent/subjects` | INSPECTED | Published grade/subject context. |
| `/parent/upcoming` | INSPECTED | Filters/time horizons/empty state. |
| `/parent/attendance` | INSPECTED/BROKEN DATA | Seven rows; wrong-class/history ambiguity and invalid trend. |
| `/parent/lessons` | INSPECTED | Lesson cards/filters/empty states. |
| `/parent/comments` | INSPECTED | Comment list/filter/empty state. |
| `/parent/recommendations` | INSPECTED | Alert/next-step actions and remediation links. |
| `/parent/announcements` | INSPECTED | Whole-school announcement visible. |
| `/parent/announcements/[id]` | INSPECTED | Detail/read state/seed-author leak. |
| `/parent/messages` | INSPECTED | Conversation list and unread state. |
| `/parent/messages/new` | INSPECTED | Child/teacher/context composer; no send. |
| `/parent/messages/[id]` | INSPECTED | Thread/reply/report; opening marked read. |
| `/parent/notifications` | INSPECTED | Zero despite other events. |
| `/parent/calendar` | INSPECTED | Filters/event modal; 14→36 async counters and holidays. |
| `/parent/documents` | INSPECTED | Empty despite message referring to attachment; bulletin controls. |
| `/parent/communication` | INSPECTED | Communication overview/channel controls. |
| `/parent/remediation/[planId]` | INSPECTED/AUTHORITY EDGE | Parent can achieve/close school plan; no direct booking. |
| `/parent/settings` | INSPECTED/CONTRADICTORY | All tabs; family state says none, notification defaults. |

### 4.5 Student source pages

| Source route | Status | Principal coverage/result |
|---|---|---|
| `/student/dashboard` | INSPECTED | Grade and remediation summary. |
| `/student/grades` | INSPECTED | Published grade visible. |
| `/student/upcoming` | INSPECTED | Empty upcoming evaluations. |
| `/student/attendance` | INSPECTED | Seven records/71%, limited context. |
| `/student/announcements` | BROKEN DATA | Whole-school announcement absent. |

Student negative RBAC tests against admin/teacher/parent were **E2E PASS**. Student has no source profile/settings route; help is the common 404.

### 4.6 Pilotage static/technical coverage

| Layer | Status | Evidence/limit |
|---|---|---|
| Workspace/packages | INSPECTED | pnpm/Turbo/Node and all app/package manifests. |
| Web routes/components | INSPECTED | Every `page.tsx`; key action/link/auth components traced. |
| API modules/controllers | INSPECTED | Module inventory, auth/permission/tenant paths and domain services. |
| Worker/jobs | INSPECTED | Alerts, analytics, imports, exports, notifications, remediation. |
| Prisma model | INSPECTED | Complete domain entity inventory and tenant relationships. |
| Docker/prod | INSPECTED | Dev/prod compose, migration/seed, ingress and optional observability. |
| Tenant/RLS | INSPECTED/CRITICAL | Constant demo tenant; `withTenant` unused; no SQL RLS policy found. |
| Tests | INVENTORIED | 50 spec files: 32 API, 12 worker, 6 web/Playwright. |
| Test/typecheck execution | BLOCKED_DATA/DEPENDENCY | Jest/workspace/Next dependencies and generated types absent in worktree. |
| Security testing | NEEDS_VALIDATION | No penetration test, provider test, backup/restore or cross-tenant attack performed. |
| Accessibility | NEEDS_VALIDATION | Source has axe assets; no complete keyboard/screen-reader/contrast audit in this run. |

## 5. State changes and safety disclosure

| Platform | State left by audit | Reversibility |
|---|---|---|
| Lakoli | Synthetic class, student, guardian, fee/payment, cafeteria, staff/time, activity, calendar and budget records; two SMS attempts to a reserved synthetic number. | Recoverable test data; no real recipient or money. |
| Pilotage | Synthetic student and successful enrollment; one rejected capacity attempt; read-state changes on seeded items. | Recoverable demo data. |
| Pilotage calendar | 22 French holidays added to active 2023–2024 by an immediate no-confirmation control. | Not reversed without explicit user authorisation. |

## 6. Remaining evidence gaps

The exploration inventory is complete; residual gaps are validation classes, not forgotten pages:

- Lakoli teacher and sensitive-follow-up roles;
- real provider sandbox callbacks and message delivery;
- Pilotage import-batch detail/apply/rollback and custom-role edit/deny;
- full CI execution in a clean dependency environment;
- database cross-tenant adversarial testing and migration/restore rehearsal;
- load/queue/object-storage/observability validation;
- complete WCAG and penetration testing.

Primary evidence:

- [`audit-evidence/lakoli/lakoli_deep-workflow-browser-audit-07.md`](audit-evidence/lakoli/lakoli_deep-workflow-browser-audit-07.md)
- [`audit-evidence/internal/internal_hosted-multirole-browser-audit-04.md`](audit-evidence/internal/internal_hosted-multirole-browser-audit-04.md)

---

## 7. Lakoli control- and workflow-level coverage

The route tables above establish navigation coverage. This table establishes whether the important control families, lifecycle branches and outputs were inspected or executed.

| Domain | Feature/control family | Coverage action | Result/status | Residual evidence owner |
|---|---|---|---|---|
| Setup | School identity, cycles and administrator setup | Opened setup and configuration surfaces; inspected fields and continued-access behaviour | **INSPECTED**; post-setup `/app/setup` remains reachable | Vendor security/product |
| Setup | Ten-step onboarding checklist | Replayed available “Revoir le guide” tours and reconciled targets/rules | **INSPECTED**; guide/runtime mismatches recorded | Product/QA |
| Reference | Academic-year form and activation | Opened, submitted safe synthetic attempts | **BROKEN** reset/server error | Engineering |
| Reference | Period type/dates/weights/closure | Inspected form, guide, client state rules; safe create attempt | **BROKEN** at form/server path; close not triggered | Engineering + Direction |
| Reference | Class create/capacity/mark scale | Created synthetic class and checked selector propagation; narrow viewport tested | **E2E** plus mobile obstruction | Registrar + UX |
| Reference | Subject/curriculum grid | Inspected CRUD/seed/order/sync contracts and guides | **INSPECTED** | Academic lead |
| Reference | Timetable rooms/slots/conflicts/print | Inspected surface and conflict vocabulary | **INSPECTED**; conflict override not executed | Academic lead |
| Admissions | New student wizard | Executed synthetic identity/family/class chain | **E2E** | Registrar |
| Admissions | Guardian/principal-contact linkage | Created synthetic guardian and checked related views | **E2E** | Registrar/family |
| Admissions | Enrollment/receivable generation | Executed safe synthetic enrollment and checked downstream finance | **E2E** | Registrar/accountant |
| Admissions | Finance-zero gate and payment requirement | Inspected guides/client guards | **INSPECTED**; Direction exception not executed | Direction/accountant |
| Admissions | Pre-payment correction/lock after payment | Inspected success and guide rules; performed payment but avoided destructive correction | **NOT_TRIGGERED_SAFETY** for reversal combinations | Accountant |
| Admissions | Required-document checklist/control | Inspected document types/statuses/reason controls | **INSPECTED**; upload/conformity cases not fully executed | Registrar/DPO |
| Admissions | Staff pre-enrollment queue | Opened list/forms/states | **INSPECTED** | Registrar |
| Admissions | Public pre-enrollment | Opened public path and parent queue | **INSPECTED**; silo confirmed | Registrar/product |
| Admissions | Refusal boundary | Reused existing refused dossier in document population | **BROKEN** refusal leaked to output | Registrar/DPO |
| Admissions | Bulk student import | Inspected formats/columns/preview/2,000 limit/receivable confirmations | **NOT_TRIGGERED_SAFETY** | Data migration owner |
| Admissions | End-of-year decisions | Inspected outcomes/non-computability/freeze/reopen/hash rules | **INSPECTED**; no official freeze | Direction |
| Admissions | Re-enrollment campaign | Inspected six steps, four state axes and guides | **BLOCKED_DATA** for cross-year E2E | Registrar/finance |
| Admissions | State-assignment registry | Inspected official/declarative source and immutable event rules | **INSPECTED** | Registrar/auditor |
| Admissions | Two-person deletion | Inspected request and approval/reject controls | **NOT_TRIGGERED_SAFETY** | Direction/DPO |
| Finance | Fee category form/scope/schedule | Created safe synthetic fee and checked downstream charge | **E2E** | Accountant |
| Finance | Receivable ledger/filter/status | Inspected synthetic and existing ledger rows | **E2E**; aggregate mismatch | Accountant |
| Finance | Discount criteria | Inspected restrictions and forms | **INSPECTED** | Accountant |
| Finance | Counter payment/modes/receipt | Executed synthetic cash payment | **E2E** | Cashier/accountant |
| Finance | Cash session/journal | Checked propagation from payment | **E2E** | Cashier |
| Finance | Cash contribution | Inspected separate physical-cash semantics | **INSPECTED** | Cashier |
| Finance | Expense draft/approve/reject | Inspected controls and state model | **NOT_TRIGGERED_SAFETY** | Accountant/Direction |
| Finance | Daily closing/PV/variance | Inspected theoretical/real and one-close rule | **NOT_TRIGGERED_SAFETY** | Accountant/Direction |
| Finance | Mass cancellation/refund/overpayment | Inspected typed confirmation and refund forms | **NOT_TRIGGERED_SAFETY** | Accountant/auditor |
| Finance | Reconciliation | Inspected internal/provider layers | **INSPECTED**; provider data absent | Accountant |
| Finance | Anti-fraud | Inspected nine anomaly categories and review surface | **INSPECTED**; detector efficacy unvalidated | Auditor |
| Finance | Budget | Created safe synthetic item and checked view | **E2E** | Direction/accountant |
| Finance | Provider setup/payment link/callback | Inspected test/production/provider/callback surfaces | **BLOCKED_BY_DEPENDENCY**; callback-no-param logout defect | Finance/engineering |
| Finance | SMS wallet/recharge | Inspected balance, packs, thresholds and verify contract | **INSPECTED**; no real recharge | Finance/product |
| Services | Cafeteria subscription/charge/expense | Executed safe synthetic cafeteria path | **E2E** | Service manager/accountant |
| Services | Transport | Inspected subscription/charge and guide | **INSPECTED**; route/stop depth absent | Service manager |
| Services | Generic services | Opened framework and configuration-dependent empty state | **BLOCKED_DATA**; no create action | Product |
| Pedagogy | Teacher assignment | Inspected and attempted HR-to-assignment bridge | **BROKEN** identity/email deadlock | HR/academic lead |
| Pedagogy | Assessment/score/publication/revision | Inspected forms, state/API contracts and guides | **BLOCKED_ROLE** for E2E | Teacher/academic lead |
| Pedagogy | Bulletins provisional/official | Inspected four gates, watermark, archive and outputs | **NOT_TRIGGERED_SAFETY** | Direction |
| Pedagogy | Lesson-book submit/visa/correction | Inspected shipped workflow | **BLOCKED_ROLE** | Teacher/academic lead |
| Pedagogy | Attendance register | Created future-dated synthetic attendance and read back | **E2E → BROKEN** future accepted | Teacher/registrar |
| Pedagogy | Attendance alerts navigation | Opened embedded tab and direct route | **BROKEN** tab crash; direct route **INSPECTED** | Engineering |
| Pedagogy | Attendance corrections/print/SMS | Inspected contracts and outputs | **NOT_TRIGGERED_SAFETY** for parent SMS | Teacher/registrar |
| Pedagogy | Compositions rooms/conflicts/SMS | Inspected guards and lifecycle | **NOT_TRIGGERED_SAFETY** | Academic lead |
| Pedagogy | Offline notes/attendance queue | Inspected client contract: 100 items, 30 days, conflicts and logout clearing | **BLOCKED_ROLE/NEEDS_VALIDATION** | Teacher/engineering |
| School life | Discipline incident/measure | Created synthetic incident and checked chronology | **E2E → BROKEN** wrong saved/read date | Direction/safeguarding |
| School life | Clubs/activity lifecycle | Created club/activity and revisited | **E2E → BROKEN** state instability | Activities lead |
| School life | Protected follow-up grant wall | Attempted entry without grant | **BLOCKED_ROLE** correctly | DPO/safeguarding |
| Orientation | Referential/campaign/wishes/freeze/exports | Tenant gate observed; shipped forms/states/rules/API inspected | **IMPLEMENTED_BUT_GATED** | Vendor + Direction |
| Conformity | Official preparation/snapshot/generate | Tenant gate observed; client blocks/fields/states inspected | **IMPLEMENTED_BUT_GATED** | Vendor + Direction |
| Conformity | External file reconciliation | Inspected CSV/XLSX validation, idempotence, anomalies and decision reasons | **IMPLEMENTED_BUT_GATED** | Vendor + auditor |
| Conformity | ActuMoyenne local mapping | Inspected 27-field local-only flow and attestation | **IMPLEMENTED_BUT_GATED** | Vendor + registrar |
| Communication | Individual SMS | Inspected search/templates/segments; observed two synthetic transactional attempts | **INSPECTED**; real delivery not proven | Communications owner |
| Communication | Campaign compose/simulate/rules | Inspected audiences, mandatory simulation, 16 triggers and recent-payment exclusion | **NOT_TRIGGERED_SAFETY** | Communications/finance |
| Communication | Email | Inspected compose/preview | **NOT_TRIGGERED_SAFETY** | Communications |
| Communication | Lists/templates/history | Inspected CRUD/history/export | **INSPECTED**; lists unusable as send target | Product |
| Communication | WhatsApp assistants | Inspected templates/deep links/local persistence | **NOT_TRIGGERED_SAFETY**; no API delivery | Communications/DPO |
| Communication | Parent OTP portal | Inspected enrolled-parent/public spaces and settings | **INSPECTED** | Family support/security |
| HR | Staff create/account option | Created synthetic staff and read back | **E2E** | HR |
| HR | Contract lifecycle/payroll | Inspected forms, rubrics, batch/freeze/print states | **NOT_TRIGGERED_SAFETY** | HR/finance |
| HR | Single/bulk pointage | Created safe synthetic time event; inspected bulk four-eyes | Single **E2E**; bulk **NOT_TRIGGERED_SAFETY** | HR |
| Documents | Official generators/registry | Inspected ten types, branding, snapshot and registry claims | **INSPECTED**; QR authenticity not validated | Registrar/Direction |
| Governance | Audit/action diff | Inspected runtime records and client catalogue | **INSPECTED**; proxy IP/completeness needs validation | Auditor |
| Governance | AI quality audit | Ran/read audit against known state | **E2E**; missed reproduced defects | Direction/product |
| Governance | Tenant exit archive | Inspected reason/name/idempotency/concurrency/hash flow | **NOT_TRIGGERED_SAFETY** | DPO/Direction |
| Platform | Multi-space/establishment switch | Inspected selectors and shipped contracts | **INSPECTED**; cross-tenant isolation untested | Security |
| Platform | Auth/recovery/demo/presenter | Inspected login/OTP/modes; callback edge tested indirectly | **INSPECTED**; help contradiction and logout edge | Security/support |
| Platform | Responsive/accessibility | Narrow viewport spot-checks and semantic inspection | **NEEDS_VALIDATION**; modal obstruction found | UX/accessibility |

## 8. Pilotage control- and workflow-level coverage

| Portal/domain | Feature/control family | Coverage action | Result/status | Residual evidence owner |
|---|---|---|---|---|
| Public/auth | Home, login and four portal entry paths | Opened and authenticated each supplied account | **E2E** | Product/security |
| Auth | Wrong-portal isolation | Student attempted admin/teacher/parent portals | **E2E** positive denial | Security |
| Auth | Wrong password/MFA branch | Source and behaviour inspected | **BROKEN** error semantics | Security |
| Auth | Logout/Keycloak session/dead session | Source contract inspected | **NEEDS_VALIDATION/BROKEN design** | Security |
| Admin | Dashboard KPIs | Loaded after synthetic mutation and reconciled against modules | **INSPECTED → BROKEN_TRUTH** | Data/product |
| Admin | School/establishment settings | Inspected forms/actions/source | **INSPECTED**; missing mutation audit | Admin/auditor |
| Admin | Years/levels/cycles/coefficients | Opened all controls and inspected DTO/service | **INSPECTED**; stale year, unvalidated PATCH and cross-tenant coefficient defect | Academic/security |
| Admin | Classes/create/detail/capacity | Opened list/detail; followed create; tested full and available enrollment | Existing **E2E**; create **BROKEN** | Registrar |
| Admin | Subjects/assignments | Inspected filters/actions/warnings and row volume | **INSPECTED**; 290 unpaginated and counts conflict | Academic lead |
| Admin | Student create/read-back | Created synthetic student with DOB | **E2E → BROKEN** DOB omitted | Registrar |
| Admin | Enrollment capacity/propagation | Full class rejected; available class enrolled; roster checked | **E2E** positive and negative path | Registrar |
| Admin | Student filters/actions | Exercised controls/links and inspected source | **BROKEN/PARTIAL** level filter, fabricated fields, invalid nested controls | Registrar/UX |
| Admin | Guardians/filter/export | Opened and inspected source | **INSPECTED**; 200-row ceiling | Registrar/data |
| Admin | Enrollment list/export/approval | Opened tabs/actions/source | **INSPECTED**; approval explicitly not implemented | Registrar |
| Admin | Requests/child claims | Opened queues and parent-linked state | **INSPECTED → BROKEN_TRUTH** | Registrar/family |
| Admin | Assessments | Opened list/filters and correlated teacher/admin data | **INSPECTED → BROKEN_TRUTH** | Academic/data |
| Admin | Attendance | Opened controls and inspected service/guards | **INSPECTED**; silent partial save and ABAC gaps | Teacher/security |
| Admin | Calendar create/edit/holiday import | Opened form; holiday click immediately wrote 22 rows; source edit inspected | **E2E residue / BROKEN UX/data** | Admin/product |
| Admin | Alerts/rules/filters/export | Opened eight rules and inspected evaluator/API | **INSPECTED**; unreachable rule and truncated windows | Student support/data |
| Admin | Notifications/preferences | Opened centre and source/API | **INSPECTED**; kind mismatch and unvalidated enum | Communications |
| Admin | Announcement compose/detail | Created whole-school message and checked parent/student delivery | **E2E → BROKEN_AUDIENCE** | Communications/security |
| Admin | Conversation moderation | Opened queue and inspected actions | **NOT_IMPLEMENTED UI** | Safeguarding |
| Admin | Meeting requests | Opened states/actions | **INSPECTED**; label/action mismatch | Family support |
| Admin | Analytics | Opened controls and inspected hosted APIs/worker | **PARTIAL/SOURCE_ONLY**; stale endpoints and mislabelled series | Data/engineering |
| Admin | Remediation | Opened admin/teacher/parent surfaces and inspected source | **PARTIAL/SOURCE_ONLY**; authority defect | Student support |
| Admin | Import list/new/detail/apply/rollback | Opened list/new; no batch detail exists | **BLOCKED_DATA** for detail/apply/rollback | Data migration |
| Admin | OneRoster/integration | Opened surface and inspected API | **PARTIAL/SOURCE_ONLY** | Integration owner |
| Admin | Exports | Opened formats/jobs/history; source/worker inspected | **INSPECTED**; file download not performed | Reporting/operator |
| Admin | Users/invite/role assignment | Opened lists/forms/actions; avoided email and role mutation | **NOT_TRIGGERED_SAFETY**; status/error defects | Security/admin |
| Admin | Roles/create/edit/revoke/delete | Opened system roles; no custom role exists; source/guard inspected | **BLOCKED_DATA** for edit; critical source defects | Security |
| Admin | Audit | Opened route and reproduced crash; source reviewed | **BROKEN** | Auditor/engineering |
| Admin | Reports/help/legal/profile | Followed links | **BROKEN/404** | Product/legal |
| Teacher | Dashboard/classes/roster | Opened all classes and reconciled counts | **INSPECTED → BROKEN_TRUTH** | Teacher/data |
| Teacher | Class gradebook | Followed dashboard and class links | **BROKEN** wrong identifier | Teacher/engineering |
| Teacher | Assessments/grades/reports | Opened filters/rows and reconciled same seed | **INSPECTED → BROKEN_TRUTH** | Academic/data |
| Teacher | Attendance | Opened date/class/session and source controls | **INSPECTED**; stale year/date and ABAC risks | Teacher/security |
| Teacher | Lessons create/edit/status | Inspected form/default and source patch | **BROKEN** edit; unsafe Published default | Teacher/product |
| Teacher | Messaging/conversations | Followed class link and alternate composer; used seeded thread | Link **BROKEN**, audience zero; conversation **E2E read** | Communications |
| Teacher | Remediation availability/booking | Opened/create controls but avoided state mutation | **INSPECTED**; authority/copy gaps | Teacher/student support |
| Teacher | Documents/resources/profile/help | Followed pages/links | Empty/deferred or **404** | Product |
| Parent | Dashboard/children/detail/family/claim | Opened every page and compared same child | **INSPECTED → BROKEN_TRUTH** | Family/data |
| Parent | Grades/subjects/report | Opened all with child ID and compared 11.2 result | **INSPECTED → BROKEN_TRUTH** | Family/academic |
| Parent | Attendance | Inspected seven records, class and trend | **INSPECTED**; wrong class/unlabelled history and invalid trend | Family/data |
| Parent | Calendar/announcements/notifications | Opened, waited through async states, correlated admin/student | **INSPECTED**; counters/audience conflict | Family/communications |
| Parent | Conversation/attachment | Opened seeded thread; inspected document reference | **E2E read**; attachment absent | Family/teacher |
| Parent | Remediation | Opened terminal controls, did not close | **NOT_TRIGGERED_SAFETY**; unauthorised design power | Student support |
| Parent | Profile/help | Followed links | **BROKEN/404** | Product/support |
| Student | Dashboard/grades/evaluations/attendance | Opened every source page and reconciled data | **INSPECTED**; grade works, upstream counts conflict | Student/academic |
| Student | Announcements | Compared whole-school item with parent | **BROKEN_AUDIENCE** | Communications |
| Student | Password reset/client | Followed source override | **BROKEN design** parent client reused | Security |
| Source | 103 `page.tsx` accounting | Enumerated and matched to inspected, redirected, broken or data-blocked route | **COMPLETE** | QA |
| API | Modules/endpoints/guards/DTOs | Static deep audit plus hosted OpenAPI/runtime | **COMPLETE inventory**; critical defects recorded | Engineering/security |
| Database | Prisma entities/tenancy/migration | Inspected schema, helper call sites, SQL policy absence and compose startup | **COMPLETE static evidence**; P0 gaps | DBA/security |
| Worker | Alert/analytics/import/export/notification/remediation jobs | Inspected consumers/queues and hosted/source drift | **COMPLETE static evidence**; consumer/drain defects | Platform |
| Tests | 50 spec files and typechecks | Attempted representative runs/typechecks | **BLOCKED_BY_DEPENDENCY** | Engineering/CI |
| Deployment | Docker/Nginx/Traefik/Keycloak/Postgres/Redis/MinIO/Maildev | Inspected compose/config and hosted artefacts | **INSPECTED**; unsafe migrations/demo seed/Maildev leakage | Platform operator |
| Accessibility | Source patterns and browser spot-checks | Inspected obvious semantics/links; no full assistive-tech run | **NEEDS_VALIDATION** | Accessibility owner |
| Performance | Pagination/query/fan-out patterns | Static query/control sweep | **INSPECTED**; no load benchmark | Performance owner |

## 9. Boundary-condition coverage ledger

| Boundary class | Lakoli coverage | Pilotage coverage | What remains |
|---|---|---|---|
| Empty/loading | False-empty selectors and async counters observed | Async KPIs, empty modules and silent-error-as-empty reviewed | Automated loading/timeout/offline matrix |
| Invalid date/year | Future attendance and discipline date drift reproduced | Stale year, 2026/2023–24 mixing and calendar event loss reviewed | Timezone/property-based date tests |
| Capacity | Class creation and enrollment propagation inspected | Full-class negative path executed; historical 29/28 found | Concurrent/import capacity tests |
| Duplicate/idempotency | Conformity replay and payment/export idempotence contracts inspected | Fan-out dedup, import and worker repeated-scope code inspected | Provider/import concurrent execution |
| Partial/over/reverse money | Controls inspected, no consequential combinations executed | Finance domain absent | Provider sandbox and accounting acceptance |
| Role denied | Teacher/sensitive Lakoli denial observed | Student wrong-portal denial observed | Full least-privilege API matrix |
| Cross-tenant | Multi-space surfaces inspected | Static P0 defects found | Two-tenant adversarial runtime suite |
| State reopen/rollback | Year-end/period/import rollback controls inspected | Import detail blocked; remediation authority reviewed | Safe staging execution |
| Large volume | 2,000-import contract and paginated conformity anomalies inspected | 100/200/500 ceilings and 290-row list found | Load tests with realistic distributions |
| Mobile/a11y | Narrow Lakoli modal obstruction found | Invalid nested controls found | WCAG keyboard, reader, contrast and responsive suite |
| External provider | Config/simulation/callback surfaces inspected | Notification/identity/storage topology inspected | Sandbox delivery, retry, callback, outage and reconciliation |
| Destructive action | Delete/close/refund/export controls inspected but not fired | Role/delete/import/holiday safety boundaries recorded | Staging with backups and explicit authorisation |

## 10. Evidence traceability and completeness rules

| Claim type | Minimum accepted evidence | Current use |
|---|---|---|
| “Exists” | Runtime control or shipped route/component/API contract | Used for feature inventory |
| “Operational” | Successful safe execution plus read-back/propagation | Used only for **E2E/OP** labels |
| “Broken” | Reproduced failure or deterministic source defect with reachable path | Used in defect registers |
| “Secure” | Both positive and negative runtime/API controls, preferably DB enforcement | Not claimed globally for either platform |
| “Integrated” | Data/action crosses the boundary and reconciliation/delivery is visible | Provider surfaces without delivery are not counted as operational integrations |
| “Complete” | All required roles, states, edge paths and outputs validated | Not claimed for high-consequence finance/security/provider workflows |
| “Absent” | No runtime surface, shipped implementation, route, API or data model found | Gated/source-only modules are not called absent |

The coverage matrix is therefore exhaustive as an **inventory and evidence map**, while it remains deliberately non-absolute about provider delivery, destructive operations, cross-tenant attack resistance, performance, accessibility and production recovery. Those are controlled validation programmes, not missing browser pages.
