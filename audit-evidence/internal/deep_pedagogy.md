# Deep audit — domain **pedagogy** (internal "Pilotage scolaire")

Date: 2026-08-01 · Branch `claude/platform-audit-gap-analysis-216337` · commit `a9943ce`
Scope: `apps/api/src/modules/{grades,attendance,lessons,teaching,school-structure,calendar}`,
`apps/web/src/app/admin/{assessments,attendance,classes,subjects,levels,cycles,academic-years,assignments,teaching-assignments,calendar}`,
`apps/web/src/app/teacher/**`.
Method: full read of every `page.tsx` + sibling client components + every controller/service in scope;
live OpenAPI (`localhost:4000/docs-json`); **read-only** Postgres inspection (`pilotage_postgres`).

---

## 0. Ground truth from the live database (read-only)

```
assessment                  21     (all kind=written_test, all is_published=t)
grade                      513     (all status=published)
grade_revision               0
class_session                0     <-- attendance never exercised
attendance_record            0     <-- attendance never exercised
lesson_entry                 0     <-- cahier de texte never exercised
calendar_event              17     (100% scope=school_wide; 0 cycle/level/class-scoped)
teaching_assignment        289
class_section               94     (all in the single active year 2023–2024)
subject_coefficient        352
term                         3
cycle                        3 · grade_level 44 · subject 8
snapshot_recompute_trigger  21     (4 done/grade_published, 16 done/backfill, 1 FAILED)
```

Derived checks:
- `select count(distinct subject_id) from teaching_assignment` → **5** of 8 active subjects have a teacher (真 "sans enseignant" = 3).
- `select count(*) from class_section cs where not exists (… is_main_teacher)` → **92 of 94 classes have no professeur principal**.

These two numbers falsify UI counters (§4.1, §4.6) and blow up a UI panel (§4.6).

---

## 1. Headline defects (ranked)

### D1 — `PATCH /cycles/grade-levels/:levelId` runs **zero validation** and mass-assigns straight into Prisma
`apps/api/src/modules/school-structure/cycles.controller.ts:168` declares `@Body() body: Partial<GradeLevelDto>`
and `:174` does `this.prisma.gradeLevel.update({ where: { id: levelId }, data: body })`.

`Partial<T>` is a TypeScript-only mapped type; it emits `design:paramtypes = Object`. Nest's
`ValidationPipe.toValidate()` returns `false` for native `Object`, so the pipe **returns the raw body untouched** —
`whitelist`, `forbidNonWhitelisted` and every `class-validator` rule configured at
`apps/api/src/main.ts:21-25` are all bypassed.

Confirmed against the running API: the live OpenAPI has **no `requestBody` at all** for this route
(`PATCH /api/v1/cycles/grade-levels/{levelId} => "NO BODY SCHEMA"`), which is exactly the signature of an
unresolvable metatype.

Impact: any principal holding `grade_levels.write` (i.e. every `school_admin`) can PATCH arbitrary
`gradeLevel` scalars, including **`tenantId`, `schoolId`, `cycleId`** — cross-tenant / cross-school data
corruption and silent re-parenting of a whole level (and, transitively, its classes, enrollments and grades).

Same `Partial<T>` pattern, lower blast radius (fields are explicitly picked at `:229-234`, so no
mass-assignment — but still no validation, so `orderIndex: {}` or `startDate: "nope"` reach Prisma as a 500):
`apps/api/src/modules/school-structure/academic-years.controller.ts:220`.

### D2 — Coefficient-matrix save accepts **foreign-tenant ids** (cross-tenant write)
`apps/api/src/modules/school-structure/subjects.controller.ts:211-221`.
`BulkCoefficientDto.entries[]` validates only `@IsUUID()` on `gradeLevelId`/`subjectId`. There is **no check that
either id belongs to `me.tenantId` / the caller's `schoolId`** before the `subjectCoefficient.upsert` on the
composite key `gradeLevelId_subjectId`. A `school_admin` of tenant A can overwrite tenant B's coefficient for any
(level, subject) pair it can guess/enumerate — which re-weights every weighted average in tenant B
(`grades.service.ts:126-127` reads exactly this row).
Secondary: `entries` has `@ValidateNested({each:true})` but **no `@IsArray()`, no `@ArrayMaxSize`** → unbounded
batch inside one `$transaction` (`:210`).

### D3 — The snapshot-recompute queue has **no consumer in this codebase**
Three pedagogy write paths enqueue into `snapshot_recompute_trigger`:
- `apps/api/src/modules/grades/assessments.controller.ts:376` (`grade_published`, on publish)
- `apps/api/src/modules/grades/grades.controller.ts:509` (`grade_revised`, on revise)
- `apps/api/src/modules/school-structure/subjects.controller.ts:257` (`coefficient_changed`)

`grep -rn '@Cron|ScheduleModule|@Interval' apps/api/src` → **0 hits**. `snapshotRecomputeTrigger` is only ever
`count`/`findFirst`/`findMany`/`findUnique`/`update`/`create`-ed by `analytics/snapshot-ops.service.ts` (an ops
surface), never drained on a schedule.

The comments assert behaviour the branch does not contain:
- `assessments.controller.ts:363` — "The worker drains it into byte-parity snapshot rows"
- `subjects.controller.ts:240-241` — "the worker (FR7) fans it out to every affected ClassSection"
- `grades.controller.ts:482` — "the safety-net sweep + live fallback cover it"

**Features referenced but not implemented.** Worse, the DB proves the *running container is a different build*:
the one `failed` row carries a stack trace pointing at
`/app/src/modules/analytics-snapshots/snapshot-drain-cron.service.ts:501` — a **file and module that do not exist
anywhere in this worktree** (only `apps/api/src/modules/analytics/snapshot-ops.service.ts` exists). The API image
is stale/divergent, exactly like the already-confirmed stale web image.

That stuck row is also a live bug: 5 attempts, `Unique constraint failed on (tenant_id, coalesce_key, status)`
inside `snapshotRecomputeTrigger.updateMany()` — the drain tries to move a row to a terminal status that already
has a sibling row under the same partial-unique key.

