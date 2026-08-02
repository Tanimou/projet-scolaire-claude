# Pilotage scolaire — hosted multi-role interactive evidence (round 5)

Date: 2026-08-02  
Target: hosted demo deployment, all four portals plus public/auth pages.  
Method: interactive in-app browser, source-route reconciliation, safe synthetic student/enrollment write, cross-role propagation checks, static architecture inspection. Credentials and identifiers are intentionally omitted.

## Scope and completion statement

Every page represented by a `page.tsx` route was requested through the appropriate portal or reconciled with an intentional redirect. All visible forms, buttons, tabs, filters, links, menus and populated detail paths were inspected. Two data-dependent pages could not be exercised: an import-batch detail (no batch exists) and custom-role edit (no custom role exists and system roles are immutable). External sending, destructive actions, import application/rollback and security bypass attempts were not triggered.

## Public and authentication surface

- The landing page advertises realtime propagation, WCAG 2.2 AA, GDPR, sovereign hosting, 99.5% availability, OWASP ASVS L2, ISO 27001 readiness, append-only audit and several operational features. The audit found no evidence sufficient to certify these claims, and several runtime contradictions are documented below.
- `/legal/privacy`, `/legal/terms`, `/legal/cookies`, `/pricing`, `/contact` and `/help` return 404. Parent registration nevertheless requires acceptance of terms/privacy.
- Hosted admin and teacher registration pages expose development-only Maildev instructions pointing to localhost.
- Teacher and administrator registration are invitation-only; parent self-registration is public.
- The student password-reset flow targets the parent identity client. Source confirms the student portal reuses that client.
- Student credentials were correctly denied from admin, teacher and parent portals and redirected with a wrong-portal error: positive RBAC evidence.

## Admin workflow evidence

| Area | Status | Observation |
|---|---|---|
| Student creation | EXECUTED | A synthetic student was created. Date of birth entered in the form was not persisted/displayed. |
| Enrollment capacity | EXECUTED EDGE CASE | Enrollment in a full class was rejected; enrollment in a class with capacity succeeded and propagated to class detail. |
| Class creation | BROKEN | `/admin/classes/new`, linked by the UI, crashes with a server component error. |
| Enrollments | CONTRADICTORY | Dashboard reports 28 pending requests; the queue page is empty and states approval/rejection is deferred to a later release. |
| Assessments/analytics | CONTRADICTORY | Dashboard/analytics report hundreds of grade/evaluation records while the assessments page shows none published. |
| Alerts | CONTRADICTORY | Dashboard reports four configured alerts; alert management reports zero active rules. Behaviour rules are described as UI-only/not evaluated. |
| Structure | CONTRADICTORY | Teacher, subject, level and permission totals vary across pages; one class is already over capacity although manual enrollment enforces the limit. |
| Assignments | OBSERVED | 290 active assignments and 118 warnings rendered in one unpaginated page; warning subtotals include missing lead/assistant teachers and unstaffed subjects. |
| Academic years | OBSERVED RISK | Active year is 2023–2024 although audit date is 2026. New-year form defaults to 2026–2027 and “make active”, which would close the current year. |
| Calendar | EXECUTED ACCIDENTAL SIDE EFFECT | “Import French holidays” performs immediately without confirmation. It added 22 holidays to the active 2023–2024 year. Existing 2026 events were also associated with that old active year. |
| Announcements | OBSERVED | Whole-school audience estimated 191 accounts but role breakdown was 1 parent, 0 teachers, 0 admins and 190 “other”; the student portal did not receive the announcement. Recipient roles were blank. |
| Imports | OBSERVED | Five import types share a generic 5 MB UTF-8 upload step; no templates or required-column guidance. OneRoster accepts only users/classes/enrollments; REST connector is not live. |
| Exports | OBSERVED | Asynchronous XLSX/PDF/CSV catalogue with one-hour object links; no historical artifact was downloaded. |
| Roles/users | OBSERVED | Four system roles, no custom roles, and inconsistent permission totals. 186 of 191 users had never connected. Role assignment controls apply directly. |
| Audit/reports | BROKEN | `/admin/audit` crashes; `/admin/reports` is absent/404 despite expectations. |

## Teacher workflow evidence

