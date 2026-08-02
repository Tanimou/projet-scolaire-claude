# Deep audit — domain `alerts-comms`

**Scope**: `apps/api/src/modules/{alerts,notifications,announcements,messaging}` ·
`apps/web/src/app/admin/{alerts,notifications,announcements,communications,conversations,meeting-requests}` ·
`apps/web/src/app/parent/**` (comms surfaces) · shared `apps/web/src/components/{notifications,meeting-requests,messaging}`.

**Method**: every `page.tsx` + sibling client component read line-by-line; every controller/service/DTO read;
runtime cross-checks against the live stack (`/docs-json` on :4000, read-only `psql` on `pilotage_postgres`).
No writes performed.

**Runtime facts captured** (read-only, 2026-08-01):

```
notification            kind=grade_published 4 (2 unread) | kind=message 3 (2 unread) | kind=alert 2 (2 unread)
conversation_report     0 rows
meeting_request         status=resolved 1 (0 unassigned) ; status=cancelled 0 ; status=open 0
alert_rule              8 rows — enabled: LOW_SUBJECT_AVG, NEGATIVE_TREND, REPEATED_FAILURE
                                 disabled: MISSING_ASSESSMENT, HIGH_ABSENCE, TEACHER_COMMENT_FLAG,
                                           BEHAVIOR_ALERT, IMPROVEMENT
```

OpenAPI surface for the domain (33 operations, all present and reachable):

```
/api/v1/alerts/rules                    GET
/api/v1/alerts/rules/{code}             PATCH
/api/v1/alerts/instances                GET
/api/v1/alerts/instances/{id}/acknowledge|resolve|dismiss   POST
/api/v1/alerts/evaluate                 POST
/api/v1/alerts/parent/{studentId}       GET
/api/v1/alerts/{id}/ack|resolve|dismiss PATCH
/api/v1/alerts/{id}/meeting-intent      POST
/api/v1/meeting-requests                GET
/api/v1/meeting-requests/{id}/resolve   PATCH
/api/v1/notifications                   GET
/api/v1/notifications/unread-count      GET
/api/v1/notifications/{id}/read         POST
/api/v1/notifications/read-all          POST
/api/v1/notifications/preferences       GET
/api/v1/notifications/preferences/{kind} PATCH
/api/v1/announcements                   GET, POST
/api/v1/announcements/unread-count      GET
/api/v1/announcements/preview-recipients GET
/api/v1/announcements/{id}              GET, PATCH, DELETE
/api/v1/announcements/{id}/publish      POST
/api/v1/announcements/{id}/read         POST
/api/v1/messaging/eligible-teachers     GET
/api/v1/conversations                   POST, GET
/api/v1/conversations/reports           GET            ← read-only, no transition verb
/api/v1/conversations/{id}              GET
/api/v1/conversations/{id}/messages     GET, POST
/api/v1/conversations/{id}/read         PATCH
/api/v1/conversations/{id}/report       POST
```

---

## 1. Control-level inventory

### 1.1 `/admin/alerts` — `apps/web/src/app/admin/alerts/page.tsx` (660 L)

Server component, `force-dynamic`. Fires **5 parallel** requests (`page.tsx:107-133`):
`GET /alerts/rules` + `GET /alerts/instances?status={open|acknowledged|resolved|dismissed}&limit=100`.
Failures swallowed to `null` by `safe()` (`page.tsx:53-60`) → silent empty state on API error.

| Control | Where | Wired to | State |
|---|---|---|---|
| KPI "RÈGLES ACTIVES" | `page.tsx:254` | `rules.filter(enabled).length` | operational |
| KPI "À TRAITER" / "EN COURS" / "RÉSOLUES" | `page.tsx:257-284` | `openResp.total` / `ackResp.total` / `resolvedResp.total` | operational |
| Tabs `rules` / `active` / `history` | `AlertsTabsRouter.tsx:22-29` | URL `?tab=` push | operational |
| Per-rule on/off switch | `AlertRuleToggle.tsx:19-31` | `PATCH /alerts/rules/:code {enabled}`, optimistic + rollback | operational |
| "Configurer" drawer | `RuleConfigEditor.tsx` | `PATCH /alerts/rules/:code {enabled,severity,parameters}` | **defective** (§3.1) |
| Drawer fields | `types.ts:117-142` | `threshold`, `delta`, `windowAssessments`, `consecutive`, `count`, `windowDays` — numeric, min/max/step/integer, client-side `validateField` (`RuleConfigEditor.tsx:38-46`) | client-only validation |
| Severity radiogroup (3 options, arrow-key roving) | `RuleConfigEditor.tsx:188-235` | locked to `low` for `IMPROVEMENT` (`:182`) | operational |
| "UI seulement" badge | `page.tsx:361-368` | `RULE_IMPLEMENTED` map (`page.tsx:73-81`) — only `BEHAVIOR_ALERT` lacks an evaluator | honest label |
| "Lancer l'évaluation" | `EvaluateNowButton.tsx` → `POST /alerts/evaluate` | returns `{rulesRun,detected,createdInstances}`, rendered inline | operational |
| "Exporter CSV" | `AlertsExportButton.tsx` | pure client CSV, `;`-delimited, BOM, formula-injection escape (`:21`) | operational (but export ⊆ 100 rows/status, §3.3) |
| Filters: search élève, règle, sévérité, classe, statut | `AlertsFilters.tsx:61-130` | URL params, **filtered in-memory server-side** (`page.tsx:193-202`) | **exists-but-incomplete** (§3.3) |
| Filter chips + "Réinitialiser" | `AlertsFilters.tsx:118-175` | URL delete | operational |
| Table columns (active + history) | `page.tsx:598-606` | Alerte · Élève · Matière · Sévérité · Détectée · Statut · Actions | operational |
| Row actions ack / resolve / dismiss | `AlertInstanceActions.tsx:40-68` | `POST /alerts/instances/:id/{acknowledge,resolve,dismiss}` | operational |
| Empty states | `page.tsx:420-436`, `:472-488` | two variants (no data vs. no filter match) | operational |
| Loading state | `AlertsFilters.tsx:111-115` "Mise à jour…" `aria-live` | operational |
| Error state | per-row inline `<span className="text-rose-600">` (`AlertInstanceActions.tsx:70`) | operational |

