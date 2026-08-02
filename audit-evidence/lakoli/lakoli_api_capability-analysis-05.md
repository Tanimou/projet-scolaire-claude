# Evidence — Lakoli API capability analysis (round 2, corrected)

**Method (confirmed).** All **149 lazy-loaded JS chunks** referenced by the Vite entry bundle were downloaded from `https://lakoli.com/app/assets/` (3.0 MB) alongside the 732 KB entry bundle, and every HTTP call site was extracted programmatically (`.get|.post|.put|.patch|.delete|.getBlob(...)`). Result: **345 distinct API operations** (including 6 binary/blob download routes).

> **Note on completeness of this count.** 345 is a **lower bound**. Per-domain deep inspection by specialist agents found additional operations this repo-wide regex misses — notably query-string-only list routes and calls built through helper wrappers. For example the orientation/conformité/vie-scolaire domain yields **60** operations under close inspection versus **45** from this extraction. Treat 345 as "at least", and the per-domain `deep_*.md` files as authoritative for their own domain.

Raw list: [`lakoli_api_full-endpoint-inventory-04.txt`](lakoli_api_full-endpoint-inventory-04.txt) — format `METHOD /path   [chunk.js]`.

> **Round-1 correction.** The first audit reported « /api/... — 15 endpoints … a lower bound ». That was wrong by a factor of ~20. It only grepped the *entry* bundle for the literal prefix `/api/`, but Lakoli's axios instance carries the `/api` base path, so every module call is written **without** the prefix (`ut.get("/auth/mes-espaces")`). All per-module endpoints therefore live in the lazy chunks and were entirely missed.

## 1. Operation counts by API root (confirmed)

| Root | Ops | Root | Ops | Root | Ops |
|---|---|---|---|---|---|
| pedagogie | 35 | preinscriptions | 8 | affectations-etat | 4 |
| personnel | 29 | rh | 8 | billing | 4 |
| vie-scolaire | 18 | caisse | 6 | demandes-suppression | 4 |
| messagerie | 16 | classes | 6 | budget-previsionnel | 3 |
| orientation | 16 | emploi-du-temps | 6 | calendrier | 3 |
| communication | 15 | subscriptions | 6 | cantine | 3 |
| auth | 11 | annees-scolaires | 5 | categories-frais | 3 |
| eleves | 11 | paystack | 5 | cloture-caisse | 3 |
| inscriptions | 11 | preinscriptions-portail | 5 | documents-eleve | 3 |
| conformite | 10 | programmes | 5 | transport | 3 |
| reinscription-suivi | 9 | sms-logs | 5 | anti-fraude | 3 |
| criteres-remise | 4 | payment-config | 4 | onboarding | 3 |
| ventes-additionnelles | 4 | affectations-enseignants | 4 | parents | 3 |
| portail-config | 3 | sms-wallet | 3 | presences | 3 |
| espace-enseignant | 2 | etablissement | 2 | setup | 2 |
| tenant-exit-exports | 2 | suivi-enseignants | 2 | paiements | 2 |
| dashboard | 1 | generation-jobs | 1 | module-access | 1 |
| audit-ia | 1 | creances | 1 | documents | 1 |
| portail | 1 | relances | 1 | storage / system-banners / utilisateurs / audit / reconciliation / classement | — |

## 2. Three round-1 claims that were WRONG

### 2.1 « `/app/conformite` is a "Module bientôt disponible" placeholder » — **FALSE**

The Conformité module has **10 operations** and a full lifecycle:
```
GET   /conformite/profiles              GET   /conformite/executions
POST  /conformite/executions            GET   /conformite/executions/{id}
POST  /conformite/executions/{id}/generate
PATCH /conformite/executions/{id}/responses
POST  /conformite/executions/{id}/validate
POST  /conformite/imports               GET   /conformite/imports/profile
PATCH /conformite/imports/{id}/anomalies/{id}
```
**Inference (high confidence):** a compliance-campaign engine — a *profile* defines a questionnaire/ruleset, an *execution* is one run of it, responses are recorded, a document is generated and then validated; a parallel import path ingests external data and surfaces per-row **anomalies** that must be resolved.

### 2.2 « `/app/orientation` renders nothing » — **FALSE**

