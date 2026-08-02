# Deep audit — domain `admissions-students`

Repo root: `C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\youthful-chaum-6aad5c`
Branch: `claude/platform-audit-gap-analysis-216337` @ `a9943ce`
Date: 2026-08-01
Method: full read of every `page.tsx` + sibling client component + server action in
`apps/web/src/app/admin/{students,guardians,enrollments,enrollment-requests,child-claims}`,
full read of `apps/api/src/modules/{students,guardians,enrollments,child-claims}`,
live `GET /docs-json` on `:4000`, live route probes on `:3000`, read-only `psql`.

Live-stack facts used as evidence:
- API OpenAPI: **150 paths**, **zero** `/admin/child-claims` or `/parent/child-claims` paths.
- `GET /api/v1/admin/child-claims?status=submitted` → **404** (route absent from the running API).
- DB: `student` 2463 · `guardian` 2487 · `guardianship` 2487 (2459 `active`, 28 `pending`) · `enrollment` 2463 (all `active`).
- DB: table **`guardianship_claim` does not exist** (E9-S1 `db push` never applied).
- DB: `guardianship.notes` JSON flags present on **29** rows (`{"kind":"rattachement|inscription","review":"pending|to_verify|approved"}`).
- DB: `student.medical_notes` 0 non-null, `photo_url` 0 non-null, `email` 0 non-null, `external_ref` 2463 non-null.
- 1 school in the tenant (`Lycée Voltaire`), so cross-school gaps below are latent, not currently exploitable.

---

## 1. Control-level inventory

### 1.1 `/admin/students` — `apps/web/src/app/admin/students/page.tsx` (Server Component, `force-dynamic`)

**Data fetches** (`Promise.all`, page.tsx:145-152)
| call | wrapped in `safe()` | notes |
|---|---|---|
| `GET /api/v1/students?q&status&classSectionId&limit=10&offset` | no — a 5xx breaks the page | |
| `GET /api/v1/analytics/students-aggregate` | yes → KPIs degrade to `—` | |
| `GET /api/v1/classes` | no | no `limit` param exists on that endpoint |
| `GET /api/v1/academic-years` | no | only used for the "no active year" footnote |

**KPI strip** (4 cards, page.tsx:201-254)
| card | source | classification |
|---|---|---|
| TOTAL DES ÉLÈVES + delta + sparkline | `aggregate.totalStudents`, `growthPctVsLastYear`, `trends.students` | fully operational |
| NOUVEAUX INSCRITS + sparkline | `aggregate.newThisMonth`, `trends.newStudents` | **defective** — sparkline is a byte-identical duplicate of the "total" series (see D-11) |
| ÉLÈVES ACTIFS + sparkline | `aggregate.activeStudents`, `trends.activeStudents` | **defective** — same duplicate series |
| Donut « Répartition par niveau » | `aggregate.byLevel` (top-5 levels) | fully operational; has its own empty state (`Pas encore de données`, page.tsx:242) |

**FilterBar** — `StudentsPageFilters.tsx` (`'use client'`, URL-driven via `router.push`, resets `page`)
| control | wired to URL | consumed by the fetch | classification |
|---|---|---|---|
| SearchInput `q` (« Rechercher un élève (nom, ID...) ») | yes | yes → API `OR` on firstName/lastName/externalRef/email | fully operational |
| SelectFilter « Toutes les classes » → `classSectionId` | yes | yes | fully operational |
| SelectFilter « Tous les niveaux » → `gradeLevelId` | yes | **NO** — never added to `qs` (page.tsx:138-143) | **visible-but-non-functional** (D-2) |
| SelectFilter « Tous les statuts » → `status` | yes | yes | fully operational |
| `isPending` "Mise à jour…" live region | — | — | fully operational |

**Table** — 9 columns, no sort, no bulk actions, no row selection, no column chooser
| column | source | classification |
|---|---|---|
| Élève (`AvatarNameCell`, links `/admin/students/{id}`) | student | fully operational |
| ID Élève | `externalRef` | fully operational |
| Date de naissance (`PreferredDate`) | `birthDate` | fully operational |
| Classe | `enrollments[0].classSection.name` | fully operational |
| Niveau | `enrollments[0].classSection.gradeLevel.name` | fully operational |
| Responsable légal | `guardianships[0].guardian` | fully operational |
| Statut d'inscription (`StatusBadge`) | `student.status` (NOT enrollment status — label is wrong) | exists-but-incomplete |
| **Performance académique (`StarRating`)** | `performanceFromId(s.id)` — a hash of the UUID | **placeholder/mock** (D-3) |
| Actions (`RowActions` view + edit) | `viewHref=/admin/students/{id}`, `editHref=/admin/students/{id}#edit` | edit link is inert (D-4) |