Missing controls: no sort, no bulk selection/bulk action, no pagination (hard `limit=100`),
no `resolvedBy` / `acknowledgedBy` column (see §3.9), no per-alert detail view, no date-range filter
on the history tab despite the empty-state copy promising one ("Élargissez **la période**", `page.tsx:484`).

### 1.2 `/admin/notifications` — `page.tsx` (33 L) → `components/notifications/NotificationCenter.tsx` (345 L)

Thin server wrapper. Shared verbatim with `/teacher/notifications` and `/parent/notifications`.

| Control | Where | Wired to | State |
|---|---|---|---|
| Data fetch | `NotificationCenter.tsx:172-176` | `GET /notifications?limit=100` | operational |
| KPI TOTAL / NON LUES / ALERTES / ANNONCES | `:226-237` | in-memory counts over the 100 rows | **exists-but-incomplete** (`message`, `remediation`, `weekly_digest` uncounted) |
| "Tout marquer comme lu" | `MarkAllReadButton.tsx` → `POST /notifications/read-all` | operational |
| Filters: search, statut (lues/non lues), type (6 options), priorité (4 options) | `NotificationsFilters.tsx:18-37` | URL params, in-memory filter (`:196-207`) | **defective** — type list missing 3 live kinds (§3.4) |
| Day buckets Aujourd'hui/Hier/Cette semaine/Ce mois-ci/Plus ancien | `:102-139` | `createdAt` | operational |
| Row click → mark read + navigate `link` | `NotificationListItem.tsx:49-61` | `POST /notifications/:id/read` then `router.push(link)` | operational |
| Kind badge | `NotificationListItem.tsx:90-92` | `KIND_LABEL[kind]` | **defective** — renders empty for `message` (§3.4) |
| Empty states (2 variants) | `:267-284` | operational |
| "Réinitialiser" link | `:258-263` | operational |

No pagination (`limit=100` hard cap, `:173`), no bulk select, no per-kind mark-read, no delete/archive.

### 1.3 `/admin/communications` — `page.tsx` (531 L) + `CommunicationsFilters.tsx` (141 L)

`/admin/announcements` is a bare `redirect('/admin/communications')` (`admin/announcements/page.tsx:8-10`).

| Control | Where | Wired to | State |
|---|---|---|---|
| Data fetch | `page.tsx:148-150` | `GET /announcements` — **unpaginated, returns every row** | perf risk (§3.7) |
| KPI ANNONCES / PUBLIÉES ACTIVES / DESTINATAIRES TOUCHÉS / URGENTES ACTIVES | `:293-313` | in-memory over `all` | operational |
| Action strip (urgentes / brouillons ≥ 3) + 2 deep links | `:317-353` | URL filters | operational |
| Filters: search, statut, priorité, portée (data-derived), épinglées | `CommunicationsFilters.tsx` | URL params, in-memory (`page.tsx:192-210`) | operational |
| Grouping: "Brouillons" bucket first, then month buckets desc | `:216-242` | `publishedAt` | operational |
| Pagination (15/page, group-aware slicing) | `:244-262`, `:505-514` | client-side over the full fetched list | operational |
| Table columns | `:403-409` | Titre · Audience · Priorité · Destinataires · Publication · Statut · Actions | operational |
| Row action "Voir" | `:472-478` | `/admin/announcements/{id}` | operational |
| Row action "Modifier le brouillon" | `:481-488` | **same href as "Voir"** | **visible-but-non-functional** (§3.5) |
| "Nouvelle annonce" | `:283-288` | `/admin/announcements/new` | operational |
| Empty states (2 variants) | `:369-383` | operational |
| Filter-chip recap | `:516-528` | operational |

No delete from the list, no bulk publish, no sort, no server-side search.

