# Evidence — Internal platform: verified capability gaps (round 2)

**Method.** Each row below was checked with a targeted `grep -rniE` over `apps/api/src`, `apps/web/src` and `packages`
(`*.ts`, `*.tsx`) in the worktree, then every non-zero hit was opened and classified by hand. "Absent" means **zero
implementation hits**, not merely "not seen in the UI".

> Round-1 note: an earlier grep in this session used `\|` inside an ERE pattern, which matches a **literal pipe** and
> returned false zeros for everything. Those results were discarded; the table below is the corrected run.

## 1. Capabilities Lakoli has — verified state in our codebase

| Lakoli capability | Our hits | Verified state |
|---|---|---|
| Assessment-period **closure lifecycle** (`pre-cloture-check`, `cloture`, `re-cloture`, `re-ouvrir`, `ponderation-annuelle`) | **0** | **Absent.** No closure concept anywhere. Periods (`Term`) can be created and edited but never closed, re-opened, or weighted annually. |
| **Refunds** (`POST /paiements/{id}/rembourser`) | **0** | **Absent** (no payments at all). |
| **Cahier de textes visa** (`soumettre` → `visa` → `historique`) | **0** | **Absent.** `LessonEntry` exists with no submit/countersign/history workflow. |
| **Convocations** (summons for incidents and exam sittings) | **0** | **Absent.** |
| **Payroll** (contracts, payslips, batch runs, IRPP/seniority scales, rubrics) | **0** | **Absent.** No staff entity at all. |
| **Module entitlements / feature gating** (`/module-access/catalog`, per-page `accessible` gate) | **0** | **Absent.** No plan-based or per-tenant feature gating exists. |
| **Nominative habilitations** for sensitive data (`/vie-scolaire/suivi-sensible/permissions*`) | **0** | **Absent.** Authorisation stops at permissions + ABAC; no time- and domain-bounded personal grants. |
| **Timetable** (`/emploi-du-temps`, slots, class/teacher views, print) | **0** | **Absent.** |
| **Room management** (`/emploi-du-temps/salles`, `PATCH /salles/{id}/statut`) | 20 | **Not a capability.** `room` is a free-text `@IsString() @MaxLength(40)` field on a class (`classes.controller.ts:36,48`), displayed at `admin/classes/[id]/page.tsx:181`. There is no `Room` entity, no room inventory, no availability or status. |
| **Discipline / incidents** (incident → mesure → convocation, each with a status machine) | 19 | **Permission scaffolding only.** The only real hits are the catalogue entries `['discipline.read', 'Lire dossiers disciplinaires', …]` and `['discipline.write', …]` at `permissions.constants.ts:78-80`, plus their inclusion in three role presets (lines 190-191, 242-243, 267). **No model, no controller, no service, no page.** Remaining hits are the English word "discipline" in unrelated remediation DTO comments. |
| **Compliance / Conformité** (profiles, executions, responses, generate, validate, import anomalies) | **0** | **Absent.** |
| **Orientation** (référentiels, campaigns, dossiers, bulk apply) | 4 | Unrelated hits. **Absent** as a capability. |
| **SMS / WhatsApp channels** | 2 | **Declared, explicitly not wired.** `packages/contracts/src/enums/index.ts:55` declares `NOTIFICATION_CHANNEL = ['email','push','sms','in_app']`, but `apps/web/src/app/admin/settings/page.tsx:144` states verbatim: **« SMS — Désactivé (canal non câblé) »**. No provider, no template, no campaign, no wallet. The `push` channel is likewise declared with no implementation found. |
| **Finance** (`invoice`/`receivable`/`creance`/`payment`/`fee`) | **0** | **Absent** — confirms round 1 and ADR-018. |
| **Class ranking** | 29 | **Present.** Genuinely implemented (surfaced as « Rang de la classe » on the parent dashboard). |

## 2. New defect — `/admin/settings` is an informational mock

`apps/web/src/app/admin/settings/page.tsx` renders **28 `<Field>` components**, of which **26 are hardcoded string
literals and 0 take a dynamic value**:

```
<Field label="Fuseau"                    value="Europe/Paris" />
<Field label="Langue"                    value="fr-FR" />
<Field label="Barème par défaut"         value="/ 20" />
<Field label="Seuil de réussite"         value="10 / 20" />
<Field label="Digest hebdomadaire parents" value="Activé (samedi 9h)" />
<Field label="SMS"                       value="Désactivé (canal non câblé)" />
<Field label="MFA pour admins"           value="Obligatoire (à configurer dans Keycloak)" />
<Field label="Longueur min. mot de passe" value="12 caractères (policy realm)" />
<Field label="Verrouillage automatique"  value="5 tentatives" />
<Field label="Durée session"             value="8 h (refresh token : 30 j)" />
```

Classification per the audit's required taxonomy: **visible but non-functional (placeholder/mock)**.

Consequences:
1. **Nothing on this page can be changed.** Several fields openly redirect the reader elsewhere
   (« Configurable depuis /admin/establishment », « Configurée via /admin/academic-years »).
2. **The security card asserts a posture it does not verify.** « MFA pour admins : Obligatoire » is a static string,
   not a value read from Keycloak. If MFA is not actually enforced in the realm, this page states a false control —
   a genuine risk if it is ever shown during a security review or procurement questionnaire.
3. **One value is already stale:** the notification card says the notification centre is « Visible sur les 3 portails »,
   but there are now **four** portals (the student portal, ADR-021).

Round 1 recorded `/admin/settings` as « Fully explored — STATUS 200 » and did not detect that it is a mock. That was a
depth failure: HTTP 200 was mistaken for a working feature.

## 2bis. NEW HIGH-SEVERITY DEFECT — every teacher can read every student record in the school

**Location:** `apps/api/src/modules/students/student-access.service.ts:37-40`

```ts
if (roles.includes('teacher')) {
  // TODO Phase 4: when teaching assignments exist, filter by the teacher's class sections.
  return { studentIds: null, reason: 'teacher (unrestricted until teaching assignments land)' };
}
```

`studentIds: null` is the service's documented sentinel for **"no restriction"**. Consumers fold it into their `where`
clause; in `apps/api/src/modules/students/students.controller.ts:104-107`:

```ts
const scope = await this.access.scopeForUser(me, jwt, schoolId);
const where: Record<string, unknown> = {
  tenantId: me.tenantId,
  schoolId,
  ...(scope.studentIds ? { id: { in: scope.studentIds } } : {}),   // ← teacher ⇒ {} ⇒ no narrowing
```

and `canAccessStudent` short-circuits to `true` for the same reason (`student-access.service.ts:71`).

### Why the stated precondition no longer holds (confirmed)

The comment defers the restriction until "teaching assignments exist". They exist, at volume — verified read-only
against the live database:

| Table | Rows |
|---|---|
| `teaching_assignment` | **289** |
| `class_section` | 94 |
| `teacher_profile` | 188 |

There is also a live API for them (`/api/v1/teaching-assignments`, 12 operations) and an admin page. The simplification
is therefore stale, not pending.

### Blast radius (confirmed)

The `teacher` role preset (`permissions.constants.ts:221-255`) grants `students.read` **and** `guardianships.read`.
Combined with the unrestricted scope, a teacher account can:

- `GET /api/v1/students` — **list all 2 463 student records in the school**, with `q` (free-text search), `status`,
  `classSectionId` and `academicYearId` filters, regardless of what they teach;
- `GET /api/v1/students/{id}` — open any individual student record (identity, date of birth, class, legal guardian);
- reach the other `canAccessStudent`-guarded surfaces their permissions allow, notably `remediation.read`.

`scopeForUser` / `canAccessStudent` is the security boundary for **9 modules** — students, alerts, analytics, calendar,
messaging, parent-exports, remediation, student-portal and meeting-requests — so this single line is load-bearing far
beyond the students module.

### Two aggravating factors

1. **The unit test asserts the hole as intended behaviour**, so CI can never catch it —
   `student-access.service.spec.ts:86-96`:
   > `it('admin / teacher tokens are unrestricted within tenant (no guardianship lookup)')`
   > `await expect(service.canAccessStudent(PARENT, jwtWithRoles(['teacher']), OTHER_CHILD, SCHOOL)).resolves.toBe(true);`

2. **The team knows, and compensated in exactly one place.** `apps/api/src/modules/alerts/meeting-requests.service.ts:8-14`
   states verbatim: « `StudentAccessService.scopeForUser` still returns `studentIds:null` for teachers, so we cannot
   lean on student-scope here; we filter on `assignedToId = me` ∪ `assignedToId IS NULL` ». That workaround protects the
   meeting-request queue only; the student list and detail were never given equivalent treatment.

