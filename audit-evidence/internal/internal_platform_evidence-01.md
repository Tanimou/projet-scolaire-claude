# Evidence — Internal platform (« Pilotage scolaire »)

**Method:** running Docker stack inspected live; authenticated HTTP sweep of every static page route using real sessions (admin, teacher, parent) obtained through the application's own credentials flow; OpenAPI document pulled from the running API; PostgreSQL queried read-only; source tree read from the worktree. No data was created, modified or deleted.

**Environment audited:** local Docker development stack, worktree `youthful-chaum-6aad5c`, branch `claude/platform-audit-gap-analysis-216337`, date 2026-08-01.

---

## 1. Running services (confirmed — `docker ps`)

| Container | Image | Port(s) | Health |
|---|---|---|---|
| `pilotage_web` | `pilotage-scolaire-web` | 3000 | healthy |
| `pilotage_api` | `pilotage-scolaire-api` | 4000 | healthy |
| `pilotage_worker` | `pilotage-scolaire-worker` | — | healthy |
| `pilotage_postgres` | `postgres:15-alpine` | 5433→5432 | healthy |
| `pilotage_redis` | `redis:7-alpine` | 6379 | healthy |
| `pilotage_keycloak` | `quay.io/keycloak/keycloak:26.0` | 8180→8080 | healthy |
| `pilotage_minio` | `minio/minio:RELEASE.2024-10-13…` | 9000–9001 | healthy |
| `pilotage_maildev` | `maildev/maildev:2.1.0` | 1025, 1080 | healthy |

Compose also defines optional profiles: `prod` (nginx) and `obs` (observability, Jaeger OTLP at `:4318`). A separate `infra/docker-compose.prod.yml` exists alongside `infra/nginx`, `infra/keycloak`, `infra/postgres`, and Keycloak redirect-fix scripts.

Availability checks: `GET http://localhost:3000/` → **200**; `GET http://localhost:4000/healthz` → **200** `{"status":"ok",…}`; `GET http://localhost:4000/docs` → **200** (Swagger UI).

## 2. Technology stack (confirmed — manifests)

**Monorepo:** pnpm 9.12.3 workspaces + Turborepo 2. Node ≥ 20. TypeScript 5.6. Apps: `web`, `api`, `worker`. Packages: `contracts`, `design-tokens`, `eslint-config`, `i18n`, `imports-core`, `tsconfig`, `ui`.

**Web** — Next.js 15.5 (App Router, React 18.3), NextAuth 5 beta, next-intl 4, Tailwind 4 (`@tailwindcss/postcss`), Recharts 3, framer-motion, lucide-react, zod, date-fns. Dev: Playwright + `@axe-core/playwright`.

**API** — NestJS 10 (pinned; the whole `@nestjs/*` set is on v10), Prisma 5.22, Passport-JWT + `jwks-rsa`, BullMQ 5 + ioredis, `@nestjs/swagger` 8, `@nestjs/terminus`, helmet, pino/pino-http, class-validator/class-transformer, `@aws-sdk/client-s3` + presigner, papaparse.

**Worker** — NestJS 10 standalone, BullMQ, Prisma, `exceljs`, `pdfkit`, `@react-pdf/renderer`, `nodemailer`, S3 client.

## 3. Navigation inventory (confirmed — rendered HTML of authenticated pages)

### Admin portal (`/admin/*`)
`Tableau de bord` · **Gestion scolaire**: Établissement, Années académiques, Cycles & niveaux, Classes, Matières · **Personnes**: Élèves, Enseignants, Parents / Tuteurs, Utilisateurs · **Pédagogie**: Notes & Évaluations, Présences, Inscriptions, Affectations, Alertes, Demandes de RDV · **Communication**: Annonces, Notifications, Modération messagerie · **Documents & suivi**: Imports, Exports, Rapports, Audit · **Configuration**: Rôles, Paramètres.
Persistent UI: school name (« Lycée Voltaire »), academic-year chip, date, user chip with role, and a rotating « Conseil du jour » tip card (« 2 / 5 »).

