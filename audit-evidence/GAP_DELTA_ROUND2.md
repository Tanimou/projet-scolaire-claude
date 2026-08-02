# GAP DELTA — ROUND 2 (corrected)

**Lakoli vs. « Pilotage scolaire » — what the shallow audit got wrong, and what we actually have to build.**

| | |
|---|---|
| Date | 2026-08-01 |
| Branch | `claude/platform-audit-gap-analysis-216337` @ `a9943ce` |
| Lakoli evidence | 13 specialist deep passes over the shipped Vite build (`lakoli-main.js` 732 KB + **149 lazy chunks**, 3.0 MB). Every French string quoted is **verbatim from the bundle**. |
| Internal evidence | Full source read of 104 web routes + 40 API controllers, live `GET /docs-json` (150 paths / 195 operations), read-only `psql` on `pilotage_postgres`, live route probes. |
| Files | `audit-evidence/lakoli/deep_*.md` (7) · `audit-evidence/internal/deep_*.md` (6) · `lakoli_api_capability-analysis-05.md` · `internal_verified-capability-gaps-02.md` |

**Headline.** Round 1 measured Lakoli's API at **15 endpoints**. The real number is **513 distinct client→API operations** (per-domain deep counts sum to **521** with cross-domain overlap). That is a **34× undercount**. Round 1 also declared three modules blank or "coming soon" — `/conformite`, `/orientation`, `/programmes`. All three are fully built; two are behind a per-tenant entitlement gate that Round 1 mistook for an unbuilt page, and the third is simply filed under a different sidebar label. Our own API exposes **195 operations**. The capability ratio is roughly **2.6 : 1 against us**, and it is worse than that because ~40 % of the delta sits in two domains we have *deliberately* not built (Finance, HR/Payroll) and one we did not know existed (Platform/Billing/Entitlements).

---

# 1. CORRECTIONS

Every claim below was made in the earlier shallow audit and is now proven wrong or materially incomplete. No hedging.

## C-1 — « Lakoli exposes ~15 API endpoints » — **WRONG BY 34×**

**Reality: 513 distinct operations.** Per-domain deep counts:

| Domain | Ops | Domain | Ops |
|---|---|---|---|
| Finance | **105** | Admissions | **71** |
| Pedagogy | **98** | Orientation / Conformité / Vie scolaire | **60** |
| Platform (auth, billing, entitlements, setup, documents, audit) | **92** | Communication | **53** |
| HR & Payroll | **42** | **Total (with overlap)** | **521** |

**Three root causes, all methodological:**

1. The audit grepped **only the entry bundle** for the literal string `/api/`. Lakoli's axios instance carries `/api` as its `baseURL`, so **every module call is written without the prefix** — `ut.get("/auth/mes-espaces")`, not `ut.get("/api/auth/mes-espaces")`. A `/api/` grep structurally cannot find them.
2. The **149 lazy-loaded chunks were never downloaded**. Every per-module endpoint lives there. The entry bundle is routing + shell.
3. `lakoli-main.js` embeds a **generated Orval/react-query client** that declares URLs as *functions* — `const qR=()=>"/api/utilisateurs"` — with `method:"POST"` on a separate line. A naive `.post("/x")` regex finds nothing. This layer alone hides `login`, `logout`, `createUtilisateur`, `toggleUtilisateurActif`, `createParent`, `reconcilierPaiement`, `/api/audit/logs`.

**And 345 is still a lower bound.** The corrected repo-wide regex sweep produced 345; per-domain inspection produced 521. Operations the corrected extraction *still* misses because the path is glued to a query string in a template literal:
`GET /personnel/paies/lot?periode=` · `GET /personnel/presences/jour?date=` · `GET /personnel/presences/anomalies?date=` · `GET /personnel/presences/manuel/lots?status=PENDING_REVIEW` · `GET /personnel/presences/rapport-mensuel?month=` · `GET /sms-logs` · `GET /sms-wallet/recharge/verify?reference=` · `GET /preinscriptions-portail?statut&classeId&depuis` · `GET /relances?eleveId&limit` · `GET /reinscription-suivi/campagnes/derniere` · `GET /eleves/export` · `GET /orientation/campaigns/{id}/export/{listing|statistiques|export-administratif}` · `GET /orientation/campaigns/{id}/export/quitus?dossierId=`.

**Consequence for the roadmap:** every "reach parity with Lakoli in N sprints" estimate built on the 15-endpoint number is void.

## C-2 — « `/app/conformite` is a "Module bientôt disponible" placeholder » — **FALSE**

`/conformite` is `index-Ddm3x_E9.js`, **49 545 bytes, 18 operations**. What Round 1 saw is the **entitlement gate**, verbatim:

> « Module bientôt disponible » / « Le module Conformité est en cours de finalisation. Il sera accessible dès son ouverture officielle. » / « Votre administrateur Lakoli pourra vous informer de la date de disponibilité. »

That screen is rendered by `GET /module-access?module=conformite → accessible:false`. It is **tenant-scoped entitlement, not an unbuilt feature**.

What is actually inside, and was missed entirely:
- A statutory-form engine: profile → « Préparer ce profil » (snapshot + `data_hash`) → contrôles (blocking / warning anomalies) → « Valider et figer » (Direction only, blocked while blocking anomalies exist) → generate XLSX/PDF.
- **Exact derived formulas** recovered: `pourcentage = round(presents/attendus*10000)/100`; `effectifTotalAttendu = effectifPrevisionnelAttenduParClasse * classesPedagogiques - redoublantsProbables`.
- A per-block editable-field whitelist (`H.1`, `ER.1`–`ER.4`, `CAP.1`); everything else is Lakoli-derived and greyed out.
- **Content-addressed idempotent imports**: re-uploading identical bytes returns `reused:true` and replays the existing immutable result; each carries a `comparisonSha256` labelled « Empreinte comparaison ».
- **Server-side magic-byte validation** on uploads, proven by nine client-mapped error codes: `signature_xlsx_invalide`, `signature_csv_invalide`, `formule_interdite`, `macro_interdite`, `type_fichier_interdit`, `fichier_trop_volumineux`, `colonne_matricule_requise`, `profil_import_non_autorise`, `aucune_ligne_acceptee`.
- « **Assistant ActuMoyenne** » — an entire offline sub-product inside `/conformite` that makes **zero network calls**: a frozen profile (`authorityLevel:'interne_test'`, `officialTransmissionSupported:false`) plus a 27-field canonical schema with level- and série-scoped aliases. **Invisible to any network-trace audit.**
- The compliance canevas **consumes HR data** (`personnelActifLakoli`, `couverturePointage`), i.e. HR headcount and time-clock coverage are inputs to a statutory reporting pipeline. That cross-domain coupling was invisible.

## C-3 — « `/app/orientation` renders nothing » — **FALSE**

`index-cRnMt47W.js`, **20 operations**, gated on `orientation_dob`. Full DOB Seconde 2026 campaign engine: publishable référentiels of receiving establishments, campaign with 4 datetime gates, 3ᵉ sync, 7 ranked vœux (3 général + 2 tertiaire + 2 industrielle), preview-then-bulk-apply with a `confirmationToken`, per-dossier validate/reopen with optimistic concurrency, campaign freeze, then Listing / Statistiques / Export DOB / per-pupil Quitus PDF.

Two things a UI crawl could never see:
- A **hidden profile `ci-dob-affectation-6e-session-2026`** exists server-side and is explicitly **filtered out** of the campaign-creation dropdown — a built-but-suppressed 6ᵉ affectation campaign type.
- Bulk apply is **disabled entirely under the official DOB 2026 profile**: « Le traitement de masse est désactivé : l'éligibilité doit être vérifiée individuellement. »

## C-4 — « `/app/programmes` renders nothing » — **FALSE**

It is « **Grilles de programme** »: a manager for the **pre-loaded Ivorian curriculum referential**, with seeding (« Charger les grilles par défaut »), grids per cycle **and per série (A / C / D)**, coefficients, ordering, bulk edit and re-synchronisation of missing subjects. It is **not gated**. It appeared missing because the sidebar files it under **Paramètres → « Matières »**, not under a « Programmes » label.

## C-5 — « Those screens are product defects / placeholders » — **WRONG MECHANISM, AND THE MECHANISM IS ITSELF A CAPABILITY WE LACK**

Lakoli ships **one binary with per-tenant module entitlements**. `GET /module-access/catalog → {catalog, effectiveModules}` drives **47 module codes** mapped from route paths (`t3`). Modules the tenant does not own render **disabled, `opacity-40`, badged « À venir »** — in the desktop sidebar, in the ⌘K palette (`aria-disabled`), and in the mobile bottom nav (where the label is *replaced* by « À venir »).

That is a deliberate **upsell surface**, not a bug. Combined with per-module click telemetry (`Er("app_module_click", {userId, tenantSlug, metadata:{module, path, role}})` → `POST /growth/track`), Lakoli has exactly the instrumentation needed to price and package its tiers. **We have zero feature gating** (0 grep hits for `module-access` or any equivalent).

Only two entries carry an explicit `gatedModule` literal (`orientation_dob`, `conformite`); everything else resolves through the path→code map. So the absence of a `gatedModule` on Admissions or Pedagogy pages is *not* evidence they are placeholders — it is evidence they resolve by path.

## C-6 — « `/admin/settings` — Fully explored, STATUS 200 » — **DEPTH FAILURE**

`apps/web/src/app/admin/settings/page.tsx` renders **28 `<Field>` components, of which 26 are hardcoded string literals and 0 take a dynamic value**. Six of seven tabs are static text. HTTP 200 was mistaken for a working feature.

Worse: the **Sécurité** tab asserts a posture it never verifies — `<Field label="MFA pour admins" value="Obligatoire (à configurer dans Keycloak)" />`. The realm is never queried. `me.controller.ts:85` returns `mfaEnabled: false` hardcoded. If MFA is not actually enforced, this page states a **false control** — a real liability in a procurement questionnaire. The **Données & confidentialité** tab asserts 5-year / 10-year retention periods with no retention job anywhere in the repo.

## C-7 — « Our authorisation model is materially more expressive than Lakoli's » — **TRUE OF THE CATALOGUE, FALSE OF THE ENFORCEMENT**

Round 1 examined authorisation only at the level of the permission catalogue. Beneath it:

- `apps/api/src/modules/students/student-access.service.ts:36-39` returns `{ studentIds: null }` — the documented **"no restriction"** sentinel — for **every teacher**, behind a `// TODO Phase 4: when teaching assignments exist` comment. `teaching_assignment` has **289 rows**, `class_section` 94, `teacher_profile` 188. The precondition is stale, not pending. Every teacher can `GET /api/v1/students` and list **all 2 463 students**, with search and filters, plus open any individual record. This service is the security boundary for **9 modules**.
- The unit test **asserts the hole as intended behaviour** (`student-access.service.spec.ts:86-96`: *"admin / teacher tokens are unrestricted within tenant"*), so CI can never catch it.
- `apps/api/prisma/schema.prisma:892-906` — **`model Role` has no `tenantId`**. `roles.controller.ts:69` lists every role of every tenant; `:154` and `:201` patch and delete cross-tenant. `roles.controller.ts:106` admits it in a comment.
- `roles.controller.ts:110-116` validates only that requested permission codes *exist*. There is **no "you may not grant what you don't hold" check** — a `school_admin` can mint a role carrying `grades.write`, `students.delete`, `guardianships.write`, then self-assign it via `roles.assign`. **Privilege escalation.**
- `POST /api/v1/auth/register-parent` is public, **unthrottled** (`grep -rn "Throttler"` → 0 hits), sets `emailVerified: true`, echoes the email back on 409 (enumeration oracle), and hardcodes `DEMO_TENANT_SLUG = 'demo'`.
- Three endpoints leak cross-family PII to `parent` and `teacher` tokens: `GET /enrollments` (no scope, no pagination, 2 463 rows), `GET /enrollments/roster/:id` (`include: { student: true }` → full row incl. `medicalNotes`), `GET /guardians/guardianships/list` (`include: { guardian: true }`, tenant-only).

Lakoli, by contrast, ships **nominative, time-boxed, domain-scoped habilitations** for sensitive data (`/vie-scolaire/suivi-sensible/permissions*`, with `ecritureScopes ⊆ lectureScopes`, `exportScopes ⊆ lectureScopes`, `valableJusquau`, and a `protectedDemoAccount` hard block) and enforces **four-eyes** on bulk staff-attendance entry and corrections (« Le créateur du lot ne peut pas prendre la décision. » / « Le demandeur ne peut jamais décider sur sa propre correction. »). We have nothing in that class.

## C-8 — « Route returns 200 ⇒ feature works » — **SYSTEMATICALLY WRONG ON OUR OWN PLATFORM**

Round 2 found, in our code, with file:line:

- **`/admin/classes/new` does not exist.** Both the header CTA (`admin/classes/page.tsx:154`) and the empty-state CTA (`:220`) point at it; the segment is swallowed by `[id]/page.tsx`, which does an unguarded `await api('/api/v1/classes/new')` at `:122`. **There is no way to create a class from the UI at all** — the primary CTA renders the error page.
- **`/admin/guardians/[id]` does not exist.** The name link and both row actions (`guardians/page.tsx:191,237,238`) plus `enrollments/page.tsx:276` all 404, while `GET|PATCH|DELETE /api/v1/guardians/:id` all exist and work.
- **`/admin/enrollments` is permanently empty.** It fetches `GET /api/v1/guardians?includePending=true&limit=200` and types it `EnrollmentRequestRow[]`. `guardian` has no `status`, `notes`, `guardian` or `student` column. Every filter matches nothing; all four KPIs and all five tab counts are permanently 0; the CSV export is header-only. `includePending` is not a controller parameter and is silently dropped. **28 `pending` guardianships and 29 review-flagged rows exist in the DB and none are visible.** The page's own footnote admits the actions are unbuilt: *« Les actions Approuver / Rejeter ouvriront un FormDrawer dédié dans la phase R6. »*
- **10 dead internal links**, including a sidebar item (`/admin/reports`), `/{portal}/profile` in every user menu, `/help`, and **`/legal/terms` + `/legal/privacy` on the registration consent line**.
- **`/admin/audit` returns HTTP 500** — a server component calls **two** client-module symbols (`humanizeResourceType` at `:92` **and `humanizePortal` at `:97``), not one. Fixing only the first leaves it broken.
- **`/admin/students` renders fabricated data as fact**: `performanceFromId()` (`page.tsx:105-113`) hashes the student UUID into a 1–5 star rating under the column header « Performance académique », and `:277` synthesises `prenom.nom@email.com` for every student without an email — which is **100 % of 2 463 rows** in the live DB.
- **`/admin/guardians` reports 200 as the total** for 2 487 guardians and computes all four KPIs over that 200-row slice; the "attach an existing parent" picker on the student page is capped the same way, so **92 % of guardians cannot be attached to a student**.
- **`/teacher/documents` and half of `/parent/documents` are guaranteed permanently empty** — both aggregate `announcement.attachments` / `lesson.attachments`, and a repo-wide grep finds **only readers, never a writer**. There is **no upload control anywhere in the app** (2 `type="file"` hits, both in the CSV import wizard).
- **`/admin/conversations`** renders three KPIs and a « Historique » section over `ConversationReport.status`, which **no endpoint ever writes**. `reviewed` and `dismissed` are unreachable; two of three KPIs are permanently 0. An admin can see a safety report and can do nothing about it.
- **« Clôturer » on a meeting request does not clôture anything** — the client sends `{status:'cancelled'}` to an endpoint that takes no body and hardcodes `status:'resolved'`. The UI announces « Demande clôturée. » while writing `resolved`. `MeetingRequestStatus='cancelled'` is unreachable.
- **Approving a child claim reports success on every failure** (`ChildClaimsQueue.tsx:70-78`): a 403, 500, network error or the current live 404 are indistinguishable from a granted approval — the row disappears and the admin believes the family was approved.

## C-9 — « Only the web image is stale » — **THE API IMAGE AND THE DATABASE ARE STALE TOO**

Live probes (`401` = route exists, `404` = route absent):

```
404  GET  /api/v1/integrations/oneroster        (4 routes)
404  GET  /api/v1/remediation/admin/overview    (13 remediation routes absent)
404  GET  /api/v1/admin/child-claims
404  GET  /api/v1/student/*                     (7 routes — whole student portal)
404  POST /api/v1/imports/{id}/conflicts/{rowId}/resolve
```

`/docs-json` enumerates 42 domain routes where source declares ~60. And the **live database is pre-E11-S2/S3/S4**: `import_batch.origin`, `import_batch.claimed_at`, `import_row.reconciliation`, `import_row.conflict_fields` and the whole `roster_source` and `guardianship_claim` **tables do not exist**. Deploying current API/worker against this DB breaks *every* import read and *every* apply.

There is also proof the running container is a **different build** than this branch: a `failed` `snapshot_recompute_trigger` row carries a stack trace pointing at `/app/src/modules/analytics-snapshots/snapshot-drain-cron.service.ts:501` — **a file that does not exist anywhere in this worktree**.

**Round 1 classified `/admin/child-claims`, `/admin/integrations`, `/admin/remediation` and the student portal as delivered features. In the running product they are 404s.**

## C-10 — « Lakoli has 8 roles from the route-guard arrays » — **INCOMPLETE**

There are **9 role values** (`super_admin`, `direction`, `comptable`, `caissier`, `scolarite`, `enseignant`, `auditeur`, `permanent`, + `parent` which is portal-only). A user carries **exactly one role per space** (`const _ = n?.role`); route guards are allow-lists over that single value; multi-establishment membership is handled by **space/establishment switching**, not by simultaneous roles. And the **RBAC spec is written out verbatim in the « Nouvel utilisateur » modal** — e.g. `caissier` → « Caisse, créances, paiements — sans rapports ni campagnes SMS », `permanent` → « Inscriptions uniquement ». Round 1 never opened that modal.

## C-11 — « Modules with no `gatedModule` are placeholders » — **INVERTED**

In the whole bundle only `orientation_dob` and `conformite` carry a `gatedModule` literal. Round 1 read that as evidence the other pages were stubs. It is the opposite: everything else resolves through the path→module map `t3`, and **no Admissions or Pedagogy page is gated at all** — they are the shipped core.

## C-12 — « These are enhancements to what we have » — **THEY ARE ZERO-IMPLEMENTATION GAPS**

Verified by targeted `grep -rniE` over `apps/api/src`, `apps/web/src`, `packages` with every non-zero hit opened by hand:

| Capability | Our hits | Verdict |
|---|---|---|
| Period closure lifecycle (`pre-cloture-check`, `cloture`, `re-cloture`, `re-ouvrir`, `ponderation-annuelle`) | **0** | Absent |
| Refunds | **0** | Absent |
| Cahier de textes visa workflow | **0** | Absent (`LessonEntry` exists, no submit/countersign/history) |
| Convocations | **0** | Absent |
| Payroll / staff entity | **0** | Absent |
| Module entitlements / feature gating | **0** | Absent |
| Nominative habilitations | **0** | Absent |
| Timetable | **0** | Absent |
| Compliance / Conformité | **0** | Absent |
| Orientation | 4 (unrelated) | Absent |
| Discipline / incidents | 19 | **Permission strings only** — `['discipline.read', …]` in `permissions.constants.ts:78-80` and three role presets. No model, no controller, no service, no page |
| SMS / WhatsApp channel | 2 | **Declared, explicitly not wired** — `NOTIFICATION_CHANNEL` includes `'sms'`, and `admin/settings/page.tsx:144` states verbatim **« SMS — Désactivé (canal non câblé) »** |
| Finance (`invoice`/`creance`/`payment`/`fee`) | **0** | Absent (ADR-018 **Proposed**: *« Le Module Finance … ne sera pas implémenté dans les phases 0 à 8 »*) |

> **A round-1 grep used `\|` inside an ERE pattern, which matches a literal pipe and returned false zeros for everything. Every round-1 absence claim based on grep is void.** The table above is the corrected run.

## C-13 — « We have room management » — **WRONG**

`room` is a free-text `@IsString() @MaxLength(40)` field on a class (`classes.controller.ts:36,48`) displayed at `admin/classes/[id]/page.tsx:181`. There is **no `Room` entity, no inventory, no availability, no status**. Lakoli has `POST /emploi-du-temps/salles` and `PATCH /salles/{id}/statut`, and uses rooms as a first-class conflict dimension in timetabling and exam-hall allocation.

## C-14 — « Class ranking is a Lakoli-only capability » — **WRONG, IT'S PARITY**

29 hits, genuinely implemented, surfaced as « Rang de la classe » on the parent dashboard. Lakoli additionally computes rank **only over pupils who have grades** (« {n}ᵉ sur {m} élèves ayant des notes saisies ») — a non-trivial rule we should copy, but the capability itself is not a gap.

## C-15 — Two Lakoli findings Round 1 could never have reached, and which change the competitive read

- **Lakoli leaks a customer's data in its public bundle.** A hardcoded WhatsApp template names **« GSSV » / « College Source Vision »** (a specific school, 6ᵉ enrolment priority) inside the production multi-tenant bundle, called via `onWhatsAppCollege`. Their re-enrolment WhatsApp templates are persisted in `localStorage` under **`agora_wa_templates_reinscription`** — a key that betrays a previous product name and means templates are per-browser, never shared, never backed up.
- **Lakoli takes no cut of GMV.** Verbatim: *« Lakoli ne perçoit, ne détient et ne reverse jamais les fonds de vos paiements : ils vont directement de votre parent d'élève à votre compte marchand. »* Pure subscription SaaS, four aggregators (Paystack *Recommandé*, CinetPay, PayDunya, Hub2 *Bêta*), each school configures its own merchant account. That is a deliberate regulatory-liability shield and it shapes how they can price.

---

# 2. NEWLY DISCOVERED LAKOLI CAPABILITIES WE LACK

Grouped by domain. **Complexity**: S ≤ 1 sprint · M = 1–2 sprints · L = 1–2 months · XL = a quarter or more (for our stack, greenfield).

## 2.1 Platform, tenancy & monetisation

**P-1 · Per-tenant module entitlements — L**
`GET /module-access/catalog → {catalog, effectiveModules}`; **47 module codes** in the path→code map `t3` (`enrollments`, `receivables`, `timetable`, `discipline`, `sensitive_followup`, `personnel_hr`, `staff_attendance`, `compliance`, `orientation_dob`, …); per-page gate `GET /module-access?module=<code> → {accessible}`; locked entries render `opacity-40` with badge **« À venir »** in sidebar, ⌘K palette and mobile nav.
*Commercially:* this is the packaging machine. Without it we cannot sell tiers, run a trial that converts, or upsell. Every feature we build is worth less because we cannot meter it. **This is the single highest-leverage missing capability on the list.**

**P-2 · SaaS billing with headcount-tiered pricing — XL**
`GET /billing/plans|status|factures`, `POST /billing/subscribe {planCode, cguAccepted:true}`. Each plan has `seuil_eleves_min|max|prix_mensuel`; the client computes cost-per-pupil live (« Pour vos {n} élèves : environ {x} F CFA par élève/mois »). **Mandatory CGU/CGV checkbox** gates plan selection and is versioned + timestamped (`cguAccepteLe`, `cguVersion`). **60-day statutory withdrawal right** with a named mailbox (`remboursement@lakoli.com`). **No auto-debit** — « aucun prélèvement automatique, pensez à repayer avant cette date pour éviter la suspension ». Hard access suspension on expiry, enforced in the route guard (`statut==="suspended" || (statut==="trial" && dateFinEssai<now) || (statut==="active" && planExpireLe<now)`), with `demo@lakoli.com` exempt.
*Commercially:* self-serve revenue with a compliant consent trail. We have no billing object at all.

**P-3 · Headcount-overflow upsell — S**
Global banner on every page: « Votre effectif ({n} élèves) dépasse votre formule actuelle — Passez à {plan} dans les 7 jours. » plus a « Mise à niveau requise » card on `/abonnement`.
*Commercially:* automatic expansion revenue from the metric that actually grows.

**P-4 · Self-service tenant provisioning — L**
`/setup`: 4 steps (école → cycles → compte admin → done), `POST /setup/init` with 13 exact keys including `ga_client_id` (from the `_ga` cookie) and `prospect_ref` (from `localStorage["lk_utm"]`), then **async provisioning** polled at `GET /setup/ready/{slug}` every 2 500 ms with named sub-steps (« Compte créé » → « Création de votre espace » → « Configuration des modules » → « Finalisation »). Timeout copy: « Ne fermez pas cette page : aucune seconde inscription n'est nécessaire. »
*Commercially:* zero-touch acquisition. Our tenants are created by seed scripts and ops.

**P-5 · Full-funnel growth telemetry — M**
`POST /api/growth/track` with named events `signup_started`, `signup_step_1_completed`, `signup_admin_email_entered`, `signup_step_2_completed`, `signup_completed`, `signup_failed`, `demo_opened`, **`app_module_click`**, `app_action_support_sent`; mapped to GA4 (`send_to:"G-03PF3VNJCF"`) and Meta Pixel (`CompleteRegistration`, deduped via `localStorage["meta_creg_{email}"]`).
*Commercially:* they can attribute signups and price modules from real per-role usage. We instrument nothing.

**P-6 · Multi-establishment "group" layer above the tenant — XL**
`GET /auth/group-summary`, `POST|GET /auth/group-snapshots`, `POST|GET /auth/group-publications`. A read-only consolidated dashboard over **effectifs, finances (attendu net / encaissé / reste / recouvrement %), assiduité (normalised rate + call completeness), résultats (moyenne groupe, taux ≥10, classés/non classés), affectés de l'État, and declared DRENA/IEPP territorial references** — each block carrying its **own coverage rule and its own SHA-256 proof** (`{profile.code}@{profile.version} · SHA-256 {sha:0..16}…`). Exclusions are stated per block: « Le total exclut {n} établissement(s) … faute de rôle financier ou de données disponibles. »
**« Figer cet état »** creates an idempotent immutable snapshot; **« Publier au groupe »** requires the confirmation « Publier cet état agrégé à toutes les Directions du groupe ? Cette publication interne est immuable et **ne constitue pas une transmission IEPP/DRENA**. »
*Commercially:* this is the enterprise SKU — school groups and networks. It is invisible from a single-school tenant, which is why Round 1 never saw it. **We support multiple `School` rows under one tenant but have no group aggregate, no snapshot, no proof.**

**P-7 · Tenant exit / portability export — L**
`/parametres/export-resiliation`, `super_admin`/`direction` only. Three guarantees rendered: « Tenant isolé » / « Archive vérifiable — Manifeste et empreintes SHA-256 » / « Sans effet automatique ». Form requires a motive ≥ 10 chars **and retyping the establishment name exactly**; `POST /tenant-exit-exports` with an `Idempotency-Key` header; **one concurrent export max** (button label flips to « Export déjà en cours »). Result line: « {taille} · {tableCount} tables · {rowCount} lignes · {documentCount} documents » + `SHA-256 {archiveSha256}`. Legal notice: *« générer cette archive ne résilie pas l'abonnement et ne modifie aucune donnée »*, and scope restriction: *« Les données santé et sociales protégées nécessitent une procédure habilitée distincte. »*
*Commercially:* answers the #1 procurement objection ("can we get our data out?") with a verifiable artefact. Rare in regional school SaaS.

**P-8 · Two-man deletion — M**
Requester creates `POST /demandes-suppression {eleveId, motif}` from the student file; only Direction/`super_admin` sees `/admin/suppressions`; `PATCH /{id}/approuver` (cascade delete of inscriptions, créances, paiements, documents) or `PATCH /{id}/rejeter` (**comment mandatory**). Tour copy: *« Les suppressions sensibles passent par une demande, une justification et une validation séparée. »*
*Commercially:* directly saleable as a governance control. Ours: `DELETE /api/v1/students/:id` exists with **no UI caller at all** (`StudentRowActions.tsx` is dead code, zero call sites).

**P-9 · Audit log with before/after diff — M**
**35 audited action codes** including `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `ANNULATION_MASSE_CREANCES`, `CLOTURE_CAISSE`, `TOGGLE_UTILISATEUR_ACTIF`. Every entry carries `ancienneValeur`/`nouvelleValeur`; the UI computes a field-level diff (« Modifications ({n} champ(s)) », old struck red → new green) with a **blacklist** (`motDePasseHash`, `mot_de_passe_hash`, `createdAt`, `updatedAt`) and a French field-name dictionary. Each row shows **« IP : {ipAddress} »** and the actor, falling back to **« Système »**.
*Ours:* the diff drawer exists but `ip_address`, `user_agent`, `hash`, `prev_hash` are **defined in the schema and populated on 0 of 63 rows**, while `audit/page.tsx:200` claims the log is *"append-only"*; **no login event is ever audited** so the "CONNEXIONS ADMIN" KPI is permanently 0; and `actorRole` is **hardcoded `'school_admin'`** in 4 call sites (54 of 63 live rows).

**P-10 · Server-driven system banners — S**
`GET /api/system-banners → {banners:[{id,type,titre,message}]}`, 6 types (`info`, `warning`, `error`, `maintenance`, **`sms`**, `success`), dismissal in `sessionStorage["sb_dismissed_v1"]`.
*Commercially:* a product→tenant announcement and incident channel with zero deploy. The dedicated `sms` type shows it is used operationally.

**P-11 · Demo mode + presenter mode — M**
`POST /auth/demo` → fictional tenant with a permanent banner « **MODE DÉMO — Données fictives · École Privée Excellence d'Abidjan · Réinitialisation toutes les 4h** » and a « Créer mon école » CTA. Separately `POST /auth/presenter` produces a **clean** demo for sales: it marks all onboarding suggestions rejected and forces every `lakoli_tour_*` to `"seen"` so no nudge or tour fires during a live pitch.
*Commercially:* two distinct sales instruments. We have neither.

**P-12 · Embedded help centre + guided tours — L**
`/aide`: **73 articles in 16 sections**, client-side full-text search, print stylesheet, typed blocks (`step`, `table`, `faq`, `badge`, `tip`, `warning`), per-article `roles[]` and `relatedIds[]`. Plus **63 guided tours** (`Vc`), one per page, each with `id/label/route/steps[{title,description,targetId}]`, a persistent « Revoir le guide » button, and **server-side reset**: if `etablissement.toursResetAt > localStorage["lakoli:tours_cleared_at"]`, all local tour state is cleared so Lakoli can replay onboarding after a product update.
*Commercially:* this is a support-cost lever and, for us, a **free requirements specification** — the tour corpus states the real business rules in plain French. Our `/help` route is a **404 from every portal's user menu**.

**P-13 · Integrated support with context — S**
Modal « Contacter le support Lakoli », `POST /api/support/request {tenant_slug, user_id, user_nom, user_role, canal:"whatsapp", message, page_url}`, then opens `wa.me/+2250101545162` pre-filled with `[Lakoli — {école}] / Utilisateur : {nom} ({role}) / Page : {path} / Message : …`.

**P-14 · Command palette — S**
⌘/Ctrl+K over sidebar entries with per-entry `keywords[]`, locked modules shown `aria-disabled` with « À venir ». Empty state: « Aucune page autorisée ne correspond à cette recherche. »

**P-15 · Primaire / Secondaire interface partition — M**
`niveauInterface ∈ {primaire, secondaire}` mapping to `{maternelle, primaire}` and `{college, lycee, superieur}`. It is **not cosmetic**: it is threaded through `/creances`, `/paiements`, `/rapports/*`, `/budget-previsionnel/comparaison`, every `vie-scolaire` call and every conformité import, and it is surfaced as **« Périmètre isolé »** during destructive operations. Switchable only by `direction`/`super_admin` or a user with `niveauAcces === "tous"`; persisted in `localStorage["edugest_niveau"]`.
*Commercially:* groupes scolaires that run a primary and a secondary school under one roof need their money and their discipline records kept apart. We have cycles but no partition.

**P-16 · Two products on one binary — Not applicable today, but note it**
`productType ∈ {scolaire, higher_education}` with a « Supérieur » badge on the space picker. Same code, two markets.

## 2.2 Finance (we have **zero** of this — ADR-018 deferred the whole domain)

**F-1 · Daily cash closing with a printable PV — L**
`/cloture-caisse`: `GET /cloture-caisse/check?date` (blocks if a non-cancelled PV exists), `GET /session-data`, `POST /cloture-caisse`. Produces a 5-section *Procès Verbal*: répartition par mode, dépenses, réconciliation with the écart classified **AUCUN ÉCART / EXCÉDENT / MANQUANT**, observations caissier + direction, signatures et cachet. **It has no sidebar entry** — reachable only from a card on `/caisse`.
*Commercially:* this is the single feature that makes a bursar trust the software. It also exposes a doc/impl contradiction worth knowing: the help article says « La clôture est irréversible » while a direction-only `DELETE /cloture-caisse/{id}` marks the PV « Annulé ».

**F-2 · Cash-drawer semantics that match how a school actually operates — M**
Verbatim rules: « Solde espèces = apports manuels en espèces + encaissements en espèces − dépenses validées en espèces »; « Les dépôts à la banque et dépenses par chèque / virement sont comptabilisés comme sorties mais **ne réduisent pas le solde physique de la caisse** »; « Les dépenses saisies dans Cantine et Transport sont incluses automatiquement comme sorties espèces, **sans créer une seconde écriture** ».

**F-3 · Expense approval circuit — S**
`brouillon → validée | rejetée`, restricted to `direction` + `comptable`, with a `noteValidation`. « Les dépenses créées sont en brouillon. Seuls la Direction et la Comptabilité peuvent les valider pour qu'elles impactent la caisse et les rapports. »

**F-4 · Mass cancellation of receivables, guarded five ways — M**
Dry-run preview endpoint → **cycle isolation** (« Périmètre isolé ») → mandatory 10-char motive logged to audit → typed confirmation token **`ANNULER {n}`** → server-side arbitration via `expectedCount` + `confirmationCount`.
*Commercially:* the destructive-operation pattern we should copy wholesale for our imports and bulk deletes.

**F-5 · Refunds with overpayment detection — S**
`POST /paiements/{id}/rembourser`; the modal detects `tropPercu` and offers a one-click « Rembourser uniquement le trop-perçu »; partial refunds clamped to the original amount; motive mandatory; direction/`super_admin` only.

**F-6 · Anti-fraud engine — L**
**Nine typed detectors**: `cash_excessif`, `annulation_suspecte`, `montant_modifie`, `double_paiement`, `paiement_hors_horaire`, `accumulation_annulations`, `ecart_montant`, `acces_non_autorise`, `autre`. Three severities, four workflow states, 15 s / 30 s polling, a dashboard banner, and bulk « faux positif » classification behind the confirmation « Classer ces {n} alerte(s) critique(s) en faux positif ? **Cette action sera journalisée.** »

**F-7 · Generic service-subscription engine — L**
`/subscriptions` powers Cantine, Transport **and any fee category flagged `estService`**: month-level suspension (`suspend-mois`), resume, cancellation cascading to unpaid créances, and **canteen access blocking** (`accessStatus: allowed|blocked`) used explicitly as a debt-collection lever. Plus `POST /subscriptions/sms-relance`.
*Commercially:* the "suspend the canteen badge until they pay" loop is the highest-conversion dunning action a school has.

**F-8 · Four payment aggregators with a dynamic path prefix — L**
`POST /{provider}/init`, `GET /{provider}/verify/{ref}`, `POST /{provider}/sync-pending` — the `paystack` namespace is legacy naming, **not** the capability boundary. A 4-step config wizard per school, credential validation (`POST /payment-config/valider`), test/production mode with a global banner « **MODE TEST — Aucun paiement réel n'est encaissé tant que les clés de production ne sont pas activées** ».

**F-9 · Public unauthenticated parent payment portal — M**
`/paiements-en-ligne/portail` keyed on `matricule`: `GET /paystack/portail/{matricule}` → multi-créance selection → `POST /paystack/portail/init`.

**F-10 · Two independent reconciliation queues — M**
The PSP request validation queue (`/paystack/requests` with an 8-state machine `initiated → pending → payment_received → verified → validated | rejected | unattributed | expired`) **and** a separate Orval-generated queue (`/api/reconciliation/file-attente`, `/api/reconciliation/{id}/reconcilier {eleveId, creanceId, motif}`).

**F-11 · Instalment scheduling with an equality validator — S**
Monthly / quarterly / half-yearly with an explicit Sept→June month picker and a sum-must-equal-total check that surfaces « (écart +N FCFA vs montant total) ».

**F-12 · Pre-seeded discount catalogue — S**
8 criteria (`orphelin`, `enfant_enseignant`, `fratrie`, `boursier`, `eleve_meritant`, `difficulte_sociale`, `personnel_admin`, `partenariat`), `pourcentage` or `montant_fixe`, and the rule that **discounts apply to scolarité only, never to inscription**.

**F-13 · Four-level dunning ladder — M**
From the help corpus, as data: `J+7 Rappel amiable (WhatsApp avec solde dû)` → `J+30 Relance formelle (appel + lettre)` → `J+60 Mise en demeure (recommandé, direction)` → `J+90 Suspension (accès aux services)`, with « La suspension d'un élève pour impayé doit être validée par la direction et notifiée par écrit ».

**F-14 · Receipts carrying official Ivorian chrome — S**
*Ministère de l'Éducation Nationale et de l'Alphabétisation*, DRENA, IEPP, *République de Côte d'Ivoire / Union — Discipline — Travail*, armoiries — printed under a hardened CSP meta tag. Two distinct renderers coexist (server-rendered HTML at `GET /api/payment-providers/recu/{id}`, plus a client print path).

**F-15 · Server-driven data-quality deep links — S**
The AI audit (`POST /audit-ia/run`) emits links straight into filtered finance views: `/paiements?filtre=remises_elevees` (« Paiements avec remise supérieure à 50% »), `/creances?filtre=sans_echeance`, `/creances?filtre=negatives` (« Créances à solde anormal (trop-perçu) »).

**F-16 · Money-gated enrolment mutability — S**
`PATCH /preinscriptions/{id}/avant-encaissement` allows a full dossier edit (élève + père + mère + tuteur + classe + services + remise) **only while no cash has been taken**; after the first payment, « les corrections ayant un impact financier doivent être effectuées par une procédure de régularisation ». Stated as a product invariant in onboarding step 6.

## 2.3 Admissions & re-enrolment

**A-1 · Explicit 5-stage enrolment pipeline — L**
`preinscription_creee → paiement_demande → paiement_recu → dossier_complet → validee`, each state carrying an explicit "next action", with `annulee` filtered client-side out of every tab. Verbatim rule: « Tant que les frais d'inscription ne sont pas encaissés et l'inscription validée, l'élève reste ici dans En cours et **n'apparaît pas encore dans la liste Élèves**. » And: « Effectif affiché : élèves inscrits. Les préinscriptions restent consultables dans la liste **sans gonfler cet effectif**. »
*Ours:* `enrollment` has **only `active` rows** and `/admin/enrollments` is structurally broken (C-8).

**A-2 · Public pre-registration portal — L**
Shareable link, family-side document upload, **bidirectional SMS messaging per dossier**, a 7-state machine with explicitly coded allowed transitions, and 1-click conversion (`POST /convertir`) that creates the pupil and generates the créances.

**A-3 · End-of-year decision engine (DFA) — L**
`/inscriptions/fin-annee`: a **versioned decision engine** with an official rules profile (`officialRulesReference`), read-only preview (`POST /dfa-preview`), **6 non-computability codes** (`entrees_mga_primaire_non_identifiees`, `cycle_non_couvert_par_dfa`, `contrat_t1_t2_t3_incomplet`, `bulletin_officiel_publie_manquant`, `mga_secondaire_incalculable`, `statut_redoublant_a_confirmer`), **optimistic locking via `expectedDecisionVersion`** (error `decision_concurrente`), freeze with a fingerprint, and reopen requiring a motive ≥ 10 characters, all journalled.
Human-in-the-loop is enforced in copy: « **Décision humaine requise · jamais appliquée automatiquement** » and « Le résultat ne remplit jamais la moyenne, l'aide locale ou le statut final : le conseil conserve la décision. »
*Commercially:* it is the **precondition for re-enrolment** (« Cette étape doit être complétée avant de lancer les réinscriptions »). We compute averages and rankings well and have **no decision object at all** — so nothing closes a year and nothing drives a promotion.

**A-4 · Re-enrolment CRM — XL**
`/reinscriptions/suivi`: **6 prescribed steps** each with a computed "done" condition, **4 orthogonal status axes** (`statutContact`, `statutReponse`, `statutFinal`, `statutPaiement`), **4 alert tags** (`😟 Parent inquiet`, `🔔 Rappel demandé`, `⚠️ Infos contradictoires`, `🚨 Risque de départ`), a « sans contact depuis plus de 7 jours » filter, Excel import, XLSX export, and a CM2-specific « intérêt collège » block detected by class name.
*Commercially:* re-enrolment **is** the revenue renewal event for a private school. This is their retention product.

**A-5 · Credit-metered re-enrolment SMS campaigns — M**
Preview computes « Crédits requis » vs « Solde wallet »; send returns **HTTP 402** if insufficient; a demo mode simulates without debiting.

**A-6 · Bulk student import at real-world tolerance — M**
12 columns with **~60 name aliases**, 4 separators, `xlsx/xls/csv/txt`, per-row `ok | doublon | error` preview, `genererCreances` (default true) with a double confirmation to opt out, and a **`montantDejaEncaisse` field for migrating balances from a legacy system**.
*Ours:* 5 handlers with strict headers; the CSV template download is a `window.open` against a guarded endpoint and therefore **401s by construction** (`ImportWizard.tsx:73`); the wizard advertises 4 steps and implements 2.

**A-7 · Traceable exception to the payment rule — S**
The "Règle absolue" has a documented escape hatch: checkbox « Autorisation Direction (exception sans paiement) » + free-text motive, sent as `exceptionDirection` / `exceptionNote`.

**A-8 · Student file with 9 tabs and a per-student audit trail — M**
Vue d'ensemble, Santé, Finance, Pédagogie, Ventes, Services, Historique, Documents, Fichiers — with different desktop (5 visible) vs mobile (3 + Plus) distribution. Plus `GET /eleves/{id}/audit`, `/historique`, `/cursus` (multi-year career).

**A-9 · Document conformity control — M**
Upload → `a_controler` → « Déclarer conforme » or « Demander une correction » (`PATCH /documents-eleve/{id}/controle`, motive prompt mandatory). For a birth certificate, `nature = jugement_suppletif` **requires a piece number**.
*Ours:* there is **no file upload control anywhere in the product**.

**A-10 · Server-allocated matricule — S**
`GET /eleves/prochain-matricule` with a configurable `matriculePrefix` (2–6 chars) + `matriculeAnneeFormat` (`court` 2-digit / long 4-digit) + 5-digit sequence, previewed live in settings.

## 2.4 Pedagogy

**PE-1 · Assessment-period closure lifecycle — L**
`GET /pedagogie/periodes/{id}/pre-cloture-check` → `POST /cloture` → **async PDF generation job** (`GET /generation-jobs/{id}` polled every 2 000 ms, `succeeded|failed`) → **automatic publication only when every PDF of the batch is generated and verified** → `POST /re-ouvrir` (motive mandatory, **depublishes the parent portal**: « Les parents ne pourront plus consulter les bulletins jusqu'à la re-clôture ») → `POST /re-cloture` (« Une nouvelle version officielle sera générée pour la **population figée**. »).
*Ours:* **0 hits.** Terms can be created and edited but never closed. Grades stay mutable forever, which quietly undermines the credibility of every report card we produce.

**PE-2 · Annual weighting as a first-class object — M**
`PUT /pedagogie/periodes/ponderation-annuelle` with per-period inclusion/exclusion and **relative** coefficients (« 1 / 1 / 2 donne deux fois plus de poids à la troisième période »). **Frozen as soon as an end-of-year decision is validated**, and a period included without a published official bulletin **blocks the computation rather than producing a partial average**.

**PE-3 · Cahier de textes submit-and-countersign — M**
`brouillon → Soumettre → soumis (À viser) → Viser → visé`, or `Corriger` (comment ≥ 10 chars) → `a_corriger` → resubmit. Versioned history `v{n}`, never overwritten.
*Ours:* `LessonEntry` exists with no workflow, and **editing a lesson is hard-broken** — the client sends one payload for create and update, and `UpdateLessonDto` accepts neither `teachingAssignmentId` nor `date`, so with `forbidNonWhitelisted` the PATCH **400s every time**. Never noticed because `lesson_entry` has 0 rows.

**PE-4 · Offline-first write queue — XL**
A real IndexedDB operation queue covering **grade entry and attendance**: max 100 operations, 30-day retention, cleared on logout, `deviceId`, automatic replay on reconnect, **HTTP 409 `conflictPayload` preserved**, and a deep link `?offlineOperation={id}` to compare server vs. draft. Dedicated « Synchronisation pédagogique » panel.
*Commercially:* Ivorian classrooms lose connectivity. This is a hard differentiator in the field and completely invisible to an online audit.

**PE-5 · Timetable — L**
`/emploi-du-temps` with slots, drag-and-drop rescheduling, **server-side conflict detection across teacher / class / room** returning a structured `HTTP 409 {error:'conflit_planification', conflits:[…]}`, a **motivated derogation** (≥10 chars) that stamps a persistent « Dérogation » badge on the session, weekly volume tracking vs. assigned volume, and A4-landscape printing. Timezone `Africa/Abidjan` hardcoded for "today".
Plus **room management** (`POST /emploi-du-temps/salles`, `PATCH /salles/{id}/statut`).

**PE-6 · Exam planning + convocations — L**
Plan a sitting → conflict check → room + invigilators + headcount → publish convocation → **SMS cost preview in segments** → send (**one SMS per pupil, idempotent** — « une seconde confirmation ne renvoie pas les convocations déjà transmises ») → documents (feuille d'émargement, PV de surveillance) → Terminer (irreversible) / Annuler (motive mandatory). Multi-room allocation with pupil-uniqueness. BEPC/BAC mock exams carry a hardcoded admission rule and an explicit guarantee of **no nationality inference from names**.

**PE-7 · Teacher émargement with an approval chain — M**
Planned slot → `POST emargements` (presence status + real hours) → `declare (À valider)` → Direction `valide` or `rejete` + mandatory prompt motive. **Only validated émargements feed `minutesRealisees`.**

**PE-8 · Teacher↔HR record linkage — M**
Teaching assignments are auto-linked to HR records **by email**, with 5 states (`linked`, `auto_linkable`, `missing`, `ambiguous`, `inactive`) of which 3 are **blocking**, verbatim: « Créez une fiche RH avec la même adresse e-mail avant de poursuivre. » / « Plusieurs fiches RH partagent cette adresse e-mail. Corrigez les doublons avant de poursuivre. » Saving an assignment is blocked unless `rhLinkStatus ∈ {linked, auto_linkable}`.

**PE-9 · Machine-readable business-rule errors — M**
The client ships the backend's error vocabulary with French rendering: `affectation_requise`, `contexte_incoherent`, `periode_cloturee`, `date_periode`, `evaluations_initialisation`, `conflit_planification`. The API returns **rule violations a client can branch on**, not prose.
*Ours:* our API returns raw Prisma 500s for several classes of violation (e.g. renaming a class into a `(year, level, name)` collision → **P2002 500**).

**PE-10 · Server-side ABAC on list endpoints — S**
`GET /classes?usage=presences` — **the server** filters classes by the caller's call-taking right on the assignment. The teacher class list additionally applies stated data minimisation: « Identité scolaire minimale, sans coordonnées familiales ni données financières. »

**PE-11 · Curriculum referential (Grilles de programme) — M**
Pre-loaded Ivorian programme grids, seeding, per-cycle **and per-série (A/C/D)** grids, coefficients and ordering, bulk edit, and « confirmer » to associate new classes and synchronise missing subjects.

**PE-12 · Attendance → parent notification loop — M**
`POST /presences/preview-absents` then `POST /presences/notifier-absents`. Plus a threshold-driven alert view (default 5) with derived severity (Critique ≥3×seuil, Élevé ≥2×, Alerte ≥1×) and per-pupil WhatsApp deep links.

**PE-13 · Monthly attendance register, two formats one fingerprint — S**
PDF and XLSX produced from the same data with, verbatim, « la même empreinte de contrôle » — an explicit anti-divergence claim in the UI. Same guarantee on the bulletin registry: « Les deux formats utilisent exactement le même instantané de données Lakoli. »

**PE-14 · Report-card publication rules — S**
Provisional previews carry a client-generated « PROVISOIRE / NON OFFICIEL » watermark + red banner; the official download requires **four simultaneous conditions** (`est_publie && statut_document==='valide' && has_pdf && periode_id` match). Rank is computed **only over pupils with grades entered**.

## 2.5 Vie scolaire

**V-1 · Discipline case chain — L**
Signaler (faits ≥ 10 chars, **incident date auto-clamped into the active school year**) → Instruire → Proposer une mesure (7-value enum, validated in a native prompt) → Direction Valider → Marquer exécutée; parallel Convoquer branch (datetime + objet, targets `parents[0]`) → Direction Valider et publier → Honorée / Parent absent → Clore.
Governing rule, verbatim: « **Aucun retard ou signalement ne produit automatiquement une sanction. Toute mesure reste proposée puis validée par la Direction.** »
*Ours:* two permission strings and nothing else.

**V-2 · Clubs & activities — M**
Clubs with `responsablePersonnelId`, membership, activity lifecycle (`brouillon → planifiée → réalisée`), **participants immutable once `realisee`**, family-portal publication toggle, and a « Imprimer le récapitulatif » that emits a **fixed 16-row administrative canevas** (one row per domaine in declared order, zero-filled, counting only `realisees`, plus a Total row) generated entirely client-side.

**V-3 · Protected/sensitive case follow-up — XL**
Encrypted dossiers with **nominative habilitations**: per-user grants of Lecture / Écriture / Agrégats × `sante` / `social` / `grossesse`, with a mandatory motive, an expiry (`valableJusquau`), client-enforced `ecritureScopes ⊆ lectureScopes` and `exportScopes ⊆ lectureScopes`, and a `protectedDemoAccount` hard block. The domain is **derived, not stored** (`grossesse→grossesse`, `psychosocial|abandon→social`, everything else→`sante`). The anonymised aggregate export implements **real k-anonymity** — the server returns `{threshold, cells[{…, suppressed}]}` and suppressed cells print as `<threshold`.
*Commercially:* this is the control that lets a school hold health and child-protection data at all. We have **no equivalent**; our authorisation stops at permissions + a partially-broken ABAC.

## 2.6 HR & Payroll (we have **no staff entity at all**)

**H-1 · Personnel records — M** — 42 operations, 9 departments, 6 contract types, 4 statuses, optional Lakoli login creation at hire time (« Utile uniquement si cette personne doit se connecter au logiciel. »), 3 access levels (`tous|primaire|secondaire`), password ≥ 8 chars, write-once (« Communiquez-le directement à la personne. Il n'est jamais affiché ensuite. »). **No DELETE exists anywhere in HR** — deactivation only.

**H-2 · Contract lifecycle — M** — create / renew / suspend / resume / terminate (with `terminationReason`). Invariants: « **La création d'un nouveau contrat terminera automatiquement le contrat actif en cours.** » and **seniority net of suspensions** — « Ancienneté nette : X an(s) Y mois (suspension en cours déduite) » — which then feeds the `prime_anciennete` payroll rubric.

**H-3 · Parametric payroll engine — XL**
Auto-calculation « via le moteur de paie (CNPS/CMU/IRPP/ancienneté selon barèmes paramétrés) » with a live net preview (`POST /personnel/{id}/paies/apercu`), a **19-code Ivorian chart of payroll accounts** (10 SALAIRE DE BASE, 431 ITS, 440 CNPS, 530 FDFP …), three line types (`gain|retenue|patronal`), and editable statutory scales: `GET|PUT /rh/bareme-irpp` (progressive brackets, open-ended top), `/rh/bareme-anciennete`, `/rh/parametres-paie` (categories `cnps|cmu|charges_patronales|general`), `/rh/rubriques` (`systeme:true` rubrics are locked).
The governing rule, verbatim: « **Toute modification s'applique uniquement aux futurs bulletins générés. Les bulletins déjà validés ou payés ne sont jamais recalculés rétroactivement.** »

**H-4 · Batch payroll with preview-hash gating — L**
Pick month → « Vérifier les variables du mois » (`POST /paies/lot/apercu` + `GET /paies/lot?periode=` in parallel) → 4 tiles `Prêts / À corriger / Déjà créés / Net estimé` with per-line warnings → « Créer N brouillon(s) » carrying the **`previewHash`** back as an anti-double-submit token → « Valider tous les brouillons ». The create button is **disabled while `aCorriger > 0`** (« Corrigez les dossiers signalés avant de continuer »). Payslip status is a **one-way ratchet** `brouillon → validee → payee` with no UI path back.

**H-5 · Contractors as a separate object — S** — `prestataire`/`benevole` **lose the Paies tab entirely** (« Ce collaborateur est un prestataire : pas de bulletin de paie, juste un échéancier ») and get contrats-prestation with `mensuel|forfaitaire|ponctuel` periodicity and repeatable dated payments.

**H-6 · Staff time & attendance register — L**
6 event kinds (`IN`, `OUT`, `ABSENCE`, `MISSION`, `LEAVE`, `EXIT_AUTHORIZATION`), 10 reason codes (`BADGE_FORGOTTEN` … `CONTROL_REGULARIZATION`, `OTHER`), 4 anomaly types (`MISSING_OUT`, `OUT_WITHOUT_IN`, `CONSECUTIVE_IN`, unusual duration), idempotency keys on every write, no future-dated entries (`max = today`), and a 10-code append-only audit journal (« Historique non destructif des saisies et décisions RH »).
Explicitly kept separate from pupil attendance: « **Ce registre est distinct de l'appel des élèves et des cours réalisés.** »
Hardware-optional by design: « Aucun terminal n'est nécessaire pour commencer… Une pointeuse pourra être ajoutée plus tard sans perdre cet historique », with a named vendor on the roadmap (**EBKN**).

**H-7 · Four-eyes on bulk entry and corrections — M**
Bulk entry is **two-phase** (`mode:"preview"` then `mode:"confirm"` with `previewHash`) and **all-or-nothing** (« Une seule confirmation créera toutes les lignes, ou aucune si l'une d'elles est invalide »); the batch then enters `PENDING_REVIEW` and **a different user must decide** (`Number(created_by) === Number(user.id)` disables both buttons). Corrections are non-destructive — « Le pointage original restera visible » — and rejection always requires a ≥3-char comment.
Monthly report rule: « **Seules les sessions validées sont comptabilisées.** »

**H-8 · Contract-expiry horizon — S** — a 60-day amber KPI (« À renouveler dans 60 jours »). *Note: it never reaches their alert engine — zero "contrat" hits in `alertes-*.js`. A cheap place for us to be better.*

## 2.7 Communication (our SMS channel is declared and explicitly **not wired**)

**C-1 · SMS campaign engine with mandatory dry-run — L**
`POST /communication/campaigns` (brouillon) → **`POST /{id}/simulate`** (recipients + cost, opens the preview) → `POST /{id}/send`. **Sending without simulating is impossible**; the send button is disabled on `soldeInsuffisant`. Lifecycle `brouillon → prete → programmee → envoyee | partiellement_envoyee | echouee | annulee | simulee`.

**C-2 · Automation rules as a CRUD resource — L**
**16 trigger events in 2 groups** — Paiements: `ouverture_periode`, `rappel_avant_echeance`, `rappel_echeance`, `rappel_3j`, `rappel_7j`, `rappel_15j`, `relance_mensuelle`, `recu_automatique`, `paiement_partiel`; Scolarité: `bulletin_disponible`, `absence_enregistree`, `convocation`, `reunion_parents`, `info_rentree`, `rappel_evenement`, `message_direction`. Each rule carries a **signed delay** (negative = before the event), a send hour, an attached template and a mode (`semi_auto` → the server prepares a campaign in `prete` for an operator to validate; `automatique` → direct send).

**C-3 · Prepaid SMS wallet with real money mechanics — M**
Packages, Mobile Money recharge, **idempotent verify** (« Ce paiement a déjà été crédité »), 5 transaction types (`WELCOME_BONUS`, `RECHARGE`, `SMS_SENT`, `MANUAL_ADJUSTMENT`, `REFUND`, `CORRECTION`), and a hard send-block at zero balance.

**C-4 · Segment-aware cost control — S**
GSM-7 / Unicode segmentation (160/153 and 70/67) with a cost bar, thresholds at 160/306/459 and an « vous pourriez économiser N crédits » nudge. *Their implementation is buggy — the Unicode predicate is `/[^\x00-\xFF]/` so French accents (Latin-1) never trigger it, and the individual-message path uses a naive `Math.ceil(len/160)`. We can ship this correctly.*

**C-5 · Parent-level deduplication — M**
SMS to a parent with several children are **merged**, surfaced as KPIs (« Crédits économisés », « Messages fusionnés », « N SMS économisés grâce au regroupement »), and the merge is automatically disabled when the message contains a pupil-specific variable.

**C-6 · Suppression rules that prevent embarrassment — S**
Parents who paid **in the last 24 hours are automatically excluded** from "unpaid receivables" campaigns.

**C-7 · Failure triage and retry — S**
`GET /sms-logs/echecs-recents` polled every 60 s behind a **global notification bell** with an unread badge persisted in `localStorage`, distinguishing « Crédit SMS insuffisant » from « Échoué », plus `POST /sms-logs/relance` and `GET|PUT /sms-logs/auto-config`.

**C-8 · WhatsApp as a free, manual, zero-config channel — M**
A complete 4-tab module (individual, group-by-class, sequential unpaid-dunning, template editor) built entirely on `wa.me` deep links. Documented honestly: « Aucune API, aucune clé, aucun abonnement requis » and « **Vous devez appuyer sur Envoyer vous-même. Lakoli ne peut pas envoyer automatiquement sans votre accord.** » Includes a 5-branch Ivorian phone normaliser and a full Unicode sanitiser.
*Commercially:* in this market WhatsApp is the channel. Zero marginal cost, zero integration risk, and it is the one thing a competitor can copy in a sprint.

**C-9 · Parent portal with OTP-only auth — L**
« Il n'y a pas de mot de passe à retenir : la connexion se fait uniquement par code SMS à chaque fois. » The parent's phone number must match the one on the pupil's record. Two distinct portals with distinct URLs — *Préinscriptions* (families with no pupil yet) and *Espace Parent* (already enrolled) — with an explicit warning not to confuse them.
*Ours:* a full Keycloak account plus a guardianship claim. Better security, **materially worse adoption** for a parent with a feature phone.

**C-10 · Staff impersonation of the parent portal — S**
`POST /portail/staff-access {eleveId}` → redirect with `?staff_token=…`. Instantly answers "the parent says he can't see the bulletin".

## 2.8 Documents & official reporting

**D-1 · Official document generator catalogue — L**
10 types: `attestation`, `carte_scolaire` (a **4-per-page sheet of ID cards to cut out**), `situation_financiere` (with QR code), `fiche_inscription`, `fiche_individuelle` (multi-year history), `fiche_eleve`, `fiche_notation`, `liste_classe`, `liste_appel` (landscape), `effectifs`. All through `POST /documents/finaliser` → `GET /api/documents/{id}/download`, with a **registry tab** for re-download.
Each document is stamped with the school's logo, signature and cachet, and carries **a unique number and an authenticity QR code**: « En scannant ce code, n'importe qui peut vérifier l'authenticité du document sur le site de votre école. »
*Ours:* one PDF kind (`report_card_pdf`) among 5 export kinds, no numbering, no QR, no registry, and **no way to upload a signature or a cachet**.

**D-2 · Establishment identity for documents — S**
18-field `PUT /etablissement` including `drena`, `iepp`, `nomDirecteur`, `piedDePage`, and **four uploadable images** (logo, signature du Directeur, cachet, en-tête). Note the entitlement coupling: « Les cycles déterminés par votre abonnement Lakoli. Contactez le support pour les modifier. »
*Ours:* branding is `primaryColor`, `accentColor`, `fontFamily`, `logoUrl`, `faviconUrl` — all validated with **only** `@IsString() @MaxLength(60|120|500)`, then injected raw into a server-rendered `<style dangerouslySetInnerHTML>` on **every authenticated page of every portal** (stored CSS injection across a role boundary).

**D-3 · Statutory export pipelines — L (market-specific)**
CIO / StatCIO exports in a 3-step wizard with a proprietary `x-lakoli-unmapped-subjects` response header flagging subjects outside the historical canevas, plus an « Historique des preuves » timestamping every export produced.

**D-4 · Registre des affectés de l'État — M (market-specific)**
Declare → correct (motive ≥ 10 chars) → confirm internally / withdraw / restore, each event versioned and sealed with a **SHA-256 fingerprint** visible in the history, and an explicit legal disclaimer of non-officiality toward AGFNE, DEEP, IEPP and DRENA.

**D-5 · AI quality audit with a scored playbook — M**
`POST /audit-ia/run` returns a 0–100 health score (`≥95 Excellent … <55 Critique`), anomalies typed `critique|important|optimisation`, each with `{titre, description, impact, solution, actionHref, actionLabel}` rendered under the labels « **Risque** » and « **Solution** », scored by category (`wallet`, `users`, `message`, `zap`, `shield`), and switching into **installation mode** during the trial. Result cached in `localStorage["lakoli_audit_last"]`.
*Commercially:* it converts a trial into a configured tenant, and it makes the product feel like it is watching your back.

---
# 3. PER-DOMAIN FEATURE COMPARISON

**Status vocabulary** — `Fully available` · `Partially available` · `Missing` · `Implemented differently` · `Inaccessible` (built but unreachable: entitlement-gated on Lakoli's side, stale image / missing migration on ours) · `Not applicable` · `Requires validation`.
**Gap verdict** — `Full build` · `Partial build` · `Harden` · `Deploy` (code exists, ship it) · `Parity` · `We lead`.
**Priority (MoSCoW)** — `M` Must · `S` Should · `C` Could · `W` Won't (this cycle).
**Complexity** — S ≤1 sprint · M 1–2 sprints · L 1–2 months · XL quarter+.

| # | Domain | Module | Feature | Lakoli | Internal | Gap | Evidence | Impact | Cx | Pri |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Platform | Entitlements | Per-tenant module gating (47 codes) | Fully available | Missing | Full build | `GET /module-access/catalog` vs 0 grep hits | Critical | L | M |
| 2 | Platform | Entitlements | Locked-module upsell surface (« À venir » badge) | Fully available | Missing | Full build | sidebar + ⌘K `aria-disabled` + mobile nav | High | S | S |
| 3 | Platform | Entitlements | Per-page access probe | Fully available | Missing | Full build | `GET /module-access?module=orientation_dob` | High | S | M |
| 4 | Platform | Tenancy | Multi-space account (one user, many tenants) | Fully available | Missing | Full build | `/espaces`, `selectionRequise`, `POST /auth/switch-space` | Medium | M | C |
| 5 | Platform | Tenancy | Establishment switcher in shell | Fully available | Partially available | Partial build | `POST /auth/switch-establishment` vs `POST /api/v1/schools/{id}/switch` (no edit UI) | Medium | S | S |
| 6 | Platform | Tenancy | Group layer above tenant (consolidated dashboard) | Fully available | Missing | Full build | `GET /auth/group-summary` | High | XL | C |
| 7 | Platform | Tenancy | Immutable group snapshot with SHA-256 proof | Fully available | Missing | Full build | `POST /auth/group-snapshots`, `{profile.code}@{version} SHA-256` | Medium | L | C |
| 8 | Platform | Tenancy | Internal group publication (immutable, non-official) | Fully available | Missing | Full build | `POST /auth/group-publications {snapshotId, confirmation:true}` | Medium | M | C |
| 9 | Platform | Tenancy | Per-block coverage exclusion messages | Fully available | Missing | Full build | « Le total exclut {n} établissement(s) … faute de rôle financier » | Medium | M | C |
| 10 | Platform | Tenancy | Primaire/Secondaire interface partition | Fully available | Missing | Full build | `niveauInterface`, « Périmètre isolé » | High | M | S |
| 11 | Platform | Tenancy | Two product lines on one binary (scolaire / supérieur) | Fully available | Not applicable | — | `productType: higher_education` | Low | — | W |
| 12 | Platform | Tenancy | Row-Level Security enforcement | Requires validation | Missing | Harden | ADR-002 Accepted, `select count(*) from pg_policies` = 0 | Critical | L | M |
| 13 | Platform | Tenancy | Tenant-scoped `Role` model | Requires validation | Missing | Harden | `schema.prisma:892-906` has no `tenantId`; `roles.controller.ts:106` | Critical | S | M |
| 14 | Platform | Provisioning | Self-service tenant signup wizard | Fully available | Missing | Full build | `/setup` 4 steps, `POST /setup/init` (13 keys) | High | L | S |
| 15 | Platform | Provisioning | Async provisioning with progress polling | Fully available | Missing | Full build | `GET /setup/ready/{slug}` every 2500 ms | Medium | M | C |
| 16 | Platform | Onboarding | 10-step server-tracked checklist | Fully available | Partially available | Partial build | `GET /onboarding/status` vs `setup.controller.ts:71 activeTeachers: 0`, `:121 done:false` | High | M | S |
| 17 | Platform | Onboarding | 63 in-app guided tours | Fully available | Partially available | Partial build | tour catalogue `Vc` vs single rotating « Conseil du jour » | High | L | S |
| 18 | Platform | Onboarding | Server-side tour reset after a release | Fully available | Missing | Full build | `etablissement.toursResetAt` vs `localStorage` | Low | S | C |
| 19 | Platform | Help | Embedded help centre (73 articles, printable) | Fully available | Missing | Full build | `index-BT4yo3uy.js` 112 KB vs `/help` → 404 (`TopbarUserMenu.tsx:58`) | High | L | S |
| 20 | Platform | Help | Contextual support request with page context | Fully available | Missing | Full build | `POST /api/support/request` + prefilled `wa.me` | Medium | S | S |
| 21 | Platform | Nav | Command palette (⌘K) with keyword index | Fully available | Missing | Full build | palette empty state « Aucune page autorisée … » | Medium | M | C |
| 22 | Platform | Nav | Per-role mobile quick-nav (4 items) | Fully available | Missing | Full build | map `x0`, 7 role variants | Medium | S | C |
| 23 | Platform | Comms | Server-driven system banners (6 types incl. `sms`) | Fully available | Missing | Full build | `GET /api/system-banners` | Medium | S | S |
| 24 | Platform | Sales | Demo tenant mode with 4 h reset | Fully available | Missing | Full build | `POST /auth/demo` + permanent banner | High | M | S |
| 25 | Platform | Sales | Presenter mode (suppresses tours and nudges) | Fully available | Missing | Full build | `POST /auth/presenter` | Medium | S | C |
| 26 | Platform | Growth | Per-module click telemetry → GA4 + Meta | Fully available | Missing | Full build | `app_module_click` → `POST /growth/track` | High | M | S |
| 27 | Platform | Growth | Signup funnel events | Fully available | Missing | Full build | `signup_started` … `signup_completed` | Medium | S | S |
| 28 | Platform | Portability | Verifiable tenant exit archive | Fully available | Missing | Full build | `POST /tenant-exit-exports` + `Idempotency-Key`, SHA-256 manifest | High | L | S |
| 29 | Billing | Subscription | Plan catalogue + status + invoices | Fully available | Missing | Full build | `GET /billing/plans,status,factures` | Critical | L | M |
| 30 | Billing | Subscription | Headcount-tiered pricing with live per-pupil cost | Fully available | Missing | Full build | `seuil_eleves_min/max/prix_mensuel` | Critical | M | M |
| 31 | Billing | Subscription | Blocking CGU/CGV acceptance, versioned + timestamped | Fully available | Missing | Full build | `cguAccepteLe`, `cguVersion`, `POST /billing/subscribe {cguAccepted:true}` | High | S | M |
| 32 | Billing | Subscription | 60-day statutory withdrawal right | Fully available | Missing | Full build | « délai de rétractation de 60 jours », `remboursement@lakoli.com` | High | S | M |
| 33 | Billing | Subscription | No auto-debit, explicit renewal reminder | Fully available | Missing | Full build | « aucun prélèvement automatique » | Medium | S | S |
| 34 | Billing | Enforcement | Access suspension on trial/plan expiry | Fully available | Missing | Full build | route guard `xL` predicate, « Accès suspendu » screen | Critical | M | M |
| 35 | Billing | Enforcement | Headcount-overflow upsell banner | Fully available | Missing | Full build | « Votre effectif ({n}) dépasse votre formule actuelle » | High | S | S |
| 36 | Billing | Enforcement | Cycles locked by subscription | Fully available | Missing | Full build | « Les cycles déterminés par votre abonnement Lakoli » | Medium | S | C |
| 37 | Security | AuthN | IdP-backed OIDC with per-portal clients | Implemented differently | Fully available | We lead | Keycloak 26, `portal-admin/teacher/parent`, JWKS + refresh | High | — | — |
| 38 | Security | AuthN | Self-service password reset | Fully available (OTP SMS+email, 6 digits) | Implemented differently | Harden | Lakoli `POST /auth/forgot-password`; ours delegates to Keycloak, and `middleware.ts:29-42` declares 9 routes that all 404 | Medium | S | S |
| 39 | Security | AuthN | Wrong password correctly reported | Requires validation | Missing | Harden | `auth.ts:198-212` — `desc.includes('credential')` matches Keycloak's bad-password message, so every mistyped password shows « Authentification à deux facteurs requise » | High | S | M |
| 40 | Security | AuthN | RP-initiated logout (ends IdP session) | Requires validation | Missing | Harden | `grep end_session` → 0 hits; SSO cookie survives logout | High | S | M |
| 41 | Security | AuthN | Dead session detection in middleware | Requires validation | Missing | Harden | `token.error` set at `auth.ts:324/346/356`, never read by `middleware.ts:87` | Medium | S | S |
| 42 | Security | AuthN | Rate limiting on public registration | Requires validation | Missing | Harden | `grep Throttler` → 0 hits; `register.controller.ts:63-126` creates Keycloak users | High | S | M |
| 43 | Security | AuthN | MFA state read from the IdP | Requires validation | Missing | Harden | `me.controller.ts:85 mfaEnabled: false`; settings asserts « Obligatoire » as a literal | High | S | M |
| 44 | Security | AuthZ | Fine-grained permission catalogue | Missing (9 fixed roles) | Fully available | We lead | 89 codes, `<resource>.<action>`, `*.self` family | High | — | — |
| 45 | Security | AuthZ | Custom role builder with permission matrix | Missing | Fully available | We lead | `/admin/roles/new`, `Role`/`RolePermission`/`UserRole` | High | — | — |
| 46 | Security | AuthZ | Custom roles actually change portal access | Not applicable | Missing | Harden | `middleware.ts:5-13` gates on realm roles only; the `portal` radio has no runtime effect | High | M | M |
| 47 | Security | AuthZ | Permission catalogue and DB seed in sync | Not applicable | Missing | Harden | 89 in code, 68 seeded, 71 live; 18 codes ungrantable by the role builder | High | S | M |
| 48 | Security | AuthZ | "Cannot grant what you don't hold" check | Not applicable | Missing | Harden | `roles.controller.ts:110-116` — privilege escalation | Critical | S | M |
| 49 | Security | AuthZ | Route-level permission decorators | Requires validation | Fully available | We lead | 222 of 227 handlers carry `@RequiresPermission` | High | — | — |
| 50 | Security | ABAC | Teacher scoped to own class sections | Fully available (server-side `usage=presences`) | Missing | Harden | `student-access.service.ts:36-39` returns `studentIds:null` for every teacher | Critical | S | M |
| 51 | Security | ABAC | Guardian↔pupil scoping on parent reads | Fully available | Partially available | Harden | correct on `parent-dashboard`; absent on `GET /enrollments`, `/roster/:id`, `/guardianships/list` | Critical | S | M |
| 52 | Security | ABAC | School-level (not just tenant) scoping | Fully available | Missing | Harden | `scopeForUser(_schoolId)` never uses the parameter | High | M | M |
| 53 | Security | ABAC | Nominative, time-boxed, domain-scoped habilitations | Fully available | Missing | Full build | `/vie-scolaire/suivi-sensible/permissions*`, `valableJusquau` | High | L | S |
| 54 | Security | ABAC | k-anonymity suppression on aggregate exports | Fully available | Missing | Full build | server returns `{threshold, cells[{suppressed}]}` | Medium | M | C |
| 55 | Security | Governance | Two-man deletion (request → approve) | Fully available | Missing | Full build | `/demandes-suppression` vs `DELETE /students/:id` with no UI caller | High | M | S |
| 56 | Security | Governance | Four-eyes on bulk data entry | Fully available | Missing | Full build | « Le créateur du lot ne peut pas prendre la décision. » | Medium | M | C |
| 57 | Security | Governance | Destructive-op confirmation token | Fully available | Missing | Full build | typed `ANNULER {n}` + `expectedCount` arbitration | High | S | S |
| 58 | Security | Audit | Before/after field-level diff viewer | Fully available | Fully available | Parity | Lakoli diff + blacklist; ours `AuditDetailDrawer.tsx:227-235` | — | — | — |
| 59 | Security | Audit | Sensitive-field blacklist in the diff | Fully available | Requires validation | Harden | `motDePasseHash`, `mot_de_passe_hash` excluded | Medium | S | S |
| 60 | Security | Audit | Login / logout / failed-login auditing | Fully available | Missing | Full build | `LOGIN`, `LOGIN_FAILED`, `LOGOUT` vs 0 login rows ever written | High | S | M |
| 61 | Security | Audit | Role grant / revoke auditing | Requires validation | Missing | Harden | `users.service.ts:43-78` has zero `auditLog.create`; ADR-015 mandates it | High | S | M |
| 62 | Security | Audit | IP address and user agent captured | Fully available | Missing | Harden | `schema.prisma:1236-1239` defined, 0 of 63 rows populated; UI shows the columns | High | S | M |
| 63 | Security | Audit | Tamper-evident hash chain | Requires validation | Missing | Full build | `hash`/`prevHash` unpopulated while `audit/page.tsx:200` claims "append-only" | Medium | M | S |
| 64 | Security | Audit | Correct actor role on audit rows | Fully available | Missing | Harden | `actorRole:'school_admin'` hardcoded in 4 sites, 54 of 63 live rows | High | S | M |
| 65 | Security | Audit | Audit page reachable | Fully available | Missing | Harden | `/admin/audit` HTTP 500 — two client symbols called from the server component | Critical | S | M |
| 66 | Security | Audit | Schools mutations audited | Requires validation | Missing | Harden | `schools.controller.ts` — no `auditLog.create` anywhere | Medium | S | S |
| 67 | Security | Ops | User suspend / reactivate | Fully available | Missing | Full build | `POST /api/utilisateurs/{id}/toggle-actif` vs `users.suspend` granted with no implementation | Medium | S | S |
| 68 | Security | Ops | Role revocation from the UI | Not applicable | Missing | Deploy | `DELETE /users/roles/{id}` exists, `revokeRoleAction` imported and never called | Medium | S | M |
| 69 | Security | Ops | Client-side permission gating of controls | Requires validation | Missing | Full build | `hasPermission()` defined at `lib/me.ts:52`, zero call sites | Medium | M | S |
| 70 | Security | Ops | Staff impersonation of the parent portal | Fully available | Missing | Full build | `POST /portail/staff-access {eleveId}` | Medium | S | C |
| 71 | Security | Testing | Any test on the auth layer | Not applicable | Missing | Harden | 0 spec files under `shared/auth`, `modules/identity`, `modules/schools` | High | M | M |
| 72 | Admissions | Pipeline | Explicit multi-stage enrolment pipeline | Fully available | Missing | Full build | 5 statuses with a "next action" each vs `enrollment` all-`active` | Critical | L | M |
| 73 | Admissions | Pipeline | Enrolment-request approve / reject workflow | Fully available | Missing | Full build | `/admin/enrollments` states « … phase R6 »; page permanently empty | Critical | M | M |
| 74 | Admissions | Pipeline | Preinscriptions excluded from headcount | Fully available | Not applicable | — | « Les préinscriptions … sans gonfler cet effectif » | Medium | — | — |
| 75 | Admissions | Portal | Public pre-registration portal with shareable link | Fully available | Partially available | Partial build | 7-state machine + per-dossier SMS vs `parent/child-claims` (404 live) | High | L | S |
| 76 | Admissions | Portal | Family-side document deposit | Fully available | Missing | Full build | portail dossier upload | High | M | S |
| 77 | Admissions | Portal | One-click conversion to enrolled pupil | Fully available | Missing | Full build | `POST /preinscriptions-portail/{id}/convertir` | High | M | S |
| 78 | Admissions | Rules | Payment-gated validation with traced override | Fully available | Not applicable | — | « Règle absolue » + `exceptionDirection`/`exceptionNote` | — | — | — |
| 79 | Admissions | Rules | Pre-payment full-dossier edit window | Fully available | Not applicable | — | `PATCH /preinscriptions/{id}/avant-encaissement` | — | — | — |
| 80 | Admissions | Import | Bulk pupil import with ~60 column aliases | Fully available | Partially available | Partial build | 4 separators, xlsx/xls/csv/txt vs strict headers in `imports-core` | High | M | S |
| 81 | Admissions | Import | Legacy balance carry-over on import | Fully available | Not applicable | — | `montantDejaEncaisse` | High | — | — |
| 82 | Admissions | Import | Downloadable pre-filled CSV template | Fully available | Missing | Harden | `ImportWizard.tsx:73` `window.open` sends no bearer → guaranteed 401 | Medium | S | M |
| 83 | Admissions | Import | Import rollback window | Missing | Fully available | We lead | 24 h countdown + `POST /imports/{id}/rollback` | High | — | — |
| 84 | Admissions | Import | Row-level reconciliation + conflict arbitration | Missing | Inaccessible | Deploy | E11-S2/S4; `import_row.reconciliation` absent from the live DB | High | S | M |
| 85 | Admissions | Import | Wizard step count matches reality | — | Missing | Harden | `useState<1\|2>` behind a 4-step `Stepper`; `new/page.tsx:31` says "Wizard 4 étapes" | Low | S | C |
| 86 | Admissions | Year-end | End-of-year decision engine (DFA) | Fully available | Missing | Full build | `/dfa-preview`, `/decisions`, `/finaliser`, `/rouvrir` vs 0 grep hits | Critical | L | M |
| 87 | Admissions | Year-end | Optimistic locking on decisions | Fully available | Missing | Full build | `expectedDecisionVersion` → `decision_concurrente` | High | S | M |
| 88 | Admissions | Year-end | Non-computability codes instead of a silent wrong answer | Fully available | Missing | Full build | 6 codes incl. `bulletin_officiel_publie_manquant` | High | M | S |
| 89 | Admissions | Year-end | Freeze with fingerprint + motivated reopen | Fully available | Missing | Full build | motive ≥ 10 chars, journalled | High | M | M |
| 90 | Admissions | Year-end | Mass re-enrolment source→destination class | Fully available | Missing | Full build | `POST /inscriptions/masse-reinscription`, excludes exclus/redoublants/sortants | High | M | S |
| 91 | Admissions | Retention | Re-enrolment CRM (6 steps, 4 status axes) | Fully available | Missing | Full build | `/reinscriptions/suivi` | Critical | XL | S |
| 92 | Admissions | Retention | Risk tags on families | Fully available | Missing | Full build | `risque_depart`, `parent_inquiet`, `info_contradictoires`, `rappel_demande` | High | S | S |
| 93 | Admissions | Retention | "No contact for >7 days" filter | Fully available | Missing | Full build | list filter | Medium | S | S |
| 94 | Admissions | Retention | Credit-metered campaign with HTTP 402 | Fully available | Missing | Full build | `POST /sms-campaign/preview` then `/send` | High | M | C |
| 95 | Admissions | Records | Class change mid-year with motive | Fully available | Partially available | Partial build | `PATCH /inscriptions/{id}/changer-classe {motif}` vs transfer with no motive | Medium | S | S |
| 96 | Admissions | Records | Guardians notified on transfer | Requires validation | Missing | Harden | `'transferred'` notification branch declared and unreachable | Medium | S | S |
| 97 | Admissions | Records | Server-allocated matricule with configurable format | Fully available | Partially available | Partial build | `GET /eleves/prochain-matricule` vs free-text `externalRef` + 409 | Medium | S | S |
| 98 | Admissions | Records | Per-pupil audit trail / history / multi-year cursus | Fully available | Missing | Full build | `GET /eleves/{id}/audit,/historique,/cursus` | High | M | S |
| 99 | Admissions | Records | Pupil document upload + conformity control | Fully available | Missing | Full build | `PATCH /documents-eleve/{id}/controle` vs no upload control in the whole app | High | L | M |
| 100 | Admissions | Records | Rich pupil file (9 tabs, responsive tab budget) | Fully available | Partially available | Partial build | 9 tabs vs our 4 | Medium | M | C |
| 101 | Families | Guardians | Guardian detail page | Fully available | Missing | Full build | `/admin/guardians/[id]` does not exist; 4 links 404 | Critical | S | M |
| 102 | Families | Guardians | Guardian list beyond 200 rows | Requires validation | Missing | Harden | `limit=200` cap over 2 487 rows; KPIs and pager report 200 | Critical | S | M |
| 103 | Families | Guardians | Attach-existing-parent picker with search | Fully available | Missing | Harden | plain `<select>` of 200 of 2 487 (`StudentDetailTabs.tsx:758`) | High | S | M |
| 104 | Families | Guardians | Two phone numbers per parent (primary/secondary) | Fully available | Missing | Full build | help `parents-telephone`, auto-split on import | Medium | S | S |
| 105 | Families | Guardians | Guardian CRUD from the admin UI | Fully available | Missing | Deploy | `GET/PATCH/DELETE /guardians/:id` all backend-only | High | S | M |
| 106 | Families | Guardians | Pending-link review queue visible | Fully available | Missing | Harden | 28 `pending` + 29 flagged rows invisible (`/admin/enrollments` broken) | Critical | S | M |
| 107 | Families | Pupils | No fabricated data in pupil lists | — | Missing | Harden | `performanceFromId()` star rating + synthetic `@email.com` on 2 463 rows | High | S | M |
| 108 | Families | Pupils | Pupil delete reachable and guarded | Fully available (2-man) | Missing | Full build | `StudentRowActions.tsx` dead, `deleteStudent` unreachable | Medium | S | S |
| 109 | Finance | Cash | Cash drawer with entries, exits and balance formula | Fully available | Missing | Full build | `/caisse`, « Solde espèces = … » | Critical | L | M |
| 110 | Finance | Cash | Daily closing with printable 5-section PV | Fully available | Missing | Full build | `POST /cloture-caisse`, écart AUCUN/EXCÉDENT/MANQUANT | Critical | L | M |
| 111 | Finance | Cash | One closing per day guard | Fully available | Missing | Full build | `GET /cloture-caisse/check?date` | High | S | M |
| 112 | Finance | Cash | Non-cash expenses excluded from the physical drawer | Fully available | Missing | Full build | « comptabilisés mais marqués hors caisse » | High | S | M |
| 113 | Finance | Cash | Expense approval circuit (brouillon → validée/rejetée) | Fully available | Missing | Full build | direction + comptable only, `noteValidation` | High | M | M |
| 114 | Finance | Receivables | Créances with 4-state lifecycle | Fully available | Missing | Full build | `en_attente/partiellement_paye/solde/annulee` | Critical | L | M |
| 115 | Finance | Receivables | Mass cancellation with 5 guards | Fully available | Missing | Full build | dry-run + cycle isolation + motive + token + count arbitration | High | M | S |
| 116 | Finance | Receivables | Regenerate unpaid scolarité créances | Fully available | Missing | Full build | `POST /inscriptions/regenerer-creances` | Medium | S | C |
| 117 | Finance | Payments | Manual counter encashment (4-step wizard, 8 modes) | Fully available | Missing | Full build | `/paiement-parent` | Critical | L | M |
| 118 | Finance | Payments | Refunds incl. overpayment shortcut | Fully available | Missing | Full build | `POST /paiements/{id}/rembourser`, `tropPercu` | High | M | S |
| 119 | Finance | Payments | Payment links by SMS | Fully available | Missing | Full build | `POST /preinscriptions/{id}/envoyer-lien` | High | M | S |
| 120 | Finance | Online | Four payment aggregators, dynamic path prefix | Fully available | Missing | Full build | `POST /{provider}/init`, Paystack/CinetPay/PayDunya/Hub2 | Critical | L | M |
| 121 | Finance | Online | Per-school PSP credential wizard + validation | Fully available | Missing | Full build | `POST /payment-config/valider` | High | M | M |
| 122 | Finance | Online | Test-mode global banner | Fully available | Missing | Full build | « MODE TEST — Aucun paiement réel n'est encaissé … » | Medium | S | S |
| 123 | Finance | Online | Public unauthenticated parent payment portal | Fully available | Missing | Full build | `GET /paystack/portail/{matricule}` | High | M | S |
| 124 | Finance | Online | PSP request arbitration queue (8 states) | Fully available | Missing | Full build | `POST /paystack/requests/{id}/validate\|reject` | High | M | S |
| 125 | Finance | Online | Second manual reconciliation queue | Fully available | Missing | Full build | `POST /api/reconciliation/{id}/reconcilier` | Medium | M | C |
| 126 | Finance | Fees | Fee catalogue, 18 types, 5 frequencies, 3 scopes | Fully available | Missing | Full build | `categorieFrais.type`, `scopeType: all\|cycles\|classes` | Critical | M | M |
| 127 | Finance | Fees | Instalment scheduling with sum validator | Fully available | Missing | Full build | Sept→June picker, « (écart +N FCFA vs montant total) » | High | S | S |
| 128 | Finance | Fees | Pre-seeded discount catalogue (8 criteria) | Fully available | Missing | Full build | `orphelin`, `fratrie`, `boursier`, … | High | S | S |
| 129 | Finance | Fees | Discounts never apply to inscription | Fully available | Not applicable | — | stated rule | — | — | — |
| 130 | Finance | Services | Generic subscription engine (cantine/transport/other) | Fully available | Missing | Full build | `POST /subscriptions`, `estService` flag | High | L | S |
| 131 | Finance | Services | Month-level suspension and resume | Fully available | Missing | Full build | `POST /subscriptions/{id}/suspend-mois` | Medium | S | C |
| 132 | Finance | Services | Access blocking as a dunning lever | Fully available | Missing | Full build | `accessStatus: allowed\|blocked` | High | S | S |
| 133 | Finance | Services | Additional one-off sales (uniforms, trips) | Fully available | Missing | Full build | `POST /ventes-additionnelles` + `attach-creance` | Medium | M | C |
| 134 | Finance | Dunning | 4-level escalation ladder J+7/30/60/90 | Fully available | Missing | Full build | help `procedures-gestion-impayes` | High | M | S |
| 135 | Finance | Dunning | Communication log per family (7 channel types) | Fully available | Missing | Full build | `POST /relances` | Medium | S | S |
| 136 | Finance | Fraud | 9 typed anti-fraud detectors + triage workflow | Fully available | Missing | Full build | `/anti-fraude`, 3 severities, 4 states | High | L | C |
| 137 | Finance | Fraud | Dashboard fraud banner + bulk false-positive | Fully available | Missing | Full build | `POST /anti-fraude/bulk-resolve` | Medium | S | C |
| 138 | Finance | Budget | Budget prévisionnel + bootstrap from enrolments | Fully available | Missing | Full build | `POST /budget-previsionnel/generer-depuis-inscriptions` | Medium | M | C |
| 139 | Finance | Budget | Prévisionnel vs réel comparison | Fully available | Missing | Full build | `GET /budget-previsionnel/comparaison` | Medium | S | C |
| 140 | Finance | Reporting | Receipts with official state chrome | Fully available | Missing | Full build | Ministère/DRENA/IEPP/armoiries + hardened CSP | High | M | S |
| 141 | Finance | Reporting | Data-quality deep links into filtered views | Fully available | Missing | Full build | `/paiements?filtre=remises_elevees` | Medium | S | C |
| 142 | Finance | Reporting | Financial partition by cycle (`niveauInterface`) | Fully available | Missing | Full build | threaded through créances/paiements/rapports/budget | High | M | S |
| 143 | Finance | Wallet | Prepaid SMS wallet with idempotent recharge | Fully available | Missing | Full build | `GET /sms-wallet/recharge/verify?reference=` | High | M | S |
| 144 | Pedagogy | Periods | Pre-closure readiness check | Fully available | Missing | Full build | `GET /pedagogie/periodes/{id}/pre-cloture-check` | Critical | M | M |
| 145 | Pedagogy | Periods | Period closure (grades become immutable) | Fully available | Missing | Full build | `POST /cloture` vs 0 grep hits | Critical | L | M |
| 146 | Pedagogy | Periods | Motivated reopen that depublishes the parent portal | Fully available | Missing | Full build | « Les parents ne pourront plus consulter les bulletins … » | High | M | M |
| 147 | Pedagogy | Periods | Re-closure on the frozen population | Fully available | Missing | Full build | « une nouvelle version officielle … population figée » | High | M | S |
| 148 | Pedagogy | Periods | Annual weighting with relative coefficients | Fully available | Missing | Full build | `PUT /pedagogie/periodes/ponderation-annuelle` | High | M | M |
| 149 | Pedagogy | Periods | Weighting frozen once a year-end decision is validated | Fully available | Missing | Full build | stated rule | High | S | M |
| 150 | Pedagogy | Periods | Block rather than emit a partial average | Fully available | Missing | Full build | stated rule | High | S | M |
| 151 | Pedagogy | Bulletins | Async bulletin generation job with polling | Fully available | Partially available | Partial build | `GET /generation-jobs/{id}` every 2 s vs our export jobs (not tied to closure) | High | M | S |
| 152 | Pedagogy | Bulletins | Publish only when every PDF is generated and verified | Fully available | Missing | Full build | stated rule | High | S | M |
| 153 | Pedagogy | Bulletins | PROVISOIRE / NON OFFICIEL watermark | Fully available | Missing | Full build | client-generated watermark + red banner | Medium | S | S |
| 154 | Pedagogy | Bulletins | 4-condition gate on official download | Fully available | Missing | Full build | `est_publie && statut_document='valide' && has_pdf && periode_id` | High | S | S |
| 155 | Pedagogy | Bulletins | Rank computed only over graded pupils | Fully available | Requires validation | Harden | « {n}ᵉ sur {m} élèves ayant des notes saisies » | Medium | S | S |
| 156 | Pedagogy | Bulletins | Bulletin registry with statuses and re-download | Fully available | Missing | Full build | `GET /pedagogie/bulletins-registre` | Medium | M | S |
| 157 | Pedagogy | Grades | Batch grade entry | Fully available | Fully available | Parity | both; ours `POST /grades/batch` (but N+1 in a transaction) | — | — | — |
| 158 | Pedagogy | Grades | Coefficient matrix (subject × level) | Fully available | Fully available | Parity | ours `PUT /subjects/coefficients/matrix` — well built | — | — | — |
| 159 | Pedagogy | Grades | Effective coefficient shown to the teacher | Fully available | Missing | Harden | `teacher/classes:77` shows `subject.defaultCoefficient`, ignoring the level override used in the average | Medium | S | M |
| 160 | Pedagogy | Grades | Revise a published grade with a motive | Fully available | Inaccessible | Deploy | `POST /grades/{id}/revise` has zero web callers; `grade_revision` = 0 rows | High | S | M |
| 161 | Pedagogy | Grades | Unpublish an assessment | Fully available | Inaccessible | Deploy | `POST /assessments/{id}/unpublish` has zero callers, yet `DELETE` tells the user to "dépubliez-la d'abord" | Medium | S | M |
| 162 | Pedagogy | Grades | Clear / erase a mistyped grade | Requires validation | Missing | Harden | `Gradebook.tsx:79-90` filters out empty cells — no way to erase | Medium | S | M |
| 163 | Pedagogy | Grades | Publish blocked when pupils have no grade row | Fully available | Missing | Harden | ours counts only null-valued rows, so 2/30 publishes cleanly | High | S | M |
| 164 | Pedagogy | Grades | Gradebook UI reflects state after mutation | — | Missing | Harden | `Gradebook.tsx:18` `useState(initial)` frozen at mount | Medium | S | M |
| 165 | Pedagogy | Lessons | Cahier de textes submit → visa → history | Fully available | Missing | Full build | `POST /cahier-textes/{id}/soumettre\|visa`, versioned `v{n}` | High | M | S |
| 166 | Pedagogy | Lessons | Edit an existing lesson entry | Fully available | Missing | Harden | `UpdateLessonDto` lacks `teachingAssignmentId`/`date` → 400 every time | High | S | M |
| 167 | Pedagogy | Lessons | Lesson attachments | Fully available | Missing | Full build | `attachments` accepted server-side, no writer anywhere in the app | Medium | M | S |
| 168 | Pedagogy | Offline | Offline-first write queue with conflict retention | Fully available | Missing | Full build | IndexedDB, 100 ops / 30 d, 409 `conflictPayload`, `?offlineOperation={id}` | High | XL | S |
| 169 | Pedagogy | Timetable | Weekly timetable with drag-and-drop | Fully available | Missing | Full build | `/emploi-du-temps` vs 0 grep hits | High | L | S |
| 170 | Pedagogy | Timetable | Server conflict detection (teacher/class/room) | Fully available | Missing | Full build | `HTTP 409 {error:'conflit_planification', conflits:[…]}` | High | M | S |
| 171 | Pedagogy | Timetable | Motivated derogation with persistent badge | Fully available | Missing | Full build | motive ≥ 10 chars | Medium | S | C |
| 172 | Pedagogy | Timetable | Room inventory and status | Fully available | Missing | Full build | `PATCH /salles/{id}/statut` vs a free-text 40-char field on the class | Medium | M | S |
| 173 | Pedagogy | Timetable | Weekly volume tracking vs assigned volume | Fully available | Missing | Full build | PED-02 cross-reference | Medium | S | C |
| 174 | Pedagogy | Exams | Exam sitting planning with multi-room allocation | Fully available | Missing | Full build | `/planification-evaluations` | High | L | C |
| 175 | Pedagogy | Exams | Idempotent SMS convocations with cost preview | Fully available | Missing | Full build | one per pupil, « une seconde confirmation ne renvoie pas … » | High | M | C |
| 176 | Pedagogy | Exams | Invigilation documents (émargement, PV) | Fully available | Missing | Full build | `emargement`, `pv-surveillance` | Medium | S | C |
| 177 | Pedagogy | Teaching | Teacher émargement with declare/validate/reject | Fully available | Missing | Full build | only `valide` feeds `minutesRealisees` | High | M | S |
| 178 | Pedagogy | Teaching | Teacher↔HR record link by email, 3 blocking states | Fully available | Missing | Full build | `rhLinkStatus` gate on assignment save | Medium | M | C |
| 179 | Pedagogy | Teaching | Edit weekly hours after assignment creation | Fully available | Inaccessible | Deploy | `UpdateAssignmentDto.weeklyHours` backend-only | Low | S | S |
| 180 | Pedagogy | Teaching | Atomic professeur-principal transfer | Requires validation | Missing | Harden | demote `updateMany` then `create`, no `$transaction` — a race leaves the class with no PP | Medium | S | S |
| 181 | Pedagogy | Curriculum | Pre-loaded national curriculum grids | Fully available | Missing | Full build | `/programmes` seeding, per-cycle and per-série A/C/D | High | M | S |
| 182 | Pedagogy | Curriculum | Rename / recolour / reorder a cycle or level | Fully available | Inaccessible | Deploy | `PATCH /cycles/:id` backend-only, `updateCycle` has zero callers | Medium | S | S |
| 183 | Pedagogy | Curriculum | Edit a term after creation | Fully available | Inaccessible | Deploy | `PATCH /academic-years/terms/:id` backend-only **and unvalidated** | Medium | S | M |
| 184 | Pedagogy | Curriculum | Validated grade-level update | Fully available | Missing | Harden | `@Body() body: Partial<GradeLevelDto>` bypasses the ValidationPipe → mass-assign incl. `tenantId` | Critical | S | M |
| 185 | Pedagogy | Curriculum | Tenant-scoped coefficient writes | Fully available | Missing | Harden | `BulkCoefficientDto` validates only `@IsUUID()` — cross-tenant coefficient overwrite | Critical | S | M |
| 186 | Pedagogy | Curriculum | Create a class from the UI | Fully available | Missing | Harden | `/admin/classes/new` route does not exist; CTA renders the error page | Critical | S | M |
| 187 | Pedagogy | Curriculum | Rename a class / change capacity / close it | Fully available | Inaccessible | Deploy | `UpdateClassDto.{name,maxStudents,status}` backend-only | Medium | S | S |
| 188 | Pedagogy | Curriculum | Reactivate a deactivated subject | Fully available | Inaccessible | Deploy | `UpdateSubjectDto.active` backend-only — deactivation is one-way from the UI | Medium | S | S |
| 189 | Pedagogy | Errors | Machine-readable business-rule error codes | Fully available | Missing | Full build | `periode_cloturee`, `contexte_incoherent`, … vs raw P2002 500s | Medium | M | S |
| 190 | Attendance | Register | Daily register with 4+ statuses | Fully available | Partially available | Harden | `left_early` in the Prisma enum but unreachable in the UI | Medium | S | S |
| 191 | Attendance | Register | Unmarked pupils actually saved | Fully available | Missing | Harden | `AttendanceManager.tsx:216` shows "Présent" by default, `save()` serialises only `marks` → 1 row of 30 | Critical | S | M |
| 192 | Attendance | Register | Save revalidates surrounding panels | — | Missing | Harden | the only mutation module in the app with zero `revalidatePath` | Medium | S | S |
| 193 | Attendance | Register | Session date normalised / school timezone | Fully available (`Africa/Abidjan`) | Missing | Harden | `new Date().toISOString().slice(0,10)` UTC; `class-sessions/open` never normalises to midnight | High | S | M |
| 194 | Attendance | Register | Late arrival duration + motive | Fully available | Partially available | Partial build | Lakoli: 1–600 min + motive ≥ 3 chars; ours has `arrivedAt`/`comment` with no UI | Medium | S | S |
| 195 | Attendance | Justify | Justification workflow reachable | Fully available | Missing | Harden | `POST /attendance/{id}/justify` has **zero callers**, yet the teacher page says « Saisissez les justifications côté administration » | High | S | M |
| 196 | Attendance | Alerts | Threshold-driven absence alerts with severity bands | Fully available | Partially available | Partial build | Lakoli seuil 5 + Critique/Élevé/Alerte; our `HIGH_ABSENCE` rule is disabled and 0 attendance rows exist | High | M | S |
| 197 | Attendance | Alerts | Preview then notify absentee parents | Fully available | Missing | Full build | `POST /presences/preview-absents` then `/notifier-absents` | High | M | S |
| 198 | Attendance | Reporting | Monthly register in PDF + XLSX, same fingerprint | Fully available | Missing | Full build | « la même empreinte de contrôle » | Medium | M | C |
| 199 | Vie scolaire | Discipline | Incident → mesure → convocation chains | Fully available | Missing | Full build | `/vie-scolaire/incidents/*` vs 2 permission strings | High | L | S |
| 200 | Vie scolaire | Discipline | No automatic sanction (human decision enforced) | Fully available | Not applicable | — | « Aucun retard ou signalement ne produit automatiquement une sanction. » | — | — | — |
| 201 | Vie scolaire | Discipline | Incident date clamped to the school year | Fully available | Missing | Full build | auto-clamp on load | Low | S | C |
| 202 | Vie scolaire | Activities | Clubs, membership, activity lifecycle | Fully available | Missing | Full build | `/vie-scolaire/activites/*` | Medium | M | C |
| 203 | Vie scolaire | Activities | Participants immutable once `realisee` | Fully available | Missing | Full build | button only renders for `brouillon\|planifiee` | Low | S | C |
| 204 | Vie scolaire | Activities | Publication to the family portal | Fully available | Missing | Full build | `PATCH /activites/{id}/publication` | Medium | S | C |
| 205 | Vie scolaire | Activities | Fixed 16-row administrative recap print | Fully available | Missing | Full build | client-generated canevas | Low | S | C |
| 206 | Vie scolaire | Protection | Encrypted sensitive-case files | Fully available | Missing | Full build | `/vie-scolaire/suivi-sensible` | High | XL | S |
| 207 | Vie scolaire | Protection | Derived protection domain from case type | Fully available | Missing | Full build | `grossesse→grossesse`, `psychosocial\|abandon→social`, else `sante` | Medium | S | C |
| 208 | Vie scolaire | Protection | Printable anonymised synthesis with small-cell suppression | Fully available | Missing | Full build | `{threshold, cells[{suppressed}]}` | Medium | M | C |
| 209 | Orientation | DOB | End-of-cycle orientation campaign engine | Inaccessible (entitlement-gated) | Missing | Full build | `index-cRnMt47W.js`, 20 ops | High | XL | C |
| 210 | Orientation | DOB | Establishment referential import + publish/lock | Inaccessible | Missing | Full build | client-parsed, formula-rejecting, 500-row batches with provenance | Medium | L | C |
| 211 | Orientation | DOB | Two-phase bulk commit with confirmation token | Inaccessible | Missing | Full build | `bulk-preview → {confirmationToken} → bulk-apply` | Medium | M | C |
| 212 | Orientation | DOB | Arithmetic freeze gate | Inaccessible | Missing | Full build | « Valider et figer » disabled unless `validatedCount === dossierCount > 0` | Low | S | C |
| 213 | Orientation | DOB | Per-pupil Quitus PDF + administrative exports | Inaccessible | Missing | Full build | `GET /orientation/campaigns/{id}/export/quitus?dossierId=` | Medium | M | C |
| 214 | Conformité | Reporting | Statutory form engine (profile → execution → validate) | Inaccessible | Missing | Full build | `index-Ddm3x_E9.js`, 18 ops | High | XL | C |
| 215 | Conformité | Reporting | Derived-field formulas + per-block edit whitelist | Inaccessible | Missing | Full build | `H.1`, `ER.1`–`ER.4`, `CAP.1` | Medium | M | C |
| 216 | Conformité | Import | Content-addressed idempotent import (`reused:true`) | Inaccessible | Partially available | Partial build | Lakoli hashes bytes; ours is idempotent per ADR-024 but not content-addressed | Medium | M | C |
| 217 | Conformité | Import | Magic-byte signature validation on uploads | Inaccessible | Missing | Full build | `signature_xlsx_invalide`, `formule_interdite`, `macro_interdite` | High | S | S |
| 218 | Conformité | Import | Archived source re-download (Direction only) | Inaccessible | Missing | Full build | `GET /conformite/imports/{id}/source` | Medium | S | C |
| 219 | Conformité | Import | Anomaly triage with motive ≥ 5 chars to a compliance journal | Inaccessible | Missing | Full build | Direction/`super_admin` only | Medium | M | C |
| 220 | HR | Records | Staff entity at all | Fully available | Missing | Full build | 42 ops vs no `Staff` model in 54 models | Critical | M | C |
| 221 | HR | Records | Optional login account creation at hire time | Fully available | Missing | Full build | « Utile uniquement si cette personne doit se connecter au logiciel. » | Medium | S | C |
| 222 | HR | Records | Administrative file (CNPS, CMU, parts fiscales, RIB) | Fully available | Missing | Full build | `PUT /personnel/{id}` | High | S | C |
| 223 | HR | Contracts | Full lifecycle create/renew/suspend/resume/terminate | Fully available | Missing | Full build | `POST /personnel/{id}/contrats/{id}/*` | High | M | C |
| 224 | HR | Contracts | Single-active-contract invariant | Fully available | Missing | Full build | « terminera automatiquement le contrat actif en cours » | Medium | S | C |
| 225 | HR | Contracts | Seniority net of suspensions, feeding payroll | Fully available | Missing | Full build | « Ancienneté nette … (suspension en cours déduite) » | Medium | M | C |
| 226 | HR | Contracts | Expiry horizon KPI (60 days) | Fully available | Missing | Full build | amber card « À renouveler dans 60 jours » | Medium | S | C |
| 227 | HR | Contracts | Contract expiry reaches the alert engine | Missing | Missing | Full build | zero « contrat » hits in Lakoli's `alertes-*.js` — **a place we can be better** | Medium | S | C |
| 228 | HR | Payroll | Parametric payroll engine (CNPS/CMU/IRPP/ancienneté) | Fully available | Missing | Full build | `calculAuto`, `POST /paies/apercu` | Critical | XL | W |
| 229 | HR | Payroll | Editable statutory scales (IRPP brackets, seniority) | Fully available | Missing | Full build | `PUT /rh/bareme-irpp/{id}`, `/bareme-anciennete/{id}` | High | M | W |
| 230 | HR | Payroll | 19-code national payroll chart of accounts | Fully available | Missing | Full build | 10 SALAIRE DE BASE … 530 FDFP | High | M | W |
| 231 | HR | Payroll | Non-retroactive parameter changes | Fully available | Missing | Full build | « Les bulletins déjà validés ou payés ne sont jamais recalculés rétroactivement. » | High | S | W |
| 232 | HR | Payroll | Batch payroll with previewHash anti-double-submit | Fully available | Missing | Full build | `POST /paies/lot {periode, previewHash, confirmer:true}` | High | L | W |
| 233 | HR | Payroll | Batch blocked while any record is flagged | Fully available | Missing | Full build | « Corrigez les dossiers signalés avant de continuer » | Medium | S | W |
| 234 | HR | Payroll | One-way payslip ratchet brouillon→validee→payee | Fully available | Missing | Full build | no UI path back | Medium | S | W |
| 235 | HR | Payroll | Payslip PDF with state letterhead + YTD cumul | Fully available | Missing | Full build | « BULLETIN DE PAIE », `Cumul {année}` | High | M | W |
| 236 | HR | Payroll | Server-side payroll export / bank file / CNPS declaration | Missing | Missing | Full build | Lakoli prints client-side only — **a place we can be better** | Medium | M | W |
| 237 | HR | Contractors | Prestataires excluded from payroll, échéancier only | Fully available | Missing | Full build | « pas de bulletin de paie, juste un échéancier » | Medium | S | W |
| 238 | HR | Time | Staff attendance register (6 kinds, 10 reason codes) | Fully available | Missing | Full build | `/rh/pointages` | High | L | W |
| 239 | HR | Time | Kept separate from pupil attendance | Fully available | Not applicable | — | « Ce registre est distinct de l'appel des élèves » | — | — | — |
| 240 | HR | Time | Idempotency key on every attendance write | Fully available | Missing | Full build | `web:{date}:{personnelId}:{kind}:{time}` | Medium | S | C |
| 241 | HR | Time | Two-phase all-or-nothing bulk entry | Fully available | Missing | Full build | `mode:"preview"` → `mode:"confirm"` + `previewHash` | Medium | M | C |
| 242 | HR | Time | Four-eyes decision on batches and corrections | Fully available | Missing | Full build | `created_by === user.id` disables the controls | High | M | C |
| 243 | HR | Time | Non-destructive corrections (original preserved) | Fully available | Missing | Full build | « Le pointage original restera visible. » | Medium | S | C |
| 244 | HR | Time | 4 anomaly detectors on the register | Fully available | Missing | Full build | `MISSING_OUT`, `OUT_WITHOUT_IN`, `CONSECUTIVE_IN`, unusual duration | Medium | M | W |
| 245 | HR | Time | Monthly hours report over validated sessions only | Fully available | Missing | Full build | « Seules les sessions validées sont comptabilisées. » | Medium | S | W |
| 246 | HR | Time | Hardware time-clock integration path | Fully available (EBKN named) | Missing | Full build | « La connexion EBKN sera activée séparément … » | Low | L | W |
| 247 | HR | Leave | Leave request / balance / approval | Missing | Missing | Full build | no `conges` API in Lakoli either — **greenfield for both** | Medium | M | C |
| 248 | Comms | SMS | SMS channel wired at all | Fully available | Missing | Full build | `admin/settings/page.tsx:144` « SMS — Désactivé (canal non câblé) » | Critical | L | M |
| 249 | Comms | SMS | Campaign engine with mandatory dry-run | Fully available | Missing | Full build | `POST /campaigns/{id}/simulate` before `/send` | High | L | S |
| 250 | Comms | SMS | Campaign lifecycle incl. `simulee` demo mode | Fully available | Missing | Full build | 7 statuses | Medium | S | S |
| 251 | Comms | SMS | Segment calculator with cost bar and savings nudge | Fully available (buggy) | Missing | Full build | 160/153 GSM, 70/67 Unicode — **their Unicode predicate is wrong, ours can be right** | Medium | S | S |
| 252 | Comms | SMS | Parent-level dedup / message merging | Fully available | Missing | Full build | « N SMS économisés grâce au regroupement » | High | M | S |
| 253 | Comms | SMS | 24 h payment suppression on dunning campaigns | Fully available | Missing | Full build | automatic exclusion | High | S | S |
| 254 | Comms | SMS | Failure triage, retry, and a global failure bell | Fully available | Missing | Full build | `GET /sms-logs/echecs-recents` polled 60 s + `POST /sms-logs/relance` | High | M | S |
| 255 | Comms | SMS | Prepaid wallet with 5 transaction types | Fully available | Missing | Full build | `WELCOME_BONUS`…`CORRECTION` | High | M | S |
| 256 | Comms | SMS | Hard send-block at zero balance | Fully available | Missing | Full build | HTTP 402 / `soldeInsuffisant` | High | S | S |
| 257 | Comms | Automation | Trigger-event rule engine (16 events, 2 groups) | Fully available | Partially available | Partial build | `/communication/rules` vs our alert rules (in-app/email only) | High | L | S |
| 258 | Comms | Automation | Signed delay (negative = before the event) + send hour | Fully available | Missing | Full build | `delaiJours`, `heureEnvoi` | Medium | S | S |
| 259 | Comms | Automation | Semi-auto mode (server prepares, human validates) | Fully available | Missing | Full build | campaign lands in `prete` | High | M | S |
| 260 | Comms | WhatsApp | WhatsApp deep-link module (zero config, zero cost) | Fully available | Missing | Full build | `/whatsapp` 4 tabs, `wa.me` | High | M | M |
| 261 | Comms | WhatsApp | Contextual balance-aware payment reminder | Fully available | Not applicable | — | pre-filled with the exact FCFA balance | High | — | — |
| 262 | Comms | WhatsApp | 5-branch Ivorian phone normalisation | Fully available | Missing | Full build | `00225→225`, 10-digit, 8-digit branches | Medium | S | S |
| 263 | Comms | WhatsApp | Server-side template storage | Missing (`localStorage`) | Not applicable | We can lead | key `agora_wa_templates_reinscription` — per-browser, unshared | Medium | S | C |
| 264 | Comms | Email | Email to parents as a first-class channel | Fully available | Partially available | Partial build | `POST /messagerie/envoyer-email` + `preview-destinataires-email` vs our notification email dispatch | Medium | M | C |
| 265 | Comms | Announce | Broadcast lists (CRUD, by class or by parent) | Partially available (built, no consumer) | Missing | Full build | no send payload accepts `listeId` | Low | M | C |
| 266 | Comms | Announce | Announcement scopes incl. individual pupil / user | Fully available | Partially available | Partial build | `individual_student`/`individual_user` backend-only; composer union excludes them | Medium | S | S |
| 267 | Comms | Announce | Announcement attachments | Fully available | Missing | Harden | accepted server-side, rendered on the detail page, **never produced by any composer** | Medium | M | S |
| 268 | Comms | Announce | Edit a draft announcement | Fully available | Missing | Harden | « Modifier le brouillon » is a duplicate of « Voir »; `PATCH /announcements/:id` has 0 callers | Medium | S | M |
| 269 | Comms | Announce | Correct engagement stats at scale | Requires validation | Missing | Harden | stats derived from a `take:500` slice ordered `readAt desc` — systematically over-states read rate | Medium | S | S |
| 270 | Comms | Announce | Role-correct notification deep links | Fully available | Missing | Harden | every recipient incl. teachers and admins is sent to `/parent/announcements` | Medium | S | S |
| 271 | Comms | Messaging | Threaded parent↔teacher conversations | Missing | Fully available | We lead | dual-wall ABAC, immutable messages, cursor paging, reporting | High | — | — |
| 272 | Comms | Messaging | Conversation moderation transitions | Requires validation | Missing | Full build | `ConversationReport.status` never written; `reviewed`/`dismissed` unreachable | High | S | M |
| 273 | Comms | Messaging | Inbox preview reflects the latest message | — | Missing | Harden | `lastMessagePreview: r.topic`, frozen at thread creation | Medium | S | S |
| 274 | Comms | Notifications | Per-kind × per-channel preference matrix with cadence | Requires validation | Fully available | We lead | `instant \| daily_digest \| off`, partial-failure reconciliation | High | — | — |
| 275 | Comms | Notifications | Notification centre knows every kind the backend emits | — | Missing | Harden | `message`, `remediation`, `weekly_digest` missing from the union → empty grey pill on live data | Medium | S | M |
| 276 | Comms | Notifications | Global notification bell | Fully available | Fully available | Parity | both | — | — | — |
| 277 | Portals | Parent | OTP-only parent access (no password) | Fully available | Implemented differently | Partial build | « uniquement par code SMS à chaque fois » vs Keycloak account + guardianship claim | High | L | S |
| 278 | Portals | Parent | Parent self-registration / child claim | Requires validation | Inaccessible | Deploy | `POST /parent/child-claims` 404 live; `guardianship_claim` table missing | High | S | M |
| 279 | Portals | Parent | Two distinct family portals (préinscription vs parent) | Fully available | Missing | Full build | different URLs, explicit warning not to confuse them | Medium | M | S |
| 280 | Portals | Parent | Parent-visible finance (créances, historique, payer) | Fully available | Not applicable | — | portal content list | — | — | — |
| 281 | Portals | Parent | White-label portal configuration | Partially available | Partially available | Parity | Lakoli sends `couleur_primaire` with no UI control; ours has a branding form but unvalidated CSS | Low | S | C |
| 282 | Portals | Parent | Alert next-steps + meeting-request intent | Missing | Fully available | We lead | `POST /alerts/{id}/meeting-intent`, `AlertNextSteps` (322 L) | High | — | — |
| 283 | Portals | Parent | ICS export / add-to-calendar | Missing | Fully available | We lead | `/parent/upcoming` | Low | — | — |
| 284 | Portals | Teacher | Priority-ordered teacher home | Fully available | Partially available | Partial build | Lakoli refreshes every 60 s with an explicit priority order; ours is a static dashboard | Medium | M | C |
| 285 | Portals | Teacher | Direction counterpart view with overlap detection | Fully available | Missing | Full build | `GET /espace-enseignant/indicateurs-direction` | Medium | M | C |
| 286 | Portals | Teacher | Data minimisation on class lists | Fully available | Missing | Harden | « Identité scolaire minimale, sans coordonnées familiales ni données financières » | High | S | M |
| 287 | Portals | Student | Dedicated student portal | Missing | Inaccessible | Deploy | ADR-021, 6 pages, `*.self` permissions; whole controller 404 live | High | S | M |
| 288 | Portals | Student | Student portal error boundary | — | Missing | Harden | the only portal with no `error.tsx` | Low | S | S |
| 289 | Docs | Generation | Official document catalogue (10 types) | Fully available | Partially available | Partial build | attestation, carte scolaire, fiche individuelle … vs `report_card_pdf` only | High | L | S |
| 290 | Docs | Generation | Batch ID cards, 4 per A4 sheet to cut out | Fully available | Missing | Full build | `POST /api/documents/finaliser-cartes-classe` | Medium | M | C |
| 291 | Docs | Generation | Unique document number + authenticity QR code | Fully available | Missing | Full build | « n'importe qui peut vérifier l'authenticité … » | High | M | S |
| 292 | Docs | Generation | Document registry with re-download | Fully available | Partially available | Partial build | registry tab vs our exports list | Medium | S | S |
| 293 | Docs | Identity | Upload logo, signature, cachet, en-tête | Fully available | Missing | Full build | 4 image slots + `piedDePage` vs colours only | High | M | M |
| 294 | Docs | Identity | Branding values validated before injection | Requires validation | Missing | Harden | `@IsString @MaxLength` only → raw into `<style dangerouslySetInnerHTML>` on every portal | High | S | M |
| 295 | Docs | Identity | DRENA / IEPP / directeur fields for official headers | Fully available | Missing | Full build | 18-field `PUT /etablissement` | Medium | S | S |
| 296 | Docs | Identity | Editable establishment address / timezone / locale | Fully available | Inaccessible | Deploy | `PATCH /schools/:id` accepts them; the page tells the admin to use the API | Medium | S | S |
| 297 | Docs | Statutory | CIO / StatCIO export wizard + proof history | Fully available | Not applicable | — | `x-lakoli-unmapped-subjects` header | — | — | — |
| 298 | Docs | Statutory | Registre des affectés de l'État with SHA-256 events | Fully available | Not applicable | — | versioned, sealed, legal disclaimer | — | — | — |
| 299 | Docs | Statutory | National exam results capture (BEPC/BAC) | Fully available | Not applicable | — | `brouillon \| valide` internal only | — | — | — |
| 300 | Data | Analytics | Drill-down cycle→classe→matière→élève | Partially available | Fully available | We lead | `PerformanceDrilldown.tsx` 479 L, breadcrumb, term filter | High | — | — |
| 301 | Data | Analytics | Precomputed snapshots with recompute triggers | Requires validation | Fully available | We lead (broken) | `StudentSubjectSnapshot`, `SnapshotRecomputeTrigger` — but the drain cron loops forever on a unique-constraint collision | High | S | M |
| 302 | Data | Analytics | Snapshot ops surface for operators | — | Inaccessible | Deploy | `GET /snapshots/recompute-status`, `POST /snapshots/rebuild` have **no UI at all** | Medium | S | S |
| 303 | Data | Analytics | Health score with anomaly playbook and deep links | Fully available | Partially available | Partial build | `POST /audit-ia/run` (score, Risque/Solution, categories) vs our alert engine (7 of 8 rules, no score) | High | M | S |
| 304 | Data | Analytics | Financial dashboards (12 parallel queries) | Fully available | Not applicable | — | `/dashboard/*` | — | — | — |
| 305 | Data | Analytics | Correct KPI sparklines | — | Missing | Harden | 3 identical `sparkline()` calls labelled as 3 different series | Medium | S | S |
| 306 | Data | Alerts | Configurable pedagogical alert rules as a resource | Missing | Fully available | We lead | 8 rule codes, parameters, severity, `POST /alerts/evaluate`, parent lane | High | — | — |
| 307 | Data | Alerts | Rule parameters clamped server-side | — | Missing | Harden | `parameters` is `@IsObject()` only; the store clamps nothing, each evaluator clamps differently at read time | Medium | S | S |
| 308 | Data | Alerts | Every enableable rule has an evaluator | — | Missing | Harden | `BEHAVIOR_ALERT` toggle is enabled and produces nothing | Medium | S | S |
| 309 | Data | Alerts | Alert closure attribution visible to admins | Requires validation | Missing | Harden | a parent can terminally resolve a school alert; no `resolvedBy` column or DTO field | High | S | S |
| 310 | Data | Exports | Async export pipeline with presigned download | Requires validation | Fully available | We lead | BullMQ → MinIO → signed URL, 5 kinds, 5 live succeeded jobs | High | — | — |
| 311 | Data | Exports | Parameterised export scoping (class, term, range) | Fully available | Missing | Harden | `createExportAction(code, {})` sends empty parameters while the copy promises scoping | High | M | M |
| 312 | Data | Exports | Export retry from the UI | Requires validation | Missing | Harden | the alert strip says "relancer le job depuis la file"; no retry control exists | Medium | S | S |
| 313 | Data | Exports | Grades XLSX covers all classes | Fully available | Missing | Harden | silent `take: 50` truncation with no warning in the file | High | S | M |
| 314 | Data | Exports | ABAC-scoped parent and teacher exports | Requires validation | Fully available | We lead | `exports.execute.parent/.teacher` + guardianship / TA ownership | High | — | — |
| 315 | Data | Interop | OneRoster ingestion adapter | Missing | Inaccessible | Deploy | `roster_source` table absent from the live DB; routes 404 | Medium | S | S |
| 316 | Data | Interop | Full OneRoster bundle (6 members) | Missing | Partially available | Partial build | drawer exposes 3 of 6 (`courses`/`academicSessions`/`orgs` backend-only) | Low | S | C |
| 317 | Data | Interop | Credentials actually sealed in a secret store | Missing | Missing | Harden | `sealCredential` is a stub by its own docblock while the UI promises secure storage | Medium | M | S |
| 318 | Data | Remediation | Tutoring catalogue, availabilities, plans, bookings | Missing | Inaccessible | Deploy | 13 routes 404 live; sweep cron is clean and correct | High | S | M |
| 319 | Data | Remediation | Edit or deactivate a published slot | Missing | Inaccessible | Deploy | `editSlotAction` imported with zero call sites | Medium | S | S |
| 320 | UX | Tables | Sortable columns | Requires validation | Missing | Full build | 0 `aria-sort` / `onSort` in the whole app; one sort *select* on `/parent/subjects` | Medium | M | S |
| 321 | UX | Tables | Bulk row selection and bulk actions | Fully available | Missing | Full build | Lakoli: « Tout sélectionner » on documents and pointage; ours: 11 checkboxes app-wide, none for rows | High | M | S |
| 322 | UX | Tables | Server-side pagination | Fully available | Partially available | Harden | 11 pages paginate a JS array; `/admin/exports` `FETCH_LIMIT = 100` drives KPIs, filters and the pager | High | M | M |
| 323 | UX | Tables | Search that does not re-render on every keystroke | Requires validation | Missing | Harden | `SearchInput` has no debounce; typing "Dupont" = 6 renders × 4 API calls | Medium | S | M |
| 324 | UX | Loading | Route-level skeletons / streaming | Requires validation | Missing | Full build | 0 `loading.tsx` across 104 `force-dynamic` routes; `LoadingState` is dead code | Medium | M | S |
| 325 | UX | Errors | Error state distinguishable from empty state | Requires validation | Missing | Harden | `safe()` collapses 403/404/500 into the empty branch on audit, establishment, settings, analytics, exports, imports | High | S | M |
| 326 | UX | Dialogs | Design-system dialogs for destructive actions | Fully available | Partially available | Harden | native `confirm()`/`alert()`/`prompt()` on apply, rollback, publish, delete, end-enrolment | Medium | S | S |
| 327 | UX | A11y | Table semantics (`<th scope>`, `<caption>`) | Requires validation | Missing | Harden | 13 of 230 `<th scope>`, 0 `<caption>` | Medium | M | S |
| 328 | UX | A11y | One `<h1>` per page | Requires validation | Missing | Harden | duplicate `<h1>` on ~95 pages (`PageHeader` + topbar) | Medium | S | S |
| 329 | UX | A11y | Valid interactive nesting | Requires validation | Missing | Harden | `RowActions` renders a `<button>` inside an `<a>` with `tabIndex={-1}` | Medium | S | S |
| 330 | UX | A11y | Automated a11y gate in CI | Requires validation | Partially available | Harden | axe + Playwright suites exist across 4 portals but **no CI job runs them** | Medium | S | M |
| 331 | UX | System | Component library documentation | Requires validation | Missing | Harden | ADR-016 mandates Storybook; 64 components, **0 stories** | Medium | M | S |
| 332 | UX | System | Dead code in the design system | — | Missing | Harden | 7 components + 15 named exports unreferenced; `DataTable` used once of ~25 tables | Low | S | C |
| 333 | UX | i18n | Multi-language support | Missing (French only) | Fully available | We lead | `packages/i18n` fr + en via next-intl | Medium | — | — |
| 334 | UX | Deploy | Running images match the repository | Requires validation | Missing | Deploy | web **and** API images stale; 4 modules + the student portal 404 | Critical | S | M |
| 335 | UX | Deploy | Database schema matches the code | Requires validation | Missing | Deploy | `roster_source`, `guardianship_claim`, `import_row.reconciliation`, `import_batch.origin/claimed_at` all absent | Critical | S | M |

<!-- SECTION4 -->
