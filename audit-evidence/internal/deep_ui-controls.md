# Deep audit — domain `ui-controls`

**Scope**: `packages/ui/src/components` (64 components) + every `apps/web/src/app/**/page.tsx` (104 routes) and their sibling client components / server actions, plus the API endpoints those controls call (routes, DTO validation, guards, service implementation).

**Method**: full source read of every page family (page.tsx + siblings + `actions.ts`), cross-checked against the live stack — `GET http://localhost:4000/docs-json` (150 paths), `docker ps`, and read-only `psql` row counts. No writes performed.

**Repo root used**: `C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\youthful-chaum-6aad5c`
(the task passed the literal string `undefined` as REPO ROOT; resolved to the working-directory worktree.)

---

## 0. Runtime baseline (facts the classification depends on)

| Fact | Evidence |
|---|---|
| 104 `page.tsx` routes | `find apps/web/src/app -name page.tsx` |
| **0** pages are `'use client'` — every route is a server component | `grep -rln "'use client'" --include=page.tsx` → 0 |
| 64 UI components; **23** are `'use client'` | `head -3 packages/ui/src/components/*.tsx` |
| 227 API route handlers, **222** carry `@RequiresPermission` | script over `apps/api/src/**/*.controller.ts` |
| API `/docs-json` exposes **150** paths | `curl localhost:4000/docs-json` |
| Containers up 8h; images predate current source | `docker ps` |

Live DB row counts (read-only) — these determine whether an empty screen is "no data" or "broken":

```
student 2463 | guardian 2487 | enrollment 2463 | class_section 94
grade 513 | assessment 21 | user_profile 190 | audit_log 63
alert_instance 7 | export_job 5 | conversation 2
attendance_record 0 | announcement 0 | import_batch 0
```

---

## 1. Control inventory by page

Legend for the capability column:
`OK` fully operational · `INC` exists-but-incomplete · `NF` visible-but-non-functional · `BE` backend-only · `FE` frontend-only · `MOCK` placeholder/mock · `DEF` defective

### 1.1 Admin portal (49 routes)