### 1.4 `/admin/announcements/new` — `AnnouncementComposer.tsx` (1001 L)

| Field / control | Where | Validation | State |
|---|---|---|---|
| Titre | `:340-347` | `required`, `maxLength=200`, live counter | operational |
| Message | `:356-364` | `required`, `maxLength=10000`, live counter | operational |
| Audience tiles (4) | `SCOPE_TILES :52-82` | `school_wide`, `cycle_scope`, `grade_level_scope`, `class_section_scope` | **incomplete** — `individual_student` / `individual_user` unreachable (§3.6) |
| Cycle / Niveau / Classe select | `:423-486` | `required` when the scope needs it; `scopeReady` gate `:208-219` | operational |
| Priorité tiles (3) | `:496-527` | normal / high / urgent | operational |
| Expiration presets + date input + "Retirer" | `:530-584` | none / 7j / 30j / 90j / custom | operational |
| Épinglage checkbox | `:594-599` | operational |
| Live recipient estimate | `:224-266` | debounced 350 ms `GET /announcements/preview-recipients` via `/api/proxy` | operational |
| Estimate panel + role breakdown | `RecipientEstimatePanel :862-945` | parents / enseignants / admins / autres | operational |
| Live preview card | `PreviewCard :768-860` | operational |
| Hints panel | `HintsPanel :947-999` | operational |
| "Enregistrer en brouillon" / "Publier maintenant" | `:646-671` | `POST /announcements` with `publishNow` | operational |
| Error banner | `:321-329` `role="alert"` | operational |

No attachments UI (backend accepts `attachments[]`, `announcements.controller.ts:52`) — backend-only.
No edit mode: the composer is create-only; `PATCH /announcements/:id` has no caller in the web app.

### 1.5 `/admin/announcements/[id]` — `page.tsx` (691 L)

| Control | Where | Wired to | State |
|---|---|---|---|
| Fetch + 404 | `:176-183` | `GET /announcements/:id`, `notFound()` on 404 | operational |
| Identity badges (statut, audience, priorité, épinglée, expiration) | `:291-317` | operational |
| Draft / expired action strips | `:320-349` | operational |
| KPI DESTINATAIRES / LECTURES / TAUX DE LECTURE / DERNIÈRE LECTURE | `:352-391` | `a.stats.*` | **defective for >500 recipients** (§3.8) |
| Engagement donut + progress bar | `:458-490` | `DonutChart`, `ProgressBar` | operational |
| Attachments list | `:409-438` | renders `attachments[]` if present | frontend-only (never populated) |
| Recipient filters: search, lues/non lues, rôle (data-derived facets w/ counts) | `RecipientsFilters.tsx` | URL params, in-memory (`page.tsx:222-241`) | operational |
| Recipient buckets "Non lues" / "Lues" + tables | `:533-548`, `RecipientsBucket :592-690` | Destinataire · Rôle · E-mail(mailto) · Statut | operational |
| "À relancer" badge on the unread bucket | `:612-614` | no reminder action anywhere | **visible-but-non-functional** |
| "Publier maintenant" (drafts) | `DetailActions.tsx:26-40` | `POST /announcements/:id/publish` | operational, uses `window.confirm` |
| "Supprimer" | `DetailActions.tsx:42-53` | `DELETE /announcements/:id` (hard delete) | operational, uses `window.confirm`/`alert` |
| Empty states (2 variants) | `:524-530`, `:570-587` | operational |

No edit control on the detail page despite the list offering "Modifier le brouillon".
No recipient pagination (server truncates at 500, `announcements.controller.ts:356`).

### 1.6 `/admin/conversations` (modération messagerie) — `page.tsx` (184 L)

3 parallel `GET /conversations/reports?status={open,reviewed,dismissed}&limit=100` (`:54-70`).

| Control | Where | State |
|---|---|---|
| KPI À examiner / Examinés / Classés | `:88-97` | **permanently 0 for the last two** (§3.2) |
| "À examiner" list of `ReportRow` | `:112-117` | operational (read-only) |
| "Historique" section | `:121-130` | **dead — unreachable** (§3.2) |
| `ReportRow`: status badge, thread status, parent ↔ enseignant ↔ élève, reporter, reason, date | `:135-184` | operational |
| Empty state | `:104-109` | operational |
| **Triage actions** | — | **absent**: no "Examiner", no "Classer", no "Suspendre la conversation" |

No filters, no search, no pagination, no link to the reported thread.

### 1.7 `/admin/meeting-requests` — `page.tsx` (54 L) → `components/meeting-requests/MeetingRequestList.tsx` (404 L)

3 parallel `GET /meeting-requests?status={open,resolved,cancelled}&limit=100` (`page.tsx:26-30`).