### Assessment

- **Severity:** High — a data-minimisation / privacy failure over the entire student body, not an edge case.
- **Likelihood:** Certain — it is the default path for every teacher token.
- **Contradicts:** the service's own docstring, ADR-015 (RBAC + ABAC), and the "dual wall" standard the messaging
  module applies (guardianship ∩ teaching assignment).
- **Fix size:** Small — resolve the teacher's `TeachingAssignment` → `ClassSection` → active `Enrollment` student ids
  and return them, mirroring the existing parent branch. The test at `:86` must be inverted at the same time, or the
  fix will be reported as a regression.

**This was missed entirely in round 1**, which examined authorisation only at the level of the permission catalogue and
concluded the model was "materially more expressive" than Lakoli's. That conclusion stands for the *catalogue*, but the
ABAC layer beneath it has a hole the catalogue cannot compensate for.

## 2ter. Two further verified findings

### A. End-of-year pass/repeat decisions (« conseil de classe ») are absent

| Concept | Our hits | State |
|---|---|---|
| `coefficient` | 165 | Present — coefficients per subject × grade level |
| `moyenne` / `average` | 391 | Present — average computation is thorough |
| `rank` / `classement` | 67 | Present |
| `bulletin` / `reportCard` | 63 | Present — async `report_card_pdf` generator |
| `appreciation` / teacher comment | 12 | Present |
| `mention` | 13 | Present |
| **`conseil de classe` / `passage` / `redoublement` / decision** | **0** | **Absent** |
| **absence rate** | **0** | **Absent** |

Lakoli exposes `POST /inscriptions/fin-annee/decisions`, `/dfa-preview`, `/finaliser`, `/rouvrir` — a formal end-of-year
decision step that it explicitly makes a **precondition for re-enrolment** (« Cette étape doit être complétée avant de
lancer les réinscriptions »). We compute averages and rankings well but have **no decision object at all**, so there is
nothing to close a year with and nothing to drive a promotion from. This compounds the missing period-closure lifecycle
(§1): grades stay mutable and the year never formally ends.

### B. `POST /api/v1/auth/register-parent` is public and unthrottled

`apps/api/src/modules/identity/register.controller.ts:57-63` — `RegisterController` carries **no** `@UseGuards` and the
route carries no permission decorator, so it is reachable unauthenticated (by design: parent self-registration). It
validates terms acceptance and password complexity, then creates a **Keycloak user** via `KeycloakAdminService`.

Rate limiting in this codebase is bespoke and application-level, and exists in exactly **two** places:
- `child-claims.service.ts:40-42` — `RATE_LIMIT_MAX = 5` per `10 * 60 * 1000` ms, explicitly for anti-enumeration;
- `messaging.service.ts` — a per-sender send limit.

Neither covers registration. An unauthenticated endpoint that provisions identity-provider accounts with no throttle is
an abuse and resource-exhaustion risk (and a signup-enumeration oracle if it responds differently for existing emails).

**Requires validation:** whether the production edge (Traefik/nginx) applies a rate limit in front of it. If it does, the
severity drops to Low; if not, this is Medium and should be fixed in the application, where the two existing rate-limit
implementations already provide a pattern to copy.

### C. Positive finding — permission-guard discipline is excellent

A sweep of all 40 controllers found **227 route decorators, of which 222 carry an explicit `@RequiresPermission`**. The
five without are correct: three health probes (`/`, `/healthz`, `/readyz`), `GET /me` (self, authenticated but
permission-free by design), and the public `register-parent` above. This is materially stronger than anything
observable on Lakoli and should be defended in the comparison — the ABAC hole in §2bis is an exception to an otherwise
disciplined authorisation layer, not a symptom of a sloppy one.

## 3. What this means for the gap analysis

The absences in §1 are not "features we have in a weaker form". With the single exception of class ranking — and the
partial exception of `room` as a text field — they are **zero-implementation gaps**. Any roadmap item touching them is
a build-from-scratch, not an enhancement.

Two of them are also *governance* gaps rather than merely functional ones, and are worth separating in the roadmap:
- **Nominative habilitations** — the control Lakoli applies to child-protection and health data, which our permission
  model has no equivalent for.
- **Period closure** — without it, grades remain mutable indefinitely, which undermines the credibility of any report
  card or transcript our platform produces.