| Route | Filters / search | Columns | Actions & what they call | Modals / drawers | Empty / error | Class |
|---|---|---|---|---|---|---|
| `/admin/dashboard` | — | KPI + class table (Classe, Planifiées, Notées, Taux, Statut) | read-only | — | `EmptyState` ×2; `safe()` re-throws nav signals (`page.tsx:130-144`) | OK |
| `/admin/students` | `SearchInput` q + 3 `SelectFilter` (classe, **niveau**, statut) | Élève, ID, Naissance, Classe, Niveau, Responsable, Statut, **Performance académique**, Actions | `Ajouter un élève`→`/admin/students/new`; `RowActions` view/`#edit` | — | `EmptyState` | **DEF** — see §2.1, §2.2, §2.3 |
| `/admin/students/[id]` | 4 tabs (identity/academic/enrollments/guardians) | grades table (Date, Matière, Éval, Note, Moy. classe) | save student · enroll · transfer · end enrollment · attach/create guardian · revoke — all → `students/actions.ts` (9 mutations, 12 `revalidatePath`) | inline panels, no `Drawer` | `EmptyState` | INC — guardian picker capped at 200 of 2487 (§2.3) |
| `/admin/students/new` | — | form: prénom, nom, naissance, externalRef, email… | submit → `POST /api/v1/students` | — | client-side required checks only | OK |
| `/admin/guardians` | q + relation | Parent, Email, Téléphone, Élèves, Relation, Statut lien, Actions | export CSV (client); `RowActions` view/edit → `/admin/guardians/{id}` | — | `EmptyState` | **DEF** — §2.3, §2.4 (dead route + 200-cap + wrong KPIs) |
| `/admin/teachers` | q + 2 selects (actif, **matière** — filtered in memory, `page.tsx:105`) | Enseignant, N° employé, Spécialités, Classes, Email, Tél, Statut, Actions | `RowActions` | — | `EmptyState` | OK |
| `/admin/teachers/[id]` | — | assignments table (Classe, Matière, Année, h/sem, Rôle, Action) | add/remove assignment → `teaching-assignments/actions.ts` | inline form | `EmptyState`, `notFound()` | OK |
| `/admin/classes` | 2 selects (niveau, année) | Nom, Niveau, Salle, Année, Capacité, Effectif, Occupation, Réf., Statut, Actions | `Ajouter une classe`→`/admin/classes/new` | `ClassInfoEditor` (`role="dialog"`) | `EmptyState` + action | **DEF** — §2.5 (`/admin/classes/new` route does not exist) |
| `/admin/classes/[id]` | — | detail + roster | edit via `ClassInfoEditor` | dialog | **none** — bare `api()` at `page.tsx:122` | **DEF** — §2.5 |
| `/admin/assessments` | **none** | 11 cols (Titre…Statut, Actions) | `RowActions viewHref=/admin/assessments/{id}` | — | `EmptyState` | **DEF** — §2.4 (dead route) |
| `/admin/attendance` | **none** | Élève, Classe, Matière, Date, Statut, Justification, Actions | `RowActions` → student `#attendance` | — | `EmptyState` | INC — no filters, no justify action; 0 rows in DB |
| `/admin/enrollments` | tabs only (all/pending/to_verify/approved/rejected) | Demandeur, Élève, Type, Classe, Statut, Date, Actions | export CSV; `RowActions` → dead `/admin/guardians/{id}` | — | `EmptyState` | **NF** — §2.6 (approve/reject not implemented, page says so) |
| `/admin/alerts` | tabs + q + 4 selects | Alerte, Élève, Matière, Sévérité, Détectée, Statut, Actions | ack/resolve/dismiss → `alerts/actions.ts`; `EvaluateNowButton`→`POST /alerts/evaluate`; `AlertRuleToggle`; export | `FormDrawer` (`RuleConfigEditor`) | `EmptyState` ×2 | INC — §2.7 (`BEHAVIOR_ALERT` toggleable but has no evaluator) |
| `/admin/audit` | q + 3 selects + date range | Date, Utilisateur, Action, Ressource, Détails, Portail·IP | export → `POST /exports` then redirect | `DetailDrawer` | `EmptyState` | **DEF** — known 500 (§2.8, now 2 symbols not 1) |
| `/admin/exports` | q + 4 selects (période, type, statut, demandeur) | Fichier, Type, Taille, Demandé par, Date, Statut, Actions | `ExportLauncher` (5 kinds) → `POST /exports`; download → `GET /exports/{id}/download-url`; auto-refresh poller | — | `EmptyState` | INC — §2.9 (100-row ceiling drives KPIs + filters + pagination) |
| `/admin/imports` | q + 4 selects | grouped batch cards | link to `/admin/imports/new` | — | `EmptyState` | INC — filters applied in memory over unpaginated `/imports` |
| `/admin/imports/new` | — | wizard step 1 type · step 2 file | download template; upload → `POST /imports/{type}/upload` | — | inline | OK |
| `/admin/imports/[id]` | q + 3 selects | Ligne, Statut, Données, Erreurs | apply (mode radio) · rollback · conflict resolve | `FormDrawer` (`ConflictResolver`) | `EmptyState`, status poller | OK |
| `/admin/integrations` | — | OneRoster source cards | connect · sync · view batch | 2 × `FormDrawer` | `EmptyState` | **DEF** — §2.10 (endpoint absent from running API) |
| `/admin/child-claims` | — | claim queue rows | approve / reject → `admin/child-claims/actions.ts` | `FormDrawer` (reject reason) | `EmptyState` | **DEF** — §2.10 |
| `/admin/remediation` | q (tutors) | `DataTable` (only use of it in the app) | create/edit/publish/retire tutor + slot curation | `FormDrawer` ×2, `ConfirmDialog` | `EmptyState` ×2 | **DEF** — §2.10 |
| `/admin/conversations` | **none** | report cards (open / history) | **none** | — | `EmptyState` | **NF** — §2.11 (moderation is read-only; `reviewed`/`dismissed` unreachable) |
| `/admin/communications` | q + 4 selects | Titre, Audience, Priorité, Destinataires, Publication, Statut, Actions | create → `/admin/announcements/new` | — | `EmptyState` ×2 | OK (0 rows in DB) |
| `/admin/announcements/new` | — | scope tiles, priorité tiles, titre, corps, expiration | preview recipients (`/api/proxy/...`); save draft / publish | — | inline validation via `canSubmit` | OK |
| `/admin/announcements/[id]` | q + 2 selects (recipients) | Destinataire, Rôle, E-mail, Statut | publish · delete | — | `EmptyState` ×2, `notFound()` | INC — recipient filters applied in memory |
| `/admin/roles`, `/roles/new`, `/roles/[id]/edit` | permission-group search | role list | create/patch/delete → `roles/actions.ts`; group toggle-all | — | — | OK |
| `/admin/users` | **none** | Utilisateur, Rôles, Statut, Action | assign role dropdown → `POST /users/{id}/roles` | popover menu | — | INC — no search/filter/pagination over 190 users; no role *removal* control although `DELETE /users/roles/{id}` exists |
| `/admin/users/invite` | — | email, rôle, message | → `POST /users/invite` | — | status states | OK |
| `/admin/academic-years` | — | year cards + terms | create/patch/delete year, add/delete term, make active, archive | inline forms | — | OK |
| `/admin/levels` (`/cycles` → redirect) | — | cycles + nested levels | create/delete cycle & level | inline forms | KPI degrade to `—` | OK |
| `/admin/subjects` | 2 tabs | coefficient matrix (Matière × Niveau) | save matrix → `PUT /subjects/coefficients/matrix`; CRUD subjects | inline form | — | OK |
| `/admin/calendar` | — | month grid + list | prev/next/today · seed FR holidays · create/edit/delete event | custom dialog | "Aucun événement à venir" | OK |
| `/admin/establishment` (`/school/branding` → redirect) | tabs | school info + branding form | patch branding | — | `safe()` | INC — §2.12 (unvalidated CSS injected) |
| `/admin/school/structure` | year chips (`?year=` → `academicYearId`) | cycle→level→class tree | read-only | — | — | OK |
| `/admin/schools` | — | school cards | create · switch → `POST /schools/{id}/switch` | inline form | — | OK |
| `/admin/analytics` | 1 select (`termId`) | drill table (Élèves évalués, En réussite, En difficulté, Moyenne, Taux) + ranking (Rang, Élève, Moyenne, Tendance, Statut) | drill-down `onDrill` | — | `EmptyState` ×2 | OK |
| `/admin/settings` | — | notification prefs matrix (kind × channel) + display prefs | per-cell toggle, bulk cadence, bulk channel, reset | — | — | INC — `ch.comingSoon` channels rendered disabled |
| `/admin/meeting-requests` | **none** | open / resolved / cancelled sections | resolve → `components/meeting-requests/actions.ts` | — | `safe()` empty | INC — no filters, 100-row cap per status |
| `/admin/notifications` | q + 3 selects declared | shared `NotificationCenter` | mark read / mark all read | — | — | OK |
| `/admin/assignments` (`/teaching-assignments` → redirect) | — | `AssignmentsManager` | CRUD assignments | inline | `safe()` | OK |
| `/admin/login`, `/admin/register` | — | auth forms | NextAuth | — | — | OK |
| Redirect-only shims | `announcements`→`communications`, `cycles`→`levels`, `enrollment-requests`→`enrollments`, `school/branding`→`establishment`, `teaching-assignments`→`assignments`, `roles/[id]`→`roles/[id]/edit` | | | | | OK |