| Control | Where | State |
|---|---|---|
| KPI À TRAITER / TRAITÉES / CLÔTURÉES | `MeetingRequestList.tsx:127-146` | "CLÔTURÉES" **permanently 0** (§3.10) |
| Section "À traiter" (oldest-first, severity tiebreak) | `:93-101`, `:149-158` | operational |
| Section "Historique" (resolvedAt desc) | `:103-110`, `:161-170` | operational |
| Responsive: `<ul role=list>` cards `<sm`, `<table>` `sm+` | `:216-252` | operational |
| Table columns | `:229-243` | Élève · Alerte · Demandée · Statut · Actions | operational |
| "En attente depuis N jours" pill (≥ 2 j) | `:320-324` | operational |
| Alert context chip (icon + code label + `SubjectChip` + title) | `AlertContext :259-289` | operational |
| Action "Planifier un échange" | `MeetingRequestActions.tsx:63-79` → `PATCH /meeting-requests/:id/resolve` | operational |
| Action "Clôturer" | `MeetingRequestActions.tsx:80-96` | **defective — silently does the same thing as "Planifier"** (§3.10) |
| `aria-live` announce + inline error | `:99-107` | operational |
| Empty states (both sections) | `:206-212` | operational |

No filters, no search, no pagination, no assignee reassignment, no link to the alert or to a conversation.

### 1.8 Parent portal

| Page | Controls present | Notes |
|---|---|---|
| `/parent/notifications` (33 L) | identical shared `NotificationCenter` | inherits §3.4 |
| `/parent/announcements` (202 L) | 4 KPI, filters (search/statut/priorité/portée), `AnnouncementCard` grid 2-col, pagination 10/page, 2 empty states, per-card "Marquer lue" (`POST /announcements/:id/read`) | KPI "URGENTES" labelled *« Priorité haute »* but counts `urgent` only (`:135-137`) |
| `/parent/announcements/[id]` | detail; server auto-marks read (`announcements.controller.ts:339-344`) | operational |
| `/parent/communication` (581 L) | 4 KPI, filters (source/statut/période/recherche), interlocutor cards, month grouping | **reads the same `GET /announcements`** as `/parent/announcements` — duplicate surface, both in the nav (`sidebar-items.ts:246`, `:258`) |
| `/parent/recommendations` (495 L) | child selector, 5 KPI incl. positive `IMPROVEMENT` lane, filters (sévérité/code/matière/statut/recherche), severity sections, `AlertNextSteps` (322 L), `AlertActions` | operational |
| `AlertActions.tsx` | « Marquer comme lue » (`PATCH /alerts/:id/ack`), « Marquer comme traitée » (`PATCH /alerts/:id/resolve`), « Ignorer » + 2-step inline confirm (`PATCH /alerts/:id/dismiss`) | operational — but see §3.9 |
| `AlertNextSteps` + `intent-actions.ts` | « Demander un rendez-vous » → `POST /alerts/:id/meeting-intent`, idempotent, deliberately no revalidate | operational |
| `/parent/messages` (121 L) | inbox via `GET /conversations`, `ThreadList`, "Nouveau message", 3 terminal states (no child / load failed / no thread) | operational; preview is wrong (§3.11) |
| `/parent/messages/new` + `ComposeForm` (339 L) | child + teacher pickers (`GET /messaging/eligible-teachers`), body, `POST /conversations` | operational |
| `/parent/messages/[id]` (281 L) | alert-context note card, `role="log"` stream, day separators, Vu/Envoyé receipt, "Charger les messages précédents" cursor, `ThreadReply`, `ReportThreadDialog` | operational |
| `ThreadReply.tsx` | mark-read on mount, 2000-char composer + counter, read-only banner for `read_only`/`archived`/`blocked` | `archived`/`blocked` branches are **dead** (§3.2) |
| `/parent/settings` (472 L) | notification preferences matrix | Push column `comingSoon`, switch `disabled` (`admin/settings/PreferencesPanel.tsx:394`) — honest |

---

## 2. API-side inventory

| Module | Guards | DTO validation | Service |
|---|---|---|---|
| `AlertsController` | `JwtAuthGuard` + `PermissionsGuard` class-level; `alerts.read`/`alerts.write` for admin routes; `profile.read.self` + guardianship ABAC (`authorizeParentAlertAction`, `:192-212`) for parent routes | `ParseEnumPipe(RULE_CODES)` on `:code`; `UpdateAlertRuleDto` — `@IsOptional()` on `enabled` with **no `@IsBoolean()`** (`alerts.types.ts:77-78`), `parameters` only `@IsObject()` (`:84-86`); `EvaluateAlertsDto.schoolId` `@IsUUID()` | real (936 L): rule materialisation, 7 evaluators wired, `BEHAVIOR_ALERT` stub (`alerts.service.ts:52`), dedup 7 d, guardian fan-out, audit rows |
| `MeetingRequestsController` | `meeting_requests.read` / `.write`; role scope via `scopeFromRoles` (`meeting-requests.service.ts:57-65`) | `ParseIntPipe` on limit/offset; **`resolve` accepts no `@Body()`** (`:74-92`) | real (206 L), one shared `MEETING_REQUEST_INCLUDE`, no N+1 |
| `NotificationsController` | `profile.read.self` / `profile.write.self` | manual `parseInt` clamp 1..100 (`:39`) | real (359 L) |
| `NotificationPreferencesController` | `profile.read.self` / `profile.write.self` | `UpdatePreferenceDto` fully validated (`@IsBoolean` ×3, `@IsIn(NOTIFICATION_CADENCE)`); **`@Param('kind')` cast unchecked** (`preferences.controller.ts:53-54`) | real (338 L); `disabledInAppKeys`, `emailEnabledKeys`, `isEnabled` are **dead** |
| `AnnouncementsController` | `announcements.read` / `.write` | `CreateAnnouncementDto` / `UpdateAnnouncementDto` / `PreviewRecipientsDto` — good coverage; `attachments` only `@IsArray()` of `unknown[]` | thin controller + `AnnouncementRecipientsService` (157 L) |
| `MessagingController` | `messaging.read` / `.write` / `messaging.moderate`; parent-only create (`:87-90`); Zod `safeParse` on every body/query | Zod contracts (`@pilotage/contracts`) — strongest in the domain | real (1162 L): dual-wall ABAC, per-sender rate limit (env-tunable), immutable messages, cursor paging, reports |