- Sub-line under the name falls back to a **fabricated address** `prenom.nom@email.com` when `email` is null (page.tsx:306-309). All 2463 rows in the live DB have `email = null`, so **100 % of rows currently display an invented email**. (D-5)
- Pagination: `Pagination` (URL `?page=`), `PAGE_SIZE = 10`, server-side `total` — fully operational.
- Empty state: `EmptyState` « Aucun élève trouvé » — fully operational.
- Loading state: **none** — no `loading.tsx`, no Suspense; only the filter strip's inline "Mise à jour…".
- Error state: no local boundary; falls through to `apps/web/src/app/admin/error.tsx`.
- Permission guard: **client-side none**; the page is only walled by the `/admin/*` auth redirect (307 → `/admin/login`) and by the API's `@RequiresPermission('students.read')`. No conditional rendering of "Ajouter un élève" by permission.
- **Dead file**: `StudentRowActions.tsx` (delete button + `hasEnrollments` guard + `confirm()`) has **zero call sites**; the page uses `RowActions` from `@pilotage/ui` instead. This makes the `deleteStudent` server action unreachable from the UI. (D-6)

### 1.2 `/admin/students/new` — `page.tsx` + `StudentForm.tsx` (`'use client'`)

Single-step form (no wizard), 3 sections.
| field | control | client validation | server validation (`CreateStudentDto`) |
|---|---|---|---|
| Prénom * | text | `required` + submit disabled on empty-trim | `@IsString @MinLength(1) @MaxLength(80)` |
| Nom * | text | idem | idem |
| Date de naissance | `type=date` | none | `@IsOptional @IsDateString` + **age 2–30 business rule** (controller:226-232) |
| Sexe | select F/M/X | none | `@Length(1,1)` |
| Matricule | text | none | `@MaxLength(80)` + **`schoolId+externalRef` uniqueness → 409** |
| Nationalité | text, `maxLength=2`, force-uppercase | client slice(0,2) | `@Length(2,2)` — no ISO-3166 check |
| URL photo | `type=url` + live `Avatar` preview | browser URL check only | **`@IsString @MaxLength(2000)` — not `@IsUrl`** (D-14) |
| Email | `type=email` | browser | `@IsEmail` |
| Téléphone | text | none | `@MaxLength(40)` |
| Adresse (rue/ville/CP/pays) | 4 texts → object | none | `@IsObject` — **no inner shape validation** |
| Notes médicales | textarea | none | `@MaxLength(2000)` |
| Notes générales | textarea | none | `@MaxLength(2000)` |

- Actions: « Annuler » → `router.back()`; « Enregistrer » → `createStudent()` → `POST /api/v1/students` → `router.push(/admin/students/{id})`.
- Error state: red banner from `res.error` (server message surfaced verbatim) — fully operational.
- Busy state: `Loader2` spinner + disabled submit — fully operational.
- Classification: **fully operational**.

### 1.3 `/admin/students/[id]` — `page.tsx` + `StudentDetailTabs.tsx` (`'use client'`) + `StudentAcademicTab.tsx`

Header: `Avatar`, `NOM Prénom` (`<h1>`), externalRef chip, birth date, active enrollment breadcrumb (cycle · niveau · classe · année), 3 `Stat` tiles (Statut / Inscriptions / Parents).

Data (page.tsx:107-116): `GET /students/{id}`, `GET /classes`, `GET /guardians?limit=200`, `safe(GET /analytics/parent-dashboard/{id})`.

**Tab « Identité »** — read mode (`dl` of 10 rows + medical-notes rose panel + notes panel) / edit mode toggled by « Modifier ».
Edit fields: prénom, nom, date de naissance, sexe, matricule, nationalité, email, téléphone, statut (active/transferred/graduated/withdrawn), URL photo (+live preview), adresse ×4, notes médicales, notes. Actions: Annuler / Enregistrer → `updateStudent`. **Zero client-side validation** on the edit form (no `required`, no submit-disable). Classification: **fully operational**, but see D-13 (server-side birthDate rule is not enforced on PATCH).

**Tab « Académique »** — `StudentAcademicTab`
- Rendered: 5 KPI tiles (moyenne générale, moyenne classe, progression, rang, taux de présence), `SubjectPerfCard` grid + teacher line, `LineChart` term evolution (only when ≥2 terms have data), « Notes récentes » table (5 cols), `ProgressBar` assiduité.
- Empty state: `EmptyState` « Aucune donnée académique pour l'instant » — fully operational.
- **`previousYearComparison` and `annualProgression` (mostImproved / mostDeclined / recommendations) are typed (`StudentAcademicTab.tsx:59-73`), fetched and passed down — and never rendered.** Classification: **backend-only** (D-12).
- Dead imports `History` (:4), `Lightbulb` (:6), `StatusBadge` (:19) — the leftovers of that unbuilt section.