### 1.2 Teacher portal (21 routes)

| Route | Controls | Class |
|---|---|---|
| `/teacher/dashboard` | KPI, `InlineGradebook` (inline grade entry + save-all + assessment picker), action center, calendar panel | OK |
| `/teacher/classes` | client grid + reset filter | OK |
| `/teacher/classes/[id]` | overview; `redirect('/teacher/dashboard?error=unknown_assignment')` guard at `page.tsx:192` | **DEF** — dead link `/teacher/messaging` at `page.tsx:903` (§2.4) |
| `/teacher/classes/[id]/grades` | gradebook matrix, per-assessment flush, publish, create assessment (`FormDrawer`-less inline), grade-grid export | OK |
| `/teacher/classes/[id]/attendance` | date/heure/sujet, open session, mark-all-present, per-student status, save | **DEF** — §2.13 (no revalidation after save) |
| `/teacher/classes/[id]/lessons` | q + 4 selects; create/edit/delete lesson | OK |
| `/teacher/assessments` | q + 6 selects (in-memory), 7 cols | INC |
| `/teacher/grades` | q + 4 selects (in-memory over `recent-grades?limit=100`), 7 cols | INC |
| `/teacher/students` | q + 4 selects (in-memory), 6 cols, CSV export | INC |
| `/teacher/reports` | q + 5 selects, per-term columns, export | OK |
| `/teacher/messages` + `/new` | announcement composer (scope tiles, priority tiles, expiry), publish/delete row actions | OK |
| `/teacher/conversations` + `/[id]` | inbox, reply, report | OK |
| `/teacher/meeting-requests` | 3 status sections, resolve | INC (no filters, 100-cap) |
| `/teacher/remediation` | availability publish drawer, booking transitions (confirm/complete/no-show/decline) | **DEF** — §2.10 |
| `/teacher/documents` | q + 3 selects + class filter, KPIs, pagination | **NF** — §2.14 (data source is never written) |
| `/teacher/calendar`, `/notifications`, `/settings`, `/login`, `/register` | — | OK |

### 1.3 Parent portal (23 routes)

| Route | Controls | Class |
|---|---|---|
| `/parent/dashboard` | `ChildSelector`, family swimlane, action center, `RecentGradesTable` (9 cols, client pagination), remediation strip, events | INC — §2.15 (HTTP fan-out) + dead link `/parent/remediation` |
| `/parent/children` + `/[id]` + `/[id]/report` | claim list, child hero, subject cards, printable report (`window.print()`) | **DEF** — `/api/v1/parent/child-claims` absent from running API (§2.10) |
| `/parent/grades` | `ChildSelector` + q + 4 selects (in-memory), CSV export | OK |
| `/parent/subjects` | q + 3 selects + **the only sort control in the app** (`page.tsx:294`) | OK |
| `/parent/upcoming` | q + 4 selects, ICS export + "add to calendar" | OK |
| `/parent/attendance` | q + 3 selects, month calendar w/ prev/next, CSV export | OK (0 rows in DB) |
| `/parent/comments`, `/recommendations`, `/announcements`, `/communication`, `/lessons` | q + 3-4 selects each; alert ack/resolve/dismiss; "find tutoring" + "request meeting" intents | OK |
| `/parent/documents` | `ChildSelector` + q + 2 selects; bulletin enqueue + download | **NF** for the document list (§2.14); bulletin export OK |
| `/parent/messages` + `/[id]` + `/new` | compose (child + teacher + subject), thread reply, report thread | OK |
| `/parent/remediation/[planId]` | mark met / close / reopen with `ConfirmDialog` | OK — but **no `/parent/remediation` index** (§2.4) |
| `/parent/settings`, `/notifications`, `/calendar`, `/login`, `/register` | prefs matrix, display prefs, family list | INC — `/legal/terms` + `/legal/privacy` links 404 (§2.4) |

### 1.4 Student portal (6 routes)

`/student/dashboard`, `/grades`, `/upcoming`, `/attendance`, `/announcements`, `/login`.
All are gated by `StudentActivationGate` and all call `/api/v1/student/*`.
These are the **only pages in the app that render `ErrorState`** (4 of them).
**Class: DEF** — the entire `student` controller is absent from the running API (§2.10). Also the only portal with **no `error.tsx`** boundary.

### 1.5 Cross-cutting control inventory