---

## 3. Defects (file:line)

### 3.1 Rule-config bounds are not enforced server-side, and the UI's own min is out of sync with the evaluator — an admin can save a threshold the engine silently ignores

`apps/web/src/app/admin/alerts/types.ts:119` declares `LOW_SUBJECT_AVG.threshold` with `min: 0`, and
`RuleConfigEditor.tsx:44` accepts any `n >= field.min`. `UpdateAlertRuleDto.parameters` is only
`@IsObject()` (`apps/api/src/modules/alerts/alerts.types.ts:84-86`) and `AlertsService.updateRule` writes
the JSONB verbatim (`alerts.service.ts:149-151`) — no clamp. But the evaluator rejects it:

```ts
// apps/api/src/modules/alerts/rules/low-subject-avg.rule.ts:17-19
const rawThreshold = Number(params.threshold ?? 10);
const threshold =
  Number.isFinite(rawThreshold) && rawThreshold > 0 && rawThreshold <= 20 ? rawThreshold : 10;
```

Saving `threshold = 0` through the supported drawer stores `{"threshold": 0}`, the rule card renders
`threshold: 0` as the live configuration (`page.tsx:371-373`), and the engine keeps using `10`.
Silent config drift with no warning. The `RuleConfigEditor.tsx:37` comment ("mirrors the server clamp")
and `types.ts:91-93` ("the server still accepts/clamps") are both factually wrong — the *store* clamps
nothing; only each evaluator does, at read time, to a different bound.

Same class: `enabled` has `@IsOptional()` but no `@IsBoolean()` (`alerts.types.ts:77-78`), so
`PATCH /alerts/rules/LOW_SUBJECT_AVG {"enabled":"yes"}` reaches Prisma and 500s instead of 400ing.

### 3.2 Conversation moderation is a write-only queue — `reviewed`/`dismissed`/`blocked` are unreachable

`ConversationReport.status` and `reviewedAt` exist in the model and are surfaced in the DTO
(`messaging.service.ts:1116-1117`), but **no endpoint ever writes them**. The OpenAPI surface confirms
`/api/v1/conversations/reports` is `GET` only. Consequences:

- `apps/web/src/app/admin/conversations/page.tsx:60-69` fires two `GET`s (`status=reviewed`,
  `status=dismissed`) that can only ever return 0 rows.
- `page.tsx:95-96` KPI "Examinés" / "Classés" are permanently `0`.
- `page.tsx:121-130` "Historique" section is dead markup.
- `STATUS_META` (`page.tsx:29-33`) defines labels for two states the app cannot reach.
- `Conversation.status` `'blocked'` / `'archived'` are never written either — `grep "status: 'blocked'"`
  over `apps/api/src` returns nothing — so `ThreadReply.tsx:62-66` and the
  `header.status !== 'blocked'` guard at `parent/messages/[id]/page.tsx:273` are dead branches.

An admin can *see* a safety report and can do nothing about it in-product.

### 3.3 Alert filters, export and totals operate on a truncated ≤100-row window per status

`GET /alerts/instances` supports only `status`, `studentId`, `limit`, `offset`
(`alerts.controller.ts:74-95`). The page requests `limit=100` per status
(`admin/alerts/page.tsx:107-133`) and applies rule/severity/classSection/search filters **in memory**
(`page.tsx:193-202`). With more than 100 open alerts:

- the filter dropdown options themselves are derived from the truncated set (`page.tsx:153-172`), so a
  class or rule beyond row 100 is not even offerable;
- "Exporter CSV" exports the truncated, filtered set (`page.tsx:209-226`) while the KPI shows the true
  `total` — the file and the header disagree;
- the per-severity counter renders `rows.length/totalForSeverity` (`page.tsx:551`) where both numbers
  come from the same truncated array, so it always reads `n/n` and never reveals the truncation.

No pagination control exists on the page.

### 3.4 `NotificationCenter` does not know three notification kinds the backend actually produces — live data renders an empty badge today