- The demo teacher has two classes. Class-list, profile and detail counts disagree (48, 46, 43 distinct and 25/26 variants).
- Class gradebook links pass a class identifier where the page expects a teaching-assignment identifier. The gradebook and dashboard “create assessment” path therefore fail.
- Assessments reports 0 while teacher reports show 2 published assessments/46 grades, the dashboard says 3 drafts plus 1 incomplete grade, and the global grade page shows 46 rows with a conflicting KPI of 42.
- Attendance creation had no session for one class and defaulted to the current 2026 date while the active academic year is 2023–2024.
- New lesson defaults to **Published**, immediately parent-visible, rather than Draft.
- Class “new announcement” points to a 404 messaging route. The alternate composer calculated zero recipients for a class known to have linked families.
- Conversations work; opening the seeded thread marked it read. Reporting is available.
- Remediation exposes a weekly slot and pending booking. The slot form omits visible location/end/overlap controls and its governance copy conflicts with the publish action.
- Teacher profile and help links return 404; “Import grades” points into the admin portal. Notification settings contain parent-specific copy.
- Direct document upload is explicitly deferred to a later worker release.

## Parent workflow evidence

- Dashboard and child detail show an active child/enrollment, while “My family”, children list and claim panel say no active enrollment/no linked child.
- Grades page shows zero even with the child query parameter, while dashboard, subject view, printable report and student portal all show the same published grade.
- Attendance shows seven records and 71.4%, but includes a class different from the active class and displays a nonsensical −71.4-point trend.
- Calendar counters load through contradictory interim/final values; imported holidays become visible to the parent.
- A whole-school announcement is visible to the parent but absent for the student; its detail leaks an internal seed-author label.
- A teacher message promises an attachment, while the parent documents page contains none.
- Parent remediation detail allows the parent to mark the school-created plan achieved or close it, while providing no direct booking action.
- Printable report works but combines the 2023–2024 year with the 2026 generation date and computes a misleading “+0.0 above” comparison.
- Profile and help links return 404. Opening the conversation and announcement changed their read state.

## Student workflow evidence

The student portal is operational but minimal: dashboard, grades, upcoming evaluations, attendance and announcements. It correctly displays the known grade and seven attendance records. It does not display the whole-school announcement and has no profile/settings surface. Help returns 404. Portal-isolation negative tests succeeded.

## Static architecture evidence

| Grade | Finding |
|---|---|
| CONFIRMED | Monorepo: pnpm/Turborepo; Next.js web; NestJS API and worker; Prisma/PostgreSQL; Keycloak; Redis/BullMQ; MinIO; Maildev; optional observability stack. |
| CONFIRMED | Production startup uses `prisma db push --accept-data-loss`; repository comments acknowledge no SQL migration history. |
| CONFIRMED | Production compose deliberately runs the demo seed outside `NODE_ENV=production`; hosted data is visibly seed-derived. |
| CONFIRMED | `UserSyncService` and public registration attach new unmapped profiles to a constant `demo` tenant. |
| CONFIRMED | `PrismaService.withTenant` exists, but repository search found no application call sites and no SQL RLS policies/enabling statements. The claim that repositories are RLS-isolated is not implemented in this tree. |
| CONFIRMED | API validates Keycloak RS256 tokens via JWKS; portal middleware separates roles; permission guards combine realm and custom-role permissions. |
| CONFIRMED | Global request validation uses whitelist/forbid-non-whitelisted; Helmet is enabled with CSP explicitly disabled. |
| CONFIRMED | Notification bell polls every 30 seconds; source says SSE is future work. Email/push coverage is staged. |
| BLOCKED_BY_DEPENDENCY | 50 spec files exist (32 API, 12 worker, 6 web/Playwright), but test and typecheck execution is not valid in this worktree because required local dependencies/generated Next types/workspace config are absent. |

## Safe state changes and residue

- One synthetic student and one successful enrollment remain for reproducibility; one full-class enrollment attempt was correctly rejected.
- Clicking holiday import added 22 French holidays to the demo’s active 2023–2024 year. The control had no confirmation and the action is not reversed without explicit authorisation.
- Opening seeded conversations/announcements marked them read on the demo accounts.
- No real message, invitation, payment, destructive deletion, import application/rollback or role/security mutation was performed.