| Control class | Present? | Evidence |
|---|---|---|
| Search input | 23 pages | 23 × `<SearchInput>` in `*Filters.tsx` |
| Select filters | 25 filter components, 79 `<SelectFilter>` | `grep -c "<SelectFilter"` per file |
| **Sortable table columns** | **NONE** | 0 `aria-sort` / `onSort` in `apps/web/src`; only `/parent/subjects` has a sort *select* |
| **Bulk row selection / bulk actions** | **NONE** | 11 `type="checkbox"` in the whole app; the only select-all is permission groups in `RoleBuilderForm.tsx:291` |
| Pagination | 11 pages in-memory `slice()`, ~4 true server-side | see §2.9 |
| Route-level `loading.tsx` | **0 of 104** | `find -name loading.tsx` → 0 |
| Route-level `error.tsx` | 4 (`app/`, `admin/`, `parent/`, `teacher/`) — **student missing** | `find -name error.tsx` |
| `EmptyState` | widely used (good) | ~70 occurrences |
| `ErrorState` | 4 uses, all in `/student/*` | `grep -rn ErrorState` |
| Modals/drawers | `FormDrawer` ×8, `ConfirmDialog` ×2, `DetailDrawer` ×1, 2 hand-rolled `role="dialog"` | |
| Table `<th scope>` | **13 of 230** | a11y gap |
| Table `<caption>` | **0** | a11y gap |

---

## 2. Defects (file:line)

### 2.1 `admin/students` — "Niveau" filter is wired to nothing — **NF**
`apps/web/src/app/admin/students/page.tsx:130` declares `gradeLevelId?: string`, `:262` passes `initialGradeLevelId={sp.gradeLevelId}` to the filter strip, and `StudentsPageFilters.tsx:70-78` renders a populated `<SelectFilter>` that pushes `?gradeLevelId=` into the URL.
The value is **never consumed**: the API query string is built at `page.tsx:137-143` from `q`, `status`, `classSectionId`, `limit`, `offset` only, and there is no in-memory filter either (`grep -n gradeLevelId page.tsx` → 4 hits, all plumbing).
Effect: selecting a level updates the dropdown and the URL; the 2463-row table is unchanged. Pure decoration.

### 2.2 `admin/students` — fabricated data rendered as fact — **MOCK**
```ts
// apps/web/src/app/admin/students/page.tsx:105-113
function performanceFromId(id: string): { rating: number; label: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const rating = (hash % 5) + 1;
```
Rendered at `:325` as `<StarRating value={perf.rating} label={perf.label} stacked />` under the column header **"Performance académique"** (`:291`). Every one of the 2463 students gets a 1–5 star academic rating derived from a hash of their UUID. Nothing labels it as demo data in the UI. The docstring admits it: *"used as a demo performance indicator"*.

Second fabrication on the same page, `:277-279`:
```ts
sub={s.email ?? `${s.firstName.toLowerCase()}.${s.lastName.toLowerCase()}@email.com`}
```
Students with no email are shown a **made-up `@email.com` address** that looks real and is copy-pasteable.

### 2.3 200-row ceiling on guardians — **DEF** (high)
`apps/api/src/modules/guardians/guardians.controller.ts:97` — `const take = Math.min(parseInt(limit ?? '50', 10) || 50, 200);` and `:123` returns `{ data }` with **no `total`** and no offset support.
DB has **2487 guardians**. Consumers:

* `apps/web/src/app/admin/guardians/page.tsx:68` sets `limit=200`, then `:99` paginates **in memory**: `allGuardians.slice(startIdx, startIdx + PAGE_SIZE)`.
  → 2287 guardians (92%) are unreachable by browsing.
  → `:249` `<Pagination total={totalGuardians}>` reports **200**, not 2487.
  → the 4 KPI cards at `:123-146` ("PARENTS ENREGISTRÉS", "LIENS APPROUVÉS", "LIENS EN ATTENTE", "COMPTES À VÉRIFIER") are computed at `:83-98` over the same 200 rows and are therefore **wrong numbers presented as counts**.
  → the `relationship` filter (`:76`) also only sees the 200-row window.
* `apps/web/src/app/admin/students/[id]/page.tsx:110` — `/api/v1/guardians?limit=200` feeds the "attach an existing guardian" picker in `StudentDetailTabs.tsx` → **92% of guardians cannot be attached to a student**.
* `apps/web/src/app/admin/enrollments/page.tsx:115` — same cap.

### 2.4 Dead internal links (route does not exist) — **DEF**
Verified against the full `page.tsx` route table:

| file:line | href | Note |
|---|---|---|
| `apps/web/src/components/shell/sidebar-items.ts:175` | `/admin/reports` | **dead item in the admin sidebar** ("Rapports", Documents & suivi group) |
| `apps/web/src/app/admin/assessments/page.tsx:184` | `/admin/assessments/{id}` | no `[id]` route — the only row action on the page |
| `apps/web/src/app/admin/guardians/page.tsx:191, 237, 238` | `/admin/guardians/{id}`, `…#edit` | no `[id]` route — name link + both row actions |
| `apps/web/src/app/admin/enrollments/page.tsx:276` | `/admin/guardians/{id}` | same |
| `apps/web/src/app/teacher/classes/[id]/page.tsx:903` | `/teacher/messaging?classSectionId=…` | route is `/teacher/messages` |
| `apps/web/src/app/parent/dashboard/_components/RemediationProgressStrip.tsx:233` | `/parent/remediation` | only `/parent/remediation/[planId]` exists |
| `apps/web/src/components/shell/TopbarUserMenu.tsx:45` and `apps/web/src/components/UserMenu.tsx:55` | `/{portal}/profile` | **no profile route in any portal** — dead item in every user menu |
| `apps/web/src/components/shell/TopbarUserMenu.tsx:58` | `/help` | hard 404 (`curl` → 404, not even redirected) |
| `apps/web/src/app/parent/register/ParentRegisterForm.tsx:172,176` and `apps/web/src/components/AuthSplitLayout.tsx:141,145` | `/legal/privacy`, `/legal/terms` | hard 404 — **on the registration consent line** |

`{portal}/settings` also resolves for admin/teacher/parent but **not student** (no `student/settings/page.tsx`).

### 2.5 `/admin/classes/new` is a link into the `[id]` dynamic route — **DEF**
`apps/web/src/app/admin/classes/page.tsx:154` (`Ajouter une classe` header button) and `:220` (`EmptyState` action) both point at `/admin/classes/new`. There is no `admin/classes/new/` directory — the segment is swallowed by `admin/classes/[id]/page.tsx`, which at `:122` does an **unguarded** `await api<ClassDetail>('/api/v1/classes/new')` with no try/catch and no `notFound()`. The `ApiError` propagates → `admin/error.tsx`. So the primary create-a-class CTA renders an error page, and there is **no way to create a class from the UI at all**.
Same lack of guard makes any bad/stale class id a 500 instead of a 404.

### 2.6 `/admin/enrollments` — approval workflow is not implemented, and the page says so — **NF**
`apps/web/src/app/admin/enrollments/page.tsx:292-299` renders, in the product UI:
> *"Les actions Approuver / Rejeter ouvriront un FormDrawer dédié dans la phase R6."*

The only row action (`:276`) is a `RowActions viewHref` to the **dead** `/admin/guardians/{id}`. The "Type" and "Statut" columns are derived by string-parsing a JSON flag out of `Guardianship.notes` (`parseRequestType(r.notes)`, `parseReview(r.notes, …)` at `:245-246`). The tabs `pending / to_verify / approved / rejected` exist but no control can move a row between them.

### 2.7 `BEHAVIOR_ALERT` — an admin can enable a rule that can never fire — **NF**
`apps/api/src/modules/alerts/alerts.types.ts:12` lists `BEHAVIOR_ALERT` in `RULE_CODES`, so `alerts.service.ts:76` materialises a row for it per tenant. But `alerts.service.ts:44-53`:
```ts
const RULE_FN: Partial<Record<AlertRuleCode, RuleFn>> = { …
  // BEHAVIOR_ALERT remains a stub — it will be wired in a subsequent iteration.
};
```
The UI at `apps/web/src/app/admin/alerts/page.tsx:73-81` correctly marks it `UI seulement` and hides `RuleConfigEditor` (`:383`) — but `AlertRuleToggle` at `:352` is **still rendered and still enabled**. Toggling it writes `enabled=true` via `PATCH /alerts/rules/{code}`, the card then shows as active, and `POST /alerts/evaluate` silently produces nothing for it. 7 of 8 cahier-des-charges rules are implemented; the 8th is a switch that does nothing.

### 2.8 `admin/audit` server/client boundary — **2** symbols, not 1 — **DEF** (already known, extended)
`apps/web/src/app/admin/audit/page.tsx:16`
```ts
import { AuditPageFilters, humanizePortal, humanizeResourceType } from './AuditPageFilters';
```
`AuditPageFilters.tsx` is `'use client'`. The server component calls **both** helpers during render — `humanizeResourceType(rt)` at `:92` (the previously reported one) **and `humanizePortal(p)` at `:97`**. Both are client references on the server. Fixing only `:92` leaves the page broken.
A full-repo scan for this class found **exactly these two** and no others (script: server files importing a non-JSX symbol from a `'use client'` sibling and invoking it).

### 2.9 In-memory pagination + hard fetch ceilings — **INC**
11 pages paginate a JS array instead of the database:
```
admin/assessments:85 · admin/attendance:89 · admin/classes:130 · admin/enrollments:140
admin/guardians:99 · admin/teachers:110 · parent/announcements:113
parent/dashboard/_components/RecentGradesTable:47 · teacher/assessments:244
teacher/messages:105 · teacher/students:155
```
`admin/exports/page.tsx:59` is explicit: `const FETCH_LIMIT = 100;` — every KPI (`:263-271`), every filter (`:277-297`), the requester dropdown (`:300-308`) and the pagination total are computed on the 100 most recent exports; the real `total` is fetched at `:258` and used only for a footnote at `:382`.
`/api/v1/classes`, `/api/v1/teachers`, `/api/v1/assessments`, `/api/v1/subjects`, `/api/v1/cycles` have **no `take` at all** in their controllers — unbounded `findMany`. Currently survivable (94 classes, 21 assessments) but will not scale, and combined with in-memory pagination it means these pages get slower linearly with the tenant.

### 2.10 The running API image is stale too — 4 whole modules unreachable — **DEF**
The prior pass flagged the stale **web** image. The **API** image is equally stale. Source has these controllers; `docs-json` does not, and every probe returns 404:

| Controller (source) | Prefix | Live |
|---|---|---|
| `child-claims/child-claims.controller.ts:44` | `parent/child-claims` | 404 |
| `child-claims/admin-child-claims.controller.ts:47` | `admin/child-claims` | 404 |
| `integrations/integrations.controller.ts:66` | `integrations/oneroster` | 404 |
| `student-portal/student-portal.controller.ts:41` | `student` (7 routes) | 404 |
| `remediation.controller.ts:537,551,579,612,695,718,732,775,815,855` | `remediation/teacher*`, `remediation/admin/*`, `remediation/tutors*` | absent from `docs-json` (only `plans`, `catalogue`, `bookings` are live) |

Downstream, these UI surfaces call endpoints that do not answer:
`admin/child-claims/page.tsx:42` · `admin/integrations/page.tsx:30` · `admin/remediation/page.tsx:58-59` · `teacher/remediation/page.tsx:45` · `parent/children/page.tsx:72` · all 6 `student/*` pages via `student/_lib/student-me.ts:18`.

### 2.11 `/admin/conversations` — "Modération" with no moderation controls — **NF / BE gap**
`apps/web/src/app/admin/conversations/page.tsx` renders 3 KPIs ("À examiner", "Examinés", "Classés"), an open-reports list and a "Historique" section, but `ReportRow` (`:134-185`) contains **no button, no form, no action** — it is pure display.
Confirmed on the API side: `apps/api/src/modules/messaging/messaging.controller.ts` exposes `GET conversations/reports` (`:148`) and `POST conversations/:id/report` (`:242`) — and **no transition endpoint**. `reviewedAt` exists in the select (`messaging.service.ts:1069, 1142`) but nothing ever sets it.
Net: a report can only ever be `open`. The "Examinés"/"Classés" KPIs are permanently `0` and the entire "Historique" branch (`:120-131`) is unreachable dead UI. The sidebar entry (`sidebar-items.ts:153-159`) promises moderation the product cannot perform.

### 2.12 Unvalidated branding values injected into a server-rendered `<style>` — **DEF** (security)
`apps/api/src/modules/school-structure/branding.dto.ts` validates `primaryColor`, `accentColor`, `fontFamily` with **only** `@IsString() @MaxLength(60|60|120)` — no `@IsHexColor`, no `@Matches`.
`apps/web/src/components/shell/AppShellRoot.tsx:229`:
```ts
const css = `:root{${branding.primaryColor ? `--brand-primary:${branding.primaryColor};` : ''}…}`;
…
<style dangerouslySetInnerHTML={{ __html: css }} />
```
No escaping. A `school_admin` holding `branding.write` can store a value containing `}` and break out of the `:root{}` rule, injecting arbitrary CSS that then renders **on every authenticated page of every portal (admin, teacher, parent, student) for every user in that school** — stored CSS injection: content hiding, fake overlays, background-image beacons. Not script execution (a `<style>` cannot run JS), so it is defacement/exfil-by-CSS rather than XSS, but it crosses a role boundary and persists.
`logoUrl` / `faviconUrl` are likewise unvalidated 500-char strings; `faviconUrl` lands in `<link rel="icon" href={…}>` at `AppShellRoot.tsx:224`.

### 2.13 Attendance save never revalidates — **DEF**
`apps/web/src/app/teacher/classes/[id]/attendance/actions.ts` is the **only** mutation module in the app with **zero** `revalidatePath` (2 mutations, 0 revalidations — every other of the 41 action files has at least one).
`AttendanceManager.tsx:105-119` `save()` awaits `submitAttendance()` and sets a success toast; it never calls `router.refresh()` (`grep -n "router.refresh" AttendanceManager.tsx` → no match).
Result: after taking the register, the surrounding server-rendered `KpiCard`s (`page.tsx`), `HistoricSessionsPanel.tsx` and `StudentsToWatchPanel.tsx` still show the pre-save state until a hard reload. The teacher sees "12 présences enregistrées" next to a history panel that does not list the session.
Secondary smell in the same file: `fetchRoster` (`actions.ts:26-33`) is a **GET wrapped in `'use server'`** — every roster read is a POST server-action round-trip returning `Result<unknown>`, which the client then casts.

### 2.14 "Documents" / "Ressources" — two full sidebar features over a field nothing writes — **NF**
`teacher/documents/page.tsx` and `parent/documents/page.tsx` build their entire list by flattening `announcement.attachments` and `lesson.attachments` (`teacher/documents/page.tsx:105-160`, `parent/documents/page.tsx:99-160`).
Searching the whole web app for a **writer** of `attachments`: `grep -rn "attachments" apps/web/src` returns **only readers** — `admin/announcements/[id]/page.tsx`, `parent/documents`, `teacher/documents`, and a type. Neither `AnnouncementComposer.tsx` (1001 L) nor `LessonsManager.tsx` (396 L) ever sends the field, and there is **no upload control anywhere** in the app (`grep -rn 'type="file"'` → 2 hits, both in the CSV import wizard `ImportWizard.tsx:188` and `IntegrationsManager.tsx:439`).
On the API side `attachments?: unknown[]` is accepted with only `@IsArray()` (`lessons.controller.ts:47,56`; `announcements.controller.ts:52`) — no item-shape validation.
Net: `/teacher/documents` (q + 3 selects + class filter + KPIs + pagination, 429 L) and the document half of `/parent/documents` (483 L) are **guaranteed to be permanently empty**, and the "Pièces jointes" block in `admin/announcements/[id]/page.tsx:409-416` can never render. Only the bulletin-export half of `/parent/documents` is real.