**16 operations**, gated behind module code `orientation_dob`:
```
GET  /orientation/profile                GET  /orientation/referentiels
POST /orientation/referentiels           POST /orientation/referentiels/{id}/etablissements
POST /orientation/referentiels/{id}/publier
GET  /orientation/campaigns              POST /orientation/campaigns
GET  /orientation/campaigns/{id}         POST /orientation/campaigns/{id}/status
POST /orientation/campaigns/{id}/sync-eleves
POST /orientation/campaigns/{id}/bulk-preview
POST /orientation/campaigns/{id}/bulk-apply
POST /orientation/campaigns/{id}/valider
PUT  /orientation/dossiers/{id}          POST /orientation/dossiers/{id}/valider
POST /orientation/dossiers/{id}/reouvrir
```
**Inference (high confidence):** end-of-cycle **orientation / school-assignment campaigns** — publishable *référentiels* listing receiving establishments, a campaign that syncs the eligible students, a **preview-then-bulk-apply** wizard for assigning choices, per-student *dossiers* with validate/reopen, and a campaign-level validation.

### 2.3 « `/app/programmes` renders nothing » — **FALSE**

```
GET  /programmes            PUT  /programmes/{id}/matieres
POST /programmes/{id}/matieres/ajouter
POST /programmes/confirmer  POST /programmes/reinitialiser
```
**Inference (high confidence):** per-class curriculum composition — attach subjects to a programme, confirm it, reset it.

### 2.4 Why the pages looked empty — **the real mechanism (confirmed)**

Lakoli has a **per-module entitlement system**. From the entry bundle's layout component:
```js
{data:Y} = useQuery({queryKey:["module-access-catalog", tenantSlug],
                     queryFn:()=> ut.get("/module-access/catalog").then(r=>r.data), ...})
const he = new Set(Y?.effectiveModules ?? [])                       // unlocked
const _e = new Set(Y?.catalog?.map(c=>c.code).filter(c=>!he.has(c)))  // locked
```
and a **per-page gate** (from the orientation chunk):
```js
useQuery({queryKey:["module-access","orientation_dob"],
          queryFn:()=> d.get("/module-access?module=orientation_dob").then(r=>r.data)})
  → data?.accessible ? <RealPage/> : <LockedUpsellPanel/>
```
Confirmed gated module codes: **`conformite`**, **`orientation_dob`**.

**Therefore:** those screens were **locked on the audited trial tenant**, not unbuilt. Round 1 reported them as product defects/placeholders; that was an incorrect conclusion drawn from an entitlement-gated empty state. `/app/programmes` produced no content for the same class of reason (gating or unconfigured prerequisite) — **requires validation** as to which.

**This entitlement layer is itself a significant capability our platform lacks entirely.**

## 3. Capabilities discovered in round 2 that round 1 missed completely

### 3.1 Assessment-period closure lifecycle (pedagogie) — **major**
```
GET  /pedagogie/periodes/{id}/pre-cloture-check
POST /pedagogie/periodes/{id}/cloture
POST /pedagogie/periodes/{id}/re-cloture
POST /pedagogie/periodes/{id}/re-ouvrir
PUT  /pedagogie/periodes/ponderation-annuelle
```
A pre-closure readiness check, a formal closure, re-closure and re-opening, plus **annual weighting** across periods. Nothing comparable exists in our platform.

### 3.2 Cahier de textes submit-and-countersign workflow
```
POST /pedagogie/cahier-textes/{id}/soumettre
POST /pedagogie/cahier-textes/{id}/visa
GET  /pedagogie/cahier-textes/{id}/historique
```
Teacher submits → management applies a *visa* → full change history.

### 3.3 Class ranking
`GET /pedagogie/classement/{id}/{id}` — computed class ranking (the parent UI showed « Rang de la classe » on our side too, but Lakoli exposes it as a first-class endpoint).

### 3.4 Exam-planning notifications
```
PATCH /pedagogie/planification-evaluations/{id}/convocation
GET   /pedagogie/planification-evaluations/{id}/notifications/preview
POST  /pedagogie/planification-evaluations/{id}/notifications/sms
PATCH /pedagogie/planification-evaluations/{id}/statut
```
Preview-then-send SMS convocations for exam sittings.

### 3.5 A complete payroll engine (personnel + rh) — 37 operations
```
Contracts:      GET|POST /personnel/{id}/contrats
                POST /personnel/{id}/contrats/{id}/{renew|suspend|resume|terminate}
Service contr.: GET|POST /personnel/{id}/contrats-prestation
                POST /personnel/{id}/contrats-prestation/{id}/paiements
Payslips:       GET|POST /personnel/{id}/paies · PUT /personnel/{id}/paies/{id}
                GET /personnel/{id}/paies/{id}/lignes · POST /personnel/{id}/paies/apercu
Batch payroll:  POST /personnel/paies/lot · POST /personnel/paies/lot/apercu
                PATCH /personnel/paies/lot/valider
Scales:         GET|PUT /rh/bareme-anciennete   (seniority scale)
                GET|PUT /rh/bareme-irpp         (income-tax bands)
                GET|PUT /rh/parametres-paie     (payroll parameters)
                GET|PUT /rh/rubriques           (payroll line items)
```
Preview-before-commit at both individual and batch level, configurable statutory scales.