### D4 — Editing a cahier-de-texte entry is **hard-broken** (400 every time)
`apps/web/src/app/teacher/classes/[id]/lessons/LessonsManager.tsx:288-299` builds **one** payload for both create
and update:
```ts
const payload = { teachingAssignmentId, date, title, content, homework, homeworkDueAt, status };
const res = initial ? await updateLesson(initial.id, payload, …) : await createLesson(payload, …);
```
`UpdateLessonDto` (`apps/api/src/modules/lessons/lessons.controller.ts:50-57`) has **neither
`teachingAssignmentId` nor `date`**. With `forbidNonWhitelisted: true` (`main.ts:24`) the PATCH is rejected:
*"property teachingAssignmentId should not exist, property date should not exist"*.
→ The "Modifier" pencil (`LessonsManager.tsx:234-241`) is **visible-but-non-functional**; the `Date` input is
editable but un-persistable in edit mode. Never caught because `lesson_entry` has 0 rows.

### D5 — Attendance: silent partial save, corrupting every downstream rate
`apps/web/src/app/teacher/classes/[id]/attendance/AttendanceManager.tsx:216` renders each unmarked student as
**"Présent" (green, active)**: `const status = marks[id] ?? row.record?.status ?? 'present'`.
`save()` at `:110` serialises **only `marks`**: `Object.entries(marks).map(…)`.
→ A teacher who marks one pupil absent and hits *Enregistrer* persists **one** record. The other 29 pupils
displayed as present get **no `attendance_record` row at all**. `recordedTotal`, presence rate
(`attendance/page.tsx:53-55, :99`), the `/admin/attendance` KPI strip and the R-rules all then compute over a
1-row denominator.
Related in the same file:
- `:58` `new Date().toISOString().slice(0,10)` → **UTC** date, off-by-one for the session date in any non-UTC
  timezone; also SSR-vs-client hydration risk.
- `:228` the status buttons are `['present','late','absent','absent_excused']` — **`left_early` is unreachable**
  even though it exists in the Prisma enum, in `STATUS_LABEL/TONE/ICON` (`:38,:46,:54`) and in the admin table
  (`admin/attendance/page.tsx:46`). Dead status.
- `comment` and `arrivedAt` exist in `AttendanceItem` (`attendance.controller.ts:52-53`) with **no UI** → backend-only.
- `save()` never calls `router.refresh()` → the KPI strip and historic panel stay stale after an appel.

### D6 — Two attendance read endpoints have **no ABAC guard** (any teacher reads any class's roster + student PII)
- `apps/api/src/modules/attendance/attendance.controller.ts:248-266` `GET class-sessions/:id` — tenant check only,
  **no `assertOwnership`**, and it `include`s `enrollments: { include: { student: true } }` + `attendanceRecords:
  { include: { student: true } }` → full student records.
- `apps/api/src/modules/attendance/attendance.controller.ts:408-449` `GET class-sessions/:id/roster` — same, tenant
  check only, `include: { student: true }`.

Every other write seam in this controller calls `assertOwnership` (`:110, :217, :282`); these two were missed.
Any holder of `class_sessions.read` / `attendance.read` (every `teacher`) can enumerate session ids and read other
teachers' rosters.
- `:329-341` `justify` likewise has no ownership check beyond tenant.
- `apps/api/src/modules/grades/grades.controller.ts:456` documents the same hole for grades:
  `// teachers can read any student in their school (Phase 4 simplification)`.

### D7 — `school_admin` is missing the permissions its own controller code branches on (dead admin bypasses)
`apps/api/src/shared/auth/permissions.constants.ts:144-220` grants `school_admin` `grades.read` + `grades.publish`
but **not** `grades.write`, `grades.revise`, `attendance.write`, `lessons.write`, `lessons.delete`.

Consequence — the `PermissionsGuard` rejects before the controller runs, so these admin-bypass branches are
**unreachable dead code**:
| bypass | guarded by | admin has it? |
|---|---|---|
| `grades.controller.ts:425` (`assertCanWrite`) reached from `POST /grades/batch` `:114` | `grades.write` | ❌ |
| `grades.controller.ts:425` reached from `POST /grades/:id/revise` `:216` | `grades.revise` | ❌ |
| `grades.controller.ts:425` reached from `PATCH /grades/:id/flag` `:288` | `grades.write` | ❌ |
| `attendance.controller.ts:457` reached from `POST /attendance/batch` `:272` | `attendance.write` | ❌ |
| `lessons.controller.ts:344` reached from `PATCH/DELETE /lessons/:id` `:288,:328` | `lessons.write/delete` | ❌ |

Conversely `school_admin` **has** `attendance.justify` (`:188`) and `teacher` **does not** — and
`POST /attendance/:id/justify` has **zero callers in the whole web app** (`grep 'justify' apps/web/src` → only CSS
classnames). The capability is unreachable from every portal (§3).

### D8 — Calendar edit modal silently **destroys `cycle_scope`** events and drops `academicYearId`
`apps/web/src/app/admin/calendar/CalendarManager.tsx:347-351` types the scope state as
`'school_wide' | 'grade_level_scope' | 'class_section_scope'` and coerces anything else to `'school_wide'`.
`:432-443` then always sends `scope`, `gradeLevelId`, `classSectionId` (never `cycleId`).
→ Opening a `cycle_scope` event and pressing *Mettre à jour* rewrites it to `school_wide` and orphans `cycleId`.
`ScopeBadge` (`:307-318`) already can't name it: it falls through to the literal string **"Scope custom"**.

On the API side `PATCH /calendar/events/:id` (`calendar.controller.ts:237-253`) **accepts `academicYearId` in the
DTO (inherited from `CreateCalendarEventDto:135`) but never writes it** — the field is silently dropped. The admin
modal has an "Année scolaire" `<select>` (`CalendarManager.tsx:385-390`) that therefore **does nothing on edit**.
And unlike `createEvent` (`:362-370`) the PATCH performs **no scope/id consistency validation**, so an event can be
persisted with `scope='school_wide'` + a stale `classSectionId`, which the parent ABAC
(`calendarVisibilityWhere:70-73`) reads.