**Tab « Inscriptions »**
| control | calls | classification |
|---|---|---|
| « Inscrire » / « Ajouter une inscription » + class `<select>` (active-year, active classes, current class excluded) | `enrollStudent` → `POST /enrollments` | fully operational (capacity/double-enrollment/archived-year 409s surfaced) |
| History list with grade-code chip, dates, status pill | — | fully operational |
| « Transférer » + inline target `<select>` (same academic year, status active) | `transferEnrollment` → `POST /enrollments/{id}/transfer` | fully operational |
| « Mettre fin » | `endEnrollment(status='dropped')` — motif via **`window.prompt()`** | exists-but-incomplete (no drawer, always hard-codes `dropped`; the `graduated`/`transferred_out` values in the handler signature are unreachable) |
| Empty state « Aucune inscription pour le moment. » | — | fully operational |
- Error state: red banner. Busy: `Loader2`. No confirm dialog on « Mettre fin ».

**Tab « Parents »**
| control | calls | classification |
|---|---|---|
| « Rattacher un parent » → inline panel, mode toggle *Parent existant* / *Nouveau parent* | — | fully operational |
| *existant*: `<select>` of guardians | `attachGuardian({guardianId})` | **exists-but-incomplete** — the list is capped at 200 of 2487 guardians and has no search/typeahead (D-8) |
| *nouveau*: prénom*, nom*, email, téléphone, profession | `POST /guardians` then `POST /guardians/guardianships` | fully operational; submit disabled until first+last non-empty |
| Lien de parenté `<select>` (6 values) + « Contact principal » checkbox | — | fully operational |
| Guardian cards: initials tile, primary star, relationship chip, email, phone, `canPickup` / `hasLegalCustody` badges | — | fully operational (read-only — those two flags cannot be edited from any admin surface) |
| « Révoquer » trash + `confirm()` | `revokeGuardianship` → `DELETE /guardians/guardianships/{id}` | fully operational |
| Empty state « Aucun parent rattaché… » | — | fully operational |
- Dead import `X` (`StudentDetailTabs.tsx:20`).

### 1.4 `/admin/guardians` — `page.tsx` + `GuardiansPageFilters.tsx` + `GuardiansExportButton.tsx`

**Fetch**: `GET /api/v1/guardians?q&limit=200` (page.tsx:68-74) — `safe()`-wrapped.

**KPIs** — all four computed **in-page from the 200-row slice**, so all four are wrong at 2487 guardians:
| card | computation | classification |
|---|---|---|
| PARENTS ENREGISTRÉS | `allGuardians.length` → shows **200**, real 2487 | **defective** (D-7) |
| LIENS APPROUVÉS | count `status==='active'` in slice | defective (same cause) |
| LIENS EN ATTENTE | count `status==='pending'` in slice | defective |
| COMPTES À VÉRIFIER | count `status==='revoked'` — **the API filters `revoked` out** (guardians.controller.ts:118), so this is structurally always **0** | **visible-but-non-functional** (D-9) |

**Filters**
| control | classification |
|---|---|
| SearchInput `q` — placeholder « nom, email, **profession** » | **exists-but-incomplete**: the API `q` searches firstName/lastName/email only (guardians.controller.ts:100-106); profession is never matched (D-10) |
| SelectFilter relation (6 values) | **exists-but-incomplete**: applied **client-side over the 200-row slice** (page.tsx:77-81), never sent to the API |

**Table** — 7 columns, no sort, no bulk actions, no row selection:
Parent/Tuteur (`AvatarNameCell` → `/admin/guardians/{id}`), Email, Téléphone, Élèves rattachés (`_count`), Relation principale, Statut du lien (`StatusBadge` Approuvé/En attente/Révoqué), Actions (`RowActions` view + edit → `/admin/guardians/{id}` and `#edit`).

**`/admin/guardians/[id]` DOES NOT EXIST.** The directory contains only `page.tsx`, `GuardiansPageFilters.tsx`, `GuardiansExportButton.tsx`. Every name link, every eye icon and every pencil icon on this table is a **404**. (D-1)

**Page actions**
| control | classification |
|---|---|
| « Exporter CSV » (`GuardiansExportButton`) — 9 columns, header block, disabled when empty | fully operational **but exports only the 200-row slice** |
| Footer link « Voir les demandes → » → `/admin/enrollments` | fully operational link, dead destination (see 1.5) |
| `<span className="hidden"><X/></span>` (page.tsx:263-265) | **dead markup** existing solely to consume an unused import (D-19) |

- Pagination: `total = allGuardians.length` (≤200) → the pager can never reach page 21+. Empty state: `EmptyState` « Aucun parent trouvé ». Loading: none. Guards: none client-side.
- **There is no create / edit / delete guardian control anywhere in the admin UI.** Guardians can only be created as a side-effect of the student-detail "Nouveau parent" panel.

### 1.5 `/admin/enrollments` — `page.tsx` + `EnrollmentsPageTabs.tsx` + `EnrollmentsExportButton.tsx`

**Fetch**: `GET /api/v1/guardians?includePending=true&limit=200` (page.tsx:113-118).