### 3.6 Staff attendance with an approval chain
```
POST  /personnel/presences/manuel           POST  /personnel/presences/manuel/lot
PATCH /personnel/presences/manuel/lots/{id}/decision
POST  /personnel/presences/ajustements      PATCH /personnel/presences/ajustements/{id}/decision
GET   /personnel/presences/audit            GET   /personnel/presences/terminaux
```
Batch entry and adjustment requests, each requiring an explicit **decision**, with a dedicated audit read and hardware-terminal support.

### 3.7 Vie scolaire — a full case-management chain (18 ops)
```
Incidents:  POST /vie-scolaire/incidents
            POST /vie-scolaire/incidents/{id}/mesures
            POST /vie-scolaire/incidents/{id}/convocations
            PATCH /vie-scolaire/incidents/{id}/statut
Measures:   PATCH /vie-scolaire/mesures/{id}/statut
Summons:    PATCH /vie-scolaire/convocations/{id}/statut
Clubs:      POST /vie-scolaire/activites/clubs · PUT .../clubs/{id}/membres
Activities: POST /vie-scolaire/activites · PUT .../{id}/participants
            PATCH .../{id}/statut · PATCH .../{id}/publication
```
Incident → measure → summons, each with its own status machine.

### 3.8 The sensitive-case habilitation system is **manageable in-app**
```
GET /vie-scolaire/suivi-sensible/permissions
PUT /vie-scolaire/suivi-sensible/permissions/{id}
GET /vie-scolaire/suivi-sensible/permissions/me
POST /vie-scolaire/suivi-sensible · GET /{id} · PATCH /{id}/statut
```
Round 1 saw only the refusal screen. The permission grants are a first-class, administrable resource, and a user can query their own effective habilitation (`/permissions/me`).

### 3.9 Two distinct communication engines
```
communication/*  (15)  campaigns + simulate/send/cancel · rules CRUD · templates CRUD · stats
messagerie/*     (16)  envoyer · envoyer-email · listes + membres CRUD
                       preview-destinataires-email · templates CRUD · seed-templates · stats
sms-logs/*       (5)   stats · echecs-recents · relance · auto-config GET/PUT
sms-wallet/*     (3)   balance · packages · recharge
relances         (1)   POST /relances
```
Notable: **`POST /communication/campaigns/{id}/simulate`** (dry-run a campaign before spending credits), **`/communication/rules`** (automation rules as a CRUD resource), **`/sms-logs/auto-config`** (automatic-send configuration), **`/sms-logs/echecs-recents` + `/sms-logs/relance`** (failure triage and retry).

### 3.10 Group / multi-establishment consolidation
```
GET  /auth/establishments          POST /auth/switch-establishment
GET  /auth/mes-espaces             POST /auth/switch-space
GET  /auth/group-summary
POST /auth/group-snapshots         GET /auth/group-snapshots/{id}
POST /auth/group-publications      GET /auth/group-publications/{id}
```
A group layer above the school: consolidated summary, point-in-time **snapshots**, and **publications** (shareable consolidated reports).

### 3.11 Sales / demo mode
`POST /auth/demo`, `POST /auth/presenter`, plus a `demo@lakoli.com` special case in the layout and an « open-demo-modal » window event. A built-in product-demonstration mode.