### D9 — Multi-month calendar events are invisible outside their start month
`CalendarManager.tsx:78-87` filters `monthEvents` on **`startsAt` only**
(`if (t < start || t >= end) return false`), then `MonthGrid` (`:251-262`) painstakingly clamps
`startDay/endDay` for spanning events. The clamp can never fire for a month the event doesn't *start* in.
→ "Vacances de Noël" (23 Dec → 5 Jan) shows in December and **vanishes** from January.

Also `:437-438`: `new Date(\`${startsAt}T00:00:00\`).toISOString()` parses in **browser-local** time and stores
UTC. At UTC+2, an all-day event created for 1 Sep is persisted as `2026-08-31T22:00:00Z` → the teacher and parent
portals (which read the raw ISO) show it a day early. `allDay` is hardcoded `true` (`:439`); `visibility`,
`color`, `icon` are never editable → **backend-only fields** (17/17 events in the DB are `school_wide`; the
`staff_only` ones can only have come from seed/manual SQL).

### D10 — `POST /grades/batch` is an N+1 inside a transaction, and fabricates phantom revisions
`apps/api/src/modules/grades/grades.controller.ts:152-202`: for each of up to **200** (`ArrayMaxSize(200)` `:55`)
grades it awaits `tx.grade.findUnique` then `tx.grade.update`/`create` **sequentially** → up to ~400 serialized
round-trips holding one transaction open. Compare `attendance.controller.ts:290-311`, which correctly builds an
op array and passes it to `$transaction`.

Correctness bug at `:161`:
```ts
const valueChanged = Number(existing.value) !== Number(g.value);
```
`existing.value` is `Decimal | null` and `g.value` is `number | undefined`.
`Number(null) === 0`, `Number(undefined) === NaN`, and `NaN !== NaN` is always `true`.
→ Re-saving an **absent** published pupil (value `null`, payload omits `value`) evaluates `0 !== NaN` → `true`,
so every no-op save writes a `gradeRevision` row (`:164`) with the canned reason
`'Modification après publication (saisie batch)'`, flips the grade to `status='revised'` (`:180`) and fires a
`grade_revised` recompute (`:208`). Idempotency is broken for every absent pupil.

---

## 2. Control-level inventory — admin pages

### `/admin/assessments` — `apps/web/src/app/admin/assessments/page.tsx` (203 L, single file)
| control | evidence | verdict |
|---|---|---|
| 4 KPI cards (planifiées / publiées / brouillons / publiées 7 j) | `:99-110` | fully operational (computed client-side over the **whole** fetched set) |
| Table cols: Titre, Type, Matière, Classe, Enseignant, Période, Date, Barème, Notes, Statut, Actions | `:127-137` | fully operational |
| Filters / search / sort | — | **absent** (0 filters, 0 search, 0 sort — the only admin pedagogy list with none) |
| Bulk actions | — | absent |
| Pagination | `:191-196` | client-side slice of an **unbounded** fetch (`GET /assessments` has no `take`, `assessments.controller.ts:100`) |
| `RowActions viewHref={/admin/assessments/${a.id}}` | `:184` | **defective — 404.** `apps/web/src/app/admin/assessments/` contains only `page.tsx`; no `[id]/` route. `RowActions` renders it as a real `<Link>` (`packages/ui/src/…/RowActions.tsx:44-56`) |
| `KIND_LABEL` map | `:41-50` | **defective.** Lists `quiz` + `exam`, which are **not** in `enum AssessmentKind` (`apps/api/prisma/schema.prisma:188-196`), and **omits `project`, which is**. A "Projet" renders as the raw string `project` |
| Empty state | `:115-120` | fully operational |
| Loading / error state | `safe()` `:52-59` | error ⇒ silent empty list, no banner distinguishing "0 évaluations" from "API down" |
| Edit / delete / publish / unpublish | — | **absent** (admin cannot act on any assessment) |

### `/admin/attendance` — `apps/web/src/app/admin/attendance/page.tsx` (199 L, single file)
| control | evidence | verdict |
|---|---|---|
| 4 KPI cards (présences/absences/retards/non justifiées **du jour**) | `:103-124` | exists-but-incomplete — `overview` computes "today" with the **API server's** `setHours(0,0,0,0)` (`attendance.controller.ts:473-475`), not the school's timezone |
| Table cols: Élève, Classe, Matière, Date, Statut, Justification, Actions | `:141-147` | fully operational |
| Filters (class / date range / status / student) · search · sort | — | **absent** |
| Pagination `PAGE_SIZE=15` | `:187-192` | **defective.** `GET /attendance/overview` hard-caps at `take: 50` (`attendance.controller.ts:500`) with no filter params. The page paginates those 50 into 4 pages and labels it "*n* enregistrements" — a 50-row window presented as the full ledger |
| "Justification" column | `:176-178` | **display-only.** No justify control anywhere (§3) |
| `RowActions viewHref={/admin/students/${id}#attendance}` | `:180` | link works; the `#attendance` anchor is a plain fragment with no matching `id` in the student page |
| Empty state | `:129-134` | fully operational (this is what renders today — 0 rows in DB) |
| KPI `excused` / `leftEarly` | `attendance.controller.ts:522-524` returns them | **frontend gap** — computed by the API, never rendered |