**This page is structurally broken.** The response is typed `EnrollmentRequestRow[]` (`{ id, status, relationship, notes, createdAt, guardian:{…}, student:{…} }`) but `GET /guardians` returns **Guardian** rows (`{ id, firstName, lastName, email, phone, profession, _count, guardianships[] }`). `guardian` has **no `status` column** (verified via `\d guardian`) and no `guardian`/`student`/`notes` property. Consequently:
- `pending`/`approved`/`rejected` filters (page.tsx:122-128) all evaluate against `undefined` → **every bucket is empty**;
- **all four KPIs are permanently 0**, all five tab counts are permanently 0, every tab shows the empty state, and the CSV export always yields a header-only file;
- the `includePending=true` query param **does not exist on the controller** and is silently ignored;
- even with the shape fixed, the "Rejetées" tab could never populate because `GET /guardians` hard-filters `guardianships: { where: { status: { not: 'revoked' } } }`.
- The 29 seeded `{"kind":…,"review":…}` guardianship rows and the 28 `pending` links in the live DB are **completely invisible**. (D-1a)

| control | classification |
|---|---|
| KPI × 4 (En attente / À vérifier / **Approuvées (ce mois)** / Rejetées) | **defective** — always 0; the third is also mislabeled: it counts *all-time* approved, never "ce mois" |
| Tabs Toutes / En attente / À vérifier / Approuvées / Rejetées (`EnrollmentsPageTabs`, URL `?tab=`) | wiring fully operational, counts always 0 |
| Table 7 cols: Demandeur, Élève, Type, Classe souhaitée, Statut, Date, Actions | **visible-but-non-functional** — never renders a row |
| Row action: `RowActions viewHref=/admin/guardians/{id}` (page.tsx:276) | **404** (route absent) |
| « Exporter CSV » | wiring fully operational, always empty |
| **Approve / Reject** | **absent** — the page itself states (page.tsx:294-300) the actions "ouvriront un FormDrawer dédié dans la phase R6" |
| Empty state / Pagination | fully operational |

The seeded `enrollments.approve` permission (`permissions.constants.ts:36,170`) is granted to `school_admin` and used by **no endpoint anywhere** — dead permission.

### 1.6 `/admin/enrollment-requests`

`export default function LegacyEnrollmentRequestsRedirect() { redirect('/admin/enrollments'); }` — 11 lines, no metadata, no `dynamic`. Fully operational as a redirect; inherits the broken destination.

### 1.7 `/admin/child-claims` — `page.tsx` + `ChildClaimsQueue.tsx` + `actions.ts` + `types.ts`

**Fetch**: `GET /api/v1/admin/child-claims?status=submitted`, `safe()`-wrapped (page.tsx:19-27) with `console.error` + empty state on ANY failure.

| control | classification |
|---|---|
| KPI « En attente » (tone flips amber/slate) | fully operational (code) |
| Evidence card: parent-typed claim vs matched roster student side-by-side, `matchMethod` chip, `SearchX` "Aucune correspondance — à traiter manuellement", requesting parent + email + relationship + `Reçu le` | fully operational (code) — but the `matchMethod` chip can lie (D-16) |
| « Approuver » → `approveChildClaimAction` → `POST /admin/child-claims/{id}/approve` | fully operational (code); **swallows all failures** (D-15) |
| « Rejeter » → `RejectClaimDrawer` (`FormDrawer`): required `Motif` textarea, `maxLength=500`, live counter, `aria-required`/`aria-describedby`/`aria-invalid`, `role=alert` | fully operational (code) — best a11y of the whole domain |
| `role=status aria-live=polite` announcements | fully operational |
| Empty state `ShieldCheck` « Aucune demande en attente » | fully operational |
| Optimistic row removal (`removed` Set) | see D-15 |
| Filters / sort / pagination | **absent** — `status=submitted` is hard-coded; the other 5 statuses are unreachable from the UI |

**End-to-end status: `placeholder/mock` in the running stack.** The API route is absent from the live `/docs-json` and returns 404; the `guardianship_claim` table does not exist in the live DB. The whole feature (parent submit + admin approve) is code-complete and unit-tested but **not deployed and not migrated**.

### 1.8 API surface