### 2.15 Per-child HTTP fan-out on the parent dashboard — **INC**
`apps/web/src/app/parent/dashboard/page.tsx:232-247` issues **2 API calls per child** (`analytics/parent-dashboard/{id}` + `alerts/parent/{id}`) inside a `Promise.all` map, capped at `FAMILY_OVERVIEW_MAX` (8) → up to **17 upstream HTTP calls per page render** (16 + comments), each re-authenticating through `auth()` in `api-client.ts:38`. It is parallel and capped (better than serial), but it is an N+1 at the HTTP layer where one aggregate endpoint would do; the comment at `:225` claims it avoids N round trips, which is not what the code does.

### 2.16 Search fires a full server render on every keystroke — **DEF** (perf)
`packages/ui/src/components/SearchInput.tsx:12` — *"onChange handler — fires on every keystroke"* — and there is no debounce in the component. All 23 call sites wire it straight to `router.push`, e.g. `StudentsPageFilters.tsx:60-64` → `update({ q })` → `router.push` (`:45`).
On `/admin/students` (`dynamic = 'force-dynamic'`) each keystroke re-runs the server component and its **4 parallel API calls** (`page.tsx:145-152`). Typing "Dupont" = 6 renders × 4 calls = **24 API round-trips** against a 2463-row table. Same pattern on all 23 searchable pages.

### 2.17 `RowActions` renders a `<button>` inside an `<a>` — **DEF** (a11y / HTML validity)
`packages/ui/src/components/RowActions.tsx:96-108`:
```tsx
<a key={a.id} href={a.href} aria-label={a.label} title={a.label}>
  <IconButton … tabIndex={-1} />
</a>
```
`IconButton` is a `<button>` (`IconButton.tsx:34` — `ButtonHTMLAttributes<HTMLButtonElement>`). Interactive content nested inside an anchor is invalid HTML and produces an unpredictable AT tree; the `tabIndex={-1}` workaround confirms the authors hit the double-focusable symptom. It is also a raw `<a>`, not `next/link` — every "Voir"/"Modifier" in every admin table triggers a **full document navigation** instead of a client transition.

### 2.18 `#edit` row action does not open an editor — **NF**
`admin/students/page.tsx:333` `editHref={'/admin/students/{id}#edit'}`. `StudentDetailTabs.tsx` (913 L) has **no hash handling** (`grep -n "hash\|#edit\|location.hash"` → no match); the editor is behind `onClick={() => setEditing(true)}` at `:229`. The pencil icon navigates to the detail page and does nothing else. Same construction on `admin/guardians/page.tsx:238`, where the target route does not even exist.

### 2.19 `PermissionsGuard` fails open on missing metadata — **INC** (design risk)
`apps/api/src/shared/auth/permissions.guard.ts:21`:
```ts
if (!required || required.length === 0) return true;
```
There is no `APP_GUARD` in `app.module.ts`; guards are per-controller. A handler added without `@RequiresPermission` is authenticated-but-unrestricted rather than denied. Current exposure is small and intentional (5 of 227: `healthz`, `readyz`, `/`, `GET /me`, `POST /auth/register-parent`) — but the default is "allow", so the next forgotten decorator is silently open.

### 2.20 Teacher ABAC is unrestricted — **DEF** (security, live TODO)
`apps/api/src/modules/students/student-access.service.ts:36-39`:
```ts
if (roles.includes('teacher')) {
  // TODO Phase 4: when teaching assignments exist, filter by the teacher's class sections.
  return { studentIds: null, reason: 'teacher (unrestricted until teaching assignments land)' };
}
```
`studentIds: null` is the admin "no restriction" sentinel (`canAccessStudent` at `:66-73` returns `true` immediately). Teaching assignments **do** exist now (`/api/v1/teaching-assignments`, `teachers/me/assignments`, 94 class sections). Every consumer of this scope — `alerts.controller.ts:178`, `analytics.controller.ts`, `calendar.controller.ts:323` — therefore lets **any teacher read any of the 2463 students in the school**, including grades, alerts and comments for children they do not teach.

### 2.21 Query parameters bypass validation entirely — **INC**
`main.ts:20-25` installs a global `ValidationPipe({ whitelist, forbidNonWhitelisted })`, which is solid for bodies. But **no controller uses a query DTO**: every filter arrives as `@Query('x') x?: string` (98 occurrences across 25 controllers, e.g. `analytics.controller.ts:229-236`, `students.controller.ts:97`, `alerts.controller.ts:76-77`). The pipe never runs on primitives, so there is no enum check, no UUID check, and pagination is hand-parsed (`Math.min(parseInt(limit ?? '50',10) || 50, 200)`). Prisma parameterises, so this is not injection — but invalid filter values silently degrade to "no filter" rather than 400, which is exactly the failure mode behind several of the UI filter gaps above.