### Teacher portal (`/teacher/*`)
Tableau de bord · Mes classes · Élèves · Demandes de RDV · Notes · Évaluations · Emploi du temps · Ressources · Messagerie · Conversations parents · Rapports · Notifications · Paramètres.

### Parent portal (`/parent/*`)
Tableau de bord · Profil de l'élève · Notes et évaluations · Suivi des matières · Évaluations à venir · Absences et retards · Cahier de texte · Commentaires · Recommandations · Annonces · Messages · Notifications · Emploi du temps · Documents · Communication · Paramètres · « Besoin d'aide ? » help card.

### Student portal (`/student/*`)
6 pages in source (dashboard, grades, attendance, announcements, upcoming, login). **Not provisioned in this environment** — see §7.

## 4. Authenticated page sweep — results

**Admin (50 routes in source).** All returned **200** except:

| Route | Result | Cause (verified) |
|---|---|---|
| `/admin/audit` | **500** | Real code defect — see §6 |
| `/admin/child-claims` | 404 | Route absent from the **running container's build** (`/app/apps/web/.next/server/app/admin/` has no `child-claims`); source exists in the repo |
| `/admin/integrations` | 404 | Same — stale image |
| `/admin/remediation` | 404 | Same — stale image |
| `/admin/announcements`, `/admin/cycles`, `/admin/enrollment-requests`, `/admin/teaching-assignments`, `/admin/school/branding` | 307 | Intentional backward-compat redirects |

**Teacher (14 routes swept).** All **200** except `/teacher/remediation` → 404 (same stale-image cause).

**Parent (16 routes swept).** All **200**.

### Representative captures

**`/admin/dashboard`** — H1 « Tableau de bord administrateur ». Sections: « Bonjour 👋 », **« Centre d'action 31 »** (« Ce qui demande votre attention sur l'établissement aujourd'hui · mis à jour à 14:38 »), « Structure de l'établissement », « Synthèse couverture enseignants », « Performances de l'établissement », « Journal d'audit — Activités récentes », « Taux de notation par classe » (columns: Classe / Planifiées / Notées / Taux / Statut).
Live action centre content: « 3 Alertes critiques ouvertes — Étudiant·e·s concerné·e·s : 3 · la plus ancienne il y a 55 j » with named students and a **Traiter** action; « 28 Demandes en attente — Plus ancienne il y a 838 j » with an **Examiner** action.
KPIs: **ÉLÈVES 2 463 · PROFESSEURS 188 · CLASSES 94 · DEMANDES EN ATTENTE 28 · ALERTES CONFIGURÉES 4**.

**`/admin/students`** — KPIs TOTAL DES ÉLÈVES 2 463 / NOUVEAUX INSCRITS 0 / ÉLÈVES ACTIFS 2 463; « Répartition par niveau » (4e 22 %, 3e 22 %, 5e 22 %, 6e 22 %, 2nde 12 %); filters Toutes les classes / Tous les niveaux / Tous les statuts; table columns **Élève · ID Élève · Date de naissance · Classe · Niveau · Responsable légal · Statut d'inscription · Performance académique · Actions**; matricule format `VOLT-001753`.

**`/admin/classes`** — columns **Nom de la classe · Niveau · Salle · Année académique · Capacité maximale · Effectif actuel · Taux d'occupation · Enseignant référent · Statut · Actions**.

**`/admin/assessments`** — columns **Titre · Type · Matière · Classe · Enseignant · Période · Date · Barème · Notes · Statut · Actions**.

**`/admin/guardians`** — columns **Parent / Tuteur · Email · Téléphone · Élèves rattachés · Relation principale · Statut du lien · Actions**.

**`/admin/teachers`** — columns **Enseignant · N° Employé · Spécialité(s) · Classes Assignées · Email · Téléphone · Statut · Actions**.