| endpoint | guard | DTO validation | service | classification |
|---|---|---|---|---|
| `GET /api/v1/students` | `students.read` + `StudentAccessService.scopeForUser` + tenant + school | query strings, `take≤200` | inline in controller | fully operational |
| `GET /api/v1/students/:id` | `students.read` + `canAccessStudent` (tenant only, **not school**) | — | inline | exists-but-incomplete (D-17) |
| `POST /api/v1/students` | `students.write` | `CreateStudentDto` (12 fields) + externalRef 409 + age 2–30 | inline | fully operational |
| `PATCH /api/v1/students/:id` | `students.write`, **no `canAccessStudent`** | `UpdateStudentDto` | inline | **defective** (D-13) |
| `DELETE /api/v1/students/:id` | `students.delete`, **no `canAccessStudent`**, blocks when enrollments>0 | — | inline | exists-but-incomplete; **no UI caller** (D-6) |
| `GET /api/v1/guardians` | `parents.read` + tenant + school, `take≤200` | — | inline | fully operational (cap is the caller's problem) |
| `GET /api/v1/guardians/:id` | `parents.read`, tenant only | — | inline | **backend-only** (no `/admin/guardians/[id]` page) |
| `PATCH /api/v1/guardians/:id` | `parents.write`, tenant only | `UpdateGuardianDto` | inline | **backend-only** |
| `DELETE /api/v1/guardians/:id` | `parents.delete`, blocks when guardianships>0 | — | inline | **backend-only** |
| `POST /api/v1/guardians` | `parents.write` + email-dup 409 | `CreateGuardianDto` | inline | fully operational |
| `GET /api/v1/guardians/guardianships/list` | `guardianships.read` — **tenant only, no school, no ABAC, no pagination**, returns `guardian: true` | — | inline | **defective** (D-18) |
| `POST /api/v1/guardians/guardianships` | `guardianships.write` + same-school check + dup 409 + revoked-reuse + primary-demote | `CreateGuardianshipDto` | inline | fully operational |
| `PATCH /api/v1/guardians/guardianships/:id` | `guardianships.write` | `UpdateGuardianshipDto` | inline | **backend-only** |
| `DELETE /api/v1/guardians/guardianships/:id` (soft revoke) | `guardianships.write` | — | inline | fully operational |
| `GET /api/v1/enrollments` | `enrollments.read` — **tenant only, no school, no ABAC, no pagination** | — | inline | **defective** (D-18); also **backend-only** (no web caller) |
| `POST /api/v1/enrollments` | `enrollments.write` + archived-year + closed-class + capacity 409 + double-enrollment 409 + guardian notify | `CreateEnrollmentDto` | inline | fully operational (capacity check is racy — D-20) |
| `PATCH /api/v1/enrollments/:id` | `enrollments.write` + guardian notify | `EndEnrollmentDto` | inline | fully operational |
| `POST /api/v1/enrollments/:id/transfer` | `enrollments.write` + same-year + capacity + `$transaction` | `TransferEnrollmentDto` | inline | exists-but-incomplete — **never notifies guardians** despite the `kind:'transferred'` branch existing (D-21) |
| `DELETE /api/v1/enrollments/:id` | `enrollments.delete` (hard-delete only when `pending`, else soft `dropped`) | — | inline | **backend-only** |
| `GET /api/v1/enrollments/roster/:classSectionId` | `enrollments.read`, tenant only, `include: { student: true }` | — | inline | **defective** (D-18) + **backend-only** |
| `GET /api/v1/admin/child-claims` | `guardianships.approve` (admin-only) + enum-validated `status` | — | `ChildClaimsService.listQueueForAdmin` | code fully operational, **not deployed** |
| `POST /api/v1/admin/child-claims/:id/approve` | `guardianships.approve` + `ParseUUIDPipe` | — | idempotent, from-status-guarded `$transaction`, 409 on race, audited | code fully operational, **not deployed** |
| `POST /api/v1/admin/child-claims/:id/reject` | `guardianships.approve` + `ParseUUIDPipe` | `RejectChildClaimDto` (`@Transform` trim + `@IsNotEmpty` + `@MaxLength(500)`) | ditto | code fully operational, **not deployed** |
| `POST/GET /api/v1/parent/child-claims`, `POST …/:id/withdraw` | `guardianships.claim` (parent-only) + rate-limit 5/10 min | `CreateChildClaimDto` | deny-by-default matcher, no-oracle uniform response | code fully operational, **not deployed** |
| `GET /api/v1/analytics/students-aggregate` | `students.read` (parent + teacher also hold it), tenant + school | — | `analytics.service.ts:3042` | exists-but-incomplete (D-22) |

Tests: `child-claims` has 3 unit spec files + 1 Playwright journey. `students.controller.ts`, `guardians.controller.ts`, `enrollments.controller.ts` have **zero tests**; only `student-access.service.spec.ts` exists.

---

## 2. Defects (file:line)

**D-1 — `/admin/guardians/[id]` route does not exist; 3 controls per row + 1 per enrollment row lead to a 404.**
`apps/web/src/app/admin/guardians/page.tsx:191` (`AvatarNameCell href`), `:237` (`viewHref`), `:238` (`editHref`), and `apps/web/src/app/admin/enrollments/page.tsx:276` (`viewHref`). Directory listing of `apps/web/src/app/admin/guardians/` contains only `page.tsx`, `GuardiansPageFilters.tsx`, `GuardiansExportButton.tsx`. Severity: high — the guardian record is unreachable and un-editable from the admin UI even though `GET/PATCH/DELETE /api/v1/guardians/:id` all exist.

**D-1a — `/admin/enrollments` queries an endpoint whose response shape it cannot read; the page is permanently empty.**
`apps/web/src/app/admin/enrollments/page.tsx:113-118` requests `GET /api/v1/guardians?includePending=true&limit=200` and types it `EnrollmentRequestRow[]`. `GuardiansController.list` (`apps/api/src/modules/guardians/guardians.controller.ts:111-123`) returns `Guardian[]`. `guardian` has no `status`, `notes`, `guardian` or `student` column (`\d guardian`). Every filter at `:122-128` therefore matches nothing. `includePending` is not a parameter of that controller and is silently dropped. 28 `pending` guardianships + 29 review-flagged rows exist in the DB and none are shown. Severity: **critical** — the entire "Inscriptions" workflow page is dead.

**D-2 — « Tous les niveaux » filter is never sent to the API.**
`apps/web/src/app/admin/students/page.tsx:138-143` builds `qs` from `q`, `status`, `classSectionId` only; `sp.gradeLevelId` is read at `:262` and passed to the filter component but never added to the query string (and `GET /students` has no `gradeLevelId` param either — `students.controller.ts:90-98`). Selecting a level changes the URL and re-renders the identical list. Severity: medium.

**D-3 — "Performance académique" column is a hash of the student UUID.**
`apps/web/src/app/admin/students/page.tsx:115-121` `performanceFromId()`, rendered at `:351`. A 1–5 star rating labelled « Excellent » / « À améliorer » that has no relationship to any grade. The JSDoc admits it. Real per-student averages already exist (`GET /analytics/parent-dashboard/:id`, used on the detail page). Severity: high — fabricated academic judgement displayed as fact in the roster.

**D-4 — "Modifier" row action links to an anchor nothing handles.**
`apps/web/src/app/admin/students/page.tsx:356` → `/admin/students/{id}#edit`. `StudentDetailTabs.tsx:161` initialises `editing = useState(false)` and never reads `location.hash`. Same pattern at `guardians/page.tsx:238`. Severity: low-medium.

**D-5 — Fabricated email addresses rendered for every student.**
`apps/web/src/app/admin/students/page.tsx:306-309`: `sub={s.email ?? \`${s.firstName.toLowerCase()}.${s.lastName.toLowerCase()}@email.com\`}`. Live DB: `count(*) filter (where email is not null) = 0` on 2463 students → all 2463 rows display an invented contact address. Severity: high — an admin can plausibly copy it and mail a non-existent address.

**D-6 — Dead component; the student delete control is unreachable.**
`apps/web/src/app/admin/students/StudentRowActions.tsx:10` — `grep -rn StudentRowActions` returns only its own definition. The page uses `@pilotage/ui`'s `RowActions` (view+edit, no delete) at `page.tsx:354-357`. `deleteStudent` (`actions.ts:40`) and `DELETE /api/v1/students/:id` (`students.controller.ts:296`) therefore have no caller. `MoreHorizontal` is also imported unused at `StudentRowActions.tsx:3`. Severity: medium.

**D-7 — `/admin/guardians` shows and paginates only the first 200 of 2487 guardians, and reports 200 as the total.**
`apps/web/src/app/admin/guardians/page.tsx:70` hard-codes `qs.set('limit','200')`; the API caps at 200 anyway (`guardians.controller.ts:97`). `totalGuardians = allGuardians.length` (`:84`) feeds both the "PARENTS ENREGISTRÉS" KPI (`:129`) and `Pagination total` (`:249`). 92 % of guardians are unreachable and the headline number is wrong by 12×. Severity: **high**.

**D-8 — The "Parent existant" picker on the student detail page can only reach 200 of 2487 guardians and has no search.**
`apps/web/src/app/admin/students/[id]/page.tsx:110` (`/api/v1/guardians?limit=200`) → `StudentDetailTabs.tsx:758-766` renders them all into a plain `<select>`. Severity: high — attaching an existing parent is impossible for ~92 % of the roster.

**D-9 — "COMPTES À VÉRIFIER" KPI is structurally always 0.**
`apps/web/src/app/admin/guardians/page.tsx:93-96` counts `guardianships.status === 'revoked'`, but `guardians.controller.ts:118` filters revoked links out of the response (`where: { status: { not: 'revoked' } }`). Severity: medium.

**D-10 — Search placeholder promises a field the API does not search.**
`apps/web/src/app/admin/guardians/GuardiansPageFilters.tsx:40` « Rechercher un parent (nom, email, **profession**)… » vs `guardians.controller.ts:100-106` which builds `OR` over `firstName`/`lastName`/`email` only. Severity: low.

**D-11 — Three KPI sparklines on `/admin/students` are the same series, fetched three times.**
`apps/api/src/modules/analytics/analytics.service.ts:3137-3139` calls `this.sparkline({tenantId, schoolId, model:'student', sinceDays:30})` three times with byte-identical arguments; the inline comment says `// same data, KPI labels differ`. Result: the "NOUVEAUX INSCRITS" and "ÉLÈVES ACTIFS" trend lines (`students/page.tsx:222`, `:232`) render the *total students* cohort under a different label, and each page load issues 3 redundant aggregate queries. Severity: medium (wrong data + wasted work).

**D-12 — `previousYearComparison` and `annualProgression` are fetched, typed and never rendered.**
`apps/web/src/app/admin/students/[id]/StudentAcademicTab.tsx:59-73` declares them; `page.tsx:124-125` maps them into the snapshot; no JSX reads them (`grep` confirms only the type declarations match). The unused `History` (`:4`), `Lightbulb` (`:6`) and `StatusBadge` (`:19`) imports are the residue of the unbuilt "recommandations" panel. Severity: low (backend-only capability).

**D-13 — `PATCH /students/:id` skips the ABAC check and the birth-date business rule that `POST` enforces.**
`apps/api/src/modules/students/students.controller.ts:255-294`: no `this.access.canAccessStudent(...)` (compare `getOne` at `:207`), and no age 2–30 validation (compare `create` at `:226-232`). Any `students.write` holder can mutate any student in the tenant regardless of scope, and can set an out-of-range `birthDate` that `POST` would reject. `DELETE` at `:296-312` has the same missing ABAC check. Severity: **high**.

**D-14 — `photoUrl` accepts arbitrary strings and is rendered as an image `src`.**
`students.controller.ts:52` and `:69`: `@IsOptional() @IsString() @MaxLength(2000) photoUrl?: string` — no `@IsUrl`. The value flows to `Avatar src` (`students/[id]/page.tsx:146`, `StudentDetailTabs.tsx:239`, `:291`, `StudentForm.tsx:131`). The client input is `type=url` (browser-side only). Severity: medium.

**D-15 — Approving a child claim reports success on every failure.**
`apps/web/src/app/admin/child-claims/ChildClaimsQueue.tsx:70-78`: the `else` branch of `if (res.ok)` unconditionally adds the claim to the optimistic `removed` set and announces « Cette demande vient d'être traitée. » A 403, a 500, a network error or the current live 404 are all indistinguishable from a successful grant — the row disappears from the queue and the admin believes the family was approved. Only the 409 concurrent-loser case justifies this treatment. Severity: **high**.

**D-16 — `matchMethod` on the admin evidence card can assert a match method that was not used.**
`apps/api/src/modules/child-claims/child-claims.service.ts:430`: `matchMethod: r.claimedExternalRef ? 'externalRef' : r.claimedDob ? 'name+dob' : null` — derived from *what the parent typed*, not from `matchClaim`'s outcome. `claim-match.ts:83-88` explicitly falls through from the externalRef path to the name+DOB path when the ref matches 0 rows. So a claim carrying a wrong/unknown externalRef that matched on name+DOB is shown to the approving admin as « Référence exacte » (`ChildClaimsQueue.tsx:24-27,103-104,129-133`), and a `match_failed` row with a ref still shows a method chip. The chip is the admin's primary evidence for granting access to a minor's file. Severity: **high**.

**D-17 — Student and guardian reads are tenant-scoped but not school-scoped.**
`students.controller.ts:206` (`student.tenantId !== me.tenantId` only), `guardians.controller.ts:136`, `:181`, `:204`, `:313`, `:345`; and `StudentAccessService.scopeForUser` takes `_schoolId` and never uses it (`student-access.service.ts:30`, `:33-38`). In a multi-school tenant a school_admin of school A reads and writes school B's students and guardians. Currently latent (1 school in the DB). Severity: medium (high once multi-school ships).

**D-18 — Three endpoints leak cross-family PII to `parent`/`teacher` tokens.**
The `parent` realm role holds `students.read`, `enrollments.read`, `guardianships.read` (`permissions.constants.ts:258-260`); `teacher` holds the same three (`:224-226`).
- `apps/api/src/modules/enrollments/enrollments.controller.ts:115-141` — `GET /enrollments` filters on `tenantId` only, applies **no** `StudentAccessService` scope and has **no pagination**: a parent token returns all 2463 enrollments with every student's name + `externalRef` + class.
- `apps/api/src/modules/enrollments/enrollments.controller.ts:330-347` — `GET /enrollments/roster/:classSectionId` returns `include: { student: true }`, i.e. the **full** Student row (`medicalNotes`, `address`, `phone`, `email`, `notes`) for every child in any class id.
- `apps/api/src/modules/guardians/guardians.controller.ts:216-237` — `GET /guardians/guardianships/list` filters on `tenantId` only, no school scope, no pagination, `include: { guardian: true }` → every family's guardian record (address, email, phone) plus the linked student names.
Severity: **critical** (RGPD; medical notes are in scope).

**D-19 — Dead markup kept only to consume an unused import.**
`apps/web/src/app/admin/guardians/page.tsx:263-265`: `<span className="hidden"><X className="h-3 w-3" /></span>`. Severity: trivial.

**D-20 — Class-capacity check is a TOCTOU race.**
`enrollments.controller.ts:166-170` (create) and `:287-289` (transfer) read `_count.enrollments` outside the write. The transfer at `:291-309` uses `$transaction([...])` but the capacity read precedes it. Two concurrent enrolments can both pass and exceed `maxStudents`. Severity: medium.

**D-21 — Transfers never notify guardians although the code path exists.**
`enrollments.controller.ts:256-310` returns without calling `notifyGuardiansOfEnrollment`. The `'transferred'` kind, its title « Changement de classe » (`:82`) and its `'info'` severity (`:87`) are declared and unreachable — dead code. Severity: medium.

**D-22 — School-wide student statistics are readable by parent and teacher tokens.**
`apps/api/src/modules/analytics/analytics.controller.ts:198-204` guards `students-aggregate` with `students.read` only (no `StudentAccessService` narrowing, unlike `parent-dashboard` at `:150-160` which does call `canAccessStudent`). Returns school totals, growth %, and the per-level distribution. Severity: low-medium.

**D-23 — `RowActions` uses raw `<a href>` instead of `next/link`.**
`packages/ui/src/components/RowActions.tsx:98`, and `AvatarNameCell.tsx:56`. Every "Voir"/"Modifier"/name click in this domain triggers a full document navigation instead of a client transition. Severity: low.

**D-24 — Teacher scope is unrestricted by design-debt.**
`apps/api/src/modules/students/student-access.service.ts:36-39`: `// TODO Phase 4: when teaching assignments exist, filter by the teacher's class sections.` returns `studentIds: null` (the "unrestricted" sentinel) for every teacher. `teaching_assignment` exists in the live DB. Severity: medium.

**D-25 — Unused imports (lint-level dead code).**
`StudentDetailTabs.tsx:20` (`X`), `StudentAcademicTab.tsx:4,6,19` (`History`, `Lightbulb`, `StatusBadge`), `StudentRowActions.tsx:3` (`MoreHorizontal`).

---

## 3. Classification roll-up

**Fully operational** — students list (search, class filter, status filter, pagination, empty state), student create form (+ server DTO + externalRef 409 + age rule), student identity read/edit, student enrollment attach / transfer / end (+ capacity, double-enrollment, archived-year guards, guardian notification), guardian attach (existing + new) / revoke, student academic tab (KPIs, subject cards, term chart, recent grades, attendance bar, empty state), guardians CSV export, enrollments tab wiring + CSV export wiring, `/admin/enrollment-requests` redirect, child-claim approve/reject service (idempotency, from-status guard, 409 race handling, append-only audit, best-effort notify), child-claim reject drawer (a11y-complete), parent claim matcher (deny-by-default, no-oracle, rate-limited).

**Exists-but-incomplete** — "Statut d'inscription" column shows the *student* status; « Mettre fin » uses `window.prompt` and hard-codes `dropped`; guardian relationship filter applied client-side over a truncated slice; guardian search misses `profession`; `GET /students/:id` school scoping; `POST /enrollments/:id/transfer` (no notification); guardians picker (200-row cap); teacher ABAC.

**Visible-but-non-functional** — « Tous les niveaux » filter; "COMPTES À VÉRIFIER" KPI; the entire `/admin/enrollments` table + KPIs + tab counts; `#edit` row actions on students and guardians; every `/admin/guardians/{id}` link.

**Backend-only** — `GET/PATCH/DELETE /guardians/:id`; `GET /guardians/guardianships/list`; `PATCH /guardians/guardianships/:id`; `GET /enrollments`; `DELETE /enrollments/:id`; `GET /enrollments/roster/:classSectionId`; `students?academicYearId=` and `students?unenrolled=true` query params; `previousYearComparison` + `annualProgression` payloads.

**Frontend-only** — `includePending=true` (query param invented by the page, no server support); the "Approuver / Rejeter" affordance promised in `/admin/enrollments`'s own footnote.

**Placeholder / mock** — "Performance académique" star rating; the fabricated `prenom.nom@email.com` sub-line; two of three KPI sparklines; the whole child-claims feature in the *running* stack (route 404, table missing).

**Defective** — D-1, D-1a, D-2, D-3, D-5, D-7, D-9, D-11, D-13, D-15, D-16, D-18, D-20, D-21.

**Dead code** — `StudentRowActions.tsx` (whole file); `deleteStudent` server action; the `'transferred'` notification branch; `enrollments.approve` permission; the hidden `<X/>` span; 5 unused imports.

---

## 4. Deployment / migration gaps observed in the live stack

1. The running API is older than `HEAD`: `ChildClaimsModule` is registered at `apps/api/src/app.module.ts:62` but `/docs-json` exposes **no** `child-claims` path and `GET /api/v1/admin/child-claims` returns 404. Same staleness class as the previously-confirmed stale web image.
2. `guardianship_claim` is **absent** from the live database (`\dt`), so even a redeployed API would fail: `GuardianshipClaimIndexBootstrap` (`guardianship-claim-index.bootstrap.ts:30-46`) already degrades to a warning, but every service query would 500. The E9-S1 `db push` is the missing operator step.
3. `enrollment` has only `active` rows (2463) — no `pending`, so the `DELETE /enrollments/:id` hard-delete branch and the "Approuvées (ce mois)" reporting path are untested against real data.