`apps/web/src/components/notifications/NotificationCenter.tsx:29-35` declares:

```ts
export type NotificationKind =
  | 'announcement' | 'alert' | 'grade_published'
  | 'enrollment_status' | 'lesson_published' | 'system';
```

Producers that emit kinds outside that union:
- `apps/api/src/modules/messaging/messaging.service.ts:585` → `kind: 'message'`
- `apps/api/src/modules/remediation/remediation.controller.ts:337,470,660,976,1071,1082` → `kind: 'remediation'`
- `apps/worker/src/modules/parent-digest/parent-digest-cron.service.ts:104` → `weekly_digest`

`KIND_LABEL` (`:52-59`) therefore returns `undefined`, which is passed as `kindLabel` (typed `string`)
into `NotificationListItem.tsx:90-92` and rendered as an **empty grey pill**. The icon has a `?? Bell`
fallback (`NotificationListItem.tsx:46`); the label has none.

Confirmed against live data: `SELECT kind, count(*) FROM notification` returns
`message = 3 (2 unread)` in the running database right now.

Knock-on effects: `KIND_OPTIONS` (`NotificationsFilters.tsx:23-30`) has no "Messagerie" entry, so those
rows cannot be filtered; `KIND_VALUES` (`:141-148`) drops an unknown `?kind=` param back to "no filter";
and the KPI row (`:181-183`) counts only `alert` + `announcement`, so `TOTAL` ≠ the sum of the buckets.

### 3.5 "Modifier le brouillon" is a mislabelled duplicate of "Voir" — no announcement edit UI exists

`apps/web/src/app/admin/communications/page.tsx:481-488`:

```tsx
{ id: 'edit', icon: <FileEdit …/>, label: 'Modifier le brouillon', tone: 'cyan',
  href: `/admin/announcements/${a.id}` },      // ← identical to the 'view' href on :477
```

The target (`admin/announcements/[id]/page.tsx`) is a read-only detail page: its only controls are
"Publier maintenant" and "Supprimer" (`DetailActions.tsx:55-86`). `PATCH /api/v1/announcements/:id`
exists on the API and has **zero callers in `apps/web`**. A draft therefore cannot be corrected — only
published as-is or deleted and retyped.

### 3.6 Two announcement scopes are backend-only; the composer cannot reach them

`AnnouncementScope` supports `individual_student` and `individual_user` server-side
(`announcements.controller.ts:636-641`, `announcements.service.ts:43-55`), and both are fully labelled
in the list and detail pages (`admin/communications/page.tsx:47-48`, `admin/announcements/[id]/page.tsx:52-53`).
The composer's own union excludes them:

```ts
// apps/web/src/app/admin/announcements/new/AnnouncementComposer.tsx:26
type Scope = 'school_wide' | 'cycle_scope' | 'grade_level_scope' | 'class_section_scope';
```

There is no way in the admin UI to message a single family or a single staff member. Same for
`attachments` (accepted at `announcements.controller.ts:52`, rendered at
`admin/announcements/[id]/page.tsx:409-438`, never produced by any composer).

### 3.7 `GET /api/v1/announcements` is unpaginated and returns every announcement of the tenant

`announcements.controller.ts:107-118` (admin branch) and `:139-163` (receipt branch) have no `take`.
Three pages fetch the whole list and paginate client-side:
`admin/communications/page.tsx:148-150`, `parent/announcements/page.tsx:87-89`,
`parent/communication/page.tsx:138-140`. Every page load transfers the full announcement history
(including 10 000-char bodies) to compute a 10–15 row page.

### 3.8 Announcement engagement stats are computed from a 500-row truncation, so read-rate is wrong for large audiences

```ts
// apps/api/src/modules/announcements/announcements.controller.ts:352-356
const receipts = await this.prisma.announcementReceipt.findMany({
  where: { announcementId: id }, orderBy: [...], take: 500,
});
```

`stats.total`, `stats.read`, `stats.unread` and `stats.readRate` are all derived from that array
(`:390-394`) rather than from a `count`. For a `school_wide` announcement in a school with more than
500 profiles, the detail page reports `DESTINATAIRES = 500` (`admin/announcements/[id]/page.tsx:353`)
and a read rate computed over an arbitrary 500-row slice ordered `readAt desc` — i.e. biased toward
readers, systematically **over-stating** engagement. The list page's own `_count.recipients`
(`admin/communications/page.tsx:454`) shows the true number, so the two screens contradict each other.

### 3.9 A parent can terminally close a school-generated alert, and the admin UI never shows who did it

`PATCH /alerts/:id/{resolve,dismiss}` are open to any guardian of the child
(`alerts.controller.ts:222-236`, guarded by `profile.read.self` + guardianship ABAC), and
`AlertsService.resolve` writes the terminal status plus `markReadBySource`, which retracts the bell
notification **for every guardian in the tenant** (`alerts.service.ts:278-299`). The alert then leaves
the admin "Alertes actives" tab. The admin table has no `resolvedBy` / `acknowledgedBy` column
(`admin/alerts/page.tsx:598-606`) and the DTO does not even carry those ids
(`alerts.types.ts:107-132`), so the only trace is the append-only `audit_log` row. From the admin's
screen a parent-closed alert is indistinguishable from a staff-closed one.

