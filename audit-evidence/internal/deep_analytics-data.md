# Deep audit — domain `analytics-data`

Scope: `apps/api/src/modules/{analytics,exports,imports,integrations,parent-exports,teacher-exports,remediation}`,
`packages/imports-core`, `apps/web/src/app/admin/{analytics,exports,imports,integrations,remediation}`, `apps/worker/**`.

Method: full read of every page + sibling client component + server action; full read of every controller/DTO/guard;
live probes against the running stack (API `http://localhost:4000`, OpenAPI `/docs-json`), read-only Postgres inspection
(`docker exec pilotage_postgres psql`), and `docker logs pilotage_worker`.

All line numbers are from the worktree `claude/platform-audit-gap-analysis-216337` @ `a9943ce`.

---

## 0. Environment-level findings (verified live, these dominate everything below)

### 0.1 The running **API** image is stale — 3 whole feature slices are 404 in production
Previously only the *web* image was known stale. The API container is stale too.

Live probe results (`curl -o /dev/null -w %{http_code}`, unauthenticated — `401` = route exists, `404` = route absent):

```
404  GET  /api/v1/integrations/oneroster          <- IntegrationsController (4 routes) entirely absent
404  GET  /api/v1/remediation/admin/overview      <- E7-S5 admin curation
404  GET  /api/v1/remediation/admin/tutors        <- E7-S5 admin curation
404  GET  /api/v1/remediation/teacher             <- E7-S4 teacher capacity surface
404  POST /api/v1/imports/{id}/conflicts/{rowId}/resolve   <- E11-S4 conflict arbitration
401  GET  /api/v1/remediation/catalogue           (exists)
401  GET  /api/v1/analytics/snapshots/recompute-status (exists)
401  GET  /api/v1/imports/types                   (exists)
401  GET  /api/v1/exports                         (exists)
```

`/docs-json` enumerates **42** domain routes; the source declares ~60. The code has 18 `@Get/@Post/@Patch` decorators in
`remediation.controller.ts` (1097 lines) — the live API serves 5.

Consequence: `/admin/integrations` and `/admin/remediation` are dead ends in the running stack even after the web image
is rebuilt.

### 0.2 The live **database schema** is pre-E11-S2/S3/S4 — the current API code cannot run against it
`docker exec pilotage_postgres psql -U pilotage -d pilotage -c "\d import_batch"` / `"\d import_row"`:

| column the code writes | source | present in live DB? |
|---|---|---|
| `import_batch.origin` | `apps/web/src/app/admin/imports/[id]/page.tsx:523`, `integrations.service.ts` | **NO** |
| `import_batch.claimed_at` | `apps/worker/src/modules/imports/imports.processor.ts:83` | **NO** |
| `import_row.reconciliation` | `packages/imports-core/src/engine.ts:159,175` | **NO** |
| `import_row.conflict_fields` | `packages/imports-core/src/engine.ts:160` | **NO** |
| table `roster_source` | `apps/api/prisma/schema.prisma:785-805` | **NO** (52 tables, none named `roster_source`) |

So: deploying the current API/worker against this DB breaks **every** import read
(`ImportsService.getBatch` → `include: { rows }` selects `reconciliation`) and every apply
(`ImportsProcessor.claim` reads `claimedAt`). This is the operator `prisma db push` gap noted in the project memory, but
it is a P0 for this domain, not a cosmetic RED gate: E11-S2 (reconciliation panel), E11-S3 (OneRoster) and E11-S4
(conflict arbitration) are **placeholder** in the running stack.

### 0.3 RBAC catalogue tables are unseeded and 5 permission codes are missing
```
permission        = 71 rows
role              =  3 rows
role_permission   =  0 rows      <-- join table completely empty
```
`select code from permission where code like 'remediation%'` → **0 rows**. Missing from the DB catalogue but defined in
`apps/api/src/shared/auth/permissions.constants.ts:110-117`:
`remediation.read`, `remediation.manage`, `remediation.book`, `exports.execute.parent`, `exports.execute.teacher`.

Authorization still works because `UserSyncService.effectivePermissions` (`user-sync.service.ts:64-87`) unions the
hardcoded `REALM_ROLE_PERMISSIONS` map first and only *adds* DB-role permissions. Net effect: the DB RBAC tables — and
therefore anything the `/admin/roles` UI can grant — are **decorative** for this whole domain; the 5 newest permissions
can never be granted through the product.

---

## 1. `/admin/analytics` — Analytique des performances

Files: `apps/web/src/app/admin/analytics/page.tsx` (141 l.), `PerformanceDrilldown.tsx` (479 l.)
API: `analytics.controller.ts:84` → `school-performance-drilldown.service.ts` (691 l.)