**`/admin/subjects`** — a coefficient **matrix**: rows = subjects, columns = grade levels (CP, CE1, CE2, CM1, CM2, 6e, 5e, 4e, 3e, plus 6e Bilangue / 6e SEGPA / 6e ULIS).

**`/admin/exports`** — job table **Fichier · Type · Taille · Demandé par · Date · Statut · Actions** (asynchronous export jobs with download).

**`/admin/analytics`** — table **Cycle · Élèves évalués · En réussite · En difficulté · Moyenne · Taux de réussite**.

**`/parent/dashboard`** — « Centre de suivi 2 », child hero card (« Céline Chevalier — Classe de 2ndeD · Lycée Voltaire », Âge, Né(e) le, Identifiant `VOLT-002042`, **Rang de la classe 23 / 23**), « Performance globale — À jour il y a 46 min · 5 notes — 43 % À améliorer », « Moy. générale 8,50 / 20 · Moy. classe 12,43 / 20 · Progression +6,3 pts · Assiduité — », and an alerts-and-recommendations feed with a fully explained rule: « Moyenne actuelle 9.75 / 20 (seuil 10 / 20) sur 2 évaluations publiées. Consultez le détail en Mathématiques avec votre enfant et l'enseignant·e… ».

**`/teacher/dashboard`** — « Bienvenue, Catherine 👋 », « Pas encore d'affectation — Demandez à l'administration de vous rattacher à une classe et une matière depuis /admin/teachers », inline grade entry, « Répartition des moyennes », class statistics (Moyenne générale / Meilleure / Plus faible / Taux de réussite ≥10/20), assessment planning calendar, « Prochaines évaluations », « Classes enseignées », « Activité récente », « Outils rapides ».

## 5. API surface (confirmed — OpenAPI from the running service)

`GET /docs-json` → title « Pilotage scolaire API », version 1.0, **150 paths / 195 operations** across 27 tags:

health 3 · identity 3 · users 4 · roles 5 · auth 1 · branding 2 · school-structure 29 · schools 5 · imports 7 · calendar 5 · students 5 · guardians 9 · enrollments 6 · teaching 12 · grades 13 · notifications 6 · lessons 5 · attendance 8 · announcements 9 · analytics 17 · remediation 6 · exports 4 · parent-exports 4 · teacher-exports 4 · alerts 12 · meeting-requests 2 · messaging 9.

Notable operations: `POST /api/v1/grades/batch`, `POST /api/v1/assessments/{id}/publish|unpublish`, `POST /api/v1/grades/{id}/revise`, `PATCH /api/v1/grades/{id}/flag`, `POST /api/v1/attendance/batch`, `POST /api/v1/attendance/{id}/justify`, `POST /api/v1/class-sessions/open`, `POST /api/v1/imports/{type}/upload` → `/{id}/apply` → **`/{id}/rollback`**, `POST /api/v1/exports` → `GET /{id}/download-url` (presigned), `POST /api/v1/alerts/evaluate`, `POST /api/v1/analytics/snapshots/rebuild`, `POST /api/v1/schools/{id}/switch`, `POST /api/v1/calendar/events/seed-french-holidays`.

## 6. Confirmed defects

### D-1 — `/admin/audit` returns HTTP 500 (server/client boundary violation)
Runtime log from `pilotage_web`:
> `⨯ Error: Attempted to call humanizeResourceType() from the server but humanizeResourceType is on the client. It's not possible to invoke a client function from the server…` `digest: '1943107787'`

Root cause verified **in current source**: `apps/web/src/app/admin/audit/page.tsx` (a Server Component) imports `humanizeResourceType` from `./AuditPageFilters`, and `apps/web/src/app/admin/audit/AuditPageFilters.tsx:1` begins with `'use client'`. It is called at `page.tsx:92`. The whole audit page is unreachable.