### 3.10 "Clôturer" on a meeting request does not clôture anything — it resolves, and the UI reports a lie

Client sends a `status` body:

```ts
// apps/web/src/components/meeting-requests/actions.ts:26-35
export async function resolveMeetingRequestAction(id, portal, status: 'resolved'|'cancelled' = 'resolved') {
  const data = await api(`/api/v1/meeting-requests/${id}/resolve`, { method: 'PATCH', body: { status } });
```

The endpoint takes no body at all:

```ts
// apps/api/src/modules/alerts/meeting-requests.controller.ts:74-92
@Patch(':id/resolve')
async resolve(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) { … }
```

and the service hardcodes the transition:

```ts
// apps/api/src/modules/alerts/meeting-requests.service.ts:147-155
data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: args.userProfileId },
```

Clicking « Clôturer » (`MeetingRequestActions.tsx:86`) announces *« Demande clôturée. »*
(`:86`, `aria-live` at `:99-101`) while the row is written as **`resolved`** and re-renders in Historique
labelled *« Traitée »* (`MeetingRequestList.tsx:80`). Consequences:

- `MeetingRequestStatus = 'cancelled'` is unreachable — confirmed: `SELECT status, count(*) FROM
  meeting_request` returns only `resolved`;
- the KPI "CLÔTURÉES" (`MeetingRequestList.tsx:138-145`) is permanently `0`;
- `admin/meeting-requests/page.tsx:29` and `teacher/meeting-requests` each fire a
  `?status=cancelled` request that can never return a row;
- the doc comment at `actions.ts:23-25` ("The optional `status` body lets the same endpoint close a
  request without follow-up") documents behaviour that does not exist, and `actions.ts:13` names the
  wrong permission (`alerts.write`; the real one is `meeting_requests.write`).

### 3.11 Conversation inbox previews are frozen at the first message

```ts
// apps/api/src/modules/messaging/messaging.service.ts:712-713
// Preview comes from `topic` (denormalised at create) — no per-thread join.
lastMessagePreview: r.topic,
```

`topic` is set once at create from the first 80 characters of the opening message
(`messaging.service.ts:304`) and is never updated on send (`:522-525` only touches `lastMessageAt` /
`lastMessageById`). The field named `lastMessagePreview` therefore always shows the *first* message.
The single-thread DTO does it correctly (`:919` reads `conv.messages[0].body.slice(0,140)`), so the
inbox row and the thread header disagree.

### 3.12 Unread-count computation in the inbox fetches every message of every thread on the page

```ts
// apps/api/src/modules/messaging/messaging.service.ts:680-687
const unreadRows = await this.prisma.conversationMessage.findMany({
  where: { tenantId, conversationId: { in: ids }, senderId: { not: args.me.id } },
  select: { conversationId: true, createdAt: true },
});
```

No `take`, no `createdAt` lower bound. The comment at `:678-679` calls this "the bounded shape (one
query, capped by page size)" — it is capped by page size **× messages per thread**, which is unbounded.
A page of 20 threads with 500 messages each pulls 10 000 rows to produce 20 integers. A cheap fix
exists: `createdAt: { gt: min(lastReadAt) }` per-thread, or a `groupBy` with a per-thread `count`.

### 3.13 `PATCH /notifications/preferences/:kind` accepts any string as an enum

```ts
// apps/api/src/modules/notifications/preferences.controller.ts:43-56
async update(@Param('kind') kind: string, …) {
  return this.prefs.update({ …, kind: kind as NotificationKind, patch: dto });
}
```

No `ParseEnumPipe`, no `@IsIn`. An unknown kind reaches `prisma.notificationPreference.upsert`
(`preferences.service.ts:133-142`) and 500s on the Postgres enum. A *valid-but-unlisted* kind
(`remediation`, which is in the Prisma enum and in `NOTIFICATION_KIND_LABEL` but deliberately excluded
from `NOTIFICATION_KINDS`, `preferences.service.ts:10-40`) succeeds and creates a preference row the
user can never see or undo, because `listForUser` iterates `NOTIFICATION_KINDS` only (`:100`).

Related tenant-scoping gap: `findUnique` / `upsert` key on `userProfileId_kind` **without `tenantId`**
(`preferences.service.ts:124-142`) — every other read in the same file pins `tenantId` (`:95`, `:207`,
`:239`, `:281`), so this is an inconsistency, not a deliberate design.

### 3.14 Notification fan-out dedup query is not tenant-scoped

```ts
// apps/api/src/modules/notifications/notifications.service.ts:106-117
const existing = await this.prisma.notification.findMany({
  where: { OR: sourceKeys.map((k) => ({ userProfileId: …, sourceType: …, sourceId: … })) },
```