### `/admin/classes` — `page.tsx` (343 L) + `ClassesPageFilters.tsx` + `ClassInfoEditor.tsx` + `actions.ts`
| control | evidence | verdict |
|---|---|---|
| 4 KPI cards w/ sparklines | `:164-199` (`/analytics/classes-aggregate`) | fully operational; falls back to `—` when the aggregate 500s |
| Filter: Niveau (`SelectFilter`, clearable) | `ClassesPageFilters.tsx:45-53` | fully operational |
| Filter: Année académique | `ClassesPageFilters.tsx:54-62` | **defective.** Choosing *"Toutes les années"* deletes the param (`:34`), and the API then re-applies the active year: `const yearFilter = academicYearId ?? activeAcademicYearId` (`classes.controller.ts:90`). The clear option is a no-op |
| Search · sort · bulk actions | — | absent |
| Table cols: Nom, Niveau, Salle, Année, Capacité max, Effectif, Taux (CapacityBar), Enseignant référent, Statut, Actions | `:228-237` | fully operational |
| "Ajouter une classe" (header) | `:153-158` → `/admin/classes/new` | **visible-but-non-functional — 404.** `apps/web/src/app/admin/classes/` has no `new/` directory (`find apps/web/src/app -type d -name new` lists announcements, imports, roles, students, parent/messages, teacher/messages — **not classes**) |
| Empty-state CTA "Ajouter une classe" | `:220` → same href | same 404 |
| `ClassInfoEditor` modal — fields: Salle, Icône, Couleur (picker + hex), Options k/v repeater, Observations internes | `ClassInfoEditor.tsx:147-232` | fully operational for those 5 fields |
| …but **name / maxStudents / status are passed in `initial` and never editable** | `ClassInfoEditor.tsx:9-17` vs the `updateClass` call `:107-114` | exists-but-incomplete. `UpdateClassDto` supports `name`, `maxStudents`, `status` (`classes.controller.ts:44-46`) → **backend-only**: no UI can rename a class, change its capacity, or close it |
| Modal a11y | `ClassInfoEditor.tsx:124-129` | no focus trap, no `Escape` handler, no scroll lock, no focus restore |
| `createClass` / `deleteClass` server actions | `actions.ts:27`, `actions.ts:70` | **dead code** — zero references (`grep -rn 'deleteClass\|createClass' apps/web/src` returns only their own definitions) |
| Client-side pagination | `:325-330` | slice over an unbounded `GET /classes` |

### `/admin/classes/[id]` — `page.tsx` (559 L)
| control | evidence | verdict |
|---|---|---|
| Hierarchy breadcrumb → `/admin/school/structure`, `/admin/cycles` ×2 | `:141-152` | works (`/admin/cycles` is a redirect to `/admin/levels`, extra hop) |
| 4 KPIs: effectif, taux de notation, performance moyenne, alertes ouvertes | `:225-257` | fully operational (server-computed in `classes.service.detailAggregate`) |
| `ClassInfoEditor` "Modifier infos" | `:192-208` | same 5-field limitation as above |
| QuickLinks: Affecter enseignants, Voir performances, Voir élèves, Planifier évènement | `:209-220` | all 4 resolve |
| Capacity bar, Options pédagogiques, Observations internes | `:260-313` | fully operational |
| Équipe enseignante list (+ PP badge, subject chips) | `:316-376` | fully operational |
| Roster (links to student), Matières & coefficients (défaut/personnalisé) | `:380-492` | fully operational |
| Alertes de la classe | `:496-536` | fully operational |
| Delete / close / archive class | — | absent (`DELETE /classes/:id` is **backend-only**) |
| `<h1>` | `:171` | duplicates `Topbar.tsx:41` — known issue class |

