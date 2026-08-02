# Pilotage scolaire live runtime browser audit — round 4

**Date:** 2026-08-02  
**Environment:** local Docker stack, web `:3000`, API `:4000`, Keycloak `:8180`.  
**Method:** real authentication and browser traversal for admin, teacher, and parent roles; direct student-route checks; Docker health and log inspection; source cross-check. No business record was created, updated, sent, imported, exported, or deleted.

This file is the authoritative runtime supplement to the source-heavy internal audit. A source route or API controller is not classified as operational unless the running image rendered it successfully.

## Runtime and coverage

- Eight containers were running and Docker reported all of them healthy: web, API, worker, Keycloak, PostgreSQL, Redis, MinIO, and Maildev.
- Both health endpoints returned HTTP 200.
- 73 static role routes were requested in the interactive pass: 41 admin, 14 teacher, 16 parent, and 2 student routes, in addition to the three login flows.
- Authentication succeeded for admin, teacher, and parent accounts.
- The student source tree exists, but both `/student/login` and `/student/dashboard` return the Next.js 404 in the running image.

## Highest-impact runtime finding

### I-R4-01 — Concurrent first-request user synchronization fails with a unique constraint

**Severity:** Critical for runtime reliability  
**Observed effect:** authenticated pages issue several parallel API requests. One request creates the local `UserProfile`; concurrent requests also execute `create()` and fail with a unique constraint on `auth_provider_id`. Depending on which request fails, pages show an error boundary, partial data, or a misleading empty state.

**Docker log evidence:**

```text
Invalid this.prisma.userProfile.create() invocation
Unique constraint failed on the fields: (auth_provider_id)
at UserSyncService.ensureUser (.../user-sync.service.ts:44)
```

**Source evidence:** `apps/api/src/shared/auth/user-sync.service.ts:17-58` performs `findUnique`, optional email lookup/update, and then a separate `create`. This check-then-create sequence is not atomic and has no unique-conflict recovery.

**Why health checks missed it:** `/healthz` tests process availability, not an authenticated multi-request page load. Both web and API remained HTTP 200-healthy while functional routes returned API 404/500 or error boundaries.

## Admin portal — live state

### Routes that rendered

Dashboard shell, establishment, academic years, cycles/levels, subjects (with API-error copy), guardians, users, assessments, attendance, enrollments, assignments, alerts, meeting requests, communications, notifications, conversation moderation, imports, exports, audit, roles, settings, analytics, schools, new student, invite user, and import wizard.

Important corrections:

- `/admin/settings` is no longer a static mock. The Notifications tab exposes seven event categories, in-app/email switches, per-category email frequency, a weekly digest switch, and disabled future push controls.
- `/admin/audit` rendered a coherent empty state and filters in this build; the earlier 500 finding is stale.
- `/admin/conversations` renders a moderation empty state but could not demonstrate moderation actions without reported conversations.
- `/admin/enrollments` explicitly discloses that the full EnrollmentRequest workflow and action drawer are planned for R6; the current UI derives requests from Guardianship metadata.

### Error-boundary routes

- `/admin/classes`
- `/admin/students`
- `/admin/teachers`
- `/admin/calendar`
- `/admin/school/structure`
- `/admin/announcements/new`

### 404 or absent routes

- `/admin/reports` despite a visible sidebar link
- `/admin/child-claims`
- `/admin/integrations`
- `/admin/remediation`

### Routing defect

After successful admin credential submission, the callback lands on `/admin`, which is a 404. Direct navigation to `/admin/dashboard` succeeds.

## Teacher portal — live state

The teacher portal is present and coherent, but the demo teacher has no teaching assignment. Dashboard, classes, students, meeting requests, grades, assessments, calendar, documents, messages, conversations, notifications, and settings render useful empty states.

- `/teacher/reports` renders `Rapports indisponibles` because its data request fails.
- `/teacher/remediation` returns 404 despite the source page.
- The dashboard quick action `Importer des notes` points into the admin portal (`/admin/imports`), which is a cross-portal UX and authorization concern.

## Parent portal — live state

The parent role authenticates, but the current demo account has no child linked. Dashboard, attendance, calendar, children, comments, communication, documents, grades, lessons, messages, notifications, recommendations, settings, subjects, upcoming evaluations, and announcements all render role-appropriate empty states.

This invalidates the earlier claim that the current runtime was verified with a rich parent dataset. The source capabilities remain, but populated parent workflows were not live-tested in this environment.

## Student portal — source/build mismatch

The repository contains six student pages, middleware role definitions, and student permissions. The running Next.js image returns 404 for both the login and dashboard. Runtime status is therefore **source-only / absent from build**, not a fourth operational portal.

## Operational classification

| Layer | Current result |
|---|---|
| Containers and health probes | Healthy |
| Authentication | Works for admin, teacher, parent |
| Authenticated API initialization | Race-prone; produces 500s |
| Admin UI | Mixed: several functional surfaces, six error boundaries, four 404s |
| Teacher UI | Broad empty-state coverage; reports unavailable; remediation 404 |
| Parent UI | Broad empty-state coverage; no linked child |
| Student UI | Absent from running build |
| Source architecture | Rich and modular, but materially ahead of deployed behavior |

## Screenshots

- `screenshots/internal_admin_classes-error-boundary-01.png`
- `screenshots/internal_student_portal-404-01.png`

The functional settings page was inspected live through its full DOM, but its screenshot was not retained because the header and explanatory copy contained demo personal identifiers.

## Immediate remediation order

1. Make `ensureUser()` atomic or recover from the unique conflict, and add a concurrent first-login integration test.
2. Fix `/admin` to redirect to `/admin/dashboard` after login.
3. Align the web image with the source route tree and remove or implement sidebar links that resolve to 404.
4. Repair the six admin error-boundary routes and `/teacher/reports` against the actual API contract.
5. Provision and verify the student portal in the standard seed/build, or remove it from product claims.
6. Upgrade health/readiness checks to exercise an authenticated read path or a representative API dependency.