### D-2 — Row-Level Security documented as Accepted but absent from the database
`docs/adr/ADR-002-multi-tenancy-rls.md` → **Status: Accepted**. Live database:
```
select count(*) from pg_policies;                          -> 0
select count(*) … where c.relrowsecurity;                  -> 0
```
`PrismaService.withTenant()` exists (`apps/api/src/shared/prisma/prisma.service.ts:27`) but `grep -rn "withTenant" apps/api/src` returns **1** hit — the definition itself. Tenant isolation is therefore entirely application-level, via **665** `tenantId` references in service `where` clauses. One missed filter silently leaks across tenants.

### D-3 — Raw string interpolation in a SQL statement
`prisma.service.ts:29`: `` await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`) ``. The value is interpolated, not parameterised, in an `Unsafe` raw call. Currently unreachable (see D-2) but it is a latent injection sink the moment the RLS path is switched on.

### D-4 — Running image is stale relative to the repository
Three admin routes and one teacher route present in source are missing from the container build (`child-claims`, `integrations`, `remediation` under `/admin`, plus `/teacher/remediation`), so they 404 at runtime. Verified by listing `/app/apps/web/.next/server/app/admin` inside `pilotage_web`.

### D-5 — Recharts container-sizing warnings in production logs
`pilotage_web` logs repeat:
> `The width(-1) and height(-1) of chart should be greater than 0, please check the style of container…`
Charts are being mounted into zero-size containers (typically a hidden/tab-switched panel), i.e. wasted renders and a likely blank-chart state on first paint.

### D-6 — Duplicate `<h1>` on every non-dashboard page
Every swept page except `/admin/dashboard` and `/teacher/dashboard` returns **two** `<h1>` elements — a shell-level « Tableau de bord » plus the page's own title (e.g. `/admin/students` → « Tableau de bord | Élèves »). WCAG/AT best practice expects one `h1` per document; this affects ~95 pages.

### D-7 — Documented e2e default accounts do not exist in the seeded environment
`apps/web/tests/e2e/fixtures/users.ts` defaults teacher to `teacher.demo@voltaire.fr` and student to `student@pilotage.local`. Neither authenticates here: the teacher default is absent from `user_profile` entirely; the student default returns NextAuth `error=Configuration`. The teacher journey only works via the simple `teacher@pilotage.local` account, which has **no teaching assignments** (dashboard shows « Pas encore d'affectation »), so the teacher-side journeys are vacuous on this seed.

### D-8 — ADR-016 (« Storybook mandatory ») not implemented
`packages/ui/src/components` contains **64** components; `find … -name "*.stories.tsx"` returns **0**.

## 7. Feature status classification (confirmed by cross-checking source, API, DB and rendered pages)

**Fully operational (source + API + rendered page + data):** school structure (schools, academic years, terms, cycles, grade levels, classes, subjects + coefficient matrix), students, guardians & guardianships, enrollments (+ transfer), teachers & teaching assignments, assessments & grades (batch entry, publish/unpublish, revise with `GradeRevision`, flag), class sessions & attendance (batch + justification), lessons (cahier de texte), announcements (+ receipts, preview-recipients, unread counts), notifications (+ per-kind preferences), alerts (8 rule codes, evaluate, ack/dismiss/resolve, meeting-intent), meeting requests, parent↔teacher messaging (+ reporting/moderation), analytics (17 endpoints incl. snapshot rebuild), exports/parent-exports/teacher-exports (async jobs + presigned download), bulk imports (8 types, upload → validate → apply → **rollback**), calendar, roles & permissions (89-permission catalog), branding, audit logging (**data layer works; the admin page is broken — D-1**).

**Implemented but not activated in this environment:** student portal (6 pages, `student` realm role, `*.self` permission family per ADR-021) — no `student` account authenticates.

**Implemented in source but not in the running build:** admin child-claims queue (E9), OneRoster integrations (E11), remediation/tutoring (E7) — D-4.

**Documented but deliberately not implemented:** **the entire Finance domain.** `docs/adr/ADR-018-finance-module.md` — **Status: Proposed**, decision: « Le Module Finance est reporté à une phase future (Phase 9 — Extensions)… Il ne sera **pas** implémenté dans les phases 0 à 8. » Confirmed absent from the data model: no `Invoice`, `Payment`, `Fee`, `Receivable`, `Discount`, `CashRegister`, `Budget`, `Payroll` or `Staff` model exists in `schema.prisma` (54 models, 0 finance models; a single incidental keyword match in the whole file).

**Broken:** `/admin/audit` (D-1).

## 8. Data model (confirmed — `apps/api/prisma/schema.prisma`, 2 142 lines, 54 models)

Tenant, School, AcademicYear, Term, Cycle, GradeLevel, Subject, SubjectCoefficient, ClassSection, Student, Guardian, Guardianship, GuardianshipClaim, Enrollment, CalendarEvent, ImportBatch, ImportRow, RosterSource, Branding, UserProfile, Permission, Role, RolePermission, UserRole, TeacherProfile, TeachingAssignment, Assessment, Grade, GradeRevision, ClassSession, LessonEntry, AttendanceRecord, Announcement, AnnouncementReceipt, AuditLog, ExportJob, OutboxEvent, AlertRule, NotificationPreference, Notification, AlertInstance, MeetingRequest, Conversation, ConversationParticipant, ConversationMessage, ConversationReport, StudentSubjectSnapshot, StudentGlobalSnapshot, ClassSubjectDistribution, SnapshotRecomputeTrigger, Tutor, TutorAvailability, RemediationPlan, Booking.

Key enums — `AlertRuleCode`: LOW_SUBJECT_AVG, NEGATIVE_TREND, REPEATED_FAILURE, MISSING_ASSESSMENT, HIGH_ABSENCE, TEACHER_COMMENT_FLAG, BEHAVIOR_ALERT, IMPROVEMENT. `ExportKind`: grades_xlsx, report_card_pdf, enrollment_xlsx, attendance_xlsx, audit_csv. `NotificationKind`: announcement, alert, grade_published, enrollment_status, lesson_published, system, weekly_digest, message, remediation. `ImportType`: students, classes, subjects, teachers, parents, enrollments, grades, attendance. Plus `ImportStatus`, `ImportMode`, `ImportRowStatus`, `ReconciliationClass`, `ImportOrigin`, `RosterSourceKind`, `RosterSyncStatus`, `OutboxStatus`, `SnapshotTriggerReason`, etc.

Architectural notes visible in the schema: an **outbox** table (`OutboxEvent` + `OutboxStatus`) for reliable event dispatch; **precomputed analytics snapshots** (`StudentSubjectSnapshot`, `StudentGlobalSnapshot`, `ClassSubjectDistribution`) with an explicit `SnapshotRecomputeTrigger`; **grade revision history**; **import row-level reconciliation** classes.

## 9. Seeded data volume (confirmed — read-only SQL)

| Table | Rows |
|---|---|
| tenant | 2 |
| school | 1 |
| student | 2 463 |
| guardian | 2 487 |
| enrollment | 2 463 |
| grade | 513 |
| attendance_record | **0** |
| user_profile | 190 |
| teacher_profile | 188 |

Attendance is entirely unseeded, so attendance-driven surfaces (HIGH_ABSENCE alerts, `/admin/attendance`, `/parent/attendance` — parent dashboard shows « Assiduité — ») could only be verified structurally, not behaviourally.

## 10. Authentication & authorisation (confirmed — source + live)

- **IdP:** Keycloak 26, realm `pilotage-scolaire`, discovery at `/realms/pilotage-scolaire/.well-known/openid-configuration` → 200.
- **Clients:** `portal-admin`, `portal-teacher`, `portal-parent`. Per ADR-021 the **student portal reuses the `portal-parent` client** (no 4th client), overridable via `KEYCLOAK_STUDENT_CLIENT_*`.
- **Web auth:** NextAuth 5. Providers advertised at `/api/auth/providers`: `keycloak-admin`, `keycloak-teacher`, `keycloak-parent`, and `credentials` (« Email / mot de passe »). The credentials provider performs a **server-side ROPC** grant against the internal Keycloak URL; OIDC uses the browser-facing public issuer so `iss` matches. Both paths were exercised: credentials login for admin/teacher/parent returned `302 → <portal>/dashboard`.
- **Portal isolation:** `apps/web/src/middleware.ts` maps portal → required realm role (`PORTAL_REQUIRED_ROLES`) and portal → landing route (`PORTAL_LANDING`), matcher `'/((?!_next/static|_next/image|favicon.ico).*)'`. Authenticated-but-wrong-role is redirected to that portal's login with an error rather than looping.
- **API auth:** Passport JWT validated against Keycloak JWKS (`jwks-rsa`), plus `JwtAuthGuard`, `PermissionsGuard`, `@RequiresPermission`, `@CurrentUser`, and a `UserSyncService` that reconciles Keycloak identities into `UserProfile`.
- **Permission model:** 89 permissions of shape `<resource>.<action>` in `apps/api/src/shared/auth/permissions.constants.ts`, including deliberately role-narrowed variants: `exports.execute.parent`, `exports.execute.teacher`, `guardianships.claim` (parent-only, cannot create an `active` link), and a `*.self` family for the student role. Custom roles are first-class (`Role`, `RolePermission`, `UserRole`, `GET /api/v1/roles/permissions/catalog`).
- Login pages expose: email/password, « Se connecter via SSO Keycloak », « Mot de passe oublié ? », « Demander une invitation », and cross-links to the other portals.

## 11. Quality, testing, delivery (confirmed)

- **Tests:** 50 spec files repo-wide; 32 `*.spec.ts` under `apps/api/src`. Playwright e2e: `smoke.spec.ts`, journeys `child-claim-approval`, `grade-to-alert`, `parent-teacher-messaging`, and a11y suites `authenticated.a11y.spec.ts` + `cross-portal.a11y.spec.ts` (WCAG 2.2 AA sweep across all four portals) with a session-caching `auth.setup.ts`.
- **CI** (`.github/workflows/ci.yml`): install → lint → typecheck → build → test. Separate `docker-build.yml` builds and pushes images via a matrix. **No e2e or a11y job runs in CI** — those suites exist but are not gated.
- **Design system:** `packages/ui` with 64 components (DataTable, FilterBar, KpiCard, DetailDrawer, FormDrawer, EmptyState, ErrorState, LoadingState, ConfirmDialog, charts, GradePill, CapacityBar, NotificationBell, Pagination, …) + `packages/design-tokens`. Storybook: **0 stories** despite ADR-016.
- **i18n:** `packages/i18n` with `fr.json` and `en.json`, wired through next-intl.
- **ADRs:** 16 records — 001 modular monolith, 002 multi-tenancy RLS, 003 three-portals routing, 004 Keycloak realm/clients, 013 customization layer, 014 Postgres 15, 015 permissions RBAC+ABAC, 016 Storybook mandatory, 017 bulk-import pipeline, 018 finance module (Proposed/deferred), 019 analytics snapshots, 020 booking availability concurrency, 021 student role & self-ABAC, 022 enrollment self-service child-claim, 023 authenticated e2e & a11y layer, 024 async import sync & idempotent reconciliation.
- **Deployment:** `docs/DEPLOYMENT.md`, `infra/docker-compose.prod.yml`, `scripts/deploy-prod.sh`; production runs behind an existing Traefik with HTTPS (per repository history and prod compose).
- **Observability:** pino structured logging in api/worker; OTLP endpoint configured (`OTEL_EXPORTER_OTLP_ENDPOINT`) with a Jaeger service under the `obs` profile; `@nestjs/terminus` health/readiness (`/healthz`, `/readyz`).

## 12. Actions deliberately **not** executed

No records were created, updated or deleted; no import was applied or rolled back; no export job, alert evaluation or snapshot rebuild was triggered; no email was sent through MailDev; no Keycloak user, password or client setting was modified; no Docker service was altered. All findings above come from reads, plus authentication using dev credentials already documented in the repository.