No `tenantId`, while the sibling `dispatchEmails` explicitly pins it and cites ADR-002 as the reason
(`:193-195`). Same class in `AnnouncementRecipientsService`: `guardiansOfStudents` (`:91-94`),
`studentsOwnProfiles` (`:109-112`), `teachersOfClasses` (`:120-123`) and the enrollment lookup in
`recipientsForClassSections` (`:129-132`) all filter on ids only — `allTenantUsers` (`:82-85`) is the
only method in the file that scopes by tenant.

### 3.15 `super_admin` cannot edit or delete another author's announcement, though the list shows them all

`announcements.controller.ts:527` and `:579`:

```ts
if (a.authorId !== me.id && !(jwt.realm_access?.roles ?? []).includes('school_admin')) {
  throw new BadRequestException("Vous ne pouvez modifier que vos propres annonces.");
}
```

Every other branch in the same controller computes `isAdmin = roles.includes('super_admin') ||
roles.includes('school_admin')` (`:102`, `:227`, `:329`, `:449`). These two checks drop `super_admin`.
Also the wrong exception type — an authorization failure returned as `400`, not `403`.

### 3.16 Announcement notifications deep-link every recipient to the parent portal

```ts
// apps/api/src/modules/announcements/announcements.controller.ts:604-616
link: `/parent/announcements`,
```

`computeRecipients` deliberately includes teachers (`announcements.service.ts:134-142`) and, for
`school_wide`, every active profile including admins (`:81-87`). All of them receive a bell
notification whose "Voir →" navigates into `/parent/announcements`. Compare `messaging.service.ts:539`,
which correctly branches the link per recipient role.

### 3.17 Dead code

| Symbol | File:line | Evidence |
|---|---|---|
| `AnnouncementActions` component (52 L) | `apps/web/src/app/admin/announcements/AnnouncementActions.tsx:9` | `grep -rn AnnouncementActions apps/web/src` → only its own definition; `admin/announcements/page.tsx` is a `redirect()` |
| `NotificationPreferencesService.disabledInAppKeys` | `apps/api/src/modules/notifications/preferences.service.ts:161` | superseded by `inAppPlan` (`:255`); referenced only by a jest mock |
| `NotificationPreferencesService.emailEnabledKeys` | `preferences.service.ts:198` | superseded by `instantEmailKeys` (`:230`); referenced only by a jest mock |
| `NotificationPreferencesService.isEnabled` | `preferences.service.ts:320` | zero callers |
| `AlertsService.ensureAdmin` | `apps/api/src/modules/alerts/alerts.service.ts:933` | zero callers; its own docstring says "no-op for now" |
| `RULE_FN.BEHAVIOR_ALERT` | `alerts.service.ts:52` | rule enableable in the UI, evaluator absent; skipped at `:689-693` (labelled "UI seulement", so honest, but it is a togglable no-op) |
| `ThreadReply` `archived` / `blocked` branches | `apps/web/src/app/parent/messages/ThreadReply.tsx:62-66` | no code path writes those statuses (§3.2) |

### 3.18 Minor / consistency

- `window.confirm` / `window.alert` used for destructive announcement actions instead of the design
  system's dialog: `DetailActions.tsx:28,36,43,48`, `AnnouncementActions.tsx:14,18,22,27`.
- History tab of `/admin/alerts` buckets and displays by `detectedAt` (`page.tsx:509-527`, `:636`), never
  by `resolvedAt`, which is what an admin browsing history needs; the DTO does carry `resolvedAt`
  (`alerts.types.ts:124`) but the web `AlertInstance` type drops it (`admin/alerts/types.ts:6-21`).
- `admin/alerts/page.tsx:484` empty-state copy offers to "élargir la période" — no period filter exists.
- `parent/announcements/page.tsx:135-137` KPI labelled "URGENTES" with subtitle *« Priorité haute »*
  but counts `priority === 'urgent'` only.
- `AnnouncementCard` is an `<article role="link" tabIndex={0}>` containing a nested `<button>`
  (`parent/announcements/AnnouncementCard.tsx:73-83`, `:160-172`) — an interactive control inside a
  role=link, and a non-native link with a manual Enter/Space handler.
- `/parent/announcements` and `/parent/communication` render the same `GET /announcements` payload and
  are both in the parent sidebar (`sidebar-items.ts:246`, `:258`).
- `sidebar-items.ts:232-233` still calls `calendar`, `documents` and `communication` "3 stubs"; all three
  are fully built (`parent/communication/page.tsx` alone is 581 L).
- `AlertsService.acknowledge` issues an `update` even on a no-op (`alerts.service.ts:233-240`), unlike
  `resolve`/`dismiss` which early-return (`:277`, `:329`).
- `MeetingRequestsService.list` is called 3× per page load from both `/admin/meeting-requests` and
  `/teacher/meeting-requests`; one of the three (`cancelled`) is structurally always empty (§3.10).
- `MessagingService.listReports` writes an `AuditLog` row on every non-empty page render
  (`messaging.service.ts:1086-1108`) — moderation-read noise proportional to page refreshes.