### `/admin/levels` (canonical) + `/admin/cycles` (redirect) — `CyclesManager.tsx` (314 L)
| control | evidence | verdict |
|---|---|---|
| `/admin/cycles/page.tsx` → `redirect('/admin/levels')` | `cycles/page.tsx:8-10` | fully operational |
| 4 KPIs (cycles, niveaux, plus grand cycle, organisation) | `levels/page.tsx:74-99` | fully operational |
| "Créer un cycle" form — Nom*, Code*, Ordre, Couleur (OKLCH free-text) | `CyclesManager.tsx:178-194` | fully operational. Code is auto-slugged `:166`. Colour is a raw text field, no picker/validation (contrast with `ClassInfoEditor`'s colour picker) |
| "Ajouter un niveau" form — Nom*, Code*, Ordre | `:247-260` | fully operational |
| Delete cycle / delete niveau (`confirm()`) | `:67-78`, `:107-118` | fully operational (API blocks non-empty, `cycles.controller.ts:110`, `:186`) |
| **Edit a cycle** | — | `updateCycle` exists at `cycles/actions.ts:36` with **zero callers** → dead code; `PATCH /cycles/:id` is **backend-only**. A cycle cannot be renamed/recoloured/reordered after creation |
| **Edit a grade level** | — | no client action at all; `PATCH /cycles/grade-levels/:levelId` is **backend-only** (and unvalidated — D1) |
| Reorder (drag or ↑↓) | — | absent; `orderIndex` is a number field set once at creation |
| Empty state | `:42-47` | fully operational |
| Error state | `:40` | single shared banner, not per-row |

### `/admin/subjects` — `page.tsx` (121 L) + `SubjectsManager.tsx` (380 L)
| control | evidence | verdict |
|---|---|---|
| KPI "MATIÈRES ACTIVES", "COEFFICIENTS CONFIGURÉS", "NIVEAUX COUVERTS" | `page.tsx:75-93` | fully operational |
| KPI "MATIÈRES SANS ENSEIGNANT" | `page.tsx:57-59` reads `s._count?.teachingAssignments` | **defective.** `GET /subjects` (`subjects.controller.ts:89-98`) returns **no `_count`** → the optional chain is always `undefined`, `?? 0`, so the KPI always equals the **total** subject count. DB truth: 5 of 8 subjects have a teacher, so it should read **3**; it renders **8** |
| Tabs: Matrice des coefficients ⇄ Matières | `SubjectsManager.tsx:21-28` | fully operational |
| Coefficient matrix (subject × level, dirty/override colour legend, batched save) | `:203-335` | fully operational — good design (dirty-set diffing, `PUT /subjects/coefficients/matrix`) |
| "Ajouter une matière" — Nom*, Code*, Coef défaut, Couleur (OKLCH text) | `:172-180` | fully operational |
| "Désactiver" a subject | `:113-126` | fully operational (soft-delete, `subjects.controller.ts:158`) |
| **Reactivate** a deactivated subject | — | **absent.** `UpdateSubjectDto` accepts `active` (`subjects.controller.ts:56`) → **backend-only**. Deactivation is a one-way door from the UI |
| **Edit** name / colour / default coefficient | — | **absent.** `PATCH /subjects/:id` is **backend-only** |
| Search · filter (active/inactive) · sort · pagination | — | absent |
| Dead code | `SubjectsManager.tsx:3` imports `Check`, `X` — unused; `page.tsx:60` `void matrixLevels;` | lint/dead code |

### `/admin/academic-years` — `page.tsx` (109 L) + `AcademicYearsManager.tsx` (521 L)
| control | evidence | verdict |
|---|---|---|
| 4 KPIs | `page.tsx:61-96` | fully operational |
| Accordion per year (auto-expands the active one) | `Manager:106-131` | fully operational |
| "Créer une année scolaire" — Nom*, Début*, Fin*, checkbox "année active" | `:286-313` | fully operational (API auto-closes the previous active year atomically, `academic-years.controller.ts:89-108`) |
| "Définir comme active" | `:141-149` | fully operational |
| "Modifier les dates" (Nom, Début, Fin) | `:334-398` | fully operational |
| "Archiver" / "Supprimer" (`confirm()`) | `:157-172` | fully operational (delete blocked when classes exist, `:156`) |
| "Ajouter" a term — Nom*, Ordre*, Début*, Fin* | `:400-482` | fully operational |
| Delete a term | `:217-228` | fully operational, **but** no guard: `deleteTerm` (`academic-years.controller.ts:238-246`) does not check for `Assessment.termId` references |
| **Edit a term** | — | **absent.** `PATCH /academic-years/terms/:termId` is **backend-only** (and unvalidated — D1). Term dates are immutable from the UI |
| Date rendering | `Manager:518-520` `toLocaleDateString('fr-FR')` inside a `'use client'` module | hydration-mismatch risk (server TZ vs client TZ); the codebase has `PreferredDate` from `@pilotage/ui` for exactly this and uses it elsewhere (`admin/classes/[id]/page.tsx:429`) |
| Dead import | `page.tsx:1` imports `Users`, unused | lint |
| API hole | `academic-years.controller.ts:122` only checks date order **when both** dates are patched → `PATCH {startDate}` alone can push start past end | defective |
| API hole | `update` (`:132-140`) never validates that contained `term` ranges still fit the new year window | defective |

### `/admin/assignments` (canonical) + `/admin/teaching-assignments` (redirect) — `AssignmentsManager.tsx` (557 L)
| control | evidence | verdict |
|---|---|---|
| `teaching-assignments/page.tsx` → `redirect('/admin/assignments')` | `:8-10` | fully operational |
| 4 KPIs | `assignments/page.tsx:58-71` | fully operational |
| `CoveragePanel` — 3 alert families (classes sans PP / primaire sans assistant / matières sans prof) | `:437-520` | logic correct, **presentation defective**: the group list is an uncapped `<ul>` (`:546-551`). DB truth = **92 classes without a PP** → a 92-item wall inside a small card, no truncation, no "+N autres", no link-through |
| Filter: classe · Filter: professeur | `:77-100` | fully operational (client-side) |
| Search · sort · pagination | — | absent (all 289 assignments rendered at once, grouped by class) |
| "Nouvelle affectation" form — Professeur*, Classe (active year only)*, Matière*, Heures/sem, Rôle | `:278-428` | fully operational |
| Per-row role `<select>` (principal / assistant / subject_teacher) | `:253-264` | fully operational (PP demotion handled server-side) |
| Per-row delete (`confirm()`) | `:265-273` | fully operational (API blocks when assessments/lessons/sessions exist, `teaching-assignments.controller.ts:209`) |
| Edit `weeklyHours` after creation | — | absent; `UpdateAssignmentDto.weeklyHours` (`:40`) is **backend-only** |
| `isPrimaryOrKindergarten` regex `:32` | `/[̀-ͯ]/g` written with **raw combining marks** instead of `̀-ͯ` | fragile — works today but breaks on any editor/encoding normalisation |
| API: PP transfer is **non-atomic** | `teaching-assignments.controller.ts:139-162` (demote `updateMany` then `create`, no `$transaction`); same at `:185-197` | defective — a failing `create` (e.g. P2002 race) leaves the class with **no** PP |
| API: `list` has no pagination | `:65-88` | scalability |

### `/admin/calendar` — `page.tsx` (99 L) + `CalendarManager.tsx` (483 L) + `actions.ts`
| control | evidence | verdict |
|---|---|---|
| Month navigation ◀ ▶ + "Aujourd'hui" | `Manager:125-136` | fully operational |
| Filter: type (7 values) | `:139-144` | fully operational |
| Month grid, max 3 chips/day + "+N" | `MonthGrid:288-295` | fully operational **except D9** (spanning events invisible outside their start month) |
| "À venir" panel (12 items, hover edit/delete) | `:181-204` | fully operational |
| "Importer les fériés (France)" | `:147-150` → `seedFrenchHolidays()` | fully operational. The `year` parameter of the action (`actions.ts:52`) is **never passed** by the button (`:101`) → dead param |
| "Nouvel événement" / edit modal — Titre, Type, Début, Fin, Année scolaire, Portée, Niveau, Classe, Description | `EventEditor:369-421` | see **D8** — `cycle_scope` destroyed, `academicYearId` silently dropped on PATCH |
| Modal validation | `:429` `disabled={saving \|\| !title.trim() \|\| !startsAt \|\| !endsAt}` | exists-but-incomplete — **no end ≥ start check client-side**; the API does check (`calendar.controller.ts:233`) so it surfaces as a raw 400 banner |
| Modal a11y | `:360-367` | no focus trap / `Escape` / scroll lock |
| Fields `visibility`, `color`, `icon`, `allDay=false` | never rendered; `allDay` hardcoded `true` `:439` | **backend-only** |
| Delete (`confirm()`) | `:113-119` | works, but relies solely on `revalidatePath` — unlike every sibling manager it never calls `router.refresh()` |
| Page chrome | `page.tsx:81-88` | **inconsistent** — raw `<div>` + `<h1>`, no `PageHeader`, no breadcrumb (every other admin pedagogy page uses `PageHeader`); duplicates `Topbar`'s `<h1>` |
| Data loading | `page.tsx:68-77` | **no `safe()` wrapper** on any of the 4 calls (contrast `assessments/attendance/subjects/levels` pages) → any API blip throws to `error.tsx`. `:71-75` also does `as unknown as Array<…>` type-laundering, and the resulting `gradeLevels` select loses cycle context (duplicate level names across cycles are indistinguishable) |
| Seed API | `calendar.controller.ts:288-317` | N+1 (`findFirst` + `create` per holiday × 22), **not** in a transaction → partial seeding on failure; dup check `:292-294` omits `tenantId` |
| Seed DTO | `calendar.controller.ts:148-150` `@IsOptional() year?: number` with **no type validator** | defective — `{"year":"2026"}` → `"2026"+1 === "20261"` → `new Date("20261-01-01")` → Invalid Date → Prisma 500 |

---

## 3. Control-level inventory — teacher portal (pedagogy pages)

### `/teacher/classes` — `page.tsx` + `TeacherClassesGrid.tsx`
- Cards grouped by class, subject chips deep-link to each `teachingAssignmentId` gradebook. Fully operational.
- **Defect** `page.tsx:77`: `coefficient: Number(a.subject.defaultCoefficient)` — shows the **subject default**,
  ignoring the `SubjectCoefficient(gradeLevel, subject)` override that the averages actually use
  (`grades.service.ts:126-127`). The displayed coefficient contradicts the computed average.
- **Minor** `page.tsx:89`: `totalStudents` sums per-class enrolments → a pupil in two of the teacher's classes is
  double-counted. The API already exposes a correct `uniqueStudents` (`teachers.controller.ts:414`).

### `/teacher/classes/[id]` — hub, 973 L
- Grid of tiles → grades / lessons / attendance; distribution bands; homework-overdue deep link. Fully operational.
- **Defect** `:203-208`: `gradebookRes.reason instanceof ApiError && …status === 404 ? null : null` — **both
  branches return `null`**, so a 500 from `GET /grades/gradebook/:id` is swallowed and rendered as "pas encore de
  gradebook". Dead conditional + silent error masking.
- **Defect** `:903`: `href={/teacher/messaging?classSectionId=…}` — **`apps/web/src/app/teacher/messaging` does not
  exist** (the portal has `messages/` and `conversations/`). 404. Only source-level dead link in the teacher portal.
- `:190` `api(...)` for `/teachers/me/assignments` is un-`safe()`-wrapped (contrast the `Promise.allSettled` used
  two lines later).

### `/teacher/classes/[id]/grades` — `page.tsx` + `Gradebook.tsx` (496 L) + `GradebookInsights.tsx` (840 L)
| control | evidence | verdict |
|---|---|---|
| 404 guard with an explanatory empty state (id is a `teachingAssignmentId`, not a class id) | `page.tsx:62-99` | fully operational — genuinely good |
| `GradeGridExportButton` (enqueue → poll → signed URL) | `page.tsx:139-142`, `actions.ts:95-152` | fully operational |
| Matrix students × assessments, sticky first column, per-cell number input + "abs." checkbox | `Gradebook.tsx:234-269` | fully operational |
| Per-assessment "Save" and "Publier" | `:306-327` | fully operational |
| Flag toggle (optimistic, per-cell in-flight, rollback) | `:46-66`, `:336-372` | fully operational — well built |
| "Nouvelle évaluation" form — Titre*, Type, Note max, Coef, Date prévue | `:374-496` | fully operational (all 7 `kind` values match the Prisma enum here) |
| **Stale UI after mutation** | `:18` `const [data] = useState(initial)` — frozen at mount, no setter, no `useEffect` sync | **defective.** After *Publier* + `router.refresh()`, the header badge still reads "brouillon" and the *Publier* button stays visible, because `data.assessments` never updates. Same for saved values/statuses |
| **Cannot clear a grade** | `:79-90` filters out any cell that is neither `isAbsent` nor a defined `value` | **defective.** Emptying an input is silently dropped; there is no way to erase a mis-typed grade |
| Revise a published grade (with reason) | — | **absent.** `POST /grades/:id/revise` has **zero** web callers → backend-only. `grade_revision` = 0 rows in the DB |
| Unpublish an assessment | — | **absent.** `POST /assessments/:id/unpublish` has **zero** web callers → backend-only. And `DELETE /assessments/:id` returns the message *"Dépubliez-la d'abord"* (`assessments.controller.ts:251`) — an instruction pointing at a capability no UI exposes |
| Edit / delete an assessment | — | **absent.** `PATCH` and `DELETE /assessments/:id` are backend-only |
| Per-grade `comment` | in the payload type but no UI | backend-only |
| `refresh()` server action | `actions.ts:61-63` | revalidates `/teacher/classes/${teachingAssignmentId}/grades` — correct, since `[id]` **is** the assignment id (`page.tsx:58`) |

### `/teacher/classes/[id]/attendance` — `page.tsx` (273 L) + `AttendanceManager` + `HistoricSessionsPanel` + `StudentsToWatchPanel`
- 4 KPIs over a 30-day window, action strip, historic sessions panel, "élèves à suivre" panel: fully operational
  **as code** — but 0 `class_session` / 0 `attendance_record` rows exist, so none of it has ever rendered with data.
- See **D5** for the save/`left_early`/UTC defects.
- `page.tsx:235` instructs *"Saisissez les justifications côté administration"* — **there is no admin justification
  UI** (§D7). Dead instruction.
- `page.tsx:69-70`: `/teachers/me/assignments` is un-`safe()`-wrapped while the sibling call is.

### `/teacher/classes/[id]/lessons` — `page.tsx` (471 L) + `LessonsManager` (396 L) + `LessonsFilters` (129 L)
- Filters (period / homework state), grouping by month, overdue/dueSoon homework badges: fully operational as code.
- Create: fully operational. **Edit: broken (D4).** Delete: fully operational.
- `attachments` is in both DTOs (`lessons.controller.ts:47,:56`) with **no UI** → backend-only.
- `content` is `@MaxLength(10000)` server-side with no `maxLength` on the textarea (`LessonsManager.tsx:334-341`)
  → long pastes surface as a raw 400.
- `page.tsx:266` raw `<h1>` (no `PageHeader`) → duplicate-h1 class.

### `/teacher/assessments` — `page.tsx` (554 L) + `AssessmentsFilters.tsx`
- Best-instrumented list in the domain: search `q`, class, subject, kind, status bucket, term, sort
  (date-desc/date-asc/title/class), reset link, "à publier" nudge banner. All client-side over
  `GET /assessments?mine=true` (unbounded). Fully operational.
- **Defect** `:376`: `const coef = a.coefficientOverride ?? '1'` — hardcodes **1** as the fallback coefficient
  instead of the effective subject/level coefficient. Same wrong-number class as `/teacher/classes:77`.

### `/teacher/grades` — `page.tsx` (590 L) + `TeacherGradesFilters.tsx`
- Filters: search, class, subject, term, status; subject snapshot; distribution. Fully operational.
- **Defect** `:105`: fetches `/teachers/me/recent-grades?limit=100`, and the API caps `limit` at **100**
  (`teachers.controller.ts:305`). Every KPI on the page ("TAUX DE PUBLICATION", published/draft/revised/absent
  counts, averages) is computed over **at most the 100 most-recently-updated grades** but labelled as a total.
  DB has 513 grades. Same class as `/admin/attendance`'s 50-row cap.

### `/teacher/calendar` — `page.tsx` (42 L)
- Read-only `PortalCalendarView`. Fully operational. `teacher` role has `calendar.read` but not `calendar.write`
  (`permissions.constants.ts:246`) — read-only by design, consistent.

---

## 4. API-side inventory (endpoint → guard → DTO → implementation)

All 74 domain endpoints in the live OpenAPI were cross-checked against source. Every one is **implemented** (no
stubs, no `NotImplementedException`). Every one carries `@UseGuards(JwtAuthGuard, PermissionsGuard)` at the
controller level and an explicit `@RequiresPermission(...)`. Every permission string used resolves to a real entry
in `permissions.constants.ts` — **no typo'd permission codes**. Tenant isolation is by explicit
`x.tenantId !== me.tenantId → 404/403` checks in every handler (there is no RLS — see the previously-confirmed
ADR-002 finding).

Notable per-endpoint findings not already covered:

| endpoint | file:line | finding |
|---|---|---|
| `GET /assessments` | `assessments.controller.ts:100-131` | no `take`/pagination; deep nested include; the admin page fetches the whole table |
| `PATCH /assessments/:id` | `assessments.controller.ts:206-237` | allows changing `maxScore` on a **published** assessment with grades, with no check that existing grades still fit; and — unlike `create` (`:182-187`) — never validates that `termId` belongs to the assignment's academic year |
| `POST /assessments/:id/publish` | `assessments.controller.ts:270` | `missing` counts only grade **rows** whose value is null. Pupils with **no grade row at all** are invisible → an assessment with 2/30 grades publishes cleanly, leaving 28 pupils silently ungraded |
| `POST /assessments/:id/unpublish` | `assessments.controller.ts:429-439` | reverts grades to draft but **never enqueues a recompute** (publish `:376` and revise `grades.controller.ts:509` both do) and never retracts the `grade_published` notifications fanned out at `:335`. Stale snapshots + parents notified about a now-hidden grade |
| `DELETE /assessments/:id` | `assessments.controller.ts:239-256` | no recompute enqueue either |
| `GET /grades/students/:id/grades` | `grades.controller.ts:397-415` | no pagination; full history with nested includes |
| `POST /class-sessions/open` | `attendance.controller.ts:219-222` | `new Date(body.date)` is **never normalised to midnight**, and the idempotency lookup is `findFirst({ teachingAssignmentId, date })` (exact instant). Any client sending a time component creates a **second** session for the same calendar day. The `where` also omits `tenantId` |
| `POST /attendance/:id/justify` | `attendance.controller.ts:316-341` | no ownership check; `absent → absent_excused` is **irreversible** (no un-justify endpoint) |
| `GET /classes` | `classes.controller.ts:90` | silent active-year default breaks the UI's "Toutes les années" (§2) |
| `PATCH /classes/:id` | `classes.controller.ts:265-288` | `create` guards the `(year, level, name)` uniqueness (`:238-247`); `update` does **not** → renaming into a collision surfaces as a raw Prisma **P2002 500** |
| `DELETE /classes/:id` | `classes.controller.ts:290-311` | returns a `ClassSection` object on the soft-close path and `{ok:true}` on hard delete — inconsistent response shape |
| `POST /cycles/:id/grade-levels` | `cycles.controller.ts:150-159` | N+1: one `subjectCoefficient.create` per subject inside the transaction (should be `createMany`) |
| `POST /subjects` | `subjects.controller.ts:124-133` | same N+1, one `create` per grade level |
| `PATCH /subjects/:id`, `PATCH /cycles/:id` | `subjects.controller.ts:148`, `cycles.controller.ts:98` | `data: body` passes the whole DTO to Prisma — safe **only** because `whitelist:true` is on globally; brittle by construction |
| all DTOs | every controller in scope | **zero `@ApiProperty` decorators and no Nest CLI plugin** → every schema in `/docs-json` is `{"type":"object","properties":{}}` (verified live for `UpdateLessonDto`, `SeedHolidaysDto`, `BulkCoefficientDto`, `UpdateCalendarEventDto`). The published OpenAPI contract is structurally useless for any client or codegen |
| logging | `assessments.controller.ts:353,:402`, `lessons.controller.ts:139` | `console.warn` + `eslint-disable no-console` while sibling controllers (`grades.controller.ts:79`, `subjects.controller.ts:76`) use Nest `Logger` |

---

## 5. Capability classification (summary)

**Fully operational** — coefficient matrix editor (`/admin/subjects`); class filters by level; class-info editor
(5 fields); cycles/levels create+delete; academic-years full lifecycle + terms create/delete; assignments
create/role-change/delete + coverage logic; calendar month grid/type filter/holiday seed; teacher gradebook
entry + publish + flag; teacher grade-grid XLSX export; teacher assessments list (7 controls); teacher grades list
(5 controls); teacher lessons create/delete/filter; teacher calendar (read-only); `/admin/classes/[id]` detail.

**Exists-but-incomplete** — `/admin/attendance` (50-row cap, no filters, no action); `/admin/assessments` (no
filters/search/sort, no detail page); class-info editor (name/capacity/status missing); calendar modal (no
`visibility`/`color`/`icon`/timed events, no date-order check); attendance justify (irreversible, no un-justify);
teacher attendance (no `left_early`, no comment/arrivedAt, no refresh).

**Visible-but-non-functional** — "Ajouter une classe" → `/admin/classes/new` (404, ×2 entry points);
`RowActions` "Voir" on `/admin/assessments` → `/admin/assessments/:id` (404); "Toutes les années" filter on
`/admin/classes`; "Modifier" pencil on teacher lessons (400 every time); "Année scolaire" select in the calendar
edit modal (silently dropped); `/teacher/messaging` link on the teacher class hub (404).

**Backend-only** — `POST /attendance/:id/justify`; `POST /grades/:id/revise`; `POST /assessments/:id/unpublish`;
`PATCH`/`DELETE /assessments/:id`; `PATCH /cycles/:id`; `PATCH /cycles/grade-levels/:levelId`;
`PATCH /academic-years/terms/:termId`; `PATCH /subjects/:id` (incl. reactivation); `DELETE /classes/:id`;
`UpdateClassDto.{name,maxStudents,status}`; `UpdateAssignmentDto.weeklyHours`; lesson `attachments`;
attendance `comment`/`arrivedAt`; calendar `visibility`/`color`/`icon`/`allDay=false`/`cycleId`;
attendance-overview `excused`/`leftEarly` KPIs.

**Frontend-only** — none found (every UI call has a real endpoint).

**Placeholder / mock** — `setup.controller.ts:71-72` `activeTeachers: Promise.resolve(0)` and `:121`
`done: false, // wired Phase 3` → the "Équipe pédagogique" setup step is permanently 0/incomplete and links to
`/admin/users/invite` (that route does exist).

**Defective** — D1…D10 above, plus: `/admin/subjects` "matières sans enseignant" KPI (always = total);
`/teacher/grades` KPIs over a 100-row window; `/teacher/classes` + `/teacher/assessments` wrong coefficients;
admin `KIND_LABEL` out of sync with `AssessmentKind`; `CoveragePanel` 92-item uncapped list; the stuck
`failed` snapshot trigger.

---

## 6. Dead code / hygiene

| item | file:line |
|---|---|
| `createClass` never called | `apps/web/src/app/admin/classes/actions.ts:27` |
| `deleteClass` never called | `apps/web/src/app/admin/classes/actions.ts:70` |
| `updateCycle` never called | `apps/web/src/app/admin/cycles/actions.ts:36` |
| `seedFrenchHolidays(year?)` — `year` never passed | `apps/web/src/app/admin/calendar/actions.ts:52` vs `CalendarManager.tsx:101` |
| unused imports `Check`, `X` | `apps/web/src/app/admin/subjects/SubjectsManager.tsx:3` |
| unused import `Users` | `apps/web/src/app/admin/academic-years/page.tsx:1` |
| `void matrixLevels;` no-op | `apps/web/src/app/admin/subjects/page.tsx:60` |
| both ternary branches return `null` | `apps/web/src/app/teacher/classes/[id]/page.tsx:203-208` |
| unreachable admin bypasses (D7) | `grades.controller.ts:425`; `attendance.controller.ts:457`; `lessons.controller.ts:344` |
| `// eslint-disable-next-line no-console` ×3 | `assessments.controller.ts:353,:402`; `lessons.controller.ts:139` |
| "Phase N" markers still live | `grades.controller.ts:456`; `setup.controller.ts:71,:121`; `subjects.controller.ts:157`; `branding.service.ts:12-13` |
| raw `<h1>` duplicating `Topbar.tsx:41` | `admin/calendar/page.tsx:83`; `admin/classes/[id]/page.tsx:171`; `teacher/classes/[id]/lessons/page.tsx:266` |
| `toLocaleDateString` in a `'use client'` module (hydration) | `AcademicYearsManager.tsx:518-520`; `CalendarManager.tsx:76,:467-477`; `AttendanceManager.tsx:188` |
| modals without focus trap / Escape / scroll lock | `ClassInfoEditor.tsx:124`; `CalendarManager.tsx:360` |

---

## 7. Suggested fix order

1. **D1** (`Partial<T>` → real DTO on `updateGradeLevel` + `updateTerm`) — one-line class definitions, closes a
   cross-tenant write.
2. **D2** (tenant-scope `entries[]` in `upsertCoefficients`, add `@IsArray()`/`@ArrayMaxSize`).
3. **D6** (add `assertOwnership` to `sessionDetail`, `roster`, `justify`).
4. **D5** + **D4** — the two teacher workflows that are broken in a way no one has noticed because both tables are
   empty.
5. **D7** — decide whether `school_admin` should hold `grades.write`/`attendance.write`/`lessons.write`, then
   either grant them or delete the dead bypass branches.
6. **D3** — either port the drain worker into this branch or delete the enqueue seams and their comments; today
   they write into a queue nothing reads, and the running image does not match the source.
7. **D8/D9/D10**, then the wrong-number defects (`subjects` KPI, `teacher/grades` window, the two coefficient
   fallbacks) — all small and all user-visible.
8. The 404 links (`/admin/classes/new`, `/admin/assessments/:id`, `/teacher/messaging`) — either build the routes
   or remove the affordances.