### 3.12 Finance operations round 1 never saw
```
POST /paiements/{id}/rembourser              refunds
POST /creances/annuler-masse                 bulk-cancel receivables
POST /inscriptions/regenerer-creances        regenerate receivables
POST /inscriptions/suggerer-statuts          suggest enrolment statuses
POST /budget-previsionnel/generer-depuis-inscriptions   budget generated from enrolments
POST /ventes-additionnelles                  additional sales (uniforms, books…)
POST /ventes-additionnelles/{id}/attach-creance
PATCH /ventes-additionnelles/{id}/paiement
GET  /paystack/stats                         PSP dashboard
POST /paystack/requests/{id}/validate|reject manual PSP request arbitration
POST /paystack/init · /paystack/portail/init
GET|PUT|DELETE|POST /payment-config(/valider) per-school PSP configuration + validation
PATCH /cantine/abonnements/{id}/paiement     service-subscription payment
POST|DELETE /cantine/depenses · /transport/depenses
POST /subscriptions · PATCH /{id} · /{id}/cancel · /{id}/resume · /{id}/suspend-mois
POST /subscriptions/sms-relance
```
**`/subscriptions/{id}/suspend-mois`** (suspend a student's service subscription for a month) and **`/subscriptions/sms-relance`** are the kind of operational detail that only comes from running a real school.

### 3.13 Attendance → parent SMS
```
POST /presences/preview-absents      POST /presences/notifier-absents
```
Preview the absentee list, then notify parents — the loop our platform's alerting engine has no channel for.

### 3.14 Enrolment / student operations
```
GET  /eleves/prochain-matricule       next matricule (server-allocated)
GET  /eleves/{id}/audit               per-student audit trail
GET  /eleves/{id}/historique          per-student history
GET  /eleves/{id}/cursus              multi-year career
POST /eleves/import-batch             batch import
POST /eleves/eleves-parents           link students↔parents
POST /classes/{id}/dupliquer · POST /classes/dupliquer     class duplication
POST /documents-eleve · PATCH /documents-eleve/{id}/controle   student document control
PATCH /inscriptions/{id}/changer-classe                    class change
POST /inscriptions/fin-annee/{decisions|dfa-preview|finaliser|rouvrir}
```

### 3.15 Pre-registration payment orchestration
```
POST  /preinscriptions/{id}/envoyer-lien
POST  /preinscriptions/{id}/confirmer-paiement-lien
POST  /preinscriptions/{id}/paiement-especes
PATCH /preinscriptions/{id}/avant-encaissement
PATCH /preinscriptions/{id}/statut
POST  /preinscriptions/{id}/valider
GET   /preinscriptions/stats
```
plus the public portal side: `/preinscriptions-portail/{id}` · `/convertir` · `/message` · `/statut` · `/stats`.

### 3.16 Re-enrolment campaign internals
```
POST /reinscription-suivi/initialiser        POST /reinscription-suivi/campagne
POST /reinscription-suivi/import             PATCH|DELETE /reinscription-suivi/{id}
POST /reinscription-suivi/{id}/reincrire     POST /reinscription-suivi/reincrire-confirmes
POST /reinscription-suivi/sms-campaign/preview
POST /reinscription-suivi/sms-campaign/send
```
Bulk « re-enrol all confirmed » plus a preview-then-send SMS campaign scoped to the funnel.

### 3.17 Platform services
```
GET  /module-access/catalog · GET /module-access?module=<code>   entitlements
GET  /billing/plans · /billing/status · /billing/factures · POST /billing/subscribe
GET|POST /tenant-exit-exports                                    exit archive as a job
GET  /generation-jobs/{id}                                       async document generation
POST /audit-ia/run                                               quality audit run
GET  /onboarding/status · POST /onboarding/bienvenue-vu · /portail-teste
POST /setup/init · GET /setup/ready/{id}                         tenant provisioning
POST /api/storage/upload-direct                                  direct/presigned upload
GET  /api/documents/{id}/download · POST /api/documents/finaliser
POST /api/documents/finaliser-cartes-classe                      batch school-ID cards
GET  /api/payment-providers/recu/{id}                            receipt retrieval
POST /portail/staff-access · GET|POST|PATCH /portail-config
GET  /dashboard/alertes-fraude-recentes
POST /anti-fraude/bulk-resolve · GET /anti-fraude/stats
GET|POST /demandes-suppression · PATCH /{id}/approuver · /{id}/rejeter
POST /affectations-etat · PUT /{id} · GET /{id}/events
POST /emploi-du-temps/salles · PATCH /salles/{id}/statut          room management
GET  /espace-enseignant/accueil · /classes/{id}/eleves
```

## 4. Product telemetry (confirmed)

The layout emits a product-analytics event on every module navigation:
```js
Er("app_module_click", { userId, tenantSlug, metadata:{ module, path, role } })
```
posted to `${B5}/growth/track`. Combined with GA4, Lakoli instruments per-tenant, per-role module usage — the data needed to price and package the entitlement tiers in §2.4.

## 5. Role model — refinement of round 1

Round 1 reported 8 roles from the route guard arrays. The entry bundle confirms a user carries a **single** role (`const _ = n?.role`), and privileged banners gate on `role === "direction" || role === "super_admin"`. So the model is: **one role per user per space**, route guards being allow-lists over that single value. Multi-establishment membership is handled by *space/establishment switching*, not by multiple simultaneous roles.

## 6. Confidence and limits

- Every endpoint above is a **string literal present in shipped code** — confirmed to exist as a client call site. It is **not** proof the server implements it, nor of its request/response shape.
- Semantics of each endpoint are **inferred from its path, HTTP verb and the chunk it lives in**, and are labelled as inference.
- This analysis is *more* complete than UI clicking for structure (it covers entitlement-locked and data-empty screens the UI would never render), but it does **not** replace the UI for visual design, layout, responsiveness or runtime behaviour.