### Control inventory
| Control | Where | Calls | Verdict |
|---|---|---|---|
| KPI: Taux de réussite global | page.tsx:98-105 | derived from L1 payload | fully operational |
| KPI: Élèves évalués | page.tsx:106 | derived | fully operational |
| KPI: Meilleur cycle | page.tsx:109-118 | derived | fully operational |
| KPI: Cycles analysés | page.tsx:119 | derived | fully operational |
| `FreshnessChip` | page.tsx:93 | `data.freshness` | fully operational (always `source:'live'`) |
| Period `SelectFilter` (Trimestre / Toute l'année) | PerformanceDrilldown.tsx:211-218 | `router.push(?termId=)` | fully operational |
| Breadcrumb drill-up (Home ▸ Cycles ▸ Cycle ▸ Classe ▸ Matière) | :146-204 | `router.push` | fully operational |
| Groups table cols: Cycle/Classe/Matière, Élèves évalués, En réussite, En difficulté, Moyenne, Taux + `SuccessBar` | :300-353 | — | fully operational |
| Row click → drill down one level | :317 `onClick` → `drillPatch` :247 | `router.push` | fully operational |
| Students table cols: Rang, Élève, Moyenne, Tendance, Statut | :396-445 | — | fully operational |
| Empty states (2 distinct copies) | :285-293, :383-391 | `EmptyState` | fully operational |
| Loading state | :227 `isPending` + `aria-busy` :231 | `useTransition` | fully operational |
| Error state | — | `safe()` → `null` → renders empty tables | **exists-but-incomplete** (an API 500 is indistinguishable from "no data") |
| Sort options | — | none | **missing** (groups always `localeCompare` by name; no column sort) |
| Bulk actions / export of the drill-down | — | none | **missing** |
| Server guard | `analytics.controller.ts:85` `@RequiresPermission('schools.read')` | — | present |
| Client guard | none — server-component page, relies on the API 403 | — | acceptable |

### Defects
- **`school-performance-drilldown.service.ts:263` — `schoolId` is accepted and silently dropped.**
  `cyclesForSchool(opts)` destructures `const { tenantId, academicYearId, termId } = opts;` — `opts.schoolId` is never
  used, and `gradeWhere()` (`:507-519`) filters only on `tenantId` + `academicYearId`. Correct today only because
  `AcademicYear` is school-scoped; a dead parameter that reads like a scope guard is a trap for the next editor.
- **`school-performance-drilldown.service.ts:265-287, 324-347, 380-402` — unbounded in-memory aggregation.**
  L1/L2/L3 each `findMany` **every** `Grade` row of the academic year (no `take`, no `select` narrowing beyond the
  nested include) and bucket in JS. With 513 grades in this env it is fine; at real scale (10⁵–10⁶ grades) this is an
  OOM/latency cliff. There is no snapshot read path (documented at `:100-110` as an intentional grain mismatch), so it
  will never get cheaper.
- **`school-performance-drilldown.service.ts:248` — bare `catch { recomputing = false; }`.** A DB error in
  `resolveFreshness` is swallowed with no log; the chip silently claims "not recomputing".
- **`apps/web/src/app/admin/analytics/page.tsx:56-73` — sequential request waterfall.** When drilled below L1 the page
  `await`s the drill-down request, *then* `await`s a second full drill-down for the KPI strip. Two sequential
  round-trips where `Promise.all` would do one; each one re-runs the unbounded aggregation of the previous bullet.

### Backend-only in this area
- `GET /api/v1/analytics/snapshots/recompute-status` and `POST /api/v1/analytics/snapshots/rebuild`
  (`analytics.controller.ts:268` / `:283`, `snapshot-ops.service.ts` 226 l.) are **backend-only**: `grep -rn
  "snapshots/rebuild\|recompute-status" apps/web/src` → **0 hits**. The whole E6-S5 "admin operability surface" ships
  with no UI. The `SnapshotRecomputeStatusResponse.recent[]` feed, `oldestPendingAt`, and the manual-rebuild verb are
  unreachable by any operator.
- `analytics.controller.ts:283-285` — `POST …/snapshots/rebuild` is a **write** gated on the **read** permission
  `schools.read` (deliberate per the docblock, "NO new permission"). Any holder of `schools.read` can enqueue a
  whole-tenant snapshot fan-out. Authorization smell, not a hole (tenant is server-derived, ids are `assertInTenant`-ed
  at `:216-225`).

---

## 2. `/admin/exports` — Exports & Rapports

Files: `page.tsx` (628 l.), `ExportLauncher.tsx`, `ExportsFilters.tsx`, `ExportDownloadButton.tsx`,
`ExportsRefresher.tsx`, `actions.ts`, `types.ts`
API: `exports.controller.ts` (82 l.), `exports.service.ts` (629 l.), `exports.types.ts`
Worker: `apps/worker/src/modules/exports/exports.processor.ts` + 5 generators

### Control inventory
| Control | Where | Calls | Verdict |
|---|---|---|---|
| 4 KPI cards (générés / bulletins PDF / Excel / en cours) | page.tsx:398-416 | derived from the fetched slice | **exists-but-incomplete** — computed over ≤100 rows, only "EXPORTS GÉNÉRÉS" uses the true server `total` |
| Failed-export alert strip | page.tsx:419-436 | derived | fully operational |
| Launcher: 5 buttons (Notes / Bulletins / Inscriptions / Présences / Audit) | ExportLauncher.tsx:109-136 | `createExportAction(code, {})` | **exists-but-incomplete** — see defects |
| Search (fichier / demandeur) | ExportsFilters.tsx:94 | URL `?q=` | exists-but-incomplete (client-side over ≤100 rows) |
| Filter: période (24h/7d/30d/90d) | ExportsFilters.tsx:100-110 | URL `?period=` | idem |
| Filter: type (5 kinds + 3 extension groups) | ExportsFilters.tsx:111-121 | URL `?kind=` | idem |
| Filter: statut (6 buckets incl. `inflight`/`completed`) | ExportsFilters.tsx:122-132 | URL `?status=` | idem |
| Filter: demandeur (only when >1 requester) | ExportsFilters.tsx:133-144 | URL `?requesterId=` | idem |
| Réinitialiser | ExportsFilters.tsx:169-177 | `router.push(pathname)` | fully operational |
| Table cols: Fichier, Type, Taille, Demandé par, Date, Statut, Actions | page.tsx:512-518 | — | fully operational |
| Day/month grouping headers + per-group inflight/failed chips | page.tsx:488-507 | — | fully operational |
| Télécharger (per row, succeeded only) | ExportDownloadButton.tsx | `fetchSignedUrlAction` → `GET /exports/:id/download-url` | fully operational |
| Pagination (20/page) | page.tsx:599-606 | URL `?page=` | exists-but-incomplete (max 5 pages ever) |
| Auto-refresh 3 s while inflight, visibility-aware | ExportsRefresher.tsx | `router.refresh()` | fully operational |
| Empty states (2 copies: no exports / no match) | page.tsx:465-481 | `EmptyState` | fully operational |
| Error state | `safe()` page.tsx:45-52 | → empty list | exists-but-incomplete |
| Sort options / bulk actions / retry-failed / delete | — | none | **missing** — the alert strip at page.tsx:431-433 tells the admin to "relancer le job depuis la file", but **no retry control exists anywhere** |
| Server guard | `exports.controller.ts:37,51,67,75` `@RequiresPermission('exports.execute')` | — | present |

### Defects
- **`apps/web/src/app/admin/exports/page.tsx:59 + :257` — every filter, the search, the pagination and 3 of 4 KPIs
  operate on a hard 100-row window.** `FETCH_LIMIT = 100`, `GET /exports?limit=100&offset=0`, then all filtering is
  in-memory. `Pagination` at `:599` is fed `totalFiltered` (≤100) so it can never reach page 6. On a tenant with 500
  exports, "filter: En échec" silently means "En échec among the 100 most recent". The server (`exports.controller.ts:53`)
  supports `offset` — the page never sends one.
- **`ExportLauncher.tsx:78` — `createExportAction(code, {})` sends empty parameters for all 5 kinds; there is no
  parameter UI at all.** The button copy promises scoping the server does not receive:
  `:21` "toutes les classes de l'année active", `:28` "première classe + dernier trimestre par défaut",
  `:42` "sur les 30 derniers jours", `:49` "sur les 90 derniers jours". No class picker, no term picker, no date range.
  Classify: **exists-but-incomplete**.
- **`apps/worker/src/modules/exports/generators/grades-xlsx.generator.ts:35` — silent `take: 50` truncation.**
  The "Notes (Excel)" export is advertised as "toutes les classes de l'année active" but caps at 50 class sections with
  no warning in the file, no `errorMessage`, no UI hint. Silent data loss in a document teachers act on.
- **`grades-xlsx.generator.ts:43-75` — N+1 in the generator.** For each of up to 50 classes it runs 3 more queries
  (enrollments, assessments, grades) ⇒ up to 151 round-trips per export.
- **`exports.types.ts:49-56` — `parameters` is `@IsObject()` with no shape validation and `schoolId` is `@IsUUID()`
  with no in-tenant check.** `exports.service.ts:47` does `args.dto.schoolId ?? args.schoolIdFallback` and forwards it
  straight to the worker payload. Every generator re-applies `where: { tenantId }` so there is **no cross-tenant leak**,
  but a client-supplied `schoolId` is used unvalidated as a scope — directly inconsistent with the sibling
  `SnapshotOpsService.assertInTenant` (`snapshot-ops.service.ts:216-225`) which 404s a foreign id. Hardening gap.
- **`exports.controller.ts:50-81` — three read endpoints (`GET /exports`, `GET /exports/:id`,
  `GET /exports/:id/download-url`) are gated on the *execute* permission.** No read-only role can list exports.
- `exports.service.ts:440` `await Promise.all(rows.map((row) => this.toDto(row)))` — `toDto` (`:560`) is `async` but
  contains no `await`. Harmless, but the `Promise.all` is noise around a pure function.

### Fully operational (verified against live data)
`export_job` = 5 rows, all `succeeded`, non-zero `file_size_bytes` (2.1 MB PDF, 487 KB XLSX). The BullMQ→MinIO→signed-URL
pipeline demonstrably works end-to-end.

---

## 3. `/admin/imports` (+ `/new`, `/[id]`) — Imports en lot

Files: `page.tsx` (562 l.), `ImportsFilters.tsx`, `new/page.tsx`, `new/ImportWizard.tsx` (279 l.),
`[id]/page.tsx` (1311 l.), `[id]/ApplyControls.tsx`, `[id]/ConflictResolver.tsx`, `[id]/RowsFilters.tsx`,
`[id]/ImportStatusPoller.tsx`, `actions.ts`
API: `imports.controller.ts` (142 l.), `imports.service.ts` (500 l.), `packages/imports-core` (5 handlers + engine)
Worker: `apps/worker/src/modules/imports/imports.processor.ts`

### Control inventory — list page
| Control | Where | Verdict |
|---|---|---|
| 4 KPIs (réussis / lignes importées / à confirmer / erreurs) | page.tsx:280-297 | fully operational |
| "à confirmer" + "en échec" action strips w/ deep links | page.tsx:301-348 | fully operational |
| Search (nom de fichier only) | ImportsFilters.tsx:80 | fully operational, in-memory |
| Filter: type (facets derived from data, with counts) | ImportsFilters.tsx:85-97 | fully operational |
| Filter: statut (4 buckets) / période (4) / mode (2) | ImportsFilters.tsx:98-133 | fully operational |
| Réinitialiser | — | **missing** (`primaryAction={null}` at ImportsFilters.tsx:143 — unlike the exports strip) |
| Day/month grouped list with per-group chips | page.tsx:385-421 | fully operational |
| Row: type badge, mode badge, filename, row-tally line, status pill, time, "Détail" link | page.tsx:437-538 | fully operational |
| "Nouvel import" CTA | page.tsx:270-276 | fully operational |
| Empty states (2 copies) | page.tsx:365-382 | fully operational |
| Error state | `safe()` page.tsx:41 | exists-but-incomplete |
| Sort / bulk actions / pagination | — | **missing** (server caps at 100 — `imports.service.ts:193`) |

### Control inventory — `/admin/imports/new` wizard
| Control | Where | Verdict |
|---|---|---|
| Type cards (5 handlers: élèves, classes, matières, parents, inscriptions) | ImportWizard.tsx:91-117 | fully operational |
| Expected-columns chips + notes | :120-142 | fully operational |
| "Télécharger un template CSV pré-rempli" | :73-75, :143-150 | **visible-but-non-functional** — see defects |
| Drag-drop + click file picker, 5 MB client guard | :173-201 | fully operational |
| CSV preview (5 lines) | :203-212 | fully operational |
| Back / "Valider et continuer" | :214-231 | fully operational |
| 4-step `Stepper` | :238-278 | **visible-but-non-functional** — steps 3 & 4 are unreachable |

### Control inventory — `/admin/imports/[id]`
| Control | Where | Verdict |
|---|---|---|
| 4 KPIs (total / valides / invalides / appliquées) | page.tsx:543-581 | fully operational |
| Répartition ProgressBars | :583-613 | fully operational |
| `LiveProgressStrip` (queued indeterminate / applying %) + `role=status` | :989-1063 | fully operational |
| `ImportStatusPoller` (2.5 s, only while queued/applying) | ImportStatusPoller.tsx | fully operational |
| `ReconciliationPanel` (5 KPI cards, deep-linking `?reconciliation=`) | :1081-1147 | **placeholder in the running stack** — `import_row.reconciliation` does not exist in the live DB ⇒ `deriveByClass` returns `null` ⇒ panel never renders |
| `AbsentFromSourcePanel` | :1156-1205 | **placeholder** — reads `batch.origin === 'oneroster'`; no `origin` column, no OneRoster path live |
| `ConflictResolver` drawer (keep-current / take-source) | ConflictResolver.tsx | **placeholder** — needs `reconciliation='conflict'` + `POST …/conflicts/:rowId/resolve` (404 live) |
| `ApplyControls`: 2 radio modes + Appliquer | ApplyControls.tsx:1-107 | fully operational |
| `RollbackBlock` + `RollbackButtonClient`, 24 h window w/ countdown | :1258-1310 | fully operational |
| Rows table cols: Ligne, Statut(+recon chip+entity id), Données(5-field dl + diff), Erreurs | :780-796, :900-987 | fully operational (recon chip inert live) |
| Rows filters: statut(6) / bilan(5) / champ-en-erreur facets / recherche | RowsFilters.tsx | fully operational |
| "Erreurs par champ" facet cards | :679-706 | fully operational |
| Timeline (uploaded→validated→queued→applied/rolled_back/failed) | :335-417, :709-728 | fully operational |
| En-têtes manquants warning | :721-726 | fully operational |
| Pagination (50/page) | :798-807 | fully operational (client-side) |
| Empty state | :764-776 | fully operational |
| Error state | — | **defective** — see defects |

### Defects
- **`apps/web/src/app/admin/imports/new/ImportWizard.tsx:73-75` — the template-download button cannot work.**
  ```ts
  window.open(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/imports/templates/${type}`);
  ```
  A browser `window.open` sends no `Authorization` header. Auth in this app is a **Bearer token held in the NextAuth
  server session** and injected only by the server-side `api()` helper (`apps/web/src/lib/api-client.ts:48`) — there is
  no cookie the API accepts. The endpoint is `@UseGuards(JwtAuthGuard, PermissionsGuard)` +
  `@RequiresPermission('imports.execute')` (`imports.controller.ts:60-61`) ⇒ guaranteed **401**.
  Classify: **visible-but-non-functional**.
- **`ImportWizard.tsx:38` vs `:239-244` — dead wizard steps.** State is `useState<1 | 2>`; the `Stepper` renders four
  steps ("Type, Upload, Preview, Appliquer"). Steps 3 and 4 can never be `active` or `done`. `new/page.tsx:31` doubles
  down: "Wizard 4 étapes". The real flow is 2 steps then a redirect to `/admin/imports/[id]`.
- **`apps/web/src/app/admin/imports/[id]/page.tsx:435` — no error boundary on the primary fetch.**
  `const batch = await api<BatchDetail>(...)` is **not** wrapped in the `safe()` helper every sibling page uses
  (cf. `imports/page.tsx:41`, `exports/page.tsx:45`, `analytics/page.tsx:14`). `ImportsService.getBatch`
  (`imports.service.ts:184-186`) throws `NotFoundException` on an unknown id and `ForbiddenException` on a cross-tenant
  id ⇒ any bad/foreign id in the URL renders the generic `admin/error.tsx` crash screen instead of a 404 page.
- **`imports.service.ts:185` — `ForbiddenException` on tenant mismatch is an existence oracle.** A foreign id returns
  403 while an unknown id returns 404, so a caller can enumerate valid batch ids of other tenants. Every sibling service
  in this domain uses 404-for-both (`exports.service.ts:407`, `snapshot-ops.service.ts:224`).
- **`imports.service.ts:178-183` + `223`, `367` — the full row set is loaded to answer trivial questions.**
  `getBatch` always does `include: { rows: { orderBy } }` with no `take`. `MAX_ROWS = 5000` (`:30`), so:
  `apply()` (`:223`) loads 5 000 rows purely to compute `invalid` (`:229`) where a `count()` would do;
  `resolveConflict()` (`:367`) loads 5 000 rows to `.find()` one; and `GET /imports/:id` ships all 5 000 rows (payload +
  errors JSON) to the browser on **every** 2.5 s poll tick of `ImportStatusPoller`.
- **`imports.service.ts:439` — fabricated audit actor role.** `actorRole: 'school_admin'` is hardcoded in the
  `import.conflict.resolve` audit row instead of being derived from the JWT. Compare `snapshot-ops` which derives it
  (`analytics.controller.ts:293-297`) and `parent-exports`/`teacher-exports` which use
  `deriveAlertActorProvenance(jwt)`. The append-only audit trail records a role the actor may not hold.
- **`apps/web/src/app/admin/imports/[id]/page.tsx:63-71` — `TYPE_LABEL` is missing `enrollments`.** The list page
  (`imports/page.tsx:56`) maps `enrollments → 'Inscriptions'`; the detail page's map does not, so
  `TYPE_LABEL[batch.type] ?? batch.type` (`:497`) renders the raw English enum `enrollments` in the page subtitle chip.
- **`imports.service.ts:96-99` — dead computation with a stale comment.** `missing` is computed from
  `handler.template.headers` (which include optional columns), the comment says "Only warn (not block)", but nothing
  warns at upload time — it is persisted to `summary.missingHeaders` and rendered only in a sidebar box
  (`[id]/page.tsx:721-726`) *after* the user has already committed the file.
- **`ApplyControls.tsx:26` and `:184`** use native `confirm()` / `alert()` for the two most destructive verbs in the
  domain (apply, rollback) while the design system ships a `ConfirmDialog` primitive that the remediation surface uses
  (`RemediationCatalogueManager.tsx:398`). Inconsistent + not focus-trapped / not screen-reader friendly.
- **`new/ImportWizard.tsx:24-34` — icon/gradient maps cover 3 of the 5 registered handlers.**
  `packages/imports-core/src/handlers/index.ts` registers `students, classes, subjects, parents, enrollments`;
  `TYPE_ICONS`/`TYPE_GRADIENT` only map the first three, so "Parents" and "Inscriptions" render a generic grey
  `FileText` card in an `sm:grid-cols-3` grid. Also `ImportTypeMeta.icon` is fetched from the API
  (`imports.service.ts:48`) and never used.

---

## 4. `/admin/integrations` — OneRoster

Files: `page.tsx` (85 l.), `IntegrationsManager.tsx` (477 l.), `integrations-actions.ts`, `types.ts`
API: `integrations.controller.ts` (109 l.), `integrations.service.ts` (648 l.), `oneroster.adapter.ts` (219 l.)

### Control inventory
| Control | Where | Verdict |
|---|---|---|
| Source cards (label, kind, last-sync, "Identifiant sécurisé", status badge, lastError) | IntegrationsManager.tsx:94-166 | **non-functional live** (list route 404s) |
| "Connecter une source" → `ConnectDrawer` | :77-83, :180-333 | non-functional live |
| ConnectDrawer fields: kind toggle (csv/rest), Nom (required, ≤120), URL de base (required iff REST), Clé d'accès (password, `autoComplete=off`) | :241-319 | client validation at :205-212; server re-validates `integrations.service.ts:92-98` |
| "Synchroniser" → `SyncDrawer` | :145-151, :345-476 | non-functional live |
| SyncDrawer: 3 file inputs (users.csv / classes.csv / enrollments.csv) | :339-343, :422-447 | **frontend-incomplete** vs. the DTO |
| "Voir le dernier import" → `/admin/imports/:lastBatchId` | :152-160 | non-functional live |
| Empty state | :86-92 | fully operational |
| "indisponible" fallback | page.tsx:67-77 | **defective** — see defects |
| Server guard | `integrations.controller.ts:74,82,90,99` `@RequiresPermission('integrations.write')` | present (a **write** permission gates the two GET reads) |
| Credential handling | `integrations.service.ts:106-108`, DTO `hasCredential` only | correct — the secret is never returned |

### Defects
- **The entire surface is non-functional in the running stack.** `GET /api/v1/integrations/oneroster` → **404**
  (route absent from the stale API build) **and** the `roster_source` table does not exist in the live DB
  (`apps/api/prisma/schema.prisma:785-805` declares it; `pg_tables` has 52 tables, none of them `roster_source`).
  Classify: **placeholder/mock** end-to-end today.
- **`apps/web/src/app/admin/integrations/page.tsx:34-40` — the failure mode lies to the operator.** Any `ApiError`
  (404 route-missing, 403 permission-denied, 500) is mapped to `unavailable = true`, which renders
  "Cette fonctionnalité nécessite une mise à jour de la base de données" (`:74-76`). Right now the cause is a *missing
  route*, not a missing migration — the message sends the admin to the DBA for a deploy problem.
- **`IntegrationsManager.tsx:339-343` — `BUNDLE_FIELDS` exposes 3 of the 6 files the API accepts.**
  `OneRosterBundleDto` (`integrations.controller.ts:41-48`) accepts `users, classes, enrollments, courses,
  academicSessions, orgs`; the drawer only ever uploads the first three. `courses`/`academicSessions`/`orgs` are
  **backend-only**.
- **`oneroster_rest` is a selectable source kind that can never sync.** The connect drawer accepts it
  (`:244-266`, labelled "Prochainement"), the service persists it (`integrations.service.ts:110-121`), and the sync path
  hard-rejects it (`integrations.service.ts:165-171`, mirrored client-side `IntegrationsManager.tsx:367-369`).
  A user can therefore create a permanently unusable source. Classify: **visible-but-non-functional** (labelled).
- **`integrations.service.ts:107` — `sealCredential(tenantId, schoolId)` is a stub by its own docblock**
  (`:102-105`: "the real value would be sealed in the platform secret store at pull time"). The submitted credential is
  discarded; only an opaque ref derived from ids is stored. The UI tells the user
  "Stockée de façon sécurisée côté serveur — jamais réaffichée" (`IntegrationsManager.tsx:313-316`), which overstates
  what happens. Harmless today (CSV bundles ride the request), but it is a promise the code does not keep.

---

## 5. `/admin/remediation` — Soutien scolaire

Files: `page.tsx` (223 l.), `RemediationCatalogueManager.tsx` (843 l.), `remediation-actions.ts`, `slot-format.ts`
API: `remediation.controller.ts` (1097 l.), `admin-remediation.service.ts` (664 l.), `booking.service.ts`,
`teacher-remediation.service.ts`, 7 DTOs
Worker: `apps/worker/src/modules/remediation-sweep/remediation-sweep-cron.service.ts` (177 l.)

### Control inventory
| Control | Where | Verdict |
|---|---|---|
| 4 KPIs (publiés / en attente / plans actifs / séances réservées) | page.tsx:118-138 | **non-functional live** (`/remediation/admin/overview` + `/admin/tutors` both 404) |
| "Besoins d'accompagnement par matière" cards + "Capacité à renforcer" badge | page.tsx:141-205 | non-functional live |
| Search intervenant | RemediationCatalogueManager.tsx:302-309 | client-side, correct |
| Filter: matière | :313-325 | client-side |
| Filter: statut (all/published/retired) | :326-335 | client-side |
| "Ajouter un intervenant" → `TutorFormDrawer` | :338-350, :417-667 | wired |
| DataTable cols: Intervenant·e(+type badge), Type, Matières(3 + overflow), Modalité, Créneaux(count + rés.), Statut, actions | :152-279 | wired |
| RowActions: Publier / Retirer(→ConfirmDialog) / Modifier / Ajouter un créneau | :234-277 | wired |
| TutorFormDrawer fields: type (3, immutable on edit), enseignant select \| nom libre (≤160), matières multi-toggle (≥1), présentation (≤500), modalité (3), publier checkbox | :513-656 | validation at `:455-457`; server re-validates `create-admin-tutor.dto.ts` |
| PublishSlotDrawer fields: kind (hebdo/ponctuel), jour, début, fin, date-heure, places (1-50) | :728-831 | validation `:694`; server `admin-upsert-availability.dto.ts` |
| Retire `ConfirmDialog` | :398-408 | correct |
| `role=status` live region for action results | :284-298 | correct |
| Empty state | :356-363 | correct |
| Error state ("Le catalogue n'a pas pu être chargé") | page.tsx:109-113 | correct — this page *does* degrade honestly (contrast §4) |
| **Edit an existing slot** | — | **backend-only** — see defects |
| **Deactivate a slot** (`active:false`) | — | **backend-only** |
| **List / inspect a tutor's slots** | — | **missing** (only a count is shown) |
| **Close / reopen a plan** | — | **backend-only** (`PATCH /remediation/admin/plans/:id/close`, `.../reopen` — `remediation.controller.ts:410,425`) |
| Server guards | `remediation.controller.ts:696,719,733,776,816,856` all `@RequiresPermission('remediation.manage')` | present & correct |

### Defects
- **The whole page is dead in the running stack.** `GET /api/v1/remediation/admin/tutors` → 404,
  `GET /api/v1/remediation/admin/overview` → 404 ⇒ `page.tsx:64` `loadFailed` is always true ⇒ only the intro blurb and
  the red "Le catalogue n'a pas pu être chargé" banner render. (Same root cause as §0.1.)
- **`RemediationCatalogueManager.tsx:30` — `editSlotAction` is imported and never used.**
  `grep -rn "editSlotAction" apps/web/src` → the export (`remediation-actions.ts:119`) and this import; **zero call
  sites**. The backend `PATCH /remediation/tutors/:tutorId/availabilities/:id`
  (`remediation.controller.ts:855-858`, with the capacity-floor 422 guard) is therefore **backend-only**: an admin can
  create a slot but can never change its capacity, time, or deactivate it. Dead import + missing feature.
- **`remediation-actions.ts:38-47` — `PublishSlotInput.active` and `.endsAt` are declared and never sent.**
  `PublishSlotDrawer.submit` (`RemediationCatalogueManager.tsx:698-701`) sends
  `{kind, weekday, startTime, endTime, capacity}` or `{kind, startsAt, capacity}` — a `one_off` slot is always created
  with `endsAt = null` even though the DTO accepts it (`admin-upsert-availability.dto.ts` `endsAt?`), and `active` can
  never be set.
- **`apps/web/src/app/admin/remediation/slot-format.ts:28` — `formatSlotLabel` + `AdminSlotShape` are dead code.**
  The only importer of this module (`RemediationCatalogueManager.tsx:38`) takes just `costKindLabel, tutorTypeLabel`.
  The slot-label formatter exists because no surface renders slots (previous bullet).
- **`apps/api/src/modules/remediation/dto/admin-upsert-availability.dto.ts:8` — `IsUUID` imported, never used.**
  Same unused import in `create-admin-tutor.dto.ts` is *used*; this one is not.
- **`remediation.controller.ts:537-615` — four teacher **write** routes ride the read permission `remediation.read`**
  (`POST teacher/availabilities`, `PATCH teacher/availabilities/:id`, `PATCH teacher/bookings/:id/transition`, plus the
  `GET teacher` surface). Parents hold `remediation.read` (`permissions.constants.ts:274`). Verified **not exploitable**:
  `TeacherRemediationService.upsertAvailability` (`teacher-remediation.service.ts:243-260`) requires a `TeacherProfile`
  for the caller and re-checks `teachesSubject` before any write. Authorization smell (coarse permission carrying an
  ABAC-only wall), not a hole — but the guard annotation no longer describes the authority.
- **`page.tsx:57-62` — 4 parallel server fetches per render** (`admin/tutors`, `admin/overview`, `/subjects`,
  `/teachers?active=true`). Correct use of `Promise.all`; noted only because `/subjects` and `/teachers` are fetched
  in full with no pagination to populate two `<select>`s.

---

## 6. Worker (`apps/worker/**`)

### 6.1 ★ Confirmed live defect — the snapshot drain can never mark a repeated scope `done`

**`apps/worker/src/modules/analytics-snapshots/snapshot-drain-cron.service.ts:501-504`**

```ts
await this.prisma.snapshotRecomputeTrigger.updateMany({
  where: { id, tenantId },
  data: { status: 'done', processedAt: new Date() },
});
```

The table carries `@@unique([tenantId, coalesceKey, status])` — verified live:
`"snapshot_recompute_trigger_tenant_id_coalesce_key_status_key" UNIQUE, btree (tenant_id, coalesce_key, status)`.
The index exists to **coalesce `pending` rows**, but it constrains *every* status, including the terminal `done`.

So the second time the same scope is recomputed (a second grade publish on the same class × subject × year), the
flip-to-`done` collides with the *first* trigger's `done` row. Live proof from the running DB:

```
 status |                              coalesce_key
--------+------------------------------------------------------------------------------
 done   | 60c96d78…|grade_published|50532cbb…|3c662f4d…|e79c4284…|-|-
 failed | 60c96d78…|grade_published|50532cbb…|3c662f4d…|e79c4284…|-|-      <-- same key
```

```
last_error: Invalid `this.prisma.snapshotRecomputeTrigger.updateMany()` invocation in
            /app/src/modules/analytics-snapshots/snapshot-drain-cron.service.ts:501:52
            Unique constraint failed on the fields: (`tenant_id`,`coalesce_key`,`status`)
attempts: 5   enqueued_at: 2026-06-07 09:36   processed_at: 2026-08-01 20:28
```

Blast radius:
1. `recomputeScope` at `:499` **already succeeded** — the snapshots are correct — yet the trigger is recorded `failed`.
2. The retry path at `:509-518` re-runs the whole recompute up to `MAX_ATTEMPTS = 5` times, each time redoing the work
   and each time colliding, before parking.
3. `reviveFailedTriggers()` (`:227-245`) resurrects any `failed` row older than 60 min with `attempts = 0` — so this is
   an **infinite hourly loop of wasted recomputes**. `enqueued_at` is 2026-06-07 but `processed_at` is *today*.
4. `GET /analytics/snapshots/recompute-status` (`snapshot-ops.service.ts:45`) reports a permanent phantom
   `failed: 1`. Every worker tick logs `"failedBacklog":1` forever (verified in `docker logs pilotage_worker`).
5. The same collision is latent on the failure branch at `:509-518` (`status: parked ? 'failed' : 'pending'`).

Fix shape: exclude terminal states from the unique index (partial index `WHERE status = 'pending'`), or delete/archive
the trigger instead of flipping it to `done`, or stamp a per-run discriminator into `coalesceKey` on completion.

### 6.2 `analytics.service.ts:3136-3140` — three identical sparkline queries, three mislabelled series
```ts
const [students, newStudents, activeStudentsSpark] = await Promise.all([
  this.sparkline({ tenantId, schoolId, model: 'student', sinceDays: 30 }),
  this.sparkline({ tenantId, schoolId, model: 'student', sinceDays: 30 }), // same data, KPI labels differ
  this.sparkline({ tenantId, schoolId, model: 'student', sinceDays: 30 }),
]);
return { …, trends: { students, newStudents, activeStudents: activeStudentsSpark }, … };
```
`/admin/students` therefore shows the **identical curve** under "Nouveaux ce mois" and "Élèves actifs" as under total
students — the sparklines do not mean what their labels say. Plus 3× the same full-table scan
(`sparkline` at `:2979-2986` has **no `createdAt` bound in the WHERE** — it reads every `Student` row of the tenant).

### 6.3 Other worker observations
- `snapshot-drain-cron.service.ts:258-320` `pruneOrphanSnapshots` samples `studentGlobalSnapshot` with a bare
  `take: 200` and **no `orderBy`** — the "bounded window" is non-deterministic, so convergence over "several ticks" is
  not guaranteed (the same 200 rows may be sampled forever).
- `snapshot-drain-cron.service.ts:383-387` — inside the backfill loop, one `studentSubjectSnapshot.findFirst` **per
  distinct class × subject** over a 500-grade probe ⇒ classic N+1 inside a cron tick.
- `exports.processor.ts:56` and `:86` update `exportJob` by `id` only (no `tenantId`) — acceptable for a trusted worker
  consuming its own payload, noted for completeness.
- `remediation-sweep-cron.service.ts` is clean: tenant-scoped, re-entrant, idempotent via
  `sourceId = '<planId>:improvement_suggested'`, suggests but never auto-closes. **Fully operational.**
- `imports.processor.ts` (lease-gated single-winner claim, per-row resume) is well built but **cannot run against the
  live DB** — `importBatch.claimedAt` does not exist (§0.2).

---

## 7. Cross-cutting summary of guards

| Surface | Server guard | Client guard | Notes |
|---|---|---|---|
| analytics drill-down | `schools.read` | none | server-component page |
| snapshots rebuild (POST) | `schools.read` | n/a | **write gated on a read permission** |
| exports (all 4, incl. 3 reads) | `exports.execute` | none | reads gated on an execute permission |
| parent exports (4) | `exports.execute.parent` + guardianship ABAC | n/a | **correct**, `parent-exports.controller.ts:62-72` |
| teacher exports (4) | `exports.execute.teacher` + TA-ownership ABAC, server-derived `classSectionId` | n/a | **correct**, `teacher-exports.controller.ts:66-81` |
| imports (7) | `imports.execute` per-route | none | correct |
| integrations (4) | `integrations.write` | none | write permission gates the reads |
| remediation admin (6) | `remediation.manage` | none | correct |
| remediation teacher (4, incl. 3 writes) | `remediation.read` | none | ABAC-walled in service; coarse annotation |

---

## 8. Verdict roll-up

**Fully operational:** analytics drill-down L1–L4 + term filter + breadcrumb; exports enqueue→BullMQ→MinIO→signed URL
(5 live succeeded jobs); exports list/filter/group/paginate within the 100-row window; auto-refresh; imports list +
filters + KPIs; import wizard steps 1–2 + upload + synchronous validation; import detail KPIs/timeline/rows-table/
filters/facets/pagination; apply (async, from-status-guarded claim) + 24 h rollback; live progress strip + poller;
parent-exports and teacher-exports (both ABAC-correct); remediation sweep cron.

**Exists-but-incomplete:** exports filters/search/KPIs/pagination bounded to 100 rows; export launcher with no parameter
UI; grades XLSX capped at 50 classes; analytics/exports/imports error states collapsing to "empty"; remediation slot
management (create only).

**Visible-but-non-functional:** import CSV-template download (401 by construction); import wizard steps 3–4;
`oneroster_rest` source kind.

**Backend-only:** snapshot recompute-status + manual rebuild (no UI at all); remediation slot edit/deactivate;
remediation admin plan close/reopen; OneRoster `courses`/`academicSessions`/`orgs` bundle members; import-batch
`offset` pagination.

**Placeholder / non-functional in the running stack:** entire `/admin/integrations`; entire `/admin/remediation`;
import reconciliation panel; import conflict arbitration; OneRoster absent-from-source panel.

**Defective:** snapshot drain unique-constraint loop (live, permanent); students-aggregate triple sparkline;
imports `[id]` unguarded fetch; imports 403-vs-404 existence oracle; hardcoded `school_admin` audit role;
integrations "needs a migration" misdiagnosis; missing `enrollments` label; unused `editSlotAction` /
`formatSlotLabel` dead code.