### 2.22 Dead code in `@pilotage/ui` — **INC**
7 of 64 components are never referenced by `apps/web` (11%):
`BarChart`, `Breadcrumb`, `EditableGradeTable`, `IconButton` (only used internally by `RowActions`), `LoadingState` (all 3 exports), `RecommendationCard`, `Stats2x2Grid`.
Plus 15 unused named exports: `AvatarGroup`, `badgeVariants`, `CardHeader/CardTitle/CardDescription/CardFooter`, `useDisplayPrefs/useDisplayDensity/useDisplayAccent/useDisplayGradeFormat`, `FadeIn/Reveal/HoverLift/PageTransition/AnimatedNumber`, `SidebarItem`, `defaultToneForStatus`, `defaultLabelForStatus`.
Two are structurally telling:
* `LoadingState` (`Skeleton`, `LoadingCard`, `LoadingTable`) is dead because there are **0 `loading.tsx` files** — 104 `force-dynamic` routes that block on `await api()` with no skeleton and no streaming.
* `EditableGradeTable` (a full gradebook grid, exported with 5 types) is dead while `Gradebook.tsx` (496 L) and `InlineGradebook.tsx` (403 L) each hand-roll their own grade matrix.
`DataTable` is used exactly **once** (`admin/remediation/RemediationCatalogueManager.tsx:353`); the other ~25 tables are hand-written `<table>` markup — which is why `<th scope>` is at 13/230 and `<caption>` at 0.

### 2.23 Cosmetic dead markup left to appease the linter
`apps/web/src/app/admin/guardians/page.tsx:262-264`:
```tsx
<span className="hidden">
  <X className="h-3 w-3" />
</span>
```
An icon imported, never needed, hidden in the DOM so the unused-import rule stays quiet.

---

## 3. Capability classification summary

**Fully operational** — admin CRUD for academic years / cycles+levels / subjects+coefficients / calendar / roles / schools / teaching assignments; user invite + role assignment; imports (wizard → validate → conflicts → apply → rollback); exports launch+download; announcements compose/publish/delete + recipient detail; alerts triage (ack/resolve/dismiss) for the 7 implemented rules; admin analytics drill-down; teacher gradebook (entry, batch save, publish, export), lessons CRUD, reports, messages, conversations, students/assessments/grades lists; parent grades / subjects / upcoming / attendance / comments / recommendations (with alert transitions + meeting & tutoring intents) / announcements / messaging / bulletin export / remediation plan completion; notification preference matrix and display preferences across all three portals.

**Exists-but-incomplete** — admin/exports (100-row ceiling drives KPIs+filters+pagination); admin/imports, admin/announcements/[id], teacher/assessments, teacher/grades, teacher/students, parent/announcements (filters applied in memory over uncapped or capped fetches); admin/users (no search/filter/pagination, no role-removal control); admin/attendance and admin/assessments (no filters at all); admin+teacher meeting-requests (no filters, 100-cap per status); admin/students/[id] and admin/enrollments guardian pickers (200 of 2487); parent/dashboard HTTP fan-out; `PermissionsGuard` fail-open; query-param validation.

**Visible-but-non-functional** — `admin/students` "Niveau" filter; `admin/enrollments` approve/reject (page states it is unimplemented); `admin/conversations` moderation (no controls, no backend transition, dead "Historique" branch); `BEHAVIOR_ALERT` enable toggle; `teacher/documents` + the document half of `parent/documents` (`attachments` has no writer); `#edit` row actions; `/admin/reports` and `/{portal}/profile` sidebar/menu entries.

**Backend-only** — `DELETE /api/v1/users/roles/{userRoleId}` (no UI); `POST /assessments/{id}/unpublish` (no UI; only `publish` is wired); `PATCH /remediation/plans/{id}/reopen` at admin scope; `GET /enrollments/roster/{classSectionId}`; `POST /grades/{id}/revise`.

**Frontend-only** — the `Documents`/`Ressources` aggregation layer (no storage, no upload); `/admin/classes/new` CTA (no route, no create form); `/legal/terms`, `/legal/privacy`, `/help`.

**Placeholder / mock** — `performanceFromId()` star ratings on `/admin/students`; the synthesised `@email.com` fallback address on the same table.

**Defective** — see §2.1–2.23. The load-bearing ones: `/admin/audit` 500 (2 symbols), the 2487-vs-200 guardian ceiling with wrong KPIs, `/admin/classes/new` (no way to create a class), 10 dead links including a sidebar item and both registration-consent links, attendance save without revalidation, unvalidated branding CSS injection, and unrestricted teacher ABAC.

---

## 4. Notes on scope boundaries with the previous pass

Already-confirmed findings I did **not** re-report as new, but extended:
* `admin/audit` boundary violation → it is **two** call sites (`humanizePortal` *and* `humanizeResourceType`), both from `page.tsx:16`; a repo-wide scan found no third instance of this class (§2.8).
* stale running image → the **API** image is stale as well, taking out 4 whole modules and 6 UI surfaces beyond the 4 web 404s already known (§2.10).
* 64 components / 0 stories → additionally **7 components and 15 named exports are dead code**, `DataTable` is used once, and `LoadingState` is unusable because there are 0 `loading.tsx` files (§2.22).
* duplicate `<h1>` → source confirmed: `PageHeader.tsx:45` emits an `<h1>` and `AppShellRoot`'s topbar emits the page title as well; a few pages (`admin/school/structure/page.tsx:83`) add a third hand-rolled `<h1>`.
* RLS / `$executeRawUnsafe` — out of this domain, not re-examined.
